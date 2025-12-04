package main

import (
	"log"
	"androidcontrol/api"
	"androidcontrol/service"
	
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

	// Setup HTTP server
	router := gin.Default()
	api.SetupRoutes(router, deviceManager, actionDispatcher, wsHub)

	// Start server
	log.Println("Server starting on http://localhost:8080")
	log.Println("WebSocket server on ws://localhost:8080/ws")
	
	if err := router.Run(":8080"); err != nil {
		log.Fatal("Failed to start server:", err)
	}
}
