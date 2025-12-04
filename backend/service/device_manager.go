package service

import (
	"database/sql"
	"androidcontrol/models"
	"sync"
	"time"
)

type DeviceManager struct {
	devices map[string]*models.Device
	mu      sync.RWMutex
	db      *sql.DB
}

func NewDeviceManager(db *sql.DB) *DeviceManager {
	return &DeviceManager{
		devices: make(map[string]*models.Device),
		db:      db,
	}
}

// ScanDevices scans for connected Android devices
func (m *DeviceManager) ScanDevices() error {
	// TODO: Implement ADB device scanning
	// For now, return mock data
	m.mu.Lock()
	defer m.mu.Unlock()
	
	// Add a mock device for testing
	mockDevice := &models.Device{
		ID:             "device_1",
		Name:           "Test Device",
		ADBDeviceID:    "emulator-5554",
		Status:         "offline",
		Resolution:     "1080x1920",
		Battery:        85,
		AndroidVersion: "13",
		LastSeen:       time.Now().Unix(),
	}
	m.devices[mockDevice.ID] = mockDevice
	
	return nil
}

// GetAllDevices returns all devices
func (m *DeviceManager) GetAllDevices() []*models.Device {
	m.mu.RLock()
	defer m.mu.RUnlock()
	
	devices := make([]*models.Device, 0, len(m.devices))
	for _, device := range m.devices {
		devices = append(devices, device)
	}
	return devices
}

// GetDevice returns a single device by ID
func (m *DeviceManager) GetDevice(id string) *models.Device {
	m.mu.RLock()
	defer m.mu.RUnlock()
	return m.devices[id]
}
