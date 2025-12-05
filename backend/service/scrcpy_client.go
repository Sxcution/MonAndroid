package service

import (
	"androidcontrol/adb"
	"fmt"
	"log"
	"math/rand"
	"net"
	"os/exec"
	"path/filepath"
	"sync"
	"time"
)

// ScrcpyClient manages a scrcpy server connection for a single device
// Updated for scrcpy 3.x protocol with control socket support
type ScrcpyClient struct {
	adbClient   *adb.ADBClient
	deviceADBID string
	localPort   int
	scid        uint32 // Session Connection ID (32-bit HEX) for scrcpy 3.x
	serverCmd   *exec.Cmd
	conn        net.Conn // Video stream connection
	ctrlConn    net.Conn // Control socket connection
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
		localPort:   0,
		scid:        0, // Will be generated on Start
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

	// Generate random 31-bit SCID for scrcpy 3.x
	// Server uses Java Integer.parseInt(hex, 16) which is signed 32-bit
	// Values >= 0x80000000 will overflow, so mask to 31-bit (bit 31 = 0)
	c.scid = rand.Uint32() & 0x7FFFFFFF

	// Step 1: Push scrcpy-server to device
	log.Printf("📦 [%s] Pushing scrcpy-server...", c.deviceADBID)
	jarPath := filepath.Join(".", "assets", "scrcpy-server")
	remotePath := "/data/local/tmp/scrcpy-server.jar"

	if err := c.adbClient.PushFile(c.deviceADBID, jarPath, remotePath); err != nil {
		return nil, fmt.Errorf("failed to push scrcpy server: %w", err)
	}
	log.Printf("✅ [%s] Server pushed successfully", c.deviceADBID)

	// Step 2: Find free port and setup ADB forward with SCID-based socket name
	c.localPort = findFreePort()
	if c.localPort == 0 {
		return nil, fmt.Errorf("failed to find free port")
	}

	// Scrcpy 3.x uses socket name: scrcpy_<SCID in 8-digit hex>
	socketName := fmt.Sprintf("scrcpy_%08x", c.scid)
	log.Printf("🔌 [%s] Setting up ADB forward on port %d (socket: %s)...", c.deviceADBID, c.localPort, socketName)
	if err := c.adbClient.Forward(c.deviceADBID, c.localPort, socketName); err != nil {
		return nil, fmt.Errorf("failed to setup ADB forward: %w", err)
	}
	log.Printf("✅ [%s] ADB forward established", c.deviceADBID)

	// Step 3: Start scrcpy server with 3.x protocol + raw_stream mode
	// raw_stream=true: server sends pure H.264 Annex-B without any headers/meta
	log.Printf("🚀 [%s] Starting scrcpy server (v3.3.3 raw_stream)...", c.deviceADBID)
	serverArgs := []string{
		"CLASSPATH=/data/local/tmp/scrcpy-server.jar",
		"app_process",
		"/",
		"com.genymobile.scrcpy.Server",
		"3.3.3",
		fmt.Sprintf("scid=%08x", c.scid), // HEX format, 8 chars, no 0x prefix
		"log_level=debug",
		"video=true",
		"audio=false",
		"max_size=720",
		"video_bit_rate=1000000", // 8Mbps for real-time mode
		"max_fps=30",             // 60fps for smooth interaction
		"tunnel_forward=true",
		"control=true",    // Enable control socket for keyboard/clipboard
		"raw_stream=true", // Pure H.264 Annex-B, no headers/meta
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

	// Step 5: Connect to the server with retry (VIDEO socket)
	log.Printf("🔗 [%s] Connecting to scrcpy video socket...", c.deviceADBID)
	conn, err := c.connectWithRetry(10, 300*time.Millisecond)
	if err != nil {
		c.cleanup()
		return nil, fmt.Errorf("failed to connect to scrcpy server: %w", err)
	}
	c.conn = conn

	// Step 5b: Connect control socket (second connection to same socket)
	log.Printf("🎮 [%s] Connecting to scrcpy control socket...", c.deviceADBID)
	ctrlConn, err := c.connectWithRetry(5, 200*time.Millisecond)
	if err != nil {
		log.Printf("⚠️ [%s] Control socket failed, keyboard disabled: %v", c.deviceADBID, err)
		// Continue without control - video still works
	} else {
		c.ctrlConn = ctrlConn
		log.Printf("✅ [%s] Control socket connected", c.deviceADBID)
	}

	// Step 6: Perform handshake
	log.Printf("🤝 [%s] Performing handshake...", c.deviceADBID)
	if err := c.handshake(); err != nil {
		log.Printf("❌ [%s] Handshake failed: %v", c.deviceADBID, err)
		c.cleanup()
		return nil, fmt.Errorf("handshake failed: %w", err)
	}

	c.running = true
	log.Printf("🎬 [%s] Scrcpy stream ready - %s @ %dx%d (control: %v)", c.deviceADBID, c.deviceName, c.width, c.height, c.ctrlConn != nil)

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
	// Close video TCP connection
	if c.conn != nil {
		c.conn.Close()
		c.conn = nil
	}

	// Close control socket
	if c.ctrlConn != nil {
		c.ctrlConn.Close()
		c.ctrlConn = nil
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

// handshake for scrcpy 3.x raw_stream mode
// raw_stream=true: server does NOT send any metadata (no dummy byte, no device name, no resolution)
// So we just set default values and return - the stream is pure H.264 Annex-B
func (c *ScrcpyClient) handshake() error {
	// raw_stream=true => socket immediately starts with H.264 data
	// No dummy byte, no device meta, no codec meta, no frame headers
	c.deviceName = c.deviceADBID // Use ADB ID as device name
	c.width = 720                // Set by max_size
	c.height = 0                 // Unknown in raw mode

	log.Printf("✅ [%s] Handshake (raw_stream mode): pure H.264 stream ready", c.deviceADBID)
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

// SendControl sends raw bytes to the control socket
func (c *ScrcpyClient) SendControl(data []byte) error {
	c.mu.Lock()
	defer c.mu.Unlock()

	if c.ctrlConn == nil {
		return fmt.Errorf("control socket not connected")
	}

	_, err := c.ctrlConn.Write(data)
	return err
}

// SendKeyEvent sends a key press/release event
func (c *ScrcpyClient) SendKeyEvent(action, keycode, metastate int) error {
	data := SerializeKeycode(action, keycode, 0, metastate)
	return c.SendControl(data)
}

// SendText injects text directly (bypasses keyboard)
func (c *ScrcpyClient) SendText(text string) error {
	data := SerializeText(text)
	return c.SendControl(data)
}

// SendClipboard sets Android clipboard and optionally pastes
func (c *ScrcpyClient) SendClipboard(text string, paste bool) error {
	data := SerializeClipboard(text, paste, 0)
	return c.SendControl(data)
}

// HasControl returns whether control socket is available
func (c *ScrcpyClient) HasControl() bool {
	c.mu.Lock()
	defer c.mu.Unlock()
	return c.ctrlConn != nil
}
