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
	debugDumped := false // Track if we dumped initial bytes

	for {
		// 1. Đọc dữ liệu mới từ stream
		n, err := r.Read(readBuf)
		if n > 0 {
			accBuf = append(accBuf, readBuf[:n]...)

			// DEBUG: Dump first 200 bytes to analyze NAL structure
			if !debugDumped && len(accBuf) >= 200 {
				fmt.Printf("🔍 DEBUG: First 200 bytes of H.264 stream:\n")
				hexStr := fmt.Sprintf("%x", accBuf[:200])
				for i := 0; i < len(hexStr); i += 64 {
					end := i + 64
					if end > len(hexStr) {
						end = len(hexStr)
					}
					fmt.Printf("%s\n", hexStr[i:end])
				}
				// Look for NAL types
				fmt.Printf("\n🔍 Looking for NAL units in first 200 bytes:\n")
				for i := 0; i < 197; i++ {
					if accBuf[i] == 0 && accBuf[i+1] == 0 {
						if accBuf[i+2] == 1 {
							nalType := accBuf[i+3] & 0x1F
							fmt.Printf("  Offset %d: Start code 00 00 01, NAL type %d\n", i, nalType)
						} else if i < 196 && accBuf[i+2] == 0 && accBuf[i+3] == 1 {
							nalType := accBuf[i+4] & 0x1F
							fmt.Printf("  Offset %d: Start code 00 00 00 01, NAL type %d\n", i, nalType)
						}
					}
				}
				debugDumped = true
			}
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

	// --- LOGIC MỚI: Cache SPS/PPS ---
	if nalType == 7 || nalType == 8 {
		s.mu.RLock()
		stream, exists := s.streams[deviceID]
		s.mu.RUnlock()

		if exists {
			stream.mu.Lock()
			// Lưu lại packet đầy đủ (có cả length prefix) để gửi thẳng cho client mới
			if nalType == 7 {
				stream.spsPkt = make([]byte, len(pkt))
				copy(stream.spsPkt, pkt)
				fmt.Printf("📦 Device %s: Cached SPS (seq %d)\n", deviceID, *frameCount)
			} else if nalType == 8 {
				stream.ppsPkt = make([]byte, len(pkt))
				copy(stream.ppsPkt, pkt)
				fmt.Printf("📦 Device %s: Cached PPS (seq %d)\n", deviceID, *frameCount)
			}
			stream.mu.Unlock()
		}
	}
	// --------------------------------

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
