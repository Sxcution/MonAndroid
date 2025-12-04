package adb

import (
	"androidcontrol/models"
	"bytes"
	"fmt"
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
func (c *ADBClient) ListDevices() ([]models.Device, error) {
	cmd := exec.Command(c.ADBPath, "devices", "-l")
	output, err := cmd.Output()
	if err != nil {
		return nil, fmt.Errorf("failed to list devices: %w", err)
	}

	return c.parseDeviceList(string(output))
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
		// Example: emulator-5554    device product:sdk_google_phone_x86 model:Android_SDK_built_for_x86 device:generic_x86
		parts := strings.Fields(line)
		if len(parts) < 2 {
			continue
		}

		serial := parts[0]
		state := parts[1]

		// Only include devices that are online
		if state != "device" {
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
func (c *ADBClient) getScreenResolution(deviceID string) (string, error) {
	cmd := exec.Command(c.ADBPath, "-s", deviceID, "shell", "wm", "size")
	output, err := cmd.Output()
	if err != nil {
		return "", err
	}

	// Output format: "Physical size: 1080x1920"
	result := strings.TrimSpace(string(output))
	if strings.Contains(result, ":") {
		parts := strings.Split(result, ":")
		if len(parts) >= 2 {
			return strings.TrimSpace(parts[1]), nil
		}
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
