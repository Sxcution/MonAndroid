package service

import (
	"androidcontrol/models"
	"fmt"
	"log"
)

type ActionDispatcher struct {
	deviceManager *DeviceManager
	actionQueue   chan *models.Action
}

func NewActionDispatcher(dm *DeviceManager) *ActionDispatcher {
	dispatcher := &ActionDispatcher{
		deviceManager: dm,
		actionQueue:   make(chan *models.Action, 100),
	}

	// Start action queue processor
	go dispatcher.ProcessActionQueue()

	return dispatcher
}

// DispatchToDevice executes an action on a single device
func (d *ActionDispatcher) DispatchToDevice(deviceID string, action *models.Action) error {
	device := d.deviceManager.GetDevice(deviceID)
	if device == nil {
		return fmt.Errorf("device not found: %s", deviceID)
	}

	if device.Status != "online" {
		return fmt.Errorf("device offline: %s", deviceID)
	}

	action.DeviceID = deviceID
	action.Status = "pending"

	// Add to queue
	select {
	case d.actionQueue <- action:
		return nil
	default:
		return fmt.Errorf("action queue full")
	}
}

// DispatchBatch executes an action on multiple devices
func (d *ActionDispatcher) DispatchBatch(deviceIDs []string, action *models.Action) ([]*models.Action, error) {
	actions := make([]*models.Action, 0, len(deviceIDs))

	for _, deviceID := range deviceIDs {
		// Create a copy of the action for each device
		deviceAction := *action
		deviceAction.DeviceID = deviceID

		if err := d.DispatchToDevice(deviceID, &deviceAction); err != nil {
			log.Printf("Failed to dispatch to device %s: %v", deviceID, err)
			continue
		}

		actions = append(actions, &deviceAction)
	}

	return actions, nil
}

// ProcessActionQueue processes actions from the queue
func (d *ActionDispatcher) ProcessActionQueue() {
	for action := range d.actionQueue {
		action.Status = "executing"

		if err := d.executeAction(action); err != nil {
			action.Status = "failed"
			action.Result = err.Error()
			log.Printf("Action failed: %v", err)
		} else {
			action.Status = "done"
			action.Result = "success"
		}
	}
}

// executeAction executes a single action using ADB
func (d *ActionDispatcher) executeAction(action *models.Action) error {
	device := d.deviceManager.GetDevice(action.DeviceID)
	if device == nil {
		return fmt.Errorf("device not found")
	}

	adbClient := d.deviceManager.GetADBClient()

	switch action.Type {
	case "tap":
		x := int(action.Params["x"].(float64))
		y := int(action.Params["y"].(float64))
		return adbClient.SendTap(device.ADBDeviceID, x, y)

	case "swipe":
		x1 := int(action.Params["x1"].(float64))
		y1 := int(action.Params["y1"].(float64))
		x2 := int(action.Params["x2"].(float64))
		y2 := int(action.Params["y2"].(float64))
		duration := 300 // default
		if d, ok := action.Params["duration"].(float64); ok {
			duration = int(d)
		}
		return adbClient.SendSwipe(device.ADBDeviceID, x1, y1, x2, y2, duration)

	case "input":
		text := action.Params["text"].(string)
		return adbClient.SendText(device.ADBDeviceID, text)

	case "key":
		keycode := int(action.Params["keycode"].(float64))
		return adbClient.SendKey(device.ADBDeviceID, keycode)

	case "open_app":
		packageName := action.Params["package"].(string)
		return adbClient.OpenApp(device.ADBDeviceID, packageName)

	case "install_apk":
		apkPath := action.Params["apk_path"].(string)
		return adbClient.InstallAPK(device.ADBDeviceID, apkPath)

	case "push_file":
		localPath := action.Params["local"].(string)
		remotePath := action.Params["remote"].(string)
		return adbClient.PushFile(device.ADBDeviceID, localPath, remotePath)

	default:
		return fmt.Errorf("unknown action type: %s", action.Type)
	}
}
