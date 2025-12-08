package main

import (
	"androidcontrol/api"
	"androidcontrol/service"
	"fmt"
	"io"
	"log"
	"os"
	"path/filepath"
	"time"

	"github.com/gin-gonic/gin"
)

// setupLogging creates a log file in the log directory with timestamp
// Returns the log file handle (caller should defer Close())
func setupLogging() (*os.File, error) {
	// Create log directory if not exists
	logDir := "log"
	if err := os.MkdirAll(logDir, 0755); err != nil {
		return nil, fmt.Errorf("failed to create log directory: %w", err)
	}

	// Create log file with timestamp: log/2025-12-08_21-52-35.log
	timestamp := time.Now().Format("2006-01-02_15-04-05")
	logPath := filepath.Join(logDir, timestamp+".log")

	logFile, err := os.OpenFile(logPath, os.O_CREATE|os.O_WRONLY|os.O_APPEND, 0644)
	if err != nil {
		return nil, fmt.Errorf("failed to open log file: %w", err)
	}

	// Write to both console and file
	multiWriter := io.MultiWriter(os.Stdout, logFile)
	log.SetOutput(multiWriter)
	log.SetFlags(log.Ldate | log.Ltime | log.Lmicroseconds)

	log.Printf("📝 Logging to: %s", logPath)
	return logFile, nil
}

func main() {
	// Setup file logging
	logFile, err := setupLogging()
	if err != nil {
		log.Printf("Warning: Failed to setup file logging: %v", err)
	} else {
		defer logFile.Close()
	}

	log.Println("Starting Android Control Backend...")

	// Initialize services (without database for now)
	deviceManager := service.NewDeviceManager(nil)
	actionDispatcher := service.NewActionDispatcher(deviceManager)

	// Initialize WebSocket hub
	wsHub := api.NewWebSocketHub()
	go wsHub.Run()

	// Initialize streaming service
	streamingService := service.NewStreamingService(deviceManager, wsHub)
	log.Println("Streaming service initialized")

	// Setup HTTP server
	router := gin.Default()
	api.SetupRoutes(router, deviceManager, actionDispatcher, wsHub, streamingService)

	// Start server
	log.Println("Server starting on http://localhost:8080")
	log.Println("WebSocket server on ws://localhost:8080/ws")
	log.Println("Ready to stream screens @ 30 FPS")

	// Auto-start streaming for all devices in background
	go func() {
		log.Println("🚀 Scanning devices for auto-streaming...")
		// Scan devices first
		if err := deviceManager.ScanDevices(); err != nil {
			log.Printf("Warning: Failed to scan devices: %v", err)
			return
		}

		devices := deviceManager.GetAllDevices()
		log.Printf("📱 Found %d devices, starting H.264 streams...", len(devices))

		if err := streamingService.StartAllStreaming(); err != nil {
			log.Printf("Warning: Failed to auto-start streaming: %v", err)
		} else {
			log.Println("✅ Auto-streaming started successfully for all devices")
		}
	}()

	if err := router.Run(":8080"); err != nil {
		log.Fatal("Failed to start server:", err)
	}
}
