package api

import (
	"androidcontrol/models"
	"androidcontrol/service"
	"net/http"

	"github.com/gin-gonic/gin"
)

// StartStreaming starts screen streaming for a device
func StartStreaming(c *gin.Context, ss *service.StreamingService) {
	deviceID := c.Param("device_id")
	
	if err := ss.StartStreaming(deviceID); err != nil {
		c.JSON(http.StatusInternalServerError, models.ErrorResponse(err.Error()))
		return
	}
	
	c.JSON(http.StatusOK, models.MessageResponse("Streaming started for device "+deviceID))
}

// StopStreaming stops screen streaming for a device
func StopStreaming(c *gin.Context, ss *service.StreamingService) {
	deviceID := c.Param("device_id")
	
	if err := ss.StopStreaming(deviceID); err != nil {
		c.JSON(http.StatusInternalServerError, models.ErrorResponse(err.Error()))
		return
	}
	
	c.JSON(http.StatusOK, models.MessageResponse("Streaming stopped for device "+deviceID))
}

// StartAllStreaming starts streaming for all online devices
func StartAllStreaming(c *gin.Context, ss *service.StreamingService) {
	if err := ss.StartAllStreaming(); err != nil {
		c.JSON(http.StatusInternalServerError, models.ErrorResponse(err.Error()))
		return
	}
	
	c.JSON(http.StatusOK, models.MessageResponse("Streaming started for all devices"))
}

// StopAllStreaming stops all active streams
func StopAllStreaming(c *gin.Context, ss *service.StreamingService) {
	ss.StopAllStreaming()
	c.JSON(http.StatusOK, models.MessageResponse("All streams stopped"))
}

// GetStreamingStatus returns the status of all streams
func GetStreamingStatus(c *gin.Context, ss *service.StreamingService) {
	status := ss.GetStreamingStatus()
	c.JSON(http.StatusOK, models.SuccessResponse(status))
}
