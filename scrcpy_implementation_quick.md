# Scrcpy 3.x Implementation Quick-Start for Go
## Practical Code Examples & Troubleshooting Guide

---

## 1. Frame Header Parsing (Most Critical)

### Bit-Packing Breakdown

The frame header encodes 3 pieces of information in 12 bytes:

```
Byte Layout (Big-Endian):
┌──────┬──────┬──────┬──────┬──────┬──────┬──────┬──────┐
│ Byte0│ Byte1│ Byte2│ Byte3│ Byte4│ Byte5│ Byte6│ Byte7│ (PTS + Flags)
├──────┴──────┴──────┴──────┴──────┴──────┴──────┴──────┤
│  C  K  [62-bit PTS value]                             │
└─────────────────────────────────────────────────────────┤
C = Config packet flag (1 bit)
K = Key frame flag (1 bit)

┌──────┬──────┬──────┬──────┐
│ Byte8│ Byte9│Byte10│Byte11│ (Packet Size)
├──────┴──────┴──────┴──────┤
│  32-bit packet size       │
└───────────────────────────┘
```

### Go Implementation

```go
package scrcpy

import (
    "encoding/binary"
    "io"
)

type FramePacket struct {
    PTS           int64
    ConfigPacket  bool
    KeyFrame      bool
    PayloadSize   uint32
    Payload       []byte
}

func ReadFramePacket(r io.Reader) (*FramePacket, error) {
    header := make([]byte, 12)
    if n, err := r.Read(header); n < 12 || err != nil {
        return nil, err
    }
    
    // Bytes 0-7: PTS with flags (Big-Endian)
    ptsWithFlags := binary.BigEndian.Uint64(header[0:8])
    
    // Extract flags from most significant 2 bits
    configPacket := (ptsWithFlags >> 63) & 1 == 1
    keyFrame := (ptsWithFlags >> 62) & 1 == 1
    
    // Extract PTS from lower 62 bits
    pts := int64(ptsWithFlags & 0x3FFFFFFFFFFFFFFF)
    
    // Bytes 8-11: Payload size (Big-Endian)
    payloadSize := binary.BigEndian.Uint32(header[8:12])
    
    // Read payload
    payload := make([]byte, payloadSize)
    if n, err := r.Read(payload); n < int(payloadSize) || err != nil {
        return nil, err
    }
    
    return &FramePacket{
        PTS:          pts,
        ConfigPacket: configPacket,
        KeyFrame:     keyFrame,
        PayloadSize:  payloadSize,
        Payload:      payload,
    }, nil
}

// Example: Write a test frame header
func WriteFramePacketHeader(w io.Writer, pts int64, isConfig, isKeyFrame bool) error {
    ptsWithFlags := pts & 0x3FFFFFFFFFFFFFFF
    
    if isConfig {
        ptsWithFlags |= (1 << 63)
    }
    if isKeyFrame {
        ptsWithFlags |= (1 << 62)
    }
    
    header := make([]byte, 8)
    binary.BigEndian.PutUint64(header, uint64(ptsWithFlags))
    
    _, err := w.Write(header)
    return err
}
```

---

## 2. Socket Connection Sequence

### Critical: Socket Order Must Match Configuration

```go
package scrcpy

import (
    "fmt"
    "net"
    "sync"
    "time"
)

type SocketConfig struct {
    Video   bool
    Audio   bool
    Control bool
}

type Sockets struct {
    Video   net.Conn
    Audio   net.Conn
    Control net.Conn
}

func (cfg SocketConfig) SocketOrder() []string {
    order := []string{}
    if cfg.Video { order = append(order, "video") }
    if cfg.Audio { order = append(order, "audio") }
    if cfg.Control { order = append(order, "control") }
    return order
}

func AcceptSockets(port int, cfg SocketConfig) (*Sockets, error) {
    listener, err := net.Listen("tcp", fmt.Sprintf(":%d", port))
    if err != nil {
        return nil, err
    }
    defer listener.Close()
    
    sockets := &Sockets{}
    order := cfg.SocketOrder()
    
    for i, name := range order {
        // Set timeout for accept (detect connection failure)
        listener.SetDeadline(time.Now().Add(30 * time.Second))
        
        conn, err := listener.Accept()
        if err != nil {
            return nil, fmt.Errorf("socket %d (%s): %w", i+1, name, err)
        }
        
        // Set I/O timeouts on connected socket
        conn.SetReadDeadline(time.Now().Add(60 * time.Second))
        conn.SetWriteDeadline(time.Now().Add(60 * time.Second))
        
        switch name {
        case "video":
            sockets.Video = conn
        case "audio":
            sockets.Audio = conn
        case "control":
            sockets.Control = conn
        }
        
        fmt.Printf("✓ Accepted %s socket\n", name)
    }
    
    return sockets, nil
}

// Example usage
func main() {
    cfg := SocketConfig{Video: true, Audio: true, Control: false}
    
    sockets, err := AcceptSockets(27183, cfg)
    if err != nil {
        panic(err)
    }
    
    fmt.Printf("Socket order: %v\n", cfg.SocketOrder())
    // Expected: ["video", "audio"]
}
```

---

## 3. Codec Metadata Parsing

### Video Codec Metadata

```go
package scrcpy

import (
    "encoding/binary"
    "io"
)

type VideoCodecMeta struct {
    CodecID int
    Width   uint32
    Height  uint32
}

const (
    CodecH264 = 0
    CodecH265 = 1
    CodecAV1  = 2
)

func ReadVideoCodecMeta(r io.Reader) (*VideoCodecMeta, error) {
    meta := make([]byte, 12)
    if n, err := r.Read(meta); n < 12 || err != nil {
        return nil, err
    }
    
    return &VideoCodecMeta{
        CodecID: int(binary.BigEndian.Uint32(meta[0:4])),
        Width:   binary.BigEndian.Uint32(meta[4:8]),
        Height:  binary.BigEndian.Uint32(meta[8:12]),
    }, nil
}

func (m *VideoCodecMeta) String() string {
    codecs := map[int]string{
        CodecH264: "H.264",
        CodecH265: "H.265 (HEVC)",
        CodecAV1:  "AV1",
    }
    codecName := codecs[m.CodecID]
    if codecName == "" {
        codecName = "Unknown"
    }
    return fmt.Sprintf("%s %dx%d", codecName, m.Width, m.Height)
}

// Audio codec metadata
type AudioCodecMeta struct {
    CodecID int
}

const (
    CodecOPUS = 0
    CodecAAC  = 1
    CodecRAW  = 2
)

func ReadAudioCodecMeta(r io.Reader) (*AudioCodecMeta, error) {
    meta := make([]byte, 4)
    if n, err := r.Read(meta); n < 4 || err != nil {
        return nil, err
    }
    
    return &AudioCodecMeta{
        CodecID: int(binary.BigEndian.Uint32(meta)),
    }, nil
}
```

---

## 4. Config Packet (SPS/PPS) Handling for H.264

### The Problem

H.264 streams require decoder initialization data before they can decode frames:

```
Stream Layout:
┌─────────────────┐
│  Config Packet  │ ← SPS/PPS (initialize decoder)
│  (ConfigPkt=1)  │
├─────────────────┤
│   IDR Frame     │ ← First decodable frame (KeyFrame=1)
│   (ConfigPkt=0) │
├─────────────────┤
│   P Frame 2     │ ← Depends on frame 1
├─────────────────┤
│   P Frame 3     │
└─────────────────┘

If you skip SPS/PPS → Decoder error or corrupted output
```

### Go Implementation

```go
package scrcpy

type H264ConfigBuffer struct {
    SPSData []byte  // Sequence Parameter Set
    PPSData []byte  // Picture Parameter Set
    ready   bool
}

func (cb *H264ConfigBuffer) ProcessPacket(pkt *FramePacket) error {
    if pkt.ConfigPacket {
        // This is SPS/PPS data
        // Parse and store for decoder initialization
        cb.SPSData, cb.PPSData = parseH264Config(pkt.Payload)
        cb.ready = true
        fmt.Println("✓ Config packet received, decoder can now be initialized")
        return nil
    }
    return nil
}

func parseH264Config(data []byte) (sps, pps []byte) {
    // NAL units start with 0x000001 or 0x00000001
    // SPS type = 7, PPS type = 8
    // This is simplified; real implementation should handle edge cases
    
    i := 0
    for i < len(data) {
        // Find NAL start code
        for i < len(data)-3 {
            if data[i] == 0 && data[i+1] == 0 && data[i+2] == 1 {
                break
            }
            i++
        }
        if i >= len(data)-3 {
            break
        }
        
        // Skip start code
        i += 3
        
        nalType := data[i] & 0x1F
        
        // Find next NAL unit
        j := i + 1
        for j < len(data)-3 {
            if data[j] == 0 && data[j+1] == 0 && data[j+2] == 1 {
                break
            }
            j++
        }
        
        nalData := data[i:j]
        
        switch nalType {
        case 7:
            sps = nalData
        case 8:
            pps = nalData
        }
        
        i = j
    }
    return
}

// Usage
func initializeDecoderWithConfig(cfgBuf *H264ConfigBuffer) error {
    if !cfgBuf.ready {
        return fmt.Errorf("config packet not yet received")
    }
    
    // Initialize FFmpeg decoder with SPS/PPS
    // Example (pseudo-code):
    // ctx := createH264Context()
    // ctx.SendPacket(cfgBuf.SPSData)  // Feed SPS
    // ctx.SendPacket(cfgBuf.PPSData)  // Feed PPS
    
    fmt.Println("✓ Decoder initialized with SPS/PPS")
    return nil
}
```

---

## 5. Real-World Frame Loop

### Complete Example: Single Device Video Stream

```go
package scrcpy

import (
    "fmt"
    "log"
    "net"
    "sync"
)

type VideoStreamConsumer struct {
    conn         net.Conn
    mu           sync.Mutex
    
    codecMeta    *VideoCodecMeta
    configBuf    *H264ConfigBuffer
    frameCount   int64
}

func NewVideoStreamConsumer(conn net.Conn) *VideoStreamConsumer {
    return &VideoStreamConsumer{
        conn:      conn,
        configBuf: &H264ConfigBuffer{},
    }
}

func (c *VideoStreamConsumer) Start() error {
    // Step 1: Read codec metadata
    meta, err := ReadVideoCodecMeta(c.conn)
    if err != nil {
        return fmt.Errorf("read codec meta: %w", err)
    }
    c.codecMeta = meta
    log.Printf("Video codec: %s", meta.String())
    
    // Step 2: Frame loop
    for {
        pkt, err := ReadFramePacket(c.conn)
        if err != nil {
            return fmt.Errorf("frame %d: %w", c.frameCount, err)
        }
        
        // Step 3: Handle config packet
        if pkt.ConfigPacket {
            if err := c.configBuf.ProcessPacket(pkt); err != nil {
                log.Printf("Warning: config packet error: %v", err)
            }
            continue  // Skip to next packet
        }
        
        // Step 4: Process data packet
        c.frameCount++
        
        if c.frameCount%100 == 0 {
            log.Printf("✓ Processed %d frames (latest: %s, pts=%d)",
                c.frameCount,
                map[bool]string{true: "IDR", false: "P"}[pkt.KeyFrame],
                pkt.PTS)
        }
        
        // Step 5: Decode and display (TODO: your decoder)
        // decoder.ProcessPacket(pkt.Payload, pkt.PTS, pkt.KeyFrame)
        // frame := decoder.GetFrame()
        // if frame != nil { displayFrame(frame) }
    }
}
```

---

## 6. Multi-Device Management

### SCID & Port Allocation

```go
package scrcpy

import (
    "fmt"
    "math/rand"
    "sync"
)

type MultiDeviceManager struct {
    devices      map[string]*DeviceSession
    portRange    [2]int  // e.g., [27183, 27199]
    usedPorts    map[int]bool
    nextSCID     int32
    mu           sync.Mutex
}

type DeviceSession struct {
    Serial   string
    SCID     string
    Port     int
}

func NewMultiDeviceManager(portStart, portEnd int) *MultiDeviceManager {
    return &MultiDeviceManager{
        devices:    make(map[string]*DeviceSession),
        portRange:  [2]int{portStart, portEnd},
        usedPorts:  make(map[int]bool),
        nextSCID:   rand.Int31(),
    }
}

func (m *MultiDeviceManager) AllocateSession(serial string) (*DeviceSession, error) {
    m.mu.Lock()
    defer m.mu.Unlock()
    
    // Find available port
    port := -1
    for p := m.portRange[0]; p <= m.portRange[1]; p++ {
        if !m.usedPorts[p] {
            port = p
            m.usedPorts[p] = true
            break
        }
    }
    
    if port == -1 {
        return nil, fmt.Errorf("no available ports (range %d-%d)",
            m.portRange[0], m.portRange[1])
    }
    
    // Generate unique SCID (31-bit)
    scid := m.nextSCID & 0x7FFFFFFF  // Ensure 31-bit
    m.nextSCID = (m.nextSCID + 1) & 0x7FFFFFFF
    
    session := &DeviceSession{
        Serial: serial,
        SCID:   fmt.Sprintf("%d", scid),
        Port:   port,
    }
    
    m.devices[serial] = session
    fmt.Printf("✓ Allocated: %s on port %d (SCID=%s)\n", serial, port, session.SCID)
    
    return session, nil
}

func (m *MultiDeviceManager) ReleaseSession(serial string) {
    m.mu.Lock()
    defer m.mu.Unlock()
    
    session, exists := m.devices[serial]
    if !exists {
        return
    }
    
    delete(m.devices, serial)
    delete(m.usedPorts, session.Port)
    
    fmt.Printf("✓ Released: %s (port %d freed)\n", serial, session.Port)
}

// Example
func main() {
    manager := NewMultiDeviceManager(27183, 27199)
    
    session1, _ := manager.AllocateSession("emulator-5554")
    session2, _ := manager.AllocateSession("192.168.1.100:5555")
    
    fmt.Println("Sessions:")
    fmt.Printf("  Device 1: %s@%d (SCID=%s)\n", session1.Serial, session1.Port, session1.SCID)
    fmt.Printf("  Device 2: %s@%d (SCID=%s)\n", session2.Serial, session2.Port, session2.SCID)
    
    manager.ReleaseSession("emulator-5554")
}
```

---

## 7. ADB Tunnel Setup

### Reverse vs Forward

```go
package scrcpy

import (
    "fmt"
    "os/exec"
    "strings"
)

type TunnelMode int

const (
    TunnelReverse TunnelMode = iota  // Preferred
    TunnelForward                     // Fallback
)

func SetupTunnel(device, scid string, port int, mode TunnelMode) error {
    localAbstract := fmt.Sprintf("localabstract:scrcpy_%s", scid)
    tcpAddr := fmt.Sprintf("tcp:%d", port)
    
    switch mode {
    case TunnelReverse:
        // Preferred: adb reverse (device connects back to us)
        cmd := exec.Command("adb", "-s", device, "reverse", localAbstract, tcpAddr)
        if err := cmd.Run(); err != nil {
            return fmt.Errorf("adb reverse failed: %w", err)
        }
        fmt.Printf("✓ Reverse tunnel: %s ← %s\n", tcpAddr, localAbstract)
        
    case TunnelForward:
        // Fallback: adb forward (we connect to device via ADB)
        cmd := exec.Command("adb", "-s", device, "forward", tcpAddr, localAbstract)
        if err := cmd.Run(); err != nil {
            return fmt.Errorf("adb forward failed: %w", err)
        }
        fmt.Printf("✓ Forward tunnel: %s → %s\n", tcpAddr, localAbstract)
    }
    
    return nil
}

func TeardownTunnel(device, scid string, port int) error {
    localAbstract := fmt.Sprintf("localabstract:scrcpy_%s", scid)
    tcpAddr := fmt.Sprintf("tcp:%d", port)
    
    // Remove reverse
    exec.Command("adb", "-s", device, "reverse", "--remove", localAbstract).Run()
    
    // Remove forward
    exec.Command("adb", "-s", device, "forward", "--remove", tcpAddr).Run()
    
    return nil
}
```

---

## 8. Server Push & Launch

### Exact Command Construction

```go
package scrcpy

import (
    "fmt"
    "os/exec"
    "strings"
)

const (
    ServerVersion = "3.2"
    ServerJar     = "scrcpy-server-v3.2.jar"
    ServerPath    = "/data/local/tmp/scrcpy-server.jar"
)

type ServerOptions struct {
    SCID          string
    VideoCodec    string  // "h264", "h265", "av1"
    AudioCodec    string  // "opus", "aac", "raw"
    Video         bool
    Audio         bool
    Control       bool
    MaxFPS        int
    MaxSize       int
    SendFrameMeta bool
    SendCodecMeta bool
    RawStream     bool
}

func PushAndStartServer(device string, opts ServerOptions) error {
    // Step 1: Push JAR
    fmt.Printf("Pushing %s...\n", ServerJar)
    cmd := exec.Command("adb", "-s", device, "push", ServerJar, ServerPath)
    if err := cmd.Run(); err != nil {
        return fmt.Errorf("adb push failed: %w", err)
    }
    
    // Step 2: Build server command
    args := []string{
        fmt.Sprintf("scid=%s", opts.SCID),
        fmt.Sprintf("video=%v", opts.Video),
        fmt.Sprintf("audio=%v", opts.Audio),
        fmt.Sprintf("control=%v", opts.Control),
    }
    
    if opts.VideoCodec != "" {
        args = append(args, fmt.Sprintf("video_codec=%s", opts.VideoCodec))
    }
    if opts.AudioCodec != "" {
        args = append(args, fmt.Sprintf("audio_codec=%s", opts.AudioCodec))
    }
    if opts.MaxFPS > 0 {
        args = append(args, fmt.Sprintf("max_fps=%d", opts.MaxFPS))
    }
    if opts.MaxSize > 0 {
        args = append(args, fmt.Sprintf("max_size=%d", opts.MaxSize))
    }
    
    // Advanced options
    if !opts.SendFrameMeta {
        args = append(args, "send_frame_meta=false")
    }
    if !opts.SendCodecMeta {
        args = append(args, "send_codec_meta=false")
    }
    if opts.RawStream {
        args = append(args, "raw_stream=true")
    }
    
    serverCmd := fmt.Sprintf(
        "CLASSPATH=%s app_process / com.genymobile.scrcpy.Server %s %s",
        ServerPath, ServerVersion, strings.Join(args, " "))
    
    // Step 3: Start server
    fmt.Printf("Starting server: %s\n", serverCmd)
    cmd = exec.Command("adb", "-s", device, "shell", serverCmd)
    
    // Note: This will run in background; errors may not be immediate
    if err := cmd.Start(); err != nil {
        return fmt.Errorf("adb shell failed: %w", err)
    }
    
    fmt.Println("✓ Server started (async)")
    return nil
}

// Example usage
func main() {
    opts := ServerOptions{
        SCID:       "12345678",
        VideoCodec: "h264",
        AudioCodec: "opus",
        Video:      true,
        Audio:      true,
        Control:    true,
        MaxFPS:     60,
        MaxSize:    1920,
    }
    
    if err := PushAndStartServer("emulator-5554", opts); err != nil {
        fmt.Printf("Error: %v\n", err)
    }
}
```

---

## 9. Error Recovery & Reconnection

### Graceful Fallback Chain

```go
package scrcpy

import (
    "fmt"
    "log"
    "time"
)

type StreamSession struct {
    device      string
    port        int
    videoCodec  string
    attempt     int
    maxAttempts int
}

func (s *StreamSession) StartWithFallback() error {
    codecs := []string{s.videoCodec}  // Start with requested codec
    
    // Add fallback codecs
    if s.videoCodec != "h264" {
        codecs = append(codecs, "h264")  // H.264 as universal fallback
    }
    if s.videoCodec != "h265" {
        codecs = append(codecs, "h265")  // Try H.265 if not already tried
    }
    
    for _, codec := range codecs {
        s.attempt++
        
        log.Printf("[Attempt %d/%d] Trying codec: %s\n", s.attempt, len(codecs), codec)
        
        if err := s.startStream(codec); err != nil {
            log.Printf("  ✗ Failed: %v\n", err)
            
            // Wait before retry (exponential backoff)
            waitTime := time.Duration(s.attempt*s.attempt) * time.Second
            if waitTime > 30*time.Second {
                waitTime = 30 * time.Second
            }
            log.Printf("  Retrying in %v...\n", waitTime)
            time.Sleep(waitTime)
            
            continue
        }
        
        log.Printf("  ✓ Success with %s\n", codec)
        return nil
    }
    
    return fmt.Errorf("all codecs failed after %d attempts", len(codecs))
}

func (s *StreamSession) startStream(codec string) error {
    // Setup tunnel
    if err := SetupTunnel(s.device, "12345", s.port, TunnelReverse); err != nil {
        return err
    }
    defer TeardownTunnel(s.device, "12345", s.port)
    
    // Push and start server
    opts := ServerOptions{
        SCID:       "12345",
        VideoCodec: codec,
        Video:      true,
        Audio:      false,
        Control:    false,
    }
    if err := PushAndStartServer(s.device, opts); err != nil {
        return err
    }
    
    // Accept socket
    cfg := SocketConfig{Video: true, Audio: false, Control: false}
    sockets, err := AcceptSockets(s.port, cfg)
    if err != nil {
        return err
    }
    defer sockets.Video.Close()
    
    // Stream video
    consumer := NewVideoStreamConsumer(sockets.Video)
    return consumer.Start()
}
```

---

## 10. Troubleshooting Checklist

### Common Issues & Solutions

| Issue | Symptom | Solution |
|-------|---------|----------|
| **Socket deadlock** | Hangs on accept | Check socket order matches config. If audio disabled, 2nd socket is control, not audio |
| **Config packet missing** | Decoder can't init | Ensure you're reading codec metadata BEFORE frame loop |
| **Frame parsing fails** | Random garbage output | Verify byte order (Big-Endian). Check 12-byte header alignment |
| **H.264 not supported** | Server crashes silently | Device doesn't have H.264 encoder. Try H.265 or fallback to H.264 (should always exist) |
| **Connection timeout** | Hangs after "accept" | Device server not connecting. Check: (1) SCID matches, (2) tunnel setup correct, (3) ADB bridge alive |
| **Multi-device conflicts** | Can only stream from 1 device | Verify each device has unique SCID and port. Don't reuse ports |
| **Device rotates mid-stream** | Decoder error | Stream restarts with new codec metadata. Re-read 12-byte header and reinitialize |
| **Frames jittery/dropping** | Playback stutters | Implement frame buffering + adaptive jitter. Don't block on decode |
| **ADB command fails** | "device offline" | Run `adb devices -l` to check connection. Reconnect device via USB or WiFi |

---

## 11. Testing Utilities

### Minimal Test Frame Generator

```go
package scrcpy

import (
    "bytes"
    "encoding/binary"
    "io"
)

// Create fake frames for testing
func GenerateTestH264Frame(pts int64, isConfig, isKeyFrame bool, data []byte) []byte {
    header := make([]byte, 12)
    
    // Build PTS with flags
    ptsWithFlags := pts & 0x3FFFFFFFFFFFFFFF
    if isConfig {
        ptsWithFlags |= (1 << 63)
    }
    if isKeyFrame {
        ptsWithFlags |= (1 << 62)
    }
    binary.BigEndian.PutUint64(header[0:8], uint64(ptsWithFlags))
    
    // Packet size
    binary.BigEndian.PutUint32(header[8:12], uint32(len(data)))
    
    return append(header, data...)
}

// Test: Parse generated frame
func TestFrameParsing() {
    testData := []byte{0x01, 0x02, 0x03, 0x04}
    frame := GenerateTestH264Frame(1000, false, true, testData)
    
    reader := bytes.NewReader(frame)
    pkt, _ := ReadFramePacket(reader)
    
    assert(pkt.PTS == 1000, "PTS mismatch")
    assert(!pkt.ConfigPacket, "ConfigPacket should be false")
    assert(pkt.KeyFrame, "KeyFrame should be true")
    assert(bytes.Equal(pkt.Payload, testData), "Payload mismatch")
    
    println("✓ Frame parsing test passed")
}

func assert(cond bool, msg string) {
    if !cond {
        panic("ASSERT: " + msg)
    }
}
```

---

## Quick Command Reference

### Start streaming from device

```bash
# Single device, H.264, video only
adb -s emulator-5554 reverse localabstract:scrcpy_12345678 tcp:27183
adb -s emulator-5554 push scrcpy-server-v3.2.jar /data/local/tmp/
adb -s emulator-5554 shell CLASSPATH=/data/local/tmp/scrcpy-server.jar \
    app_process / com.genymobile.scrcpy.Server 3.2 \
    scid=12345678 video=true audio=false control=false video_codec=h264
```

### Connect and receive stream

```bash
# Pure H.264 elementary stream (no framing)
adb -s emulator-5554 shell CLASSPATH=/data/local/tmp/scrcpy-server.jar \
    app_process / com.genymobile.scrcpy.Server 3.2 \
    scid=12345678 raw_stream=true send_dummy_byte=false

# Then on client
ffplay -f h264 tcp://localhost:27183
```

---

## Conclusion

Key takeaways:
1. **Frame headers are critical** – bit-perfect parsing required
2. **Socket order matters** – must match config (video→audio→control)
3. **Config packets first** – feed SPS/PPS before IDR frames
4. **Codec fallback essential** – H.264 is universal, use as fallback
5. **Multi-device needs unique SCID+port** – prevents conflicts
6. **ADB tunnel setup** – reverse preferred, forward as fallback
7. **Version matching required** – client and server must be identical

Start simple (single device, H.264, video-only), validate frame parsing, then expand complexity.

Good luck!
