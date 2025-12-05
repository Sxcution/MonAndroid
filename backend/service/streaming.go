package service

import (
	"context"
	"fmt"
	"io"
	"log"
	"net"
	"sync"
	"time"
)

// WebSocketBroadcaster interface to avoid import cycle
// Supports both binary ([]byte) and JSON (interface{}) messages
type WebSocketBroadcaster interface {
	BroadcastToDevice(deviceID string, message interface{}) // Can be []byte or map
	BroadcastToAll(message interface{})
}

// StreamingService handles real-time screen streaming for devices
type StreamingService struct {
	deviceManager *DeviceManager
	wsHub         WebSocketBroadcaster
	streams       map[string]*deviceStream
	mu            sync.RWMutex
	stopChan      chan bool
}

type deviceStream struct {
	deviceID     string
	deviceADBID  string
	isStreaming  bool
	stopChan     chan bool
	fps          int
	scrcpyClient *ScrcpyClient // Scrcpy client for this device
	ctx          context.Context
	cancel       context.CancelFunc
	// Cache SPS/PPS headers để gửi cho client mới subscribe
	spsPkt []byte
	ppsPkt []byte
	mu     sync.RWMutex // Mutex để bảo vệ header
}

// NewStreamingService creates a new streaming service
func NewStreamingService(dm *DeviceManager, wsHub WebSocketBroadcaster) *StreamingService {
	return &StreamingService{
		deviceManager: dm,
		wsHub:         wsHub,
		streams:       make(map[string]*deviceStream),
		stopChan:      make(chan bool),
	}
}

// StartStreaming starts streaming for a specific device using scrcpy
func (s *StreamingService) StartStreaming(deviceID string) error {
	s.mu.Lock()
	defer s.mu.Unlock()

	log.Printf("🚀 StartStreaming called for %s", deviceID)

	// Check if already streaming
	if stream, exists := s.streams[deviceID]; exists && stream.isStreaming {
		log.Printf("Device %s is already streaming, returning success", deviceID)
		return nil
	}

	// Get device info
	device := s.deviceManager.GetDevice(deviceID)
	if device == nil {
		log.Printf("❌ Device not found in manager: %s", deviceID)
		return fmt.Errorf("device not found: %s", deviceID)
	}

	if device.Status != "online" {
		return fmt.Errorf("device offline: %s", deviceID)
	}

	// Create context for this stream
	ctx, cancel := context.WithCancel(context.Background())

	// Create scrcpy client
	adbClient := s.deviceManager.GetADBClient()
	scrcpyClient := NewScrcpyClient(adbClient, device.ADBDeviceID)

	// Create stream object
	stream := &deviceStream{
		deviceID:     deviceID,
		deviceADBID:  device.ADBDeviceID,
		isStreaming:  true,
		stopChan:     make(chan bool),
		fps:          30,
		scrcpyClient: scrcpyClient,
		ctx:          ctx,
		cancel:       cancel,
	}

	s.streams[deviceID] = stream

	// Start streaming goroutine
	go s.streamWithScrcpy(stream)

	fmt.Printf("✅ Started scrcpy streaming for device %s\n", deviceID)
	return nil
}

// StopStreaming stops streaming for a specific device
// Idempotent: can be called multiple times safely
func (s *StreamingService) StopStreaming(deviceID string) error {
	s.mu.Lock()
	defer s.mu.Unlock()

	stream, exists := s.streams[deviceID]
	if !exists {
		log.Printf("⚠️ StopStreaming called for %s but stream not found (already stopped)", deviceID)
		return nil
	}

	stream.isStreaming = false

	// Cancel context to signal goroutine to stop
	if stream.cancel != nil {
		stream.cancel()
	}

	// Close stopChan to signal stop (check if already closed)
	select {
	case <-stream.stopChan:
		// Channel already closed
	default:
		close(stream.stopChan)
	}

	// Stop scrcpy client (handles process kill, socket close, forward removal)
	if stream.scrcpyClient != nil {
		stream.scrcpyClient.Stop()
	}

	delete(s.streams, deviceID)

	log.Printf("✅ Stopped streaming for device %s", deviceID)
	return nil
}

// cleanupStream is internal cleanup called from goroutine defer
func (s *StreamingService) cleanupStream(deviceID string) {
	s.mu.Lock()
	defer s.mu.Unlock()

	stream, exists := s.streams[deviceID]
	if !exists {
		return // Already cleaned up
	}

	// Stop scrcpy client
	if stream.scrcpyClient != nil {
		stream.scrcpyClient.Stop()
	}

	delete(s.streams, deviceID)
}

// streamWithScrcpy manages the scrcpy streaming for a device
func (s *StreamingService) streamWithScrcpy(stream *deviceStream) {
	defer func() {
		log.Printf("🛑 Scrcpy stream ended for %s", stream.deviceID)
		s.cleanupStream(stream.deviceID)
	}()

	// Start scrcpy and get the connection
	conn, err := stream.scrcpyClient.Start()
	if err != nil {
		log.Printf("❌ Failed to start scrcpy for %s: %v", stream.deviceID, err)
		return
	}

	log.Printf("🎬 Started H.264 stream from scrcpy: %s", stream.deviceID)

	// Consume H.264 stream (blocks until stream ends or context cancelled)
	s.consumeH264(stream.ctx, stream.deviceID, conn)
}

// consumeH264 reads raw H.264 stream and broadcasts NAL units
func (s *StreamingService) consumeH264(ctx context.Context, deviceID string, r io.Reader) {
	log.Printf("🎬 Consuming H.264 stream: %s", deviceID)

	// Buffer chứa dữ liệu tích lũy
	accBuf := make([]byte, 0, 1024*1024)

	// Buffer tạm để đọc từ stream
	readBuf := make([]byte, 4096)

	frameCount := 0

	for {
		// Check if context is cancelled
		select {
		case <-ctx.Done():
			log.Printf("⏹️ Stream context cancelled for %s", deviceID)
			return
		default:
		}

		// Set read deadline to allow checking context periodically
		if conn, ok := r.(net.Conn); ok {
			conn.SetReadDeadline(time.Now().Add(1 * time.Second))
		}

		// 1. Đọc dữ liệu mới từ stream
		n, err := r.Read(readBuf)
		if n > 0 {
			accBuf = append(accBuf, readBuf[:n]...)
		}

		if err != nil {
			if netErr, ok := err.(net.Error); ok && netErr.Timeout() {
				// Timeout is expected, continue to check context
				continue
			}
			if err != io.EOF {
				log.Printf("Error reading H.264 stream for %s: %v", deviceID, err)
			}
			return
		}

		// 2. Xử lý cắt NAL Unit từ accBuf
		for {
			// Tìm Start Code đầu tiên
			startIdx := findStartCodeIndex(accBuf)
			if startIdx == -1 {
				// Không có start code -> Chờ đọc thêm
				if len(accBuf) > 100000 {
					accBuf = accBuf[:0]
				}
				break
			}

			// Nếu start code không nằm ở đầu, vứt bỏ phần rác
			if startIdx > 0 {
				accBuf = accBuf[startIdx:]
				startIdx = 0
			}

			// Tìm Start Code THỨ HAI
			nextStartIdx := -1
			if len(accBuf) > 4 {
				idx := findStartCodeIndex(accBuf[3:])
				if idx != -1 {
					nextStartIdx = idx + 3
				}
			}

			if nextStartIdx != -1 {
				// ✅ Tìm thấy 1 NAL trọn vẹn
				nalData := make([]byte, nextStartIdx)
				copy(nalData, accBuf[:nextStartIdx])

				// Gửi NAL này đi
				s.broadcastNAL(deviceID, nalData, &frameCount)

				// ✂️ Cắt buffer
				leftover := accBuf[nextStartIdx:]
				newBuf := make([]byte, len(leftover), cap(accBuf))
				copy(newBuf, leftover)
				accBuf = newBuf

				continue
			} else {
				// Chưa đủ data -> Break để đọc thêm
				break
			}
		}
	}
}

// broadcastNAL sends a single NAL unit to WebSocket
// Protocol: [1 byte ID_LENGTH] + [ID_BYTES] + [NAL_DATA]
func (s *StreamingService) broadcastNAL(deviceID string, nalData []byte, frameCount *int) {
	if len(nalData) == 0 {
		return
	}

	*frameCount++

	// Gắn Device ID vào đầu packet để Frontend có thể filter
	// Protocol mới: [1 byte ID_LENGTH] + [ID_BYTES] + [NAL_DATA]
	idLen := len(deviceID)
	if idLen > 255 {
		log.Printf("Warning: Device ID too long: %s", deviceID)
		return
	}

	pkt := make([]byte, 1+idLen+len(nalData))
	pkt[0] = byte(idLen)
	copy(pkt[1:], []byte(deviceID))
	copy(pkt[1+idLen:], nalData)

	// Broadcast
	s.wsHub.BroadcastToDevice(deviceID, pkt)

	// Find start code and extract NAL type properly
	nalType := -1
	if len(nalData) >= 4 && nalData[0] == 0 && nalData[1] == 0 {
		if nalData[2] == 1 {
			// Start code: 00 00 01 (3 bytes)
			nalType = int(nalData[3] & 0x1F)
		} else if nalData[2] == 0 && nalData[3] == 1 {
			// Start code: 00 00 00 01 (4 bytes)
			if len(nalData) > 4 {
				nalType = int(nalData[4] & 0x1F)
			}
		}
	}

	// Cache SPS/PPS headers for new subscribers
	if nalType == 7 || nalType == 8 {
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
			}
			stream.mu.Unlock()
		}
	}
}

// findStartCodeIndex tìm vị trí xuất hiện đầu tiên của 00 00 01 hoặc 00 00 00 01
func findStartCodeIndex(data []byte) int {
	n := len(data)
	for i := 0; i < n-2; i++ {
		// Check 00 00 01
		if data[i] == 0 && data[i+1] == 0 && data[i+2] == 1 {
			// Kiểm tra xem trước đó có 00 nữa không (thành 00 00 00 01)
			if i > 0 && data[i-1] == 0 {
				return i - 1 // Start code 4 bytes
			}
			return i // Start code 3 bytes
		}
	}
	return -1
}

// StartAllStreaming starts streaming for all online devices
func (s *StreamingService) StartAllStreaming() error {
	devices := s.deviceManager.GetAllDevices()

	for _, device := range devices {
		if device.Status == "online" {
			if err := s.StartStreaming(device.ID); err != nil {
				log.Printf("Failed to start streaming for %s: %v", device.ID, err)
			}
		}
	}

	return nil
}

// StopAllStreaming stops all active streams
func (s *StreamingService) StopAllStreaming() {
	s.mu.Lock()
	defer s.mu.Unlock()

	for deviceID := range s.streams {
		stream := s.streams[deviceID]
		stream.isStreaming = false

		// Cancel context
		if stream.cancel != nil {
			stream.cancel()
		}

		// Stop scrcpy client
		if stream.scrcpyClient != nil {
			stream.scrcpyClient.Stop()
		}

		// Close stopChan
		select {
		case <-stream.stopChan:
		default:
			close(stream.stopChan)
		}
	}

	s.streams = make(map[string]*deviceStream)
	log.Println("Stopped all streams")
}

// GetStreamingStatus returns the status of all streams
func (s *StreamingService) GetStreamingStatus() map[string]bool {
	s.mu.RLock()
	defer s.mu.RUnlock()

	status := make(map[string]bool)
	for deviceID, stream := range s.streams {
		status[deviceID] = stream.isStreaming
	}

	return status
}

// IsStreaming checks if a device is currently streaming
func (s *StreamingService) IsStreaming(deviceID string) bool {
	s.mu.RLock()
	defer s.mu.RUnlock()

	stream, exists := s.streams[deviceID]
	return exists && stream.isStreaming
}

// GetStreamHeaders returns cached SPS/PPS packets for a device
// Returns nil slices if device not found or headers not available
func (s *StreamingService) GetStreamHeaders(deviceID string) ([]byte, []byte) {
	s.mu.RLock()
	stream, exists := s.streams[deviceID]
	s.mu.RUnlock()

	if !exists {
		return nil, nil
	}

	stream.mu.RLock()
	defer stream.mu.RUnlock()

	// Trả về bản copy để an toàn
	var sps, pps []byte
	if stream.spsPkt != nil {
		sps = make([]byte, len(stream.spsPkt))
		copy(sps, stream.spsPkt)
	}
	if stream.ppsPkt != nil {
		pps = make([]byte, len(stream.ppsPkt))
		copy(pps, stream.ppsPkt)
	}

	return sps, pps
}
