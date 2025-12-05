# Scrcpy 3.x Protocol Architecture & Decision Trees
## Visual Reference for Go Backend Implementation

---

## 1. Overall System Architecture

```
┌─────────────────────────────────────────────────────────────────┐
│                     Your Go Backend                              │
│  ┌───────────────────────────────────────────────────────────┐  │
│  │ Main Application                                           │  │
│  │ • UI/Display layer (SDL or FFmpeg viewer)                 │  │
│  │ • Input handling (keyboard, mouse)                        │  │
│  │ • Recording management (if enabled)                       │  │
│  └───┬───────────────────────────────────────────────────────┘  │
│      │                                                           │
│  ┌───┴───────────────────────────────────────────────────────┐  │
│  │ Stream Manager                                             │  │
│  │ • Multi-device coordination                               │  │
│  │ • Port/SCID allocation                                    │  │
│  │ • Connection lifecycle                                    │  │
│  └───┬───────────┬─────────────────┬────────────────────────┘  │
│      │           │                 │                            │
│  ┌───┴──┐ ┌─────┴────┐ ┌──────────┴──┐                          │
│  │Video │ │  Audio   │ │  Control    │                          │
│  │Parser│ │ Parser   │ │ Handler     │                          │
│  └───┬──┘ └─────┬────┘ └──────┬──────┘                          │
│      │          │              │                                │
│  ┌───┴──────────┴──────────────┴─────────────────────────────┐  │
│  │              Socket Connection Layer                      │  │
│  │ • Accept sockets in order (video→audio→control)          │  │
│  │ • Handle codec metadata                                   │  │
│  │ • Frame demuxing & parsing                                │  │
│  └───┬──────────────────────────────────────────────────────┘  │
│      │                                                           │
└──────┼───────────────────────────────────────────────────────────┘
       │
       │ TCP (via ADB reverse/forward)
       ↓
┌─────────────────────────────────────────────────────────────────┐
│                  Android Device                                  │
│  ┌───────────────────────────────────────────────────────────┐  │
│  │ Scrcpy Server (Java)                                       │  │
│  │ ┌──────────┐  ┌──────────┐  ┌──────────────┐              │  │
│  │ │ Video    │  │  Audio   │  │  Controller  │              │  │
│  │ │Streamer  │  │ Streamer │  │              │              │  │
│  │ └────┬─────┘  └────┬─────┘  └──────┬───────┘              │  │
│  │      │             │               │                       │  │
│  │ ┌────┴───────┬─────┴───────┬──────┴──────────────────┐    │  │
│  │ │ MediaCodec │ AudioRecord │ InputManager/Clipboard │    │  │
│  │ │ (H.264/    │ (PCM → OPUS)│ Injection             │    │  │
│  │ │  H.265/AV1)│             │                        │    │  │
│  │ └────────────┴─────────────┴────────────────────────┘    │  │
│  │                                                            │  │
│  │ ┌────────────────────────────────────────────────────┐   │  │
│  │ │    Display/Surface + AudioRecord Input            │   │  │
│  │ └────────────────────────────────────────────────────┘   │  │
│  └───────────────────────────────────────────────────────────┘  │
└─────────────────────────────────────────────────────────────────┘
```

---

## 2. Connection Flow Diagram

```
START
  │
  ├─ Generate SCID (31-bit random)
  │  └─ SCID ensures multiple concurrent clients
  │
  ├─ Select port from pool (27183–27199)
  │  └─ Each device needs unique port + SCID
  │
  ├─ Set up ADB tunnel
  │  │
  │  ├─ Try REVERSE (preferred):
  │  │  └─ adb reverse localabstract:scrcpy_<SCID> tcp:<PORT>
  │  │  └─ Device connects back to us (low latency)
  │  │
  │  └─ If reverse fails, use FORWARD:
  │     └─ adb forward tcp:<PORT> localabstract:scrcpy_<SCID>
  │     └─ We connect to device via ADB daemon (higher latency)
  │
  ├─ Create listening socket on <PORT>
  │  └─ Set accept timeout (10–30 seconds)
  │
  ├─ Push JAR and start server
  │  │
  │  └─ adb push scrcpy-server-v3.2.jar /data/local/tmp/
  │  └─ adb shell CLASSPATH=... app_process / \
  │     com.genymobile.scrcpy.Server 3.2 scid=<SCID> video=true ...
  │  └─ Server spawns on device
  │
  ├─ Accept sockets in EXACT order:
  │  │
  │  ├─ Socket 1: Video
  │  │  └─ Read 12-byte codec metadata
  │  │     ├─ CodecID (0=H.264, 1=H.265, 2=AV1)
  │  │     ├─ Width, Height
  │  │     └─ Initialize decoder
  │  │
  │  ├─ Socket 2 (if audio enabled): Audio
  │  │  └─ Read 4-byte codec metadata
  │  │     ├─ CodecID (0=OPUS, 1=AAC, 2=RAW)
  │  │     └─ Initialize audio player
  │  │
  │  └─ Socket 3 (if control enabled): Control
  │     └─ Ready for input events + clipboard/rotate messages
  │
  ├─ Frame streaming loop
  │  │ (runs in parallel goroutines for each socket)
  │  │
  │  └─ Read → Parse → Decode → Display (continuous)
  │
  ├─ Monitor health
  │  ├─ Detect socket timeouts
  │  ├─ Detect decoder stalls
  │  └─ Trigger reconnect on failure
  │
  └─ END (user stops or error)
```

---

## 3. Socket Connection State Machine

```
                      IDLE
                        │
                        ├─ Port allocated, SCID generated
                        │
                        ↓
                  TUNNEL_SETUP
                        │
         ┌──────────────┼──────────────┐
         │ Reverse      │ Forward      │
         │ (preferred)  │ (fallback)   │
         ↓              ↓              ↓
      TUN_OK        TUN_OK         TUN_FAILED
         │              │              │
         └──────────────┬──────────────┘
                        │
                        ↓
                  SERVER_PUSH
                        │
         ┌──────────────┼──────────────┐
         │ JAR exists   │ Need push    │
         ↓              ↓              ↓
    JAR_READY    PUSHING_JAR     PUSH_OK
         │              │              │
         └──────────────┬──────────────┘
                        │
                        ↓
                  SERVER_LAUNCH
                        │
         ┌──────────────┼──────────────┐
         │ Success      │ Error        │
         ↓              ↓              ↓
    RUNNING      LAUNCH_FAILED   RECONNECT
         │                           │
         │ (retry with fallback)    │
         │                          /
         │                         /
         ├─────────────────────────
         │
         ├─ Socket 1 (VIDEO)
         │  ├─ Accept timeout
         │  └─ Connected → Read codec meta
         │
         ├─ Socket 2 (if enabled: AUDIO or CONTROL)
         │  └─ Connected → Read metadata
         │
         ├─ Socket 3 (if enabled: CONTROL)
         │  └─ Connected
         │
         ↓
    ALL_SOCKETS_OK
         │
         ↓
    STREAMING ←──────┐
         │           │
         ├─ Read frames (loop)
         │ ├─ Frame header (12 bytes)
         │ ├─ Frame data (N bytes)
         │ ├─ Decode & display
         │ └─ Back to top
         │
         ├─ Monitor health
         │ ├─ Timeout? → ERROR
         │ ├─ Device rotate? → Reinit decoder
         │ └─ All OK? → Continue loop
         │
         ├─ ERROR detected
         │  ├─ Attempt fallback codec
         │  ├─ If codec unavailable → New attempt
         │  ├─ If all attempts fail → FAILED
         │  └─ On fallback retry → restart (back to TUNNEL_SETUP)
         │
         └─ User stops → IDLE
```

---

## 4. Frame Parsing State Machine

```
FRAME_LOOP_START
         │
         ├─ Read 12 bytes (frame header)
         │  │
         │  ├─ Timeout? → ERROR
         │  │
         │  └─ Success
         │
         ↓
    PARSE_HEADER
         │
         ├─ Extract PTS+flags (8 bytes)
         │  └─ Bit 63 = ConfigPacket
         │  └─ Bit 62 = KeyFrame
         │  └─ Bits 0–61 = PTS (62-bit)
         │
         ├─ Extract Size (4 bytes)
         │
         ↓
    DECODE_FLAGS
         │
         ├─ ConfigPacket = 1?
         │  │
         │  ├─ YES (SPS/PPS)
         │  │  ├─ Store in config buffer
         │  │  ├─ Feed to decoder
         │  │  ├─ Mark decoder as ready
         │  │  └─ Don't display → FRAME_LOOP_START
         │  │
         │  └─ NO (Data frame)
         │     └─ Continue
         │
         ├─ KeyFrame = 1?
         │  └─ Remember for decoder priority
         │
         ↓
    READ_PAYLOAD
         │
         ├─ Read N bytes (packet size)
         │  │
         │  ├─ Timeout or EOF? → ERROR
         │  │
         │  └─ Success
         │
         ↓
    DECODE_PACKET
         │
         ├─ Decoder ready?
         │  │
         │  ├─ NO → ERROR (should have received config)
         │  │
         │  └─ YES
         │     └─ Submit packet to FFmpeg
         │        └─ Return immediately (async decode)
         │
         ↓
    TRY_RECEIVE_FRAME
         │
         ├─ FFmpeg has decoded frame?
         │  │
         │  ├─ YES → DISPLAY_FRAME
         │  │  └─ Render frame
         │  │  └─ Update timestamp
         │  │  └─ Back to FRAME_LOOP_START
         │  │
         │  └─ NO (not enough data yet)
         │     └─ Back to FRAME_LOOP_START
         │
         ↓
    DETECT_ROTATION
         │
         ├─ Frame dimensions changed?
         │  │
         │  ├─ YES
         │  │  ├─ Stream restarted (codec metadata flush)
         │  │  ├─ Reinitialize decoder
         │  │  └─ Back to FRAME_LOOP_START
         │  │
         │  └─ NO → Continue
         │
         ↓
    FRAME_LOOP_START (repeat)
```

---

## 5. Codec Selection Decision Tree

```
START: User requests codec_preference="h265"
    │
    │
    ├─ Check device encoder availability
    │  │
    │  ├─ H.265 available?
    │  │  │
    │  │  ├─ YES → Try H.265
    │  │  │  └─ Server reports codec in metadata
    │  │  │  └─ Initialize H.265 decoder
    │  │  │  └─ SUCCESS → Use H.265
    │  │  │
    │  │  └─ NO
    │  │     └─ Fall back
    │  │
    │  └─ FALLBACK: Try H.264 (universal, API 16+)
    │     │
    │     ├─ H.264 available?
    │     │  │
    │     │  ├─ YES → Try H.264
    │     │  │  └─ Server reports codec in metadata
    │     │  │  └─ Initialize H.264 decoder
    │     │  │  └─ SUCCESS → Use H.264
    │     │  │
    │     │  └─ NO
    │     │     └─ Critical error (should never happen on API 16+)
    │     │
    │     └─ If connection fails with H.264
    │        ├─ Decoder error? (e.g., FFmpeg not available)
    │        │  └─ Signal error to user
    │        │
    │        └─ Network error?
    │           └─ Retry with same codec
    │
    ├─ Codec metadata (12 bytes) received
    │  │
    │  ├─ CodecID field
    │  │  ├─ 0 → H.264 codec context
    │  │  ├─ 1 → H.265 codec context
    │  │  └─ 2 → AV1 codec context
    │  │
    │  └─ Width, Height
    │     └─ Pass to decoder initialization
    │
    ├─ Initialize decoder with width/height
    │  │
    │  └─ First frame: MUST be config packet
    │     └─ Feed SPS/PPS to decoder
    │
    └─ Stream starts
```

---

## 6. Multi-Device Management State Diagram

```
MULTI_DEVICE_START
         │
         ├─ Initialize PortManager (27183–27199)
         │  └─ Mark all ports as available
         │
         ├─ Initialize SCIDAllocator
         │  └─ Generate random base, increment per device
         │
         ├─ Initialize DeviceRegistry
         │  └─ Map serial → {port, scid, streams}
         │
         ├─ Main loop: Scan for connected devices
         │  │
         │  ├─ New device detected (serial unknown)
         │  │  │
         │  │  ├─ Request port from PortManager
         │  │  │  ├─ Available? → Allocate
         │  │  │  └─ No ports? → Queue for later
         │  │  │
         │  │  ├─ Request SCID from SCIDAllocator
         │  │  │  └─ Unique 31-bit ID
         │  │  │
         │  │  ├─ Create DeviceSession
         │  │  │  ├─ {serial, port, scid, state=INIT}
         │  │  │
         │  │  ├─ Spawn goroutine for this device
         │  │  │  └─ StreamWorker(serial, port, scid)
         │  │  │
         │  │  └─ Register in DeviceRegistry
         │  │
         │  ├─ Existing device (serial known)
         │  │  ├─ If session active → Continue
         │  │  └─ If session failed → Attempt reconnect
         │  │
         │  └─ Device disconnected (not in adb list)
         │     ├─ Stop StreamWorker
         │     ├─ Release port to PortManager
         │     ├─ Release SCID
         │     ├─ Deregister from DeviceRegistry
         │     └─ Clean up sockets
         │
         ├─ StreamWorker goroutine (per device)
         │  │
         │  ├─ Setup tunnel (reverse preferred, fallback forward)
         │  │
         │  ├─ Push and start server
         │  │  └─ Pass unique port + scid
         │  │
         │  ├─ Accept 1–3 sockets (video/audio/control)
         │  │
         │  ├─ Initialize decoders
         │  │
         │  ├─ Main stream loop
         │  │  ├─ Read & parse frames
         │  │  ├─ Decode
         │  │  ├─ Queue for display
         │  │  └─ Monitor health
         │  │
         │  ├─ ERROR: Attempt fallback codec
         │  │  ├─ Close current sockets
         │  │  ├─ Teardown tunnel
         │  │  └─ Retry from Setup tunnel with new codec
         │  │
         │  └─ FATAL: Give up
         │     └─ Mark session as failed
         │     └─ Wait for user retry or device reconnect
         │
         ├─ Main loop continues (scan, allocate, spawn workers)
         │
         └─ END (user stops application)
```

---

## 7. Error Recovery Flow

```
STREAMING_ACTIVE
         │
         ├─ Frame read error
         │  │
         │  ├─ Timeout (30+ seconds)
         │  │  └─ Network stalled
         │  │
         │  ├─ EOF (connection closed)
         │  │  └─ Device disconnected
         │  │
         │  └─ Other (malformed header, bad size)
         │     └─ Protocol error or corruption
         │
         ↓
    ERROR_HANDLER
         │
         ├─ Current codec?
         │  ├─ H.265
         │  │  └─ Fallback choice: H.264
         │  │
         │  ├─ H.264
         │  │  └─ No fallback (critical)
         │  │  └─ Report error
         │  │
         │  └─ AV1
         │     └─ Fallback choice: H.265 → H.264
         │
         ├─ Retry count?
         │  │
         │  ├─ < Max attempts (default 3)
         │  │  └─ Try fallback codec
         │  │
         │  └─ >= Max attempts
         │     └─ Give up, report fatal error
         │
         ↓
    CLOSE_CURRENT
         │
         ├─ Close all sockets (video/audio/control)
         │
         ├─ Teardown ADB tunnel
         │  └─ adb reverse --remove
         │  └─ adb forward --remove
         │
         ├─ Stop decoders
         │
         └─ Clear buffers
         │
         ↓
    BACKOFF_DELAY
         │
         ├─ Wait exponentially longer
         │  ├─ Attempt 1: 1 second
         │  ├─ Attempt 2: 4 seconds (2²)
         │  ├─ Attempt 3: 9 seconds (3²)
         │  └─ Cap at 30 seconds
         │
         ├─ User can still force retry (shorter wait)
         │
         ↓
    RETRY
         │
         ├─ Same sequence as initial connection
         │  ├─ Allocate new SCID
         │  ├─ Setup tunnel
         │  ├─ Push server
         │  ├─ Accept sockets
         │  └─ Initialize decoders
         │
         ├─ If codec specified → Fallback codec
         │
         ├─ If success → Back to STREAMING_ACTIVE
         │
         └─ If failure → ERROR_HANDLER (increment attempt count)
```

---

## 8. Control Message Flow (Bidirectional)

```
CLIENT → DEVICE (Input)
         │
         ├─ User keyboard press
         │  └─ Convert to Android KeyEvent
         │  └─ Serialize to ControlMessage
         │  └─ Send via control socket
         │
         ├─ User mouse click/move
         │  └─ Convert to MotionEvent
         │  └─ Serialize to ControlMessage
         │  └─ Send via control socket
         │
         ├─ User sets clipboard
         │  └─ Create clipboard command message
         │  └─ Send via control socket
         │
         └─ Device receives & injects into input system
            └─ App responds to input normally

━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━

DEVICE → CLIENT (Events)
         │
         ├─ Device clipboard changed
         │  └─ Server reads clipboard
         │  └─ Serializes to DeviceMessage
         │  └─ Sends via control socket
         │
         ├─ Device rotated
         │  └─ Server detects rotation (90°/180°/270°)
         │  └─ Serializes to RotateMessage
         │  └─ Sends via control socket
         │  └─ Client restarts video decoder (new dimensions)
         │
         └─ Client receives & updates UI
            ├─ Clipboard: Update clipboard manager
            └─ Rotate: Reinit decoder, notify display
```

---

## 9. Codec Fallback Chain (Decision Matrix)

| User Requests | Device Has | 1st Try | Fallback1 | Fallback2 | Result |
|---|---|---|---|---|---|
| H.265 | H.265+H.264 | H.265 | ✓ | – | Use H.265 |
| H.265 | H.264 only | H.265❌ | H.264✓ | – | Fallback to H.264 |
| H.265 | None | H.265❌ | H.264❌ | AV1? | FAIL |
| H.264 | H.265+H.264 | H.264 | ✓ | – | Use H.264 |
| H.264 | H.264 only | H.264 | ✓ | – | Use H.264 |
| AV1 | AV1+H.265+H.264 | AV1 | ✓ | – | Use AV1 |
| AV1 | H.265+H.264 (no AV1) | AV1❌ | H.265✓ | – | Fallback to H.265 |
| Any | H.264 (universal) | – | H.264✓ | – | Always available |

**Note:** H.264 is the universal fallback (available since Android 4.1, API 16+).

---

## 10. Performance Optimization Checklist

```
NETWORK LAYER
  ├─ Use reverse tunnel (faster than forward)
  ├─ USB connection preferred over TCP/WiFi
  ├─ Monitor latency (target: <50ms over USB, <200ms over WiFi)
  ├─ Buffer sizing:
  │  ├─ Video: 3–5 frames (30–50ms buffer)
  │  └─ Audio: Adaptive jitter buffer (100–200ms)
  └─ Frame skipping on stall (drop old frames to catch up)

DECODER LAYER
  ├─ Use hardware decoder if available
  │  └─ Reduce CPU load
  │  └─ Lower latency (especially H.265/AV1)
  ├─ Async packet submission
  │  └─ Don't block on decode completion
  │  └─ Frames arrive asynchronously
  ├─ Multi-threaded demux + decode
  │  └─ Separate goroutines for video/audio/control
  └─ B-frame handling
     └─ Reorder frames by PTS if out-of-order

DISPLAY LAYER
  ├─ Adaptive frame drop on lag
  │  └─ Skip rendering old frames
  │  └─ Keep up with display refresh (60Hz, 120Hz, etc.)
  ├─ Minimize copy/format conversion
  │  └─ Use shared memory / GPU textures if available
  └─ V-sync with display refresh rate
     └─ Prevent frame tearing

CONCURRENCY (MULTI-DEVICE)
  ├─ One goroutine per device
  │  └─ Independent socket loops
  │  └─ No shared state between devices
  ├─ Lock only on shared resource access
  │  ├─ PortManager (port allocation)
  │  ├─ DeviceRegistry (device list)
  │  └─ Display output (frame queueing)
  └─ Non-blocking frame queue
     └─ Drop oldest frame if buffer full
```

---

## 11. Debugging Checklist

```
PROTOCOL LEVEL
  ├─ Verify frame header byte order (Big-Endian)
  │  └─ Test: Write known PTS, read back
  │
  ├─ Verify socket order matches config
  │  └─ Test: Enable video only, socket 1 should be video
  │  └─ Test: Enable video+control, socket 2 should be control (not audio)
  │
  ├─ Verify config packet handling
  │  └─ Test: Check that SPS/PPS received before first IDR
  │  └─ Test: Decoder initialized before data packets
  │
  ├─ Verify codec metadata parsing
  │  └─ Test: Log CodecID, Width, Height from first 12 bytes
  │  └─ Check: CodecID matches expected (0/1/2)
  │  └─ Check: Dimensions reasonable (e.g., not 0x0)

NETWORK LEVEL
  ├─ Monitor socket state
  │  └─ Log: Accept, connect, close events
  │  └─ Log: Timeout/error with timestamp
  │
  ├─ Capture raw frames
  │  └─ Save frame headers + payload to file
  │  └─ Verify with: ffmpeg -f h264 -i frame.h264 -vf scale=320:240 -f image2 out_%03d.png
  │
  ├─ Test ADB tunnel
  │  └─ adb shell netstat | grep scrcpy
  │  └─ adb reverse --list
  │  └─ adb forward --list

DEVICE LEVEL
  ├─ Check device codec support
  │  └─ adb shell "dumpsys media.codec | grep -A 5 video"
  │  └─ Look for mime=video/avc (H.264), mime=video/hevc (H.265)
  │
  ├─ Verify server started
  │  └─ adb shell "ps | grep scrcpy"
  │  └─ adb logcat | grep scrcpy
  │
  └─ Monitor device CPU/memory
     └─ Watch for encoder overload or crashes

DECODER LEVEL
  ├─ Log FFmpeg context creation
  │  └─ Report codec name, supported pixel formats
  │
  ├─ Count frame statistics
  │  └─ Frames received, decoded, displayed
  │  └─ Dropped frames (if any)
  │
  └─ Test with known stream
     └─ Save H.264 stream to file
     └─ Decode offline with ffmpeg: ffmpeg -f h264 -i stream.h264 -c:v rawvideo -pix_fmt yuv420p out.yuv
```

---

## Quick ASCII Reference: Frame Header Bit Layout

```
Frame Header (12 bytes):

Bytes 0-7 (PTS with Flags, Big-Endian):
  ┌─ Bit 63: ConfigPacket (1=config/SPS-PPS, 0=data)
  │ ┌─ Bit 62: KeyFrame (1=IDR, 0=P-frame)
  │ │ ┌─ Bits 0-61: PTS value (62-bit unsigned)
  │ │ │
  ┌─┴─┴─────────────────────────────────────────────┐
 ║C K │  62-bit PTS (microseconds)                   ║
 └─┬─┬─────────────────────────────────────────────┘
   │ │
   │ └─ PTS extracted: (uint64 & 0x3FFF_FFFF_FFFF_FFFF)
   │
   └─ Flags extracted:
      - ConfigPkt = (uint64 >> 63) & 1
      - KeyFrame = (uint64 >> 62) & 1

Bytes 8-11 (Packet Size, Big-Endian):
  ┌──────────────────────────────┐
  │ Payload size (uint32, bytes) │
  └──────────────────────────────┘

Total: 12 bytes header + N bytes payload
```

---

## Summary Table: Key Facts

| Aspect | Detail |
|--------|--------|
| **Minimum version** | 3.0 (but 2.1 protocol documented) |
| **Exact match required?** | YES – client & server version must match |
| **Socket count** | 1–3 (video, audio, control) |
| **Codec metadata** | 12 bytes (video) / 4 bytes (audio) |
| **Frame header size** | 12 bytes (PTS+flags + size) |
| **PTS range** | 62-bit unsigned (0 to 4.6 exabytes microseconds) |
| **Config packets** | Must be processed first (set up decoder) |
| **Default H.264?** | Yes, most compatible |
| **H.265 supported?** | API 21+ (Android 5.0) but not all devices |
| **AV1 supported?** | API 29+ (Android 10+), rare |
| **Multi-device SCID** | 31-bit random per client session |
| **Port range** | 27183–27199 (default) |
| **Byte order** | Big-Endian (network byte order) |
| **Audio codec** | OPUS (default, API 14+), AAC, RAW |
| **Control bidirectional?** | YES (input ← client, events → client) |

---

## Final Integration Checklist

- [ ] Frame header parsing (Big-Endian, 12-byte format)
- [ ] Codec metadata extraction (video: 12b, audio: 4b)
- [ ] Config packet buffering (SPS/PPS before decode)
- [ ] Socket ordering (video→audio→control per config)
- [ ] Multi-device port/SCID allocation
- [ ] ADB tunnel management (reverse preferred)
- [ ] FFmpeg decoder integration (H.264, H.265, AV1)
- [ ] Error recovery with fallback codecs
- [ ] Frame buffering & sync
- [ ] Device rotation detection & reinitialization
- [ ] Control message serialization/deserialization
- [ ] Health monitoring & timeout detection
- [ ] Comprehensive logging for debugging
- [ ] Unit tests for frame parsing & codec metadata

Good luck with your implementation!
