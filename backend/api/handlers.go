package api

import (
	"androidcontrol/models"
	"androidcontrol/service"
	"fmt"
	"net/http"
	"time"

	"github.com/gin-gonic/gin"
)

// SetupHandlers adds handler implementations
func SetupHandlers(router *gin.Engine, dm *service.DeviceManager, ad *service.ActionDispatcher, wsHub *WebSocketHub) {
	// Health check
	router.GET("/health", func(c *gin.Context) {
		c.JSON(http.StatusOK, models.SuccessResponse(gin.H{
			"status":  "ok",
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

// ExecuteAction executes a single action on a device
func ExecuteAction(c *gin.Context, dm *service.DeviceManager, ad *service.ActionDispatcher) {
	var req models.ActionRequest
	if err := c.ShouldBindJSON(&req); err != nil {
		c.JSON(http.StatusBadRequest, models.ErrorResponse("invalid request"))
		return
	}

	// Create action
	action := &models.Action{
		ID:        generateActionID(),
		Type:      req.Action.Type,
		Params:    req.Action.Params,
		Timestamp: time.Now().Unix(),
	}

	// Dispatch to device
	if err := ad.DispatchToDevice(req.DeviceID, action); err != nil {
		c.JSON(http.StatusInternalServerError, models.ErrorResponse(err.Error()))
		return
	}

	c.JSON(http.StatusOK, models.SuccessResponse(action))
}

// ExecuteBatchAction executes an action on multiple devices
func ExecuteBatchAction(c *gin.Context, dm *service.DeviceManager, ad *service.ActionDispatcher) {
	var req models.ActionRequest
	if err := c.ShouldBindJSON(&req); err != nil {
		c.JSON(http.StatusBadRequest, models.ErrorResponse("invalid request"))
		return
	}

	// Create base action
	action := &models.Action{
		ID:        generateActionID(),
		Type:      req.Action.Type,
		Params:    req.Action.Params,
		Timestamp: time.Now().Unix(),
	}

	// Dispatch to all devices
	actions, err := ad.DispatchBatch(req.DeviceIDs, action)
	if err != nil {
		c.JSON(http.StatusInternalServerError, models.ErrorResponse(err.Error()))
		return
	}

	c.JSON(http.StatusOK, models.SuccessResponse(actions))
}

// generateActionID generates a unique action ID
func generateActionID() string {
	return fmt.Sprintf("action_%d", time.Now().UnixNano())
}
