package service

import (
	"androidcontrol/models"
)

type ActionDispatcher struct {
	deviceManager *DeviceManager
	actionQueue   chan *models.Action
}

func NewActionDispatcher(dm *DeviceManager) *ActionDispatcher {
	return &ActionDispatcher{
		deviceManager: dm,
		actionQueue:   make(chan *models.Action, 100),
	}
}

// TODO: Implement methods when Go is installed:
// - DispatchToDevice(deviceID string, action *models.Action) error
// - DispatchToGroup(groupID string, action *models.Action) error
// - ProcessActionQueue()
