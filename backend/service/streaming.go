package service

import (
	"bufio"
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
func readNextAnnexBFrame(br *bufio.Reader) ([]byte, error) {
	var frame []byte
	nalCount := 0
	hasVideoFrame := false // Track if we've seen IDR(5) or Slice(1) in current frame

	for {
		// 1. Tìm start code của NAL unit hiện tại (không consume bytes nếu chưa chắc)
		// Start code: 00 00 01 (3 bytes) hoặc 00 00 00 01 (4 bytes)
		startCodeLen, err := peekStartCode(br)
		if err != nil {
			if len(frame) > 0 && err == io.EOF {
				return frame, nil
			}
			return nil, err
		}

		// Nếu không tìm thấy start code ngay đầu buffer -> data rác hoặc lỗi stream -> skip 1 byte rồi thử lại
		if startCodeLen == 0 {
			b, err := br.ReadByte()
			if err != nil {
				return nil, err
			}
			// Chỉ append vào frame nếu đang ở giữa frame (đã có NAL trước đó)
			if nalCount > 0 {
				frame = append(frame, b)
			}
			continue
		}

		// 2. Đọc Start Code + NAL Header
		// Peek NAL Header trước để check loại (TRƯỚC KHI consume start code)
		peekBuf, err := br.Peek(startCodeLen + 1)
		if err != nil {
			if len(frame) > 0 && err == io.EOF {
				return frame, nil
			}
			return nil, err
		}
		nalHeader := peekBuf[startCodeLen]
		nalType := nalHeader & 0x1F

		// 3. Check nếu đây là video frame MỚI (IDR/Slice) và ta đã có video frame trước đó -> Return
		isVideoFrame := (nalType == 1 || nalType == 5)
		if isVideoFrame && hasVideoFrame {
			// Đã có video frame rồi, gặp video frame mới -> Kết thúc frame hiện tại
			return frame, nil
		}

		// 4. Consume start code
		startCode := make([]byte, startCodeLen)
		if _, err := io.ReadFull(br, startCode); err != nil {
			return nil, err
		}

		// Consume NAL header
		headerByte, err := br.ReadByte()
		if err != nil {
			return nil, err
		}

		// Append start code + header vào frame
		frame = append(frame, startCode...)
		frame = append(frame, headerByte)

		// 5. Đọc phần data còn lại của NAL cho đến khi gặp Start Code tiếp theo
		for {
			// Peek 3-4 bytes để xem có phải start code mới không
			nextScLen, _ := peekStartCode(br)
			if nextScLen > 0 {
				// Tìm thấy start code mới -> Kết thúc NAL unit này
				break
			}

			// Không phải start code, đọc 1 byte data
			b, err := br.ReadByte()
			if err != nil {
				if err == io.EOF {
					break
				}
				return nil, err
			}
			frame = append(frame, b)
		}

		nalCount++

		// DEBUG: Log NAL type
		log.Printf("📝 NAL #%d: Type=%d, Size=%d bytes total, hasVideoFrame=%v", nalCount, nalType, len(frame), hasVideoFrame)

		// Mark if we just read a video frame
		if isVideoFrame {
			hasVideoFrame = true
			log.Printf("✅ Marked hasVideoFrame=true after NAL type %d", nalType)
		}

		// 6. Check nếu hết stream HOẶC nếu có NAL tiếp theo
		nextScLen, err := peekStartCode(br)
		if err == io.EOF || nextScLen == 0 {
			// Hết stream hoặc buffer tạm thời trống
			if hasVideoFrame {
				// Đã có video frame (IDR/Slice) rồi -> Đủ để return
				log.Printf("🔚 No more NAL units, returning complete frame with %d NAL(s), total %d bytes", nalCount, len(frame))
				return frame, nil
			}
			// Chưa có video frame -> Đây chỉ là SPS/PPS, cần đợi thêm data
			log.Printf("⏸ Buffer empty but no video frame yet (nalCount=%d), waiting for more data...", nalCount)
			// Đợi một chút để buffer fill
			_, err := br.Peek(1)
			if err == io.EOF {
				// Thực sự hết stream luôn
				if len(frame) > 0 {
					log.Printf("⚠️ EOF reached with incomplete frame (%d bytes), returning anyway", len(frame))
					return frame, nil
				}
				return nil, io.EOF
			}
			// Có data mới rồi, continue loop để đọc NAL tiếp theo
			continue
		}
	}
}

// Helper: Kiểm tra xem bytes tiếp theo có phải Start Code không.
// Trả về độ dài start code (3 hoặc 4), hoặc 0 nếu không phải.
func peekStartCode(br *bufio.Reader) (int, error) {
	// Start code có thể là 00 00 01 hoặc 00 00 00 01
	// Cần peek tối đa 4 bytes
	buf, err := br.Peek(4)
	if err != nil && err != io.EOF {
		return 0, err
	}

	if len(buf) >= 3 && buf[0] == 0 && buf[1] == 0 && buf[2] == 1 {
		return 3, nil
	}
	if len(buf) >= 4 && buf[0] == 0 && buf[1] == 0 && buf[2] == 0 && buf[3] == 1 {
		return 4, nil
	}
	return 0, nil
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
