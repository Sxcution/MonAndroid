package service

import (
	"context"
	"fmt"
	"io"
	"log"
	"net"
	"strings"
	"sync"
	"time"
)

// WebSocketBroadcaster interface to avoid import cycle
type WebSocketBroadcaster interface {
	BroadcastToDevice(deviceID string, message interface{})
	BroadcastToAll(message interface{})
}

// Warm session TTL - keep stream alive after last viewer disconnects
const warmSessionTTL = 120 * time.Second

// StreamState represents the lifecycle state of a device stream
type StreamState int

const (
	StateStopped  StreamState = iota // Not running
	StateStarting                    // scrcpy starting up
	StateRunning                     // Actively streaming
	StateIdle                        // Running but no viewers, waiting for TTL
	StateStopping                    // Cleanup in progress
)

func (s StreamState) String() string {
	return [...]string{"STOPPED", "STARTING", "RUNNING", "IDLE", "STOPPING"}[s]
}

// StreamingService handles real-time screen streaming for devices
type StreamingService struct {
	deviceManager *DeviceManager
	wsHub         WebSocketBroadcaster
	streams       map[string]*deviceStream
	mu            sync.RWMutex
}

// deviceStream holds the device-scoped context and state
// Lives across multiple client sessions (not tied to any single client)
type deviceStream struct {
	deviceID     string
	deviceADBID  string
	scrcpyClient *ScrcpyClient

	// State machine - protected by mu
	state StreamState
	mu    sync.Mutex

	// Device-scoped context (not tied to any client)
	devCtx    context.Context
	devCancel context.CancelFunc

	// Viewer management
	viewers   int         // Number of active WS subscribers
	idleTimer *time.Timer // TTL countdown when viewers=0

	// Cached headers for instant client attach
	spsPkt     []byte
	ppsPkt     []byte
	lastIDRPkt []byte
}

// NewStreamingService creates a new streaming service
func NewStreamingService(dm *DeviceManager, wsHub WebSocketBroadcaster) *StreamingService {
	return &StreamingService{
		deviceManager: dm,
		wsHub:         wsHub,
		streams:       make(map[string]*deviceStream),
	}
}

// StartStreaming starts or attaches to streaming for a device
// Uses state machine to handle concurrent requests safely
func (s *StreamingService) StartStreaming(deviceID string) error {
	s.mu.Lock()

	stream, exists := s.streams[deviceID]
	if !exists {
		// Create new stream entry
		device := s.deviceManager.GetDevice(deviceID)
		if device == nil {
			s.mu.Unlock()
			return fmt.Errorf("device not found: %s", deviceID)
		}
		if device.Status != "online" {
			s.mu.Unlock()
			return fmt.Errorf("device offline: %s", deviceID)
		}

		stream = &deviceStream{
			deviceID:    deviceID,
			deviceADBID: device.ADBDeviceID,
			state:       StateStopped,
		}
		s.streams[deviceID] = stream
	}
	s.mu.Unlock()

	// Now work with the stream under its own lock
	stream.mu.Lock()
	defer stream.mu.Unlock()

	log.Printf("🚀 [%s] StartStreaming called (state=%s, viewers=%d)", deviceID, stream.state, stream.viewers)

	switch stream.state {
	case StateRunning, StateIdle:
		// Stream already running - just increment viewers if needed
		// Cancel idle timer if exists
		if stream.idleTimer != nil {
			stream.idleTimer.Stop()
			stream.idleTimer = nil
			log.Printf("⏱️ [%s] Idle timer cancelled", deviceID)
		}
		if stream.state == StateIdle {
			stream.state = StateRunning
			log.Printf("▶️ [%s] Resuming from IDLE to RUNNING", deviceID)
		}
		return nil

	case StateStarting:
		// Already starting, just wait
		log.Printf("⏳ [%s] Already starting, skipping duplicate start", deviceID)
		return nil

	case StateStopping:
		// Wait for stop to complete, or return busy
		log.Printf("⏳ [%s] Currently stopping, please retry", deviceID)
		return fmt.Errorf("stream is stopping, retry later")

	case StateStopped:
		// Start fresh
		stream.state = StateStarting
		log.Printf("🆕 [%s] Starting fresh stream", deviceID)

		// Create device-scoped context
		stream.devCtx, stream.devCancel = context.WithCancel(context.Background())

		// Create scrcpy client
		adbClient := s.deviceManager.GetADBClient()
		stream.scrcpyClient = NewScrcpyClient(adbClient, stream.deviceADBID)

		// Start streaming goroutine
		go s.runStream(stream)
		return nil
	}

	return nil
}

// runStream manages the scrcpy streaming lifecycle for a device
// Includes auto-reconnect on unexpected stream termination
func (s *StreamingService) runStream(stream *deviceStream) {
	const maxReconnectAttempts = 3
	reconnectAttempt := 0

	defer func() {
		stream.mu.Lock()
		log.Printf("🛑 [%s] Stream goroutine ending (state=%s)", stream.deviceID, stream.state)
		stream.state = StateStopped
		if stream.scrcpyClient != nil {
			stream.scrcpyClient.Stop()
			stream.scrcpyClient = nil
		}
		stream.devCancel = nil
		stream.devCtx = nil
		stream.mu.Unlock()
	}()

	for reconnectAttempt <= maxReconnectAttempts {
		// Start scrcpy and get the connection
		stream.mu.Lock()
		if stream.state != StateStarting && stream.state != StateRunning {
			log.Printf("⚠️ [%s] State changed during startup, aborting", stream.deviceID)
			stream.mu.Unlock()
			return
		}

		// If reconnecting, recreate scrcpy client
		if reconnectAttempt > 0 {
			log.Printf("🔄 [%s] Reconnect attempt %d/%d", stream.deviceID, reconnectAttempt, maxReconnectAttempts)
			if stream.scrcpyClient != nil {
				stream.scrcpyClient.Stop()
			}
			adbClient := s.deviceManager.GetADBClient()
			stream.scrcpyClient = NewScrcpyClient(adbClient, stream.deviceADBID)
		}

		scrcpyClient := stream.scrcpyClient
		stream.mu.Unlock()

		conn, err := scrcpyClient.Start()
		if err != nil {
			log.Printf("❌ [%s] Failed to start scrcpy (attempt %d): %v", stream.deviceID, reconnectAttempt+1, err)
			reconnectAttempt++
			if reconnectAttempt <= maxReconnectAttempts {
				// Exponential backoff: 2s, 4s, 8s
				backoff := time.Duration(1<<reconnectAttempt) * time.Second
				log.Printf("⏳ [%s] Waiting %v before retry...", stream.deviceID, backoff)
				time.Sleep(backoff)
				continue
			}
			return
		}

		// Transition to RUNNING
		stream.mu.Lock()
		if stream.state != StateStarting && stream.state != StateRunning {
			log.Printf("⚠️ [%s] State changed during scrcpy connect, aborting", stream.deviceID)
			stream.mu.Unlock()
			return
		}
		stream.state = StateRunning
		ctx := stream.devCtx
		log.Printf("✅ [%s] Stream now RUNNING (attempt %d)", stream.deviceID, reconnectAttempt+1)
		stream.mu.Unlock()

		// TCP optimizations
		if tc, ok := conn.(*net.TCPConn); ok {
			tc.SetNoDelay(true)
			tc.SetReadBuffer(1 << 20)
			tc.SetWriteBuffer(1 << 20)
		}

		log.Printf("🎬 [%s] Started H.264 stream from scrcpy", stream.deviceID)

		// Consume H.264 stream (blocks until stream ends or context cancelled)
		streamStartTime := time.Now()
		s.consumeH264(ctx, stream.deviceID, conn)
		streamDuration := time.Since(streamStartTime)

		// Check if stream was cancelled by user or stopped externally
		stream.mu.Lock()
		if stream.state == StateStopping || stream.state == StateStopped {
			log.Printf("🛑 [%s] Stream stopped by user", stream.deviceID)
			stream.mu.Unlock()
			return
		}
		stream.mu.Unlock()

		// If stream lasted less than 5 seconds, it's likely an encoder crash - retry
		if streamDuration < 5*time.Second {
			reconnectAttempt++
			log.Printf("⚠️ [%s] Stream died after %v (attempt %d) - will retry",
				stream.deviceID, streamDuration.Round(time.Millisecond), reconnectAttempt)
			if reconnectAttempt <= maxReconnectAttempts {
				backoff := time.Duration(1<<reconnectAttempt) * time.Second
				log.Printf("⏳ [%s] Waiting %v before retry...", stream.deviceID, backoff)
				time.Sleep(backoff)
				continue
			}
		} else {
			// Stream lasted a reasonable time, just reconnect without incrementing attempts
			log.Printf("📺 [%s] Stream ended after %v, reconnecting...", stream.deviceID, streamDuration.Round(time.Second))
			reconnectAttempt = 0 // Reset since it worked for a while
			time.Sleep(500 * time.Millisecond)
			continue
		}
	}

	log.Printf("❌ [%s] Giving up after %d reconnect attempts", stream.deviceID, maxReconnectAttempts)
}

// StopStreaming stops streaming for a specific device (force stop)
func (s *StreamingService) StopStreaming(deviceID string) error {
	s.mu.RLock()
	stream, exists := s.streams[deviceID]
	s.mu.RUnlock()

	if !exists {
		log.Printf("⚠️ [%s] StopStreaming called but stream not found", deviceID)
		return nil
	}

	stream.mu.Lock()
	defer stream.mu.Unlock()

	log.Printf("� [%s] StopStreaming called (state=%s)", deviceID, stream.state)

	if stream.state == StateStopped || stream.state == StateStopping {
		return nil
	}

	stream.state = StateStopping

	// Cancel idle timer
	if stream.idleTimer != nil {
		stream.idleTimer.Stop()
		stream.idleTimer = nil
	}

	// Cancel device context
	if stream.devCancel != nil {
		stream.devCancel()
	}

	return nil
}

// AddViewer increments the viewer count for a device
func (s *StreamingService) AddViewer(deviceID string) {
	s.mu.RLock()
	stream, exists := s.streams[deviceID]
	s.mu.RUnlock()

	if !exists {
		return
	}

	stream.mu.Lock()
	defer stream.mu.Unlock()

	stream.viewers++
	log.Printf("�️ [%s] Viewer added (total: %d, state: %s)", deviceID, stream.viewers, stream.state)

	// Cancel idle timer if exists
	if stream.idleTimer != nil {
		stream.idleTimer.Stop()
		stream.idleTimer = nil
		log.Printf("⏱️ [%s] Idle timer cancelled by new viewer", deviceID)
	}

	// Resume from idle if needed
	if stream.state == StateIdle {
		stream.state = StateRunning
		log.Printf("▶️ [%s] Resumed from IDLE to RUNNING", deviceID)
	}
}

// RemoveViewer decrements the viewer count and starts idle timer if no viewers
func (s *StreamingService) RemoveViewer(deviceID string) {
	s.mu.RLock()
	stream, exists := s.streams[deviceID]
	s.mu.RUnlock()

	if !exists {
		return
	}

	stream.mu.Lock()
	defer stream.mu.Unlock()

	if stream.viewers > 0 {
		stream.viewers--
	}
	log.Printf("👁️ [%s] Viewer removed (remaining: %d, state: %s)", deviceID, stream.viewers, stream.state)

	// Start idle timer if no viewers and currently running
	if stream.viewers == 0 && stream.state == StateRunning {
		stream.state = StateIdle
		log.Printf("⏸️ [%s] Entering IDLE state, starting %.0fs timer", deviceID, warmSessionTTL.Seconds())

		stream.idleTimer = time.AfterFunc(warmSessionTTL, func() {
			s.handleIdleTimeout(deviceID)
		})
	}
}

// handleIdleTimeout is called when idle timer expires
func (s *StreamingService) handleIdleTimeout(deviceID string) {
	s.mu.RLock()
	stream, exists := s.streams[deviceID]
	s.mu.RUnlock()

	if !exists {
		return
	}

	stream.mu.Lock()
	defer stream.mu.Unlock()

	// Only kill if still idle with no viewers
	if stream.viewers == 0 && stream.state == StateIdle {
		log.Printf("💤 [%s] Idle timeout reached, stopping warm stream", deviceID)
		stream.state = StateStopping

		// Cancel device context to stop goroutine
		if stream.devCancel != nil {
			stream.devCancel()
		}
	} else {
		log.Printf("⏱️ [%s] Idle timeout ignored (viewers=%d, state=%s)", deviceID, stream.viewers, stream.state)
	}
}

// GetStreamData returns cached SPS, PPS, and last IDR for instant decode
func (s *StreamingService) GetStreamData(deviceID string) (sps, pps, idr []byte) {
	s.mu.RLock()
	stream, exists := s.streams[deviceID]
	s.mu.RUnlock()

	if !exists {
		return nil, nil, nil
	}

	stream.mu.Lock()
	defer stream.mu.Unlock()

	if stream.spsPkt != nil {
		sps = make([]byte, len(stream.spsPkt))
		copy(sps, stream.spsPkt)
	}
	if stream.ppsPkt != nil {
		pps = make([]byte, len(stream.ppsPkt))
		copy(pps, stream.ppsPkt)
	}
	if stream.lastIDRPkt != nil {
		idr = make([]byte, len(stream.lastIDRPkt))
		copy(idr, stream.lastIDRPkt)
	}
	return sps, pps, idr
}

// GetViewerCount returns the current viewer count for a device
func (s *StreamingService) GetViewerCount(deviceID string) int {
	s.mu.RLock()
	stream, exists := s.streams[deviceID]
	s.mu.RUnlock()

	if !exists {
		return 0
	}

	stream.mu.Lock()
	defer stream.mu.Unlock()
	return stream.viewers
}

// IsStreaming checks if a device is currently streaming
func (s *StreamingService) IsStreaming(deviceID string) bool {
	s.mu.RLock()
	stream, exists := s.streams[deviceID]
	s.mu.RUnlock()

	if !exists {
		return false
	}

	stream.mu.Lock()
	defer stream.mu.Unlock()
	return stream.state == StateRunning || stream.state == StateIdle || stream.state == StateStarting
}

// consumeH264 reads raw H.264 stream and broadcasts NAL units
func (s *StreamingService) consumeH264(ctx context.Context, deviceID string, r io.Reader) {
	log.Printf("🎬 Consuming H.264 stream: %s", deviceID)

	accBuf := make([]byte, 0, 1024*1024)
	readBuf := make([]byte, 65536)
	frameCount := 0

	for {
		select {
		case <-ctx.Done():
			log.Printf("⏹️ [%s] Stream context cancelled", deviceID)
			return
		default:
		}

		if conn, ok := r.(net.Conn); ok {
			conn.SetReadDeadline(time.Now().Add(5 * time.Second))
		}

		n, err := r.Read(readBuf)
		if n > 0 {
			if len(accBuf) == 0 && frameCount == 0 {
				log.Printf("� [%s] First data chunk received: %d bytes", deviceID, n)
			}
			accBuf = append(accBuf, readBuf[:n]...)
		}

		if err != nil {
			if netErr, ok := err.(net.Error); ok && netErr.Timeout() {
				continue
			}
			// Handle "connection reset by peer" - can happen with ADB WiFi
			errStr := err.Error()
			if strings.Contains(errStr, "connection reset") || strings.Contains(errStr, "forcibly closed") {
				log.Printf("⚠️ [%s] Connection reset, retrying...", deviceID)
				time.Sleep(200 * time.Millisecond)
				continue
			}
			// Specific EOF logging for WiFi/encoder debugging
			if err == io.EOF {
				log.Printf("⚠️ [%s] Stream closed by remote device (EOF) - Check WiFi stability or device encoder", deviceID)
			} else if !strings.Contains(errStr, "use of closed network connection") {
				log.Printf("❌ [%s] Stream read error: %v", deviceID, err)
			}
			return
		}

		// Extract and broadcast NAL units
		for {
			nalData, remaining := extractNAL(accBuf)
			if nalData == nil {
				break
			}
			accBuf = remaining
			s.broadcastNAL(deviceID, nalData, &frameCount)
		}
	}
}

// extractNAL extracts a single NAL unit from buffer
func extractNAL(buf []byte) (nalData []byte, remaining []byte) {
	if len(buf) < 4 {
		return nil, buf
	}

	startIdx := findStartCodeIndex(buf)
	if startIdx < 0 {
		return nil, buf
	}

	searchStart := startIdx + 3
	if len(buf) > startIdx+3 && buf[startIdx+2] == 0 {
		searchStart = startIdx + 4
	}

	nextIdx := -1
	for i := searchStart; i < len(buf)-2; i++ {
		if buf[i] == 0 && buf[i+1] == 0 && (buf[i+2] == 1 || (buf[i+2] == 0 && i+3 < len(buf) && buf[i+3] == 1)) {
			nextIdx = i
			break
		}
	}

	if nextIdx > 0 {
		return buf[startIdx:nextIdx], buf[nextIdx:]
	}

	if len(buf) > 1024*100 {
		return buf[startIdx:], nil
	}

	return nil, buf
}

// findStartCodeIndex finds the position of 00 00 01 or 00 00 00 01
func findStartCodeIndex(data []byte) int {
	n := len(data)
	for i := 0; i < n-2; i++ {
		if data[i] == 0 && data[i+1] == 0 && data[i+2] == 1 {
			if i > 0 && data[i-1] == 0 {
				return i - 1
			}
			return i
		}
	}
	return -1
}

// broadcastNAL sends a single NAL unit to WebSocket
func (s *StreamingService) broadcastNAL(deviceID string, nalData []byte, frameCount *int) {
	if len(nalData) == 0 {
		return
	}

	*frameCount++

	if *frameCount == 1 {
		log.Printf("🎞️ [%s] First NAL received (%d bytes)", deviceID, len(nalData))
	} else if *frameCount%1000 == 0 {
		log.Printf("📹 [%s] Streaming: %d NALs sent", deviceID, *frameCount)
	}

	idLen := len(deviceID)
	if idLen > 255 {
		return
	}

	pkt := make([]byte, 1+idLen+len(nalData))
	pkt[0] = byte(idLen)
	copy(pkt[1:], []byte(deviceID))
	copy(pkt[1+idLen:], nalData)

	s.wsHub.BroadcastToDevice(deviceID, pkt)

	// Extract NAL type
	nalType := -1
	if len(nalData) >= 4 && nalData[0] == 0 && nalData[1] == 0 {
		if nalData[2] == 1 {
			nalType = int(nalData[3] & 0x1F)
		} else if nalData[2] == 0 && nalData[3] == 1 && len(nalData) > 4 {
			nalType = int(nalData[4] & 0x1F)
		}
	}

	// Cache SPS/PPS/IDR
	if nalType == 5 || nalType == 7 || nalType == 8 {
		s.mu.RLock()
		stream, exists := s.streams[deviceID]
		s.mu.RUnlock()

		if exists {
			stream.mu.Lock()
			if nalType == 7 {
				stream.spsPkt = make([]byte, len(pkt))
				copy(stream.spsPkt, pkt)
			} else if nalType == 8 {
				stream.ppsPkt = make([]byte, len(pkt))
				copy(stream.ppsPkt, pkt)
			} else if nalType == 5 {
				stream.lastIDRPkt = make([]byte, len(pkt))
				copy(stream.lastIDRPkt, pkt)
			}
			stream.mu.Unlock()
		}
	}
}

// Control socket methods

// SendKeyEvent sends a key press/release to a device
func (s *StreamingService) SendKeyEvent(deviceID string, action, keycode, metastate int) error {
	s.mu.RLock()
	stream, exists := s.streams[deviceID]
	s.mu.RUnlock()

	if !exists || stream.scrcpyClient == nil {
		return fmt.Errorf("stream not found for device: %s", deviceID)
	}

	return stream.scrcpyClient.SendKeyEvent(action, keycode, metastate)
}

// SendText injects text directly to a device
func (s *StreamingService) SendText(deviceID string, text string) error {
	s.mu.RLock()
	stream, exists := s.streams[deviceID]
	s.mu.RUnlock()

	if !exists || stream.scrcpyClient == nil {
		return fmt.Errorf("stream not found for device: %s", deviceID)
	}

	return stream.scrcpyClient.SendText(text)
}

// SendClipboard sets Android clipboard and optionally pastes
func (s *StreamingService) SendClipboard(deviceID string, text string, paste bool) error {
	s.mu.RLock()
	stream, exists := s.streams[deviceID]
	s.mu.RUnlock()

	if !exists || stream.scrcpyClient == nil {
		return fmt.Errorf("stream not found for device: %s", deviceID)
	}

	return stream.scrcpyClient.SendClipboard(text, paste)
}

// HasControl checks if a device has control socket available
func (s *StreamingService) HasControl(deviceID string) bool {
	s.mu.RLock()
	stream, exists := s.streams[deviceID]
	s.mu.RUnlock()

	if !exists || stream.scrcpyClient == nil {
		return false
	}

	return stream.scrcpyClient.HasControl()
}

// StartAllStreaming starts streaming for all online devices
func (s *StreamingService) StartAllStreaming() error {
	devices := s.deviceManager.GetAllDevices()
	for _, device := range devices {
		if device.Status == "online" {
			if err := s.StartStreaming(device.ID); err != nil {
				log.Printf("⚠️ Failed to start streaming for %s: %v", device.ID, err)
			}
		}
	}
	return nil
}

// StopAllStreaming stops all active streams
func (s *StreamingService) StopAllStreaming() {
	s.mu.RLock()
	deviceIDs := make([]string, 0, len(s.streams))
	for id := range s.streams {
		deviceIDs = append(deviceIDs, id)
	}
	s.mu.RUnlock()

	for _, id := range deviceIDs {
		s.StopStreaming(id)
	}
}

// GetStreamingStatus returns the status of all streams
func (s *StreamingService) GetStreamingStatus() map[string]interface{} {
	s.mu.RLock()
	defer s.mu.RUnlock()

	status := make(map[string]interface{})
	for id, stream := range s.streams {
		stream.mu.Lock()
		status[id] = map[string]interface{}{
			"state":   stream.state.String(),
			"viewers": stream.viewers,
		}
		stream.mu.Unlock()
	}
	return status
}
