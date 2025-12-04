package config

const (
	// Server configuration
	HTTPPort = ":8080"
	WSPort   = ":8081"

	// ADB configuration
	ADBPath = "adb" // Assumes ADB is in PATH

	// Screen streaming configuration
	ScreenRefreshRate = 30 // FPS
	ScreenQuality     = 80 // JPEG quality 1-100
)
