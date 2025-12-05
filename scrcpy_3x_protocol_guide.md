# Scrcpy 3.x Protocol Design Document
## Deep Dive: Custom Backend Implementation for Multi-Device Android Video Streaming

**Last Updated:** November 2024  
**Scope:** Scrcpy v3.0–v3.2, with protocol details from v2.1 forward  
**Target:** Building a Go backend for concurrent multi-device H.264/H.265/AV1 streaming

---

## Table of Contents

1. [Executive Summary](#executive-summary)
2. [Protocol Architecture](#protocol-architecture)
3. [Socket Structure & Connection Flow](#socket-structure--connection-flow)
4. [Video Stream Format](#video-stream-format)
5. [Audio Stream Format](#audio-stream-format)
6. [Control Message Protocol](#control-message-protocol)
7. [Codec Negotiation & Selection](#codec-negotiation--selection)
8. [Version Compatibility (1.x vs 2.x vs 3.x)](#version-compatibility)
9. [Known Pitfalls & Edge Cases](#known-pitfalls--edge-cases)
10. [Implementation Plan for Go Backend](#implementation-plan-for-go-backend)
11. [Error Handling & Fallback Strategy](#error-handling--fallback-strategy)
12. [References & Sources](#references--sources)

---

## Executive Summary

Scrcpy is a screen mirroring tool that splits functionality into:
- **Server** (Java): Runs on Android device, captures/encodes screen & audio, sends via sockets
- **Client** (C): Consumes streams, decodes, displays, sends control messages

**Key Protocol Facts:**
- Uses 1–3 **separate TCP or Unix domain sockets** (video, audio, control)
- **No backward/forward compatibility**: Client version must exactly match server version
- Video stream: **codec metadata (12 bytes) + frame packets with 12-byte headers**
- Audio stream: **codec metadata (4 bytes) + audio packets with headers**
- Control socket: **bidirectional** (client → device for input, device → client for clipboard/events)
- Supports **H.264, H.265 (HEVC), AV1** for video; **OPUS, AAC, RAW** for audio
- Multi-client support via **SCID** (31-bit random identifier)

**Critical for Your Go Backend:**
1. Server version must match client (enforce in startup)
2. Socket connection order matters (video → audio → control)
3. Codec metadata frames are **not user data**—parse and store separately
4. Frame headers encode **config/key flags + 62-bit PTS + 32-bit size**
5. Handle device rotation, encoder reset, and codec fallbacks
6. ADB forwarding adds latency; use reverse tunneling when possible
7. Concurrent multi-device requires per-device SCID and port management

---

## Protocol Architecture

### High-Level Overview

```
┌─────────────────────────────────────────────────────┐
│            Client Application (Your Go Backend)     │
├─────────────────────────────────────────────────────┤
│ • Socket management (listen/connect)                │
│ • Frame demuxing & parsing                          │
│ • Codec metadata extraction                         │
│ • H.264/H.265/AV1 decoding (via FFmpeg or libx264) │
│ • Control message serialization                     │
├─────────────────────────────────────────────────────┤
│              ADB Tunnel (USB or TCP)                │
├─────────────────────────────────────────────────────┤
│          Android Device (Scrcpy Server)             │
├─────────────────────────────────────────────────────┤
│ • MediaCodec H.264/H.265/AV1 encoding               │
│ • AudioRecord → OPUS/AAC/RAW encoding               │
│ • Input event injection via InputManager             │
│ • Rotation/orientation tracking                     │
│ • Clipboard sync                                    │
└─────────────────────────────────────────────────────┘
```

### Connection Model

**By Default (Reverse Tunnel - Preferred):**
```
Client opens listening port (27183–27199 by default)
                    ↓
Client pushes scrcpy-server.jar to device
                    ↓
adb reverse localabstract:scrcpy_<SCID> tcp:<PORT>
                    ↓
Server on device connects back to client's listening port
```

**Fallback (Forward Tunnel - Less Preferred):**
```
adb forward tcp:<PORT> localabstract:scrcpy_<SCID>
                    ↓
Client connects to localhost:<PORT>
```

**Why Reverse is Better:**
- Avoids race conditions (client listening ensures connection doesn't fail)
- Reduces latency for local USB (data goes directly, not through ADB daemon)

---

## Socket Structure & Connection Flow

### Socket Order & Configuration

Depending on options passed to scrcpy-server, **1–3 sockets** are opened in this order:

| Enabled? | Socket 1 | Socket 2 | Socket 3 |
|----------|----------|----------|----------|
| V + A + C | video | audio | control |
| V + A | video | audio | – |
| V + C | video | – | control |
| A + C | audio | – | control |
| V only | video | – | – |
| (etc.) | – | – | – |

**Critical:** The order is fixed. If you enable video and control but disable audio, socket 2 is **control**, not audio.

### Connection Handshake

```
For Each Socket (in order):
┌─────────────────────────────────────────────────────────┐
│ 1. Client (or device if forward) connects               │
├─────────────────────────────────────────────────────────┤
│ 2. On FIRST socket only:                                │
│    - If tunnel is FORWARD: device sends 1 dummy byte    │
│    - (Detects connection error)                         │
├─────────────────────────────────────────────────────────┤
│ 3. On FIRST socket only:                                │
│    - Device sends device metadata (device name, etc.)   │
│    - Currently: varint-encoded string (device name)     │
│    - Stored as window title on client                   │
├─────────────────────────────────────────────────────────┤
│ 4. On VIDEO/AUDIO sockets:                              │
│    - Device sends codec metadata (no frame header)      │
├─────────────────────────────────────────────────────────┤
│ 5. Then stream packets with frame headers               │
└─────────────────────────────────────────────────────────┘
```

### Command-Line Options & Socket Configuration

When starting the server:

```bash
adb shell CLASSPATH=/data/local/tmp/scrcpy-server.jar \
  app_process / com.genymobile.scrcpy.Server 3.2 \
  scid=12345678 \
  audio=true \
  video=true \
  control=true \
  video_codec=h264 \
  # ... other options
```

**Key Options:**
- `scid=<RANDOM>`: 31-bit client ID (enables multiple concurrent sessions)
- `audio=true/false`: Enable audio socket
- `video=true/false`: Enable video socket
- `control=true/false`: Enable control socket
- `video_codec=h264|h265|av1`: Preferred video codec
- `audio_codec=opus|aac|raw`: Audio codec (default: opus)
- `raw_stream=true`: Disables all framing (codec meta, frame headers, device meta)
- `send_frame_meta=false`: Disables 12-byte frame headers (keeps codec meta)
- `send_codec_meta=false`: Disables codec metadata (keeps frame headers)
- `send_device_meta=false`: Disables device name on first socket
- `send_dummy_byte=false`: Disables dummy byte for forward connections

---

## Video Stream Format

### Codec Metadata (First 12 Bytes on Video Socket)

Sent once at stream start (after device name on first socket, before any frames).

```c
struct VideoCodecMetadata {
    uint32_t codec_id;      // 0=H.264, 1=H.265, 2=AV1
    uint32_t width;         // Initial video width
    uint32_t height;        // Initial video height
}
```

**Codec IDs:**
```c
enum VideoCodecId {
    H264 = 0,
    H265 = 1,  // HEVC
    AV1  = 2
}
```

**Storage Notes:**
- Big-endian (network byte order)
- Parse once and cache
- Indicates initial frame size; rotation may change dimensions in frame header or stream reset

### Frame Header (12 Bytes Per Packet)

Each encoded packet from `MediaCodec` is prefixed with:

```c
struct FrameHeader {
    uint64_t pts_with_flags;  // 64-bit big-endian
    uint32_t packet_size;      // 32-bit big-endian (payload size in bytes)
}
```

**PTS With Flags Bit Layout:**

```
Byte 7 | Byte 6 | Byte 5 | Byte 4 | Byte 3 | Byte 2 | Byte 1 | Byte 0
-------+--------+--------+--------+--------+--------+--------+-------
CK.... | ...... | ...... | ...... | ...... | ...... | ...... | ......
^^<------------- 62-bit PTS (microseconds) ------>
| |
| └─ Key frame flag (1 bit)
└── Config packet flag (1 bit)
```

**Bit Extraction (Big-Endian):**

```go
// Read 8 bytes as big-endian uint64
ptsWithFlags := binary.BigEndian.Uint64(header[0:8])

// Extract flags (most significant 2 bits)
configPacket := (ptsWithFlags >> 62) & 0x1  // Bit 63
keyFrame      := (ptsWithFlags >> 61) & 0x1  // Bit 62

// Extract PTS (lower 62 bits)
pts := ptsWithFlags & 0x3FFFFFFFFFFFFFFF  // Mask lower 62 bits

// Read packet size (4 bytes, big-endian)
packetSize := binary.BigEndian.Uint32(header[8:12])
```

**Flag Semantics:**
- **config_packet (CK[1])**: Codec-specific configuration data (SPS/PPS for H.264). Use for decoder initialization, don't display.
- **key_frame (CK[0])**: IDR (Instantaneous Decoder Refresh) frame. Can decode independently.
- **PTS**: Presentation time stamp in microseconds. Used for audio-video sync and frame ordering.

### Stream Parsing Algorithm

```go
func parseVideoStream(reader io.Reader) error {
    // Read codec metadata (12 bytes) once
    codecMeta := make([]byte, 12)
    if _, err := io.ReadFull(reader, codecMeta); err != nil {
        return err
    }
    
    codecID := binary.BigEndian.Uint32(codecMeta[0:4])
    width := binary.BigEndian.Uint32(codecMeta[4:8])
    height := binary.BigEndian.Uint32(codecMeta[8:12])
    
    log.Printf("Video: codec=%d, %dx%d", codecID, width, height)
    
    // Read frames in a loop
    for {
        header := make([]byte, 12)
        if _, err := io.ReadFull(reader, header); err != nil {
            if err == io.EOF { break }
            return err
        }
        
        ptsWithFlags := binary.BigEndian.Uint64(header[0:8])
        packetSize := binary.BigEndian.Uint32(header[8:12])
        
        configPkt := (ptsWithFlags >> 62) & 0x1
        keyFrame := (ptsWithFlags >> 61) & 0x1
        pts := ptsWithFlags & 0x3FFFFFFFFFFFFFFF
        
        packet := make([]byte, packetSize)
        if _, err := io.ReadFull(reader, packet); err != nil {
            return err
        }
        
        if configPkt != 0 {
            // Config packet (SPS/PPS for H.264) – initialize decoder
            handleConfigPacket(packet)
        } else {
            // Data packet – decode and display
            handleDataPacket(packet, pts, keyFrame != 0)
        }
    }
    return nil
}
```

### H.264 Specific Notes

**Config Packets (SPS/PPS):**
- First packet(s) are codec-specific config
- Contain SPS (Sequence Parameter Set) and PPS (Picture Parameter Set)
- **Must be fed to decoder before IDR frames**
- Frame is preceded by start code `00 00 00 01` or `00 00 01`

**Raw Stream Mode (`raw_stream=true`):**
- Disables all framing (codec meta, frame headers, device meta)
- Pure H.264 elementary stream
- **Start codes present** in NAL units
- FFmpeg/VLC can decode directly with `-f h264 -demuxer h264`

**Decoder Initialization (FFmpeg Example):**

```go
// Create codec context for H.264
codecPar := &avcodec.CodecParameters{
    CodecType:  avutil.MediaTypeVideo,
    CodecID:    avcodec.CodecIdH264,
    Width:      width,
    Height:     height,
    PixFmt:     avutil.PixelFormatYuv420P,
}

codec := avcodec.FindDecoder(avcodec.CodecIdH264)
ctx := codec.AllocContext3()
ctx.FromCodecParameters(codecPar)

// Feed config packets first
for _, configPacket := range configPackets {
    pkt := avcodec.AllocPacket()
    pkt.Data = configPacket
    avcodec.SendPacket(ctx, pkt)
    // ... receive frames
}

// Then feed data packets
avcodec.SendPacket(ctx, dataPacket)
frame := avutil.AllocFrame()
avcodec.ReceiveFrame(ctx, frame)  // May return EAGAIN if not enough data
```

---

## Audio Stream Format

### Codec Metadata (First 4 Bytes on Audio Socket)

```c
struct AudioCodecMetadata {
    uint32_t codec_id;  // 0=OPUS, 1=AAC, 2=RAW (PCM)
}
```

**Codec IDs:**
```c
enum AudioCodecId {
    OPUS = 0,
    AAC  = 1,
    RAW  = 2  // PCM, uncompressed
}
```

### Audio Packet Format

Similar to video, each audio packet has a 12-byte header:

```c
struct AudioFrameHeader {
    uint64_t pts_with_flags;  // 64-bit (same format as video)
    uint32_t packet_size;
}
```

**Parsing:** Identical to video frame header parsing.

**Config Packets:**
- OPUS: May contain VorbisComment or other metadata
- AAC: ADTS header (Audio Data Transport Stream)
- RAW: No config packet; PCM samples start immediately

### Audio Stream Specifics

**OPUS (Default)**
- Ogg Opus container or raw Opus frames
- Typically 20ms frames at 48 kHz
- Header: Frame info + compressed audio

**Raw PCM**
- No encoding, just raw samples
- Must know sample rate and format from device settings
- Use for low-latency or high-fidelity scenarios

---

## Control Message Protocol

The control socket is **bidirectional**:
- **Client → Device**: Input events (keypress, mouse, scroll, commands)
- **Device → Client**: Device messages (clipboard, rotate event, etc.)

### Control Message Format (Client → Device)

```c
struct ControlMessage {
    uint8_t type;           // Message type (1=keycode, 2=text, 3=motion, ...)
    // ... payload varies by type
}
```

**Message Types:**
1. **Keycode** (type=1): Keyboard input
   ```c
   struct KeycodeMessage {
       uint8_t type;           // 1
       uint8_t action;         // 0=KEYDOWN, 1=KEYUP
       uint32_t keycode;       // Android KeyEvent code
       uint32_t repeat;        // Repeat count
       uint32_t metastate;     // Meta keys (Ctrl, Alt, etc.)
   }
   ```

2. **Text** (type=2): Unicode text input
3. **Motion** (type=3): Mouse/touch motion and click
4. **Scroll** (type=4): Mouse scroll
5. **Command** (type=5): Device commands (e.g., power on/off, volume, clipboard set)

### Device Message Format (Device → Client)

```c
struct DeviceMessage {
    uint8_t type;   // 1=clipboard, 2=rotate, ...
    // ... payload varies
}
```

**Message Types:**
1. **Clipboard** (type=1): Device clipboard changed
   ```c
   struct ClipboardMessage {
       uint8_t type;       // 1
       uint32_t length;
       uint8_t text[length];  // UTF-8
   }
   ```

2. **Rotate** (type=2): Device rotated
   ```c
   struct RotateMessage {
       uint8_t type;       // 2
       uint8_t rotation;   // 0=0°, 1=90°, 2=180°, 3=270°
   }
   ```

**Full Specifications:**
See official unit tests:
- Client serialization: https://github.com/Genymobile/scrcpy/blob/master/app/tests/test_control_msg_serialize.c
- Server deserialization: https://github.com/Genymobile/scrcpy/blob/master/server/src/test/java/com/genymobile/scrcpy/ControlMessageReaderTest.java
- Device message serialization: https://github.com/Genymobile/scrcpy/blob/master/server/src/test/java/com/genymobile/scrcpy/DeviceMessageWriterTest.java

---

## Codec Negotiation & Selection

### Encoder Selection Process (Android Device)

The scrcpy server selects a video encoder based on:

1. **Requested codec** (`video_codec=h264|h265|av1`)
2. **Device capabilities** (via `MediaCodec.getCodecList()`)
3. **Fallback chain** (if requested codec unavailable)

**Default Fallback Order:**
```
H.265 (if available)
  ↓ [fallback]
H.264 (always available on API 16+)
  ↓ [fallback]
AV1 (API 29+, some devices)
```

**Android API Requirements:**
- H.264: API 16+ (Android 4.1)
- H.265: API 21+ (Android 5.0), but limited on some devices
- AV1: API 29+ (Android 10), rare on older devices

**Your Go Backend's Responsibility:**
1. **Parse codec metadata** from video stream start
2. **Initialize correct decoder** (FFmpeg, libx264, or platform decoder)
3. **Fall back gracefully** if decoder unavailable
4. **Report decoder status** back to server (via control message or logging)

### Codec Negotiation in Go

```go
type CodecCapability struct {
    CodecID      int  // 0=H.264, 1=H.265, 2=AV1
    Supported    bool
    HardwareDecode bool
    MaxWidth     int
    MaxHeight    int
}

func selectDecoder(codecID int, width, height int) (*Decoder, error) {
    switch codecID {
    case 0:  // H.264
        return initH264Decoder(width, height)
    case 1:  // H.265
        if hasH265Support() {
            return initH265Decoder(width, height)
        }
        // Fallback to H.264 – reconnect server with video_codec=h264
        return nil, errors.New("H.265 not supported; server must use H.264")
    case 2:  // AV1
        if hasAV1Support() {
            return initAV1Decoder(width, height)
        }
        return nil, errors.New("AV1 not supported")
    }
    return nil, fmt.Errorf("unknown codec: %d", codecID)
}
```

---

## Version Compatibility

### Scrcpy 1.x → 2.x → 3.x Timeline

| Feature | 1.x | 2.0+ | 2.1+ | 3.0+ |
|---------|-----|------|------|------|
| Video only | ✓ | ✓ | ✓ | ✓ |
| Audio support | ✗ | ✓ | ✓ | ✓ |
| H.265 codec | ✗ | ✓ | ✓ | ✓ |
| AV1 codec | ✗ | ✗ | ✗ | ✓ |
| Multiple sockets | ✓ | ✓ | ✓ | ✓ |
| Frame headers | ✓ | ✓ | ✓ | ✓ |
| Codec metadata | ✓ | ✓ | ✓ | ✓ |
| SCID support | ✓ | ✓ | ✓ | ✓ |
| OpenGL filters | ✗ | ✗ | ✗ | ✓ |
| Virtual display | ✗ | ✗ | ✗ | ✓ |
| Camera source | ✗ | ✗ | ✗ | ✓ |
| Crop via filters | ✗ | ✗ | ✗ | ✓ |

### Breaking Changes in 3.0

1. **OpenGL Filters for Video Transform**
   - `--crop` now uses OpenGL filters internally
   - Fixes Android 14+ crop issues
   - Transparent to protocol (still H.264/H.265/AV1)

2. **Virtual Display Support**
   - Can stream from virtual (secondary) displays
   - Transparent to protocol

3. **Camera as Video Source**
   - `--video-source=camera` option
   - Transparent to protocol (still H.264/H.265)

4. **Display Creation API Changes**
   - Internal Android API usage changed for Android 14/15 compatibility
   - No protocol change (server handles abstraction)

### Compatibility Table for Your Backend

**Your backend must:**
- **Exact version match** between client (you) and server (Android device)
- Example: If you're using 3.2 client, push `scrcpy-server-v3.2.jar`, not 3.1 or 3.0
- Attempting to mix versions will fail at startup with version check

**Enforcing Version Matching:**

```go
const SCRCPY_VERSION = "3.2"

func startServer(device string) error {
    // Check server jar version
    version, _ := checkServerVersion(serverJarPath)
    if version != SCRCPY_VERSION {
        return fmt.Errorf("server version mismatch: expected %s, got %s", 
            SCRCPY_VERSION, version)
    }
    
    // Push and execute
    adbPush(device, serverJarPath, "/data/local/tmp/scrcpy-server.jar")
    adbExec(device, 
        "CLASSPATH=/data/local/tmp/scrcpy-server.jar app_process / "+
        "com.genymobile.scrcpy.Server " + SCRCPY_VERSION + 
        " " + options)
    
    return nil
}
```

---

## Known Pitfalls & Edge Cases

### 1. Device Rotation Handling

**The Problem:**
- When device rotates, the encoder **resets**
- New stream starts with **new codec metadata** (potentially different width/height)
- Old frames may still be buffered in your decoder

**How Scrcpy Handles It:**
- Server detects rotation via `DisplayListener`
- Stops encoding, rotates surface, restarts encoding
- Sends new codec metadata on video socket
- Client sees resolution change and reinitializes decoder

**Your Implementation:**
```go
func handleVideoStream(conn net.Conn) {
    for {
        // Read codec metadata (may repeat after rotation)
        codecMeta := readCodecMetadata()
        
        // Reinitialize decoder if dimensions changed
        if codecMeta.width != lastWidth || codecMeta.height != lastHeight {
            closeDecoder()
            decoder = initDecoder(codecMeta)
            lastWidth, lastHeight = codecMeta.width, codecMeta.height
        }
        
        // Read frames
        for {
            frame = readFrame()
            if frame == nil {
                // End of stream (rotation) – go back to read new codec metadata
                break
            }
            decodeFrame(frame)
        }
    }
}
```

### 2. Codec Config Packet Handling

**The Problem:**
- H.264 streams start with SPS (Sequence Parameter Set) and PPS (Picture Parameter Set)
- These are **config packets** (header flag set to 1)
- **Must be fed to decoder before first IDR frame**
- If you skip or lose them, decoder will fail or produce corrupted output

**Why It Matters:**
- SPS: Picture size, frame rate, reference frames, etc.
- PPS: Slice group mapping, quantization parameters, etc.

**Your Implementation:**
```go
func initializeDecoder(configPackets [][]byte, dataWidth, dataHeight int) (*Decoder, error) {
    ctx := createDecoderContext(dataWidth, dataHeight)
    
    // Critical: Feed all config packets FIRST
    for _, cfg := range configPackets {
        pkt := createPacket(cfg, isPTS(0), isConfig(true))
        if err := ctx.SendPacket(pkt); err != nil {
            return nil, err
        }
        // Try to receive frames (should be nil for config)
        ctx.ReceiveFrame()  // Discards or buffers internally
    }
    
    return &Decoder{ctx: ctx}, nil
}

func (d *Decoder) ProcessPacket(data []byte, pts int64, isConfig bool) (Frame, error) {
    pkt := createPacket(data, pts, isConfig)
    if err := d.ctx.SendPacket(pkt); err != nil {
        return nil, err
    }
    
    frame, err := d.ctx.ReceiveFrame()
    return frame, err
}
```

### 3. ADB Forward Delays & Network Latency

**The Problem:**
- ADB forwarding adds latency (USB → daemon → TCP → client)
- Reverse tunnel (preferred) is faster but still has overhead
- TCP/IP connections over WiFi are much slower than USB
- Sudden disconnects leave stale ADB processes

**Impact on Your Backend:**
- Expect 30–100ms latency over USB, 100–500ms over WiFi
- Connection may drop silently; implement timeouts
- Frame buffering helps smooth playback but increases latency

**Mitigations:**
```go
func (c *StreamConnection) connect(device, scid string, reverse bool) error {
    port := selectAvailablePort(27183, 27199)
    
    if reverse {
        // Reverse tunnel (device connects back to us)
        err := adb.ReverseForward(device, 
            "localabstract:scrcpy_" + scid, 
            fmt.Sprintf("tcp:%d", port))
    } else {
        // Forward tunnel (we connect to device via ADB)
        err := adb.Forward(device, 
            fmt.Sprintf("tcp:%d", port), 
            "localabstract:scrcpy_" + scid)
    }
    
    // Set socket timeouts to detect dead connections
    listener.SetDeadline(time.Now().Add(10 * time.Second))
    conn, err := listener.Accept()
    if err != nil {
        return fmt.Errorf("connection timeout: %v", err)
    }
    
    // Increase read/write timeout for actual I/O
    conn.SetReadDeadline(time.Now().Add(30 * time.Second))
    conn.SetWriteDeadline(time.Now().Add(30 * time.Second))
    
    return nil
}
```

### 4. Socket Ordering & Partial Connections

**The Problem:**
- If you enable video + audio + control, you **must** open sockets in that order
- If you skip audio but enable control, the second socket is **control**, not audio
- Opening sockets out of order causes deadlock (server waiting for socket 2 while you wait for socket 3)

**Scenario That Breaks:**
```
You enable: video=true, audio=false, control=true
Expected socket order: video (1), control (2)

If you incorrectly listen for:
  socket1 (video) → OK
  socket2 (audio) → WRONG! It's control, not audio
  socket3 (control) → server is already trying to use socket 2, deadlock!
```

**Your Implementation:**
```go
type SocketConfig struct {
    video   bool
    audio   bool
    control bool
}

func (cfg SocketConfig) getSocketCount() int {
    count := 0
    if cfg.video { count++ }
    if cfg.audio { count++ }
    if cfg.control { count++ }
    return count
}

func (cfg SocketConfig) acceptSockets(port int) (map[string]net.Conn, error) {
    sockets := make(map[string]net.Conn)
    listener, _ := net.Listen("tcp", fmt.Sprintf(":%d", port))
    
    socketNames := []string{}
    if cfg.video { socketNames = append(socketNames, "video") }
    if cfg.audio { socketNames = append(socketNames, "audio") }
    if cfg.control { socketNames = append(socketNames, "control") }
    
    for _, name := range socketNames {
        conn, err := listener.Accept()
        if err != nil {
            return nil, fmt.Errorf("failed to accept %s socket: %v", name, err)
        }
        sockets[name] = conn
        log.Printf("Connected %s socket", name)
    }
    
    return sockets, nil
}
```

### 5. Frame Buffering & Display Synchronization

**The Problem:**
- Network packets arrive unpredictably (bursty)
- Decoding frames takes variable time
- Display refresh rate (60Hz, 120Hz) is independent of frame arrival
- Audio sync is critical (lip-sync)

**Scrcpy's Approach:**
- Video buffer: Optional delay buffer (default 0 = minimal latency)
- Audio buffer: Adaptive jitter buffer (maintains low but smooth playback)
- Frame skipping: If behind, drop old frames to catch up

**Your Implementation (Simplified):**
```go
type FrameBuffer struct {
    frames     chan *Frame
    maxBuffer  int
    lastPTS    int64
}

func (fb *FrameBuffer) add(frame *Frame) {
    select {
    case fb.frames <- frame:
        // Queued
    default:
        // Buffer full, drop oldest frame
        dropped := <-fb.frames
        log.Printf("Dropped frame pts=%d", dropped.PTS)
        fb.frames <- frame
    }
}

func (fb *FrameBuffer) get() *Frame {
    return <-fb.frames
}

// Display loop
func displayLoop(fb *FrameBuffer) {
    ticker := time.NewTicker(time.Second / 60)  // 60 FPS
    defer ticker.Stop()
    
    for range ticker.C {
        frame := fb.get()
        if frame != nil {
            renderFrame(frame)
        }
    }
}
```

### 6. H.265/AV1 Encoder Availability

**The Problem:**
- Not all Android devices have H.265 or AV1 encoders
- Device may claim H.265 support but encoder is buggy or unavailable
- Server selects encoder at startup; if it fails, connection drops

**Mitigation Strategy:**
1. Query available encoders before streaming
2. Implement decoder fallback chain
3. Allow user to force specific codec
4. Log encoder selection for debugging

```go
func queryAvailableEncoders(device string) []string {
    // Run: adb shell "dumpsys media.codec"
    // Parse output to list available video encoders
    // Example: mime=video/avc (H.264), mime=video/hevc (H.265), mime=video/av01 (AV1)
    output, _ := adbExec(device, "dumpsys media.codec")
    
    supported := []string{}
    if strings.Contains(output, "video/avc") { supported = append(supported, "h264") }
    if strings.Contains(output, "video/hevc") { supported = append(supported, "h265") }
    if strings.Contains(output, "video/av01") { supported = append(supported, "av1") }
    
    return supported
}

func startStreamingWithFallback(device, requestedCodec string) error {
    available := queryAvailableEncoders(device)
    
    // Try requested codec first
    codecs := []string{requestedCodec}
    codecs = append(codecs, available...)  // Fallback to available
    
    for _, codec := range codecs {
        err := startServer(device, codec)
        if err == nil {
            return nil
        }
        log.Printf("Codec %s failed: %v, trying fallback", codec, err)
    }
    
    return errors.New("no available video codec")
}
```

### 7. Multiple Concurrent Devices

**Key Challenge:** Each device needs a unique port and SCID

```go
type MultiDeviceManager struct {
    devices map[string]*DeviceStream
    portRange [int, int]  // e.g., [27183, 27199]
    nextPort int
    mu sync.Mutex
}

func (m *MultiDeviceManager) addDevice(serial string) (int, string, error) {
    m.mu.Lock()
    defer m.mu.Unlock()
    
    if m.nextPort >= m.portRange[1] {
        return 0, "", errors.New("no available ports")
    }
    
    port := m.nextPort
    m.nextPort++
    
    // Generate random SCID (31-bit)
    scid := rand.Intn(1<<31) - 1
    
    stream := &DeviceStream{
        serial: serial,
        port: port,
        scid: scid,
    }
    m.devices[serial] = stream
    
    return port, fmt.Sprintf("%d", scid), nil
}
```

**Issue from GitHub #5301:**
If you don't use different ports for each device, they may interfere (ADB daemon confusion). Always use `-p` flag or `--port=XXXX` for each instance.

---

## Implementation Plan for Go Backend

### Phase 1: Initialization & Connection

```go
type StreamConfig struct {
    Device      string
    VideoCodec  string  // "h264", "h265", "av1"
    AudioCodec  string  // "opus", "aac", "raw"
    Video       bool
    Audio       bool
    Control     bool
    MaxFPS      int
    MaxSize     int
}

type StreamServer struct {
    config    StreamConfig
    scid      string
    port      int
    
    videoConn net.Conn
    audioConn net.Conn
    controlConn net.Conn
    
    videoDecoder VideoDecoder
    audioDecoder AudioDecoder
    controlHandler ControlHandler
}

func (s *StreamServer) Start() error {
    // Step 1: Generate SCID
    s.scid = fmt.Sprintf("%d", rand.Intn(1<<31)-1)
    s.port = s.selectAvailablePort()
    
    // Step 2: Set up ADB tunnel (reverse preferred)
    if err := s.setupTunnel(); err != nil {
        return err
    }
    
    // Step 3: Push and start server
    if err := s.pushAndStartServer(); err != nil {
        return err
    }
    
    // Step 4: Accept sockets
    if err := s.acceptSockets(); err != nil {
        return err
    }
    
    // Step 5: Parse codec metadata and initialize decoders
    if err := s.initializeDecoders(); err != nil {
        return err
    }
    
    return nil
}

func (s *StreamServer) setupTunnel() error {
    localAbstract := fmt.Sprintf("localabstract:scrcpy_%s", s.scid)
    tcpAddr := fmt.Sprintf("tcp:%d", s.port)
    
    // Try reverse tunnel first
    err := adb.ReverseForward(s.config.Device, localAbstract, tcpAddr)
    if err != nil {
        log.Printf("Reverse tunnel failed, trying forward: %v", err)
        err = adb.Forward(s.config.Device, tcpAddr, localAbstract)
    }
    return err
}

func (s *StreamServer) pushAndStartServer() error {
    // Push JAR
    const jarPath = "scrcpy-server-v3.2.jar"
    adb.Push(s.config.Device, jarPath, "/data/local/tmp/scrcpy-server.jar")
    
    // Build command
    args := []string{
        fmt.Sprintf("scid=%s", s.scid),
        fmt.Sprintf("video_codec=%s", s.config.VideoCodec),
        fmt.Sprintf("audio=%v", s.config.Audio),
        fmt.Sprintf("video=%v", s.config.Video),
        fmt.Sprintf("control=%v", s.config.Control),
        fmt.Sprintf("max_fps=%d", s.config.MaxFPS),
        fmt.Sprintf("max_size=%d", s.config.MaxSize),
    }
    
    cmd := fmt.Sprintf(
        "CLASSPATH=/data/local/tmp/scrcpy-server.jar app_process / "+
        "com.genymobile.scrcpy.Server 3.2 %s",
        strings.Join(args, " "))
    
    return adb.Shell(s.config.Device, cmd)
}

func (s *StreamServer) acceptSockets() error {
    listener, err := net.Listen("tcp", fmt.Sprintf(":%d", s.port))
    if err != nil {
        return err
    }
    defer listener.Close()
    
    socketOrder := []string{}
    if s.config.Video { socketOrder = append(socketOrder, "video") }
    if s.config.Audio { socketOrder = append(socketOrder, "audio") }
    if s.config.Control { socketOrder = append(socketOrder, "control") }
    
    for i, name := range socketOrder {
        listener.SetDeadline(time.Now().Add(10 * time.Second))
        conn, err := listener.Accept()
        if err != nil {
            return fmt.Errorf("socket %d (%s) accept error: %v", i+1, name, err)
        }
        
        conn.SetReadDeadline(time.Now().Add(30 * time.Second))
        
        switch name {
        case "video":
            s.videoConn = conn
        case "audio":
            s.audioConn = conn
        case "control":
            s.controlConn = conn
        }
        
        log.Printf("Connected %s socket", name)
    }
    
    return nil
}

func (s *StreamServer) initializeDecoders() error {
    // Video decoder
    if s.config.Video {
        codecMeta := make([]byte, 12)
        s.videoConn.Read(codecMeta)
        
        codecID := binary.BigEndian.Uint32(codecMeta[0:4])
        width := binary.BigEndian.Uint32(codecMeta[4:8])
        height := binary.BigEndian.Uint32(codecMeta[8:12])
        
        decoder, err := s.createVideoDecoder(codecID, width, height)
        if err != nil {
            return fmt.Errorf("video decoder init: %v", err)
        }
        s.videoDecoder = decoder
    }
    
    // Audio decoder
    if s.config.Audio {
        codecMeta := make([]byte, 4)
        s.audioConn.Read(codecMeta)
        
        codecID := binary.BigEndian.Uint32(codecMeta[0:4])
        
        decoder, err := s.createAudioDecoder(codecID)
        if err != nil {
            return fmt.Errorf("audio decoder init: %v", err)
        }
        s.audioDecoder = decoder
    }
    
    return nil
}
```

### Phase 2: Stream Demuxing & Parsing

```go
func (s *StreamServer) StreamLoop() error {
    // Start goroutines for each stream
    errChan := make(chan error, 3)
    
    if s.config.Video {
        go func() {
            errChan <- s.videoStreamLoop()
        }()
    }
    
    if s.config.Audio {
        go func() {
            errChan <- s.audioStreamLoop()
        }()
    }
    
    if s.config.Control {
        go func() {
            errChan <- s.controlStreamLoop()
        }()
    }
    
    // Wait for first error (any stream failure ends session)
    return <-errChan
}

func (s *StreamServer) videoStreamLoop() error {
    for {
        // Read 12-byte frame header
        header := make([]byte, 12)
        _, err := io.ReadFull(s.videoConn, header)
        if err != nil {
            return fmt.Errorf("video header read: %v", err)
        }
        
        ptsWithFlags := binary.BigEndian.Uint64(header[0:8])
        packetSize := binary.BigEndian.Uint32(header[8:12])
        
        configPacket := (ptsWithFlags >> 62) & 0x1
        keyFrame := (ptsWithFlags >> 61) & 0x1
        pts := ptsWithFlags & 0x3FFFFFFFFFFFFFFF
        
        // Read packet data
        packet := make([]byte, packetSize)
        _, err = io.ReadFull(s.videoConn, packet)
        if err != nil {
            return fmt.Errorf("video packet read: %v", err)
        }
        
        // Process packet
        if err := s.videoDecoder.ProcessPacket(
            packet, 
            int64(pts), 
            configPacket != 0); err != nil {
            return fmt.Errorf("video decode: %v", err)
        }
        
        // Get decoded frame (non-blocking)
        frame := s.videoDecoder.GetFrame()
        if frame != nil {
            s.onVideoFrame(frame)  // Display, record, etc.
        }
    }
}

func (s *StreamServer) audioStreamLoop() error {
    for {
        header := make([]byte, 12)
        _, err := io.ReadFull(s.audioConn, header)
        if err != nil {
            return fmt.Errorf("audio header read: %v", err)
        }
        
        packetSize := binary.BigEndian.Uint32(header[8:12])
        
        packet := make([]byte, packetSize)
        _, err = io.ReadFull(s.audioConn, packet)
        if err != nil {
            return fmt.Errorf("audio packet read: %v", err)
        }
        
        frame := s.audioDecoder.ProcessPacket(packet)
        if frame != nil {
            s.onAudioFrame(frame)  // Play, record, etc.
        }
    }
}

func (s *StreamServer) controlStreamLoop() error {
    // Listen for device messages (clipboard, rotation)
    for {
        msgType := make([]byte, 1)
        _, err := io.ReadFull(s.controlConn, msgType)
        if err != nil {
            return fmt.Errorf("control msg type read: %v", err)
        }
        
        switch msgType[0] {
        case 1:  // Clipboard
            msg, err := s.readClipboardMessage()
            if err != nil {
                return err
            }
            s.onClipboardChange(msg)
        case 2:  // Rotate
            msg, err := s.readRotateMessage()
            if err != nil {
                return err
            }
            s.onDeviceRotate(msg)
        }
    }
}
```

### Phase 3: FFmpeg Decoder Integration

```go
// Use go-ffmpeg bindings (e.g., github.com/u2takey/ffmpeg-go)

func (s *StreamServer) createVideoDecoder(codecID, width, height uint32) (VideoDecoder, error) {
    var codecName string
    switch codecID {
    case 0:
        codecName = "h264"
    case 1:
        codecName = "hevc"  // H.265
    case 2:
        codecName = "av1"
    default:
        return nil, fmt.Errorf("unknown codec: %d", codecID)
    }
    
    // Initialize FFmpeg context
    ctx := createDecoderContext(codecName, int(width), int(height))
    
    return &FFmpegVideoDecoder{
        ctx:    ctx,
        width:  int(width),
        height: int(height),
    }, nil
}

func (d *FFmpegVideoDecoder) ProcessPacket(data []byte, pts int64, isConfig bool) error {
    // Send to decoder
    pkt := createPacket(data, pts)
    sendPacketToDecoder(d.ctx, pkt)
    
    // Decoder will buffer config packets internally
    return nil
}

func (d *FFmpegVideoDecoder) GetFrame() *Frame {
    // Try to receive frame (non-blocking)
    frame, ok := receiveFrameFromDecoder(d.ctx)
    if !ok {
        return nil  // Not enough data yet
    }
    
    return &Frame{
        Width:  frame.Width,
        Height: frame.Height,
        Data:   frame.Data,  // YUV420P or other format
        Timestamp: frame.PTS,
    }
}
```

---

## Error Handling & Fallback Strategy

### Hierarchical Fallback Chain

```
[User requests video_codec=h265]
    ↓
[Server checks device support]
    ↓ No H.265
[Try H.264]
    ↓
[Decoder initialized]
    ↓ Decode error
[Log error, attempt recovery]
    ↓ Unrecoverable
[Reconnect with fallback codec]
```

### Reconnection with Fallback

```go
func (s *StreamServer) handleFatalError(err error) error {
    log.Printf("Fatal stream error: %v, attempting fallback", err)
    
    // Try lower-level codec
    currentCodec := s.config.VideoCodec
    fallbackCodec := ""
    
    switch currentCodec {
    case "av1":
        fallbackCodec = "h265"
    case "h265":
        fallbackCodec = "h264"
    case "h264":
        log.Printf("H.264 failed, no fallback available")
        return errors.New("streaming failed")
    }
    
    log.Printf("Falling back from %s to %s", currentCodec, fallbackCodec)
    
    // Close current connections
    s.Close()
    
    // Update config and retry
    s.config.VideoCodec = fallbackCodec
    return s.Start()
}
```

### Timeout & Deadlock Detection

```go
func (s *StreamServer) monitorHealth() {
    ticker := time.NewTicker(5 * time.Second)
    defer ticker.Stop()
    
    for range ticker.C {
        lastVideoTime := s.videoDecoder.LastFrameTime()
        lastAudioTime := s.audioDecoder.LastFrameTime()
        
        // No video frames in 10 seconds = stall
        if time.Since(lastVideoTime) > 10*time.Second {
            log.Printf("Video stalled, reconnecting")
            s.handleFatalError(errors.New("video stall"))
            return
        }
        
        // Control socket not responding
        if s.config.Control {
            s.controlConn.SetWriteDeadline(time.Now().Add(5*time.Second))
            _, err := s.controlConn.Write([]byte{})  // ping
            if err != nil {
                log.Printf("Control socket dead, reconnecting")
                s.handleFatalError(err)
                return
            }
        }
    }
}
```

---

## References & Sources

### Official Documentation

1. **Scrcpy GitHub - Develop Guide**
   - https://github.com/Genymobile/scrcpy/blob/master/doc/develop.md
   - Comprehensive protocol specification (v2.1 documented)

2. **Scrcpy v3.0 Release Notes**
   - https://www.mcbluna.net/wp/zidoo/scrcpy-v3-0/
   - OpenGL filters, virtual display, camera source support

3. **Scrcpy v3.2 Release Notes**
   - https://www.mcbluna.net/wp/zidoo/scrcpy-v3-2/
   - Latest audio source options, bug fixes

### Protocol Implementation References

4. **Tango ADB Development Guide – Connect to Server**
   - https://tangoadb.dev/1.1.0/scrcpy/connect-server/
   - Unix domain sockets overview for scrcpy

5. **GitHub Issue #4076 – Socket Connection Details**
   - https://github.com/Genymobile/scrcpy/issues/4076
   - Clarification on socket order (video→audio→control)

6. **GitHub Issue #6086 – Raw H.264 Stream Decoding**
   - https://github.com/Genymobile/scrcpy/issues/6086
   - Practical raw stream decoding with FFmpeg/ffplay
   - Demonstrates SPS/PPS packet importance

### Multi-Device & Port Management

7. **GitHub Issue #5301 – Multiple Devices Port Management**
   - Discusses port conflicts and SCID usage for concurrent sessions
   - Best practices for parallel device control

8. **GitHub Issue #5732 – Socket Server vs ADB Forwarding**
   - Analysis of ADB forwarding limitations and stability concerns
   - Discussion of WiFi vs USB performance trade-offs

### Codec & Format Details

9. **H.264 Elementary Stream Format**
   - NAL unit structure with start codes (`0x000001`, `0x00000001`)
   - SPS/PPS extraction and reconstruction

10. **OPUS Audio Codec**
    - RFC 7845 (Ogg Opus standard)
    - 48kHz typical, 20ms frames, variable bitrate

11. **FFmpeg Documentation**
    - Codec contexts, packet/frame API
    - Recommended bindings for Go: `github.com/u2takey/ffmpeg-go`

### Android API Compatibility

12. **Android MediaCodec Documentation**
    - https://developer.android.com/reference/android/media/MediaCodec
    - Encoder availability varies by device and Android version

13. **Android 14/15 Scrcpy Compatibility Issues**
    - GitHub #4879 – Android 15 Beta compatibility
    - Display capture API changes in newer Android versions

---

## Data Structures Reference

### Go Implementation Data Structures

```go
// Connection management
type DeviceSession struct {
    Serial      string
    SCID        string
    Port        int
    IsReverse   bool
    
    VideoSocket net.Conn
    AudioSocket net.Conn
    ControlSocket net.Conn
}

// Video stream
type VideoCodecMetadata struct {
    CodecID uint32  // 0=H.264, 1=H.265, 2=AV1
    Width   uint32
    Height  uint32
}

type VideoFrameHeader struct {
    PTS       uint64  // 62-bit
    ConfigPkt uint8   // bit 63
    KeyFrame  uint8   // bit 62
    Size      uint32
}

type VideoFrame struct {
    PTS       int64
    Width     int
    Height    int
    Data      []byte  // YUV420P
    IsKeyFrame bool
}

// Audio stream
type AudioCodecMetadata struct {
    CodecID uint32  // 0=OPUS, 1=AAC, 2=RAW
}

type AudioFrame struct {
    PTS        int64
    Samples    []int16  // or []float32 for raw
    SampleRate int
    Channels   int
}

// Control messages
type ControlMessage interface {
    Type() uint8
    Serialize() []byte
}

type KeycodeMessage struct {
    Action   uint8
    Keycode  uint32
    Repeat   uint32
    MetaState uint32
}

type ClipboardMessage struct {
    Text string
}

type RotateMessage struct {
    Rotation uint8  // 0=0°, 1=90°, 2=180°, 3=270°
}
```

---

## Summary Checklist

- [ ] **Version Matching**: Ensure client (Go backend) and server (JAR) have exact same version
- [ ] **Socket Order**: Accept sockets in order (video → audio → control), matching enabled options
- [ ] **Codec Metadata**: Parse 12 bytes (video) or 4 bytes (audio) before processing frames
- [ ] **Frame Header Parsing**: Extract config flag, key frame flag, PTS (62-bit), size (32-bit)
- [ ] **H.264 Config Packets**: Feed SPS/PPS to decoder before first IDR frame
- [ ] **Device Rotation**: Watch for new codec metadata (resolution change), reinitialize decoder
- [ ] **SCID Management**: Generate unique 31-bit SCID for each concurrent device
- [ ] **Port Selection**: Use different ports (27183–27199) for each concurrent session
- [ ] **Timeout Detection**: Monitor socket health; reconnect on stall or timeout
- [ ] **Fallback Chain**: H.265 → H.264 if codec unavailable or fails
- [ ] **FFmpeg Integration**: Use FFmpeg for H.264/H.265/AV1 decoding
- [ ] **Error Handling**: Gracefully handle connection drops, partial reads, encoder reset
- [ ] **Multi-Device Concurrency**: Spawn separate goroutines per device, synchronize port/SCID allocation
- [ ] **Control Socket**: Implement bidirectional (input → device, clipboard/rotate → client)
- [ ] **Buffer Management**: Implement adaptive frame buffering for sync with display refresh rate

---

## Quick Reference: Frame Header Parsing

```go
func parseFrameHeader(data [12]byte) (pts int64, configPkt bool, keyFrame bool, size uint32) {
    ptsWithFlags := binary.BigEndian.Uint64(data[0:8])
    size = binary.BigEndian.Uint32(data[8:12])
    
    configPkt = (ptsWithFlags & (1 << 63)) != 0
    keyFrame = (ptsWithFlags & (1 << 62)) != 0
    pts = int64(ptsWithFlags & 0x3FFFFFFFFFFFFFFF)  // Lower 62 bits
    
    return
}
```

---

## Conclusion

Building a custom Go backend for scrcpy 3.x requires:

1. **Deep understanding** of the multi-socket architecture and version-specific protocol
2. **Careful implementation** of frame header parsing and codec metadata extraction
3. **Robust error handling** with codec fallback chains and connection monitoring
4. **Concurrent device management** with unique SCID/port per session
5. **Integration with FFmpeg** or equivalent for H.264/H.265/AV1 decoding

Start with a single device (video-only, H.264), verify frame parsing and codec initialization, then expand to audio, multiple codecs, and finally concurrent multi-device support.

Good luck with your implementation!
