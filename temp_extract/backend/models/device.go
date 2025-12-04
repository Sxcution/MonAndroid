package models

type Device struct {
	ID             string `json:"id"`
	Name           string `json:"name"`
	ADBDeviceID    string `json:"adb_device_id"`
	Status         string `json:"status"` // online, offline
	Resolution     string `json:"resolution"`
	Battery        int    `json:"battery"`
	AndroidVersion string `json:"android_version"`
	LastSeen       int64  `json:"last_seen"`
	Frame          string `json:"frame,omitempty"` // Base64 encoded screen frame
}

type DeviceGroup struct {
	ID          string   `json:"id"`
	Name        string   `json:"name"`
	Description string   `json:"description"`
	DeviceIDs   []string `json:"device_ids"`
	CreatedAt   int64    `json:"created_at"`
}
