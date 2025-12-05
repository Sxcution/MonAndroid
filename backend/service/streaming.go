package service

import (
	"context"
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
	h264Cmd     *exec.Cmd // H.264 screenrecord process
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

// StartStreaming starts streaming for a specific device with auto-restart loop
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

	// Create stream object
	stream := &deviceStream{
		deviceID:    deviceID,
		deviceADBID: device.ADBDeviceID,
		isStreaming: true, // User wants to stream
		stopChan:    make(chan bool),
		fps:         30,
	}

	s.streams[deviceID] = stream

	// Start auto-restart loop
	go s.streamLoop(stream)

	fmt.Printf("Started H.264 streaming with auto-restart for device %s\n", deviceID)
	return nil
}

// StopStreaming stops streaming for a specific device
// Idempotent: can be called multiple times safely
func (s *StreamingService) StopStreaming(deviceID string) error {
	s.mu.Lock()
	defer s.mu.Unlock()

	stream, exists := s.streams[deviceID]
	if !exists {
		// CHANGE: Nếu không tìm thấy stream, coi như đã dừng thành công. Không báo lỗi nữa.
		log.Printf("⚠️ StopStreaming called for %s but stream not found (already stopped)", deviceID)
		return nil
	}

	stream.isStreaming = false

	// Đóng channel để báo hiệu cho consumer dừng lại
	// Cần kiểm tra xem channel đã đóng chưa để tránh panic
	select {
	case <-stream.stopChan:
		// Channel already closed
	default:
		close(stream.stopChan)
	}

	// Kill H.264 screenrecord process if running
	if stream.h264Cmd != nil && stream.h264Cmd.Process != nil {
		if err := stream.h264Cmd.Process.Kill(); err != nil {
			log.Printf("Warning: failed to kill H.264 process for %s: %v", deviceID, err)
		}
	}

	delete(s.streams, deviceID)

	log.Printf("✅ Stopped streaming for device %s", deviceID)
	return nil
}

// cleanupStream is internal cleanup called from goroutine defer
// Does NOT re-acquire locks to avoid deadlock
func (s *StreamingService) cleanupStream(deviceID string) {
	s.mu.Lock()
	defer s.mu.Unlock()

	stream, exists := s.streams[deviceID]
	if !exists {
		return // Already cleaned up
	}

	// Kill H.264 process (best effort, ignore errors)
	if stream.h264Cmd != nil && stream.h264Cmd.Process != nil {
		stream.h264Cmd.Process.Kill()
	}

	delete(s.streams, deviceID)
}

// streamLoop manages the auto-restart cycle for H.264 streaming
// Automatically restarts stream when it ends (every ~3 minutes default)
func (s *StreamingService) streamLoop(stream *deviceStream) {
	defer func() {
		log.Printf("🛑 Stream loop ended for %s", stream.deviceID)
		s.cleanupStream(stream.deviceID)
	}()

	for {
		// Check if user stopped the stream
		s.mu.RLock()
		isStreaming := stream.isStreaming
		s.mu.RUnlock()

		if !isStreaming {
			return // Exit loop if user stopped streaming
		}

		// Start ADB screenrecord process
		log.Printf("🔄 Starting ADB screenrecord for %s...", stream.deviceID)
		adbClient := s.deviceManager.GetADBClient()
		h264Stream, cmd, err := adbClient.StartH264Stream(stream.deviceADBID)

		if err != nil {
			log.Printf("❌ Failed to start ADB for %s: %v. Retrying in 2s...", stream.deviceID, err)
			time.Sleep(2 * time.Second)
			continue
		}

		// Update cmd reference for cleanup
		s.mu.Lock()
		stream.h264Cmd = cmd
		s.mu.Unlock()

		// Create context for this stream cycle
		ctx, cancel := context.WithCancel(context.Background())

		// Consume H.264 stream (blocks until stream ends ~3 min or error)
		s.consumeH264(ctx, stream.deviceID, h264Stream)

		// Cancel context and cleanup
		cancel()

		// Stream ended, cleanup process
		if cmd.Process != nil {
			cmd.Process.Kill()
			cmd.Wait()
		}

		log.Printf("⚠️ Stream cycle ended for %s (3 min limit). Restarting immediately...", stream.deviceID)
		// No sleep here for fastest restart
	}
}

// consumeH264 reads raw H.264 stream and broadcasts NAL units
// Note: cleanup is handled by streamLoop, not here
func (s *StreamingService) consumeH264(ctx context.Context, deviceID string, r io.ReadCloser) {
	defer r.Close()

	log.Printf("🎬 Started H.264 stream: %s", deviceID)

	// Buffer chứa dữ liệu tích lũy
	accBuf := make([]byte, 0, 1024*1024)

	// Buffer tạm để đọc từ stream
	readBuf := make([]byte, 4096)

	frameCount := 0

	for {
		// 1. Đọc dữ liệu mới từ stream
		n, err := r.Read(readBuf)
		if n > 0 {
			accBuf = append(accBuf, readBuf[:n]...)
		}

		if err != nil {
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
