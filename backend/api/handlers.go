package api

import (
	"net/http"
	"androidcontrol/models"
	"androidcontrol/service"
	
	"github.com/gin-gonic/gin"
)

// SetupHandlers adds handler implementations
func SetupHandlers(router *gin.Engine, dm *service.DeviceManager, ad *service.ActionDispatcher, wsHub *WebSocketHub) {
	// Health check
	router.GET("/health", func(c *gin.Context) {
		c.JSON(http.StatusOK, models.SuccessResponse(gin.H{
			"status": "ok",
			"message": "Android Control Backend is running",
		}))
	})
}

// GetDevices returns all devices
func GetDevices(c *gin.Context, dm *service.DeviceManager) {
	devices := dm.GetAllDevices()
	c.JSON(http.StatusOK, models.SuccessResponse(devices))
}

// ScanDevices scans for new devices
func ScanDevices(c *gin.Context, dm *service.DeviceManager) {
	if err := dm.ScanDevices(); err != nil {
		c.JSON(http.StatusInternalServerError, models.ErrorResponse(err.Error()))
		return
	}
	devices := dm.GetAllDevices()
	c.JSON(http.StatusOK, models.SuccessResponse(devices))
}
