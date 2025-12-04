package main

import (
	"androidcontrol/api"
	"androidcontrol/service"
	"log"

	"github.com/gin-gonic/gin"
)

func main() {
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

	if err := router.Run(":8080"); err != nil {
		log.Fatal("Failed to start server:", err)
	}
}
