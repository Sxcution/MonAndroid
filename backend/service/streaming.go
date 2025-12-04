package service

import (
	"encoding/binary"
	"fmt"
	"io"
	"log"
	"os/exec"
	"sync"
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
		fps:         30,
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

// consumeH264 reads raw H.264 stream and broadcasts NAL units
// Uses buffer accumulation strategy to avoid any byte loss
func (s *StreamingService) consumeH264(deviceID string, r io.ReadCloser) {
	defer r.Close()
	defer func() {
		fmt.Printf("H.264 consumer exiting for device %s\n", deviceID)
		s.StopStreaming(deviceID)
	}()

	fmt.Printf("🎬 H.264 consumer started for device %s (Buffer Strategy)\n", deviceID)

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
func (s *StreamingService) broadcastNAL(deviceID string, nalData []byte, frameCount *int) {
	if len(nalData) == 0 {
		return
	}

	*frameCount++

	// Prefix length (4 bytes)
	pkt := make([]byte, 4+len(nalData))
	binary.BigEndian.PutUint32(pkt[:4], uint32(len(nalData)))
	copy(pkt[4:], nalData)

	// Broadcast
	s.wsHub.BroadcastToDevice(deviceID, pkt)

	// Log cho SPS/PPS để debug
	nalType := nalData[3] & 0x1F
	if len(nalData) > 4 && nalData[2] == 0 && nalData[3] == 1 { // Start code 00 00 00 01
		nalType = nalData[4] & 0x1F
	} else if len(nalData) > 3 && nalData[2] == 1 { // Start code 00 00 01
		nalType = nalData[3] & 0x1F
	}

	if nalType == 7 {
		fmt.Printf("📦 Device %s: Sent SPS (seq %d)\n", deviceID, *frameCount)
	} else if nalType == 8 {
		fmt.Printf("📦 Device %s: Sent PPS (seq %d)\n", deviceID, *frameCount)
	} else if *frameCount%30 == 0 {
		fmt.Printf("📺 Device %s: NAL seq %d\n", deviceID, *frameCount)
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
