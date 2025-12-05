package service

import (
	"androidcontrol/adb"
	"encoding/binary"
	"fmt"
	"io"
	"log"
	"net"
	"os/exec"
	"path/filepath"
	"strings"
	"sync"
	"time"
)

// ScrcpyClient manages a scrcpy server connection for a single device
type ScrcpyClient struct {
	adbClient   *adb.ADBClient
	deviceADBID string
	localPort   int
	serverCmd   *exec.Cmd
	conn        net.Conn
	deviceName  string
	width       int
	height      int
	mu          sync.Mutex
	running     bool
}

// NewScrcpyClient creates a new scrcpy client for the given device
func NewScrcpyClient(adbClient *adb.ADBClient, deviceADBID string) *ScrcpyClient {
	return &ScrcpyClient{
		adbClient:   adbClient,
		deviceADBID: deviceADBID,
		localPort:   0, // Will be assigned dynamically
	}
}

// Start initializes the scrcpy server and establishes the video stream connection
// Returns the net.Conn for reading raw H.264 Annex-B data
func (c *ScrcpyClient) Start() (net.Conn, error) {
	c.mu.Lock()
	defer c.mu.Unlock()

	if c.running {
		return c.conn, nil
	}

	// Step 1: Push scrcpy-server.jar to device
	log.Printf("📦 [%s] Pushing scrcpy-server.jar...", c.deviceADBID)
	jarPath := filepath.Join(".", "assets", "scrcpy-server-v1.24.jar")
	remotePath := "/data/local/tmp/scrcpy-server.jar"

	if err := c.adbClient.PushFile(c.deviceADBID, jarPath, remotePath); err != nil {
		return nil, fmt.Errorf("failed to push scrcpy server: %w", err)
	}
	log.Printf("✅ [%s] Server jar pushed successfully", c.deviceADBID)

	// Step 2: Find free port and setup ADB forward
	c.localPort = findFreePort()
	if c.localPort == 0 {
		return nil, fmt.Errorf("failed to find free port")
	}

	log.Printf("🔌 [%s] Setting up ADB forward on port %d...", c.deviceADBID, c.localPort)
	if err := c.adbClient.Forward(c.deviceADBID, c.localPort, "scrcpy"); err != nil {
		return nil, fmt.Errorf("failed to setup ADB forward: %w", err)
	}
	log.Printf("✅ [%s] ADB forward established", c.deviceADBID)

	// Step 3: Start scrcpy server with v1.24 key=value arguments
	log.Printf("🚀 [%s] Starting scrcpy server (v1.24)...", c.deviceADBID)
	serverArgs := []string{
		"CLASSPATH=/data/local/tmp/scrcpy-server.jar",
		"app_process",
		"/",
		"com.genymobile.scrcpy.Server",
		"1.24",
		"log_level=info",
		"max_size=720",
		"bit_rate=2000000",
		"max_fps=30",
		"lock_video_orientation=-1",
		"tunnel_forward=true",
		"control=false",
		"display_id=0",
		"show_touches=false",
		"stay_awake=false",
		"power_off_on_close=true",
		"send_frame_meta=false", // CRITICAL: No 12-byte header per frame
		"send_device_meta=true", // Keep 69-byte initial header
		"send_dummy_byte=true",  // Keep 1-byte handshake
		"raw_stream=false",
	}

	cmd, err := c.adbClient.ExecuteCommandBackground(c.deviceADBID, serverArgs)
	if err != nil {
		c.cleanup()
		return nil, fmt.Errorf("failed to start scrcpy server: %w", err)
	}
	c.serverCmd = cmd
	log.Printf("✅ [%s] Scrcpy server process started (PID: %d)", c.deviceADBID, cmd.Process.Pid)

	// Step 4: Wait for server to initialize (need enough time for app_process to start)
	time.Sleep(1500 * time.Millisecond)

	// Step 5: Connect to the server with retry
	log.Printf("🔗 [%s] Connecting to scrcpy server...", c.deviceADBID)
	conn, err := c.connectWithRetry(10, 300*time.Millisecond)
	if err != nil {
		c.cleanup()
		return nil, fmt.Errorf("failed to connect to scrcpy server: %w", err)
	}
	c.conn = conn

	// Step 6: Perform handshake
	log.Printf("🤝 [%s] Performing handshake...", c.deviceADBID)
	if err := c.handshake(); err != nil {
		log.Printf("❌ [%s] Handshake failed: %v", c.deviceADBID, err)
		c.cleanup()
		return nil, fmt.Errorf("handshake failed: %w", err)
	}

	c.running = true
	log.Printf("🎬 [%s] Scrcpy stream ready - %s @ %dx%d", c.deviceADBID, c.deviceName, c.width, c.height)

	return c.conn, nil
}

// Stop terminates the scrcpy server and cleans up resources
func (c *ScrcpyClient) Stop() {
	c.mu.Lock()
	defer c.mu.Unlock()

	c.cleanup()
	c.running = false
}

// cleanup releases all resources (must be called while holding mutex)
func (c *ScrcpyClient) cleanup() {
	// Close TCP connection
	if c.conn != nil {
		c.conn.Close()
		c.conn = nil
	}

	// Kill server process
	if c.serverCmd != nil && c.serverCmd.Process != nil {
		log.Printf("🛑 [%s] Killing scrcpy server process...", c.deviceADBID)
		c.serverCmd.Process.Kill()
		c.serverCmd.Wait()
		c.serverCmd = nil
	}

	// Remove ADB forward
	if c.localPort > 0 {
		log.Printf("🔌 [%s] Removing ADB forward on port %d...", c.deviceADBID, c.localPort)
		if err := c.adbClient.RemoveForward(c.deviceADBID, c.localPort); err != nil {
			log.Printf("⚠️ [%s] Failed to remove forward: %v", c.deviceADBID, err)
		}
		c.localPort = 0
	}
}

// connectWithRetry attempts to connect to the scrcpy server with retries
func (c *ScrcpyClient) connectWithRetry(maxRetries int, delay time.Duration) (net.Conn, error) {
	addr := fmt.Sprintf("127.0.0.1:%d", c.localPort)

	for i := 0; i < maxRetries; i++ {
		conn, err := net.DialTimeout("tcp", addr, 2*time.Second)
		if err == nil {
			return conn, nil
		}
		log.Printf("⏳ [%s] Connection attempt %d/%d failed, retrying...", c.deviceADBID, i+1, maxRetries)
		time.Sleep(delay)
	}

	return nil, fmt.Errorf("failed to connect after %d retries", maxRetries)
}

// handshake performs the scrcpy v1.24 initial handshake
// Protocol: 1 dummy byte + 64 bytes device name + 2 bytes width + 2 bytes height
func (c *ScrcpyClient) handshake() error {
	// Set read timeout for handshake
	c.conn.SetReadDeadline(time.Now().Add(5 * time.Second))
	defer c.conn.SetReadDeadline(time.Time{}) // Clear deadline after handshake

	// Read 1 dummy byte
	dummy := make([]byte, 1)
	if _, err := io.ReadFull(c.conn, dummy); err != nil {
		return fmt.Errorf("failed to read dummy byte: %w", err)
	}

	// Read 64-byte device name (null-padded)
	nameBytes := make([]byte, 64)
	if _, err := io.ReadFull(c.conn, nameBytes); err != nil {
		return fmt.Errorf("failed to read device name: %w", err)
	}
	// Trim null bytes to get actual name
	c.deviceName = strings.TrimRight(string(nameBytes), "\x00")

	// Read 2-byte width (big-endian)
	widthBytes := make([]byte, 2)
	if _, err := io.ReadFull(c.conn, widthBytes); err != nil {
		return fmt.Errorf("failed to read width: %w", err)
	}
	c.width = int(binary.BigEndian.Uint16(widthBytes))

	// Read 2-byte height (big-endian)
	heightBytes := make([]byte, 2)
	if _, err := io.ReadFull(c.conn, heightBytes); err != nil {
		return fmt.Errorf("failed to read height: %w", err)
	}
	c.height = int(binary.BigEndian.Uint16(heightBytes))

	log.Printf("✅ [%s] Handshake complete: Device='%s', Resolution=%dx%d",
		c.deviceADBID, c.deviceName, c.width, c.height)

	return nil
}

// GetResolution returns the device screen resolution after successful handshake
func (c *ScrcpyClient) GetResolution() (width, height int) {
	return c.width, c.height
}

// GetDeviceName returns the device name after successful handshake
func (c *ScrcpyClient) GetDeviceName() string {
	return c.deviceName
}

// IsRunning returns whether the scrcpy client is currently streaming
func (c *ScrcpyClient) IsRunning() bool {
	c.mu.Lock()
	defer c.mu.Unlock()
	return c.running
}

// findFreePort finds an available TCP port
func findFreePort() int {
	listener, err := net.Listen("tcp", "127.0.0.1:0")
	if err != nil {
		return 0
	}
	defer listener.Close()
	return listener.Addr().(*net.TCPAddr).Port
}
