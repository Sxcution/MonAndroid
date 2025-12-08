package adb

import (
	"androidcontrol/models"
	"bytes"
	"fmt"
	"io"
	"os"
	"os/exec"
	"strings"
)

// ADBClient wraps ADB command execution
type ADBClient struct {
	ADBPath string
}

// NewADBClient creates a new ADB client
func NewADBClient() *ADBClient {
	return &ADBClient{
		ADBPath: "adb", // Assumes ADB is in PATH
	}
}

// ListDevices returns a list of connected Android devices
// If the same physical device is connected via both USB and WiFi, WiFi is preferred
func (c *ADBClient) ListDevices() ([]models.Device, error) {
	cmd := exec.Command(c.ADBPath, "devices", "-l")
	output, err := cmd.Output()
	if err != nil {
		return nil, fmt.Errorf("failed to list devices: %w", err)
	}

	// Debug: ADB raw output (disabled to reduce log spam)
	// fmt.Println("📱 ADB Output:")
	// fmt.Println(string(output))

	devices, err := c.parseDeviceList(string(output))
	if err != nil {
		return nil, err
	}

	// Deduplicate: If same physical device connected via USB and WiFi, prefer WiFi
	return c.deduplicateDevices(devices), nil
}

// getSerialNumber gets the hardware serial number of the device
func (c *ADBClient) getSerialNumber(adbDeviceID string) string {
	cmd := exec.Command(c.ADBPath, "-s", adbDeviceID, "shell", "getprop", "ro.serialno")
	output, err := cmd.Output()
	if err != nil {
		return ""
	}
	return strings.TrimSpace(string(output))
}

// isWiFiConnection checks if the device ID is a WiFi connection (IP:port format)
func isWiFiConnection(adbDeviceID string) bool {
	return strings.Contains(adbDeviceID, ":")
}

// deduplicateDevices removes duplicate entries when same device is connected via USB and WiFi
// WiFi connections are preferred over USB
func (c *ADBClient) deduplicateDevices(devices []models.Device) []models.Device {
	// Map hardware serial -> device (prefer WiFi)
	serialToDevice := make(map[string]models.Device)

	// First pass: get hardware serial for each device
	for i := range devices {
		hwSerial := c.getSerialNumber(devices[i].ADBDeviceID)
		if hwSerial == "" {
			// Can't get serial, keep device as-is using ADB ID as key
			hwSerial = devices[i].ADBDeviceID
		}
		devices[i].HardwareSerial = hwSerial // Store for reference

		existing, exists := serialToDevice[hwSerial]
		if !exists {
			serialToDevice[hwSerial] = devices[i]
		} else {
			// Duplicate found - prefer WiFi connection
			currentIsWiFi := isWiFiConnection(devices[i].ADBDeviceID)
			existingIsWiFi := isWiFiConnection(existing.ADBDeviceID)

			if currentIsWiFi && !existingIsWiFi {
				// Current is WiFi, existing is USB - replace with WiFi
				// Dedup: prefer WiFi over USB
				serialToDevice[hwSerial] = devices[i]
			} else if !currentIsWiFi && existingIsWiFi {
				// Current is USB, existing is WiFi - keep WiFi (no-op)
			}
			// If both are same type, keep the first one
		}
	}

	// Convert map back to slice
	result := make([]models.Device, 0, len(serialToDevice))
	for _, device := range serialToDevice {
		result = append(result, device)
	}

	// Only log if deduplication actually happened
	if len(result) != len(devices) {
		fmt.Printf("📊 Dedup: %d devices (from %d raw)\n", len(result), len(devices))
	}
	return result
}

// parseDeviceList parses the output of 'adb devices -l'
func (c *ADBClient) parseDeviceList(output string) ([]models.Device, error) {
	var devices []models.Device
	lines := strings.Split(output, "\n")

	for i, line := range lines {
		// Skip header line and empty lines
		if i == 0 || strings.TrimSpace(line) == "" {
			continue
		}

		// Expected format: <serial> <state> [device info]
		parts := strings.Fields(line)
		if len(parts) < 2 {
			continue
		}

		serial := parts[0]
		state := parts[1]

		fmt.Printf("🔍 Found device: Serial=%s, State=%s\n", serial, state)

		// Only include devices that are online
		if state != "device" {
			fmt.Printf("⚠️ Skipping device %s because state is %s\n", serial, state)
			continue
		}

		// Create device with basic info
		device := models.Device{
			ID:          fmt.Sprintf("device_%s", serial),
			ADBDeviceID: serial,
			Name:        serial, // Will be updated with model name
			Status:      "online",
		}

		// Parse additional device info
		for _, part := range parts[2:] {
			if strings.HasPrefix(part, "model:") {
				device.Name = strings.TrimPrefix(part, "model:")
				device.Name = strings.ReplaceAll(device.Name, "_", " ")
			}
		}

		// Get additional device properties
		if err := c.enrichDeviceInfo(&device); err != nil {
			// Log error but don't fail
			fmt.Printf("Warning: Failed to get full info for %s: %v\n", serial, err)
		}

		devices = append(devices, device)
	}

	return devices, nil
}

// enrichDeviceInfo gets additional device properties via shell commands
func (c *ADBClient) enrichDeviceInfo(device *models.Device) error {
	// Get Android version
	if version, err := c.getProperty(device.ADBDeviceID, "ro.build.version.release"); err == nil {
		device.AndroidVersion = strings.TrimSpace(version)
	}

	// Get screen resolution
	if resolution, err := c.getScreenResolution(device.ADBDeviceID); err == nil {
		device.Resolution = resolution
	}

	// Get battery level
	if battery, err := c.getBatteryLevel(device.ADBDeviceID); err == nil {
		device.Battery = battery
	}

	return nil
}

// getProperty gets a system property from the device
func (c *ADBClient) getProperty(deviceID, property string) (string, error) {
	cmd := exec.Command(c.ADBPath, "-s", deviceID, "shell", "getprop", property)
	output, err := cmd.Output()
	if err != nil {
		return "", err
	}
	return string(output), nil
}

// getScreenResolution gets the device screen resolution
// Prioritizes "Override size" if set, otherwise uses "Physical size"
func (c *ADBClient) getScreenResolution(deviceID string) (string, error) {
	cmd := exec.Command(c.ADBPath, "-s", deviceID, "shell", "wm", "size")
	output, err := cmd.Output()
	if err != nil {
		return "", err
	}

	outputStr := string(output)
	lines := strings.Split(outputStr, "\n")

	var physicalSize string
	var overrideSize string

	for _, line := range lines {
		line = strings.TrimSpace(line)
		if strings.Contains(line, "Physical size:") {
			parts := strings.Split(line, ":")
			if len(parts) >= 2 {
				physicalSize = strings.TrimSpace(parts[1])
			}
		}
		if strings.Contains(line, "Override size:") {
			parts := strings.Split(line, ":")
			if len(parts) >= 2 {
				overrideSize = strings.TrimSpace(parts[1])
			}
		}
	}

	// Ưu tiên Override size vì đó là độ phân giải thực tế đang hiển thị
	if overrideSize != "" {
		return overrideSize, nil
	}
	if physicalSize != "" {
		return physicalSize, nil
	}

	return "unknown", nil
}

// getBatteryLevel gets the device battery level (0-100)
func (c *ADBClient) getBatteryLevel(deviceID string) (int, error) {
	cmd := exec.Command(c.ADBPath, "-s", deviceID, "shell", "dumpsys", "battery")
	output, err := cmd.Output()
	if err != nil {
		return 0, err
	}

	// Parse battery level from output
	lines := strings.Split(string(output), "\n")
	for _, line := range lines {
		if strings.Contains(line, "level:") {
			parts := strings.Split(line, ":")
			if len(parts) >= 2 {
				var level int
				fmt.Sscanf(strings.TrimSpace(parts[1]), "%d", &level)
				return level, nil
			}
		}
	}

	return 0, fmt.Errorf("battery level not found")
}

// ExecuteCommand executes a generic ADB shell command
func (c *ADBClient) ExecuteCommand(deviceID, command string) (string, error) {
	cmd := exec.Command(c.ADBPath, "-s", deviceID, "shell", command)
	output, err := cmd.Output()
	if err != nil {
		return "", fmt.Errorf("command failed: %w", err)
	}
	return string(output), nil
}

// ScreenCapture captures the device screen and returns PNG bytes
func (c *ADBClient) ScreenCapture(deviceID string) ([]byte, error) {
	cmd := exec.Command(c.ADBPath, "-s", deviceID, "exec-out", "screencap", "-p")
	var stdout, stderr bytes.Buffer
	cmd.Stdout = &stdout
	cmd.Stderr = &stderr

	if err := cmd.Run(); err != nil {
		return nil, fmt.Errorf("screencap failed: %w, stderr: %s", err, stderr.String())
	}

	return stdout.Bytes(), nil
}

// StartH264Stream starts hardware-encoded H.264 streaming using screenrecord
// Returns io.ReadCloser for streaming raw H.264 data, and *exec.Cmd for process control
func (c *ADBClient) StartH264Stream(deviceID string) (io.ReadCloser, *exec.Cmd, error) {
	// Increased quality settings to reduce blur during interaction
	bitrate := getEnv("H264_BITRATE", "2000000") // 2 Mbps (good balance for grid view)
	size := getEnv("H264_SIZE", "720x1280")      // Higher resolution for sharper image

	// Start screenrecord with H.264 output (default 3-minute limit for compatibility)
	// Backend will auto-restart when stream ends
	cmd := exec.Command(c.ADBPath, "-s", deviceID, "exec-out",
		"screenrecord",
		"--output-format=h264",
		"--bit-rate="+bitrate,
		"--size="+size,
		"-") // stdout

	// Get stdout pipe for streaming
	stdout, err := cmd.StdoutPipe()
	if err != nil {
		return nil, nil, fmt.Errorf("failed to create stdout pipe: %w", err)
	}

	// Capture stderr for debugging
	cmd.Stderr = os.Stderr

	// Start the command
	if err := cmd.Start(); err != nil {
		return nil, nil, fmt.Errorf("failed to start screenrecord: %w", err)
	}

	return stdout, cmd, nil
}

// getEnv gets environment variable with fallback default
func getEnv(key, defaultVal string) string {
	if val := os.Getenv(key); val != "" {
		return val
	}
	return defaultVal
}

// SendTap sends a tap event to the device
func (c *ADBClient) SendTap(deviceID string, x, y int) error {
	cmd := exec.Command(c.ADBPath, "-s", deviceID, "shell", "input", "tap",
		fmt.Sprintf("%d", x), fmt.Sprintf("%d", y))

	if err := cmd.Run(); err != nil {
		return fmt.Errorf("tap failed: %w", err)
	}
	return nil
}

// SendSwipe sends a swipe gesture to the device
func (c *ADBClient) SendSwipe(deviceID string, x1, y1, x2, y2, duration int) error {
	cmd := exec.Command(c.ADBPath, "-s", deviceID, "shell", "input", "swipe",
		fmt.Sprintf("%d", x1), fmt.Sprintf("%d", y1),
		fmt.Sprintf("%d", x2), fmt.Sprintf("%d", y2),
		fmt.Sprintf("%d", duration))

	if err := cmd.Run(); err != nil {
		return fmt.Errorf("swipe failed: %w", err)
	}
	return nil
}

// SendText sends text input to the device
func (c *ADBClient) SendText(deviceID, text string) error {
	// Escape special characters for shell
	escapedText := strings.ReplaceAll(text, " ", "%s")

	cmd := exec.Command(c.ADBPath, "-s", deviceID, "shell", "input", "text", escapedText)

	if err := cmd.Run(); err != nil {
		return fmt.Errorf("text input failed: %w", err)
	}
	return nil
}

// SendKey sends a key event to the device
func (c *ADBClient) SendKey(deviceID string, keycode int) error {
	cmd := exec.Command(c.ADBPath, "-s", deviceID, "shell", "input", "keyevent",
		fmt.Sprintf("%d", keycode))

	if err := cmd.Run(); err != nil {
		return fmt.Errorf("key event failed: %w", err)
	}
	return nil
}

// InstallAPK installs an APK on the device
func (c *ADBClient) InstallAPK(deviceID, apkPath string) error {
	cmd := exec.Command(c.ADBPath, "-s", deviceID, "install", apkPath)

	if err := cmd.Run(); err != nil {
		return fmt.Errorf("apk install failed: %w", err)
	}
	return nil
}

// PushFile pushes a file to the device
func (c *ADBClient) PushFile(deviceID, localPath, remotePath string) error {
	cmd := exec.Command(c.ADBPath, "-s", deviceID, "push", localPath, remotePath)

	if err := cmd.Run(); err != nil {
		return fmt.Errorf("file push failed: %w", err)
	}
	return nil
}

// OpenApp opens an app by package name
func (c *ADBClient) OpenApp(deviceID, packageName string) error {
	cmd := exec.Command(c.ADBPath, "-s", deviceID, "shell", "monkey", "-p", packageName, "-c", "android.intent.category.LAUNCHER", "1")

	if err := cmd.Run(); err != nil {
		return fmt.Errorf("app launch failed: %w", err)
	}
	return nil
}

// Forward creates ADB port forwarding from local TCP port to remote abstract socket
// Example: adb -s <deviceID> forward tcp:27183 localabstract:scrcpy
func (c *ADBClient) Forward(deviceID string, localPort int, remoteSocket string) error {
	cmd := exec.Command(c.ADBPath, "-s", deviceID, "forward",
		fmt.Sprintf("tcp:%d", localPort),
		fmt.Sprintf("localabstract:%s", remoteSocket))

	if err := cmd.Run(); err != nil {
		return fmt.Errorf("adb forward failed: %w", err)
	}
	return nil
}

// RemoveForward removes ADB port forwarding for the specified local port
func (c *ADBClient) RemoveForward(deviceID string, localPort int) error {
	cmd := exec.Command(c.ADBPath, "-s", deviceID, "forward", "--remove",
		fmt.Sprintf("tcp:%d", localPort))

	if err := cmd.Run(); err != nil {
		return fmt.Errorf("adb forward remove failed: %w", err)
	}
	return nil
}

// ExecuteCommandBackground starts a non-blocking shell command on the device
// Returns the exec.Cmd for process management (caller must handle cleanup)
func (c *ADBClient) ExecuteCommandBackground(deviceID string, args []string) (*exec.Cmd, error) {
	// Build full command: adb -s <deviceID> shell <args...>
	fullArgs := []string{"-s", deviceID, "shell"}
	fullArgs = append(fullArgs, args...)

	cmd := exec.Command(c.ADBPath, fullArgs...)

	// Capture stderr for debugging
	cmd.Stderr = os.Stderr

	if err := cmd.Start(); err != nil {
		return nil, fmt.Errorf("failed to start background command: %w", err)
	}

	return cmd, nil
}
