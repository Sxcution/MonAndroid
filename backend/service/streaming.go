package service

import (
	"bufio"
	"encoding/base64"
	"encoding/binary"
	"fmt"
	"io"
	"log"
	"os/exec"
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
	deviceID    string
	deviceADBID string
	isStreaming bool
	stopChan    chan bool
	fps         int
	lastFrame   time.Time
	h264Cmd     *exec.Cmd // H.264 screenrecord process
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

// StartStreaming starts streaming for a specific device
func (s *StreamingService) StartStreaming(deviceID string) error {
	s.mu.Lock()
	defer s.mu.Unlock()

	log.Printf("🚀 StartStreaming called for %s", deviceID)

	// Check if already streaming - if yes, just return success (idempotent)
	if stream, exists := s.streams[deviceID]; exists && stream.isStreaming {
		log.Printf("Device %s is already streaming, returning success", deviceID)
		return nil // Return success instead of error for idempotency
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

	// Start H.264 stream from ADB
	adbClient := s.deviceManager.GetADBClient()
	h264Stream, cmd, err := adbClient.StartH264Stream(device.ADBDeviceID)
	if err != nil {
		log.Printf("❌ Failed to start H.264 stream for %s: %v", deviceID, err)
		return fmt.Errorf("failed to start H.264 stream: %w", err)
	}

	// Create stream
	stream := &deviceStream{
		deviceID:    deviceID,
		deviceADBID: device.ADBDeviceID,
		isStreaming: true,
		stopChan:    make(chan bool),
		fps:         30, // Target 30 FPS
		h264Cmd:     cmd,
	}

	s.streams[deviceID] = stream

	// Start H.264 consumer goroutine
	go s.consumeH264(deviceID, h264Stream)

	fmt.Printf("Started H.264 streaming for device %s\n", deviceID)
	return nil
}

// StopStreaming stops streaming for a specific device
func (s *StreamingService) StopStreaming(deviceID string) error {
	s.mu.Lock()
	defer s.mu.Unlock()

	stream, exists := s.streams[deviceID]
	if !exists {
		return fmt.Errorf("device %s is not streaming", deviceID)
	}

	stream.isStreaming = false
	close(stream.stopChan)

	// Kill H.264 screenrecord process if running
	if stream.h264Cmd != nil && stream.h264Cmd.Process != nil {
		if err := stream.h264Cmd.Process.Kill(); err != nil {
			log.Printf("Warning: failed to kill H.264 process for %s: %v", deviceID, err)
		}
	}

	delete(s.streams, deviceID)

	log.Printf("Stopped streaming for device %s", deviceID)
	return nil
}

// consumeH264 reads H.264 stream, parses NAL units, and broadcasts frames
func (s *StreamingService) consumeH264(deviceID string, r io.ReadCloser) {
	defer r.Close()
	defer func() {
		// Clean up stream on exit
		fmt.Printf("H.264 consumer exiting for device %s\n", deviceID)
		s.StopStreaming(deviceID)
	}()

	fmt.Printf("🎬 H.264 consumer started for device %s\n", deviceID)

	br := bufio.NewReaderSize(r, 1<<20) // 1MB buffer
	frameCount := 0

	fmt.Printf("⏳ Waiting for first byte from %s...\n", deviceID)
	firstByte, err := br.Peek(1)
	if err != nil {
		fmt.Printf("❌ Failed to peek first byte for %s: %v\n", deviceID, err)
		return
	}
	fmt.Printf("✅ Received first byte: %x\n", firstByte)

	for {
		// Read next Annex-B frame (bundle of NALs until next keyframe/P-frame)
		frame, err := readNextAnnexBFrame(br)
		if err != nil {
			if err != io.EOF {
				log.Printf("Error reading H.264 frame for %s: %v", deviceID, err)
			} else {
				log.Printf("EOF reading H.264 frame for %s", deviceID)
			}
			return
		}

		if len(frame) == 0 {
			continue
		}

		frameCount++

		// Prefix frame with 4-byte big-endian length
		pkt := make([]byte, 4+len(frame))
		binary.BigEndian.PutUint32(pkt[:4], uint32(len(frame)))
		copy(pkt[4:], frame)

		// Broadcast to WebSocket with backpressure handling
		s.wsHub.BroadcastToDevice(deviceID, pkt)

		// Log every 30 frames (~1 second at 30 FPS)
		if frameCount < 5 {
			fmt.Printf("📦 Sent frame %d: %d bytes (Hex: %x...)\n", frameCount, len(frame), frame[:min(len(frame), 20)])
		} else if frameCount%30 == 0 {
			fmt.Printf("📺 Device %s: Frame %d\n", deviceID, frameCount)
		}
	}
}

func min(a, b int) int {
	if a < b {
		return a
	}
	return b
}

// readNextAnnexBFrame reads NAL units from Annex-B stream until complete frame
// Returns frame bytes (including start codes) or error
func readNextAnnexBFrame(br *bufio.Reader) ([]byte, error) {
	var frame []byte
	nalCount := 0

	for {
		// 1. Skip garbage until we find a start code (PEEK only)
		startCodeLen := 0
		for {
			// Peek enough bytes to detect 00 00 00 01
			peek, err := br.Peek(4)
			if err != nil && err != io.EOF {
				return frame, err
			}
			if len(peek) < 3 {
				// Not enough data to determine start code, wait for more or EOF
				if err == io.EOF {
					return frame, nil // End of stream
				}
				// Should not happen if err != EOF
				return frame, io.ErrUnexpectedEOF
			}

			if peek[0] == 0x00 && peek[1] == 0x00 && peek[2] == 0x01 {
				startCodeLen = 3
				break
			}
			if len(peek) >= 4 && peek[0] == 0x00 && peek[1] == 0x00 && peek[2] == 0x00 && peek[3] == 0x01 {
				startCodeLen = 4
				break
			}

			// Not a start code, consume one byte (garbage)
			b, err := br.ReadByte()
			if err != nil {
				return frame, err
			}
			// Only append garbage if we are inside a frame?
			// Usually garbage between frames is ignored.
			// But if we are in the middle of a frame (nalCount > 0), we shouldn't have garbage between NALs ideally.
			// For safety, we ignore garbage between NALs.
			_ = b
		}

		// 2. We found a start code at current position. Check NAL type.
		// We need to peek the byte AFTER the start code.
		peekHeader, err := br.Peek(startCodeLen + 1)
		if err != nil {
			return frame, err
		}
		nalHeader := peekHeader[startCodeLen]
		nalType := nalHeader & 0x1F

		// DEBUG LOGGING
		// log.Printf("Found NAL: Type=%d, StartCodeLen=%d, CurrentFrameLen=%d", nalType, startCodeLen, len(frame))

		// 3. Check if this NAL starts a new frame
		// IDR (5) or Non-IDR (1) = new frame if we already have NALs
		if (nalType == 5 || nalType == 1) && nalCount > 0 {
			// log.Printf("New frame detected (Type %d), returning accumulated frame with %d NALs", nalType, nalCount)
			// We found the start of the NEXT frame.
			// Return what we have so far. We leave the start code in the buffer.
			return frame, nil
		}

		// 4. Consume start code and NAL header
		discarded, err := br.Discard(startCodeLen + 1)
		if err != nil {
			return frame, err
		}
		if discarded != startCodeLen+1 {
			return frame, io.ErrUnexpectedEOF
		}

		// Append to frame
		if startCodeLen == 3 {
			frame = append(frame, 0x00, 0x00, 0x01)
		} else {
			frame = append(frame, 0x00, 0x00, 0x00, 0x01)
		}
		frame = append(frame, nalHeader)

		// 5. Read rest of NAL until next start code
		nalData, err := readUntilStartCode(br)
		if err != nil && err != io.EOF {
			return nil, err
		}
		frame = append(frame, nalData...)
		nalCount++

		// log.Printf("Appended NAL Type %d, Size %d. Total Frame Size: %d", nalType, len(nalData), len(frame))

		if err == io.EOF {
			return frame, nil
		}
	}
}

// findStartCode is no longer used by readNextAnnexBFrame but kept if needed or we can remove it.
// Since I am replacing the block, I will remove it to avoid dead code if it's not used elsewhere.
// Checking file... findStartCode was only used in readNextAnnexBFrame.

// readUntilStartCode reads until next start code (not including it)
func readUntilStartCode(br *bufio.Reader) ([]byte, error) {
	var data []byte

	for {
		// Peek to see if we are at a start code
		peek, err := br.Peek(4)
		// If we have fewer than 3 bytes, we can't be at a start code yet (unless EOF)
		if len(peek) >= 3 {
			if peek[0] == 0x00 && peek[1] == 0x00 && peek[2] == 0x01 {
				return data, nil
			}
			if len(peek) >= 4 && peek[0] == 0x00 && peek[1] == 0x00 && peek[2] == 0x00 && peek[3] == 0x01 {
				return data, nil
			}
		}

		if err == io.EOF {
			// If EOF, we return what we have
			// But wait, if we have 00 00 at the end, and then EOF?
			// It's not a start code. So we consume it.
			// But Peek returns EOF if it can't fill the buffer.
			// We should read the available bytes.
		} else if err != nil {
			return data, err
		}

		// Not a start code, read one byte
		b, err := br.ReadByte()
		if err != nil {
			return data, err
		}
		data = append(data, b)
	}
}

// streamDevice handles the streaming loop for a single device
func (s *StreamingService) streamDevice(stream *deviceStream) {
	log.Printf("🟢 STREAM GOROUTINE STARTED for device: %s (ADB: %s)", stream.deviceID, stream.deviceADBID)

	// Calculate frame interval for target FPS
	frameInterval := time.Duration(1000/stream.fps) * time.Millisecond
	ticker := time.NewTicker(frameInterval)
	defer ticker.Stop()

	log.Printf("🟢 TICKER CREATED: capturing every %dms (target %d FPS)", frameInterval.Milliseconds(), stream.fps)

	adbClient := s.deviceManager.GetADBClient()
	frameCount := 0
	errorCount := 0
	maxErrors := 5 // Stop after 5 consecutive errors

	for {
		select {
		case <-stream.stopChan:
			log.Printf("Stream stopped for device %s", stream.deviceID)
			return

		case <-ticker.C:
			// Capture screen
			log.Printf("📸 Attempting screen capture for %s...", stream.deviceID)
			startTime := time.Now()
			frameBytes, err := adbClient.ScreenCapture(stream.deviceADBID)
			captureTime := time.Since(startTime)
			log.Printf("📸 Capture completed: %d bytes, took %dms", len(frameBytes), captureTime.Milliseconds())

			if err != nil {
				errorCount++
				log.Printf("Screen capture failed for %s (error %d/%d): %v",
					stream.deviceID, errorCount, maxErrors, err)

				if errorCount >= maxErrors {
					log.Printf("Too many errors, stopping stream for %s", stream.deviceID)
					s.StopStreaming(stream.deviceID)
					return
				}
				continue
			}

			// Reset error count on success
			errorCount = 0
			frameCount++

			// Encode to base64
			frameBase64 := base64.StdEncoding.EncodeToString(frameBytes)

			// Calculate FPS
			actualFPS := 0
			if !stream.lastFrame.IsZero() {
				timeSinceLastFrame := time.Since(stream.lastFrame)
				actualFPS = int(1000 / timeSinceLastFrame.Milliseconds())
			}
			stream.lastFrame = time.Now()

			// Create WebSocket message
			message := map[string]interface{}{
				"type":        "screen_frame",
				"device_id":   stream.deviceID,
				"frame":       frameBase64,
				"timestamp":   time.Now().Unix(),
				"frame_count": frameCount,
				"fps":         actualFPS,
				"capture_ms":  captureTime.Milliseconds(),
			}

			// Broadcast to WebSocket clients
			log.Printf("📡 Broadcasting frame to WebSocket clients for %s", stream.deviceID)
			s.wsHub.BroadcastToDevice(stream.deviceID, message)
			log.Printf("📡 Broadcast completed")

			// Log every 30 frames (~1 second)
			if frameCount%30 == 0 {
				log.Printf("Device %s: Frame %d, FPS: %d, Capture: %dms",
					stream.deviceID, frameCount, actualFPS, captureTime.Milliseconds())
			}
		}
	}
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
		close(stream.stopChan)
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
