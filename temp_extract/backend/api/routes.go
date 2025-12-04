package api

import (
	"androidcontrol/service"
	"github.com/gin-gonic/gin"
)

func SetupRoutes(router *gin.Engine, dm *service.DeviceManager, ad *service.ActionDispatcher, wsHub *WebSocketHub, ss *service.StreamingService) {
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

		// Action routes
		actions := api.Group("/actions")
		{
			actions.POST("", func(c *gin.Context) {
				ExecuteAction(c, dm, ad)
			})
			actions.POST("/batch", func(c *gin.Context) {
				ExecuteBatchAction(c, dm, ad)
			})
		}

		// Streaming routes
		streaming := api.Group("/streaming")
		{
			streaming.POST("/start/:device_id", func(c *gin.Context) {
				StartStreaming(c, ss)
			})
			streaming.POST("/stop/:device_id", func(c *gin.Context) {
				StopStreaming(c, ss)
			})
			streaming.POST("/start-all", func(c *gin.Context) {
				StartAllStreaming(c, ss)
			})
			streaming.POST("/stop-all", func(c *gin.Context) {
				StopAllStreaming(c, ss)
			})
			streaming.GET("/status", func(c *gin.Context) {
				GetStreamingStatus(c, ss)
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
