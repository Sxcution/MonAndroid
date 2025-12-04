package service

import (
	"androidcontrol/adb"
	"androidcontrol/models"
	"database/sql"
	"sync"
	"time"
)

type DeviceManager struct {
	devices   map[string]*models.Device
	mu        sync.RWMutex
	db        *sql.DB
	adbClient *adb.ADBClient
}

func NewDeviceManager(db *sql.DB) *DeviceManager {
	return &DeviceManager{
		devices:   make(map[string]*models.Device),
		db:        db,
		adbClient: adb.NewADBClient(),
	}
}

// ScanDevices scans for connected Android devices via ADB
func (m *DeviceManager) ScanDevices() error {
	m.mu.Lock()
	defer m.mu.Unlock()

	// Get devices from ADB
	devices, err := m.adbClient.ListDevices()
	if err != nil {
		return err
	}

	// Update device map
	m.devices = make(map[string]*models.Device)
	for i := range devices {
		devices[i].LastSeen = time.Now().Unix()
		m.devices[devices[i].ID] = &devices[i]
	}

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

// GetADBClient returns the ADB client for direct command execution
func (m *DeviceManager) GetADBClient() *adb.ADBClient {
	return m.adbClient
}
