package api

import (
	"androidcontrol/service"
	"github.com/gin-gonic/gin"
)

func SetupRoutes(router *gin.Engine, dm *service.DeviceManager, ad *service.ActionDispatcher, wsHub *WebSocketHub) {
	// Enable CORS
	router.Use(CORSMiddleware())

	// Health check
	router.GET("/health", func(c *gin.Context) {
		c.JSON(200, gin.H{"status": "ok"})
	})

	// API routes
	api := router.Group("/api")
	{
		// Device routes
		devices := api.Group("/devices")
		{
			devices.GET("", func(c *gin.Context) {
				GetDevices(c, dm)
			})
			devices.POST("/scan", func(c *gin.Context) {
				ScanDevices(c, dm)
			})
		}
	}

	// WebSocket route
	router.GET("/ws", func(c *gin.Context) {
		HandleWebSocket(wsHub, c)
	})
}

func CORSMiddleware() gin.HandlerFunc {
	return func(c *gin.Context) {
		c.Writer.Header().Set("Access-Control-Allow-Origin", "*")
		c.Writer.Header().Set("Access-Control-Allow-Credentials", "true")
		c.Writer.Header().Set("Access-Control-Allow-Headers", "Content-Type, Content-Length, Accept-Encoding, X-CSRF-Token, Authorization, accept, origin, Cache-Control, X-Requested-With")
		c.Writer.Header().Set("Access-Control-Allow-Methods", "POST, OPTIONS, GET, PUT, DELETE")

		if c.Request.Method == "OPTIONS" {
			c.AbortWithStatus(204)
			return
		}

		c.Next()
	}
}
