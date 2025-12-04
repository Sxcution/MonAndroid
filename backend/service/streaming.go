package service

import (
	"encoding/base64"
	"fmt"
	"log"
	"sync"
	"time"
)

// WebSocketBroadcaster interface to avoid import cycle
type WebSocketBroadcaster interface {
	BroadcastToDevice(deviceID string, message interface{})
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

	// Check if already streaming
	if stream, exists := s.streams[deviceID]; exists && stream.isStreaming {
		return fmt.Errorf("device %s is already streaming", deviceID)
	}

	// Get device info
	device := s.deviceManager.GetDevice(deviceID)
	if device == nil {
		return fmt.Errorf("device not found: %s", deviceID)
	}

	if device.Status != "online" {
		return fmt.Errorf("device offline: %s", deviceID)
	}

	// Create stream
	stream := &deviceStream{
		deviceID:    deviceID,
		deviceADBID: device.ADBDeviceID,
		isStreaming: true,
		stopChan:    make(chan bool),
		fps:         30, // Target 30 FPS
	}

	s.streams[deviceID] = stream

	// Start streaming goroutine
	go s.streamDevice(stream)

	log.Printf("Started streaming for device %s", deviceID)
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
	delete(s.streams, deviceID)

	log.Printf("Stopped streaming for device %s", deviceID)
	return nil
}

// streamDevice handles the streaming loop for a single device
func (s *StreamingService) streamDevice(stream *deviceStream) {
	// Calculate frame interval for target FPS
	frameInterval := time.Duration(1000/stream.fps) * time.Millisecond
	ticker := time.NewTicker(frameInterval)
	defer ticker.Stop()

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
			startTime := time.Now()
			frameBytes, err := adbClient.ScreenCapture(stream.deviceADBID)
			captureTime := time.Since(startTime)

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
			s.wsHub.BroadcastToDevice(stream.deviceID, message)

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
