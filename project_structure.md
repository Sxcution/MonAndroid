# MonAndroid - Project Structure

## Overview
Multi-device Android control system with Go backend (ADB/H.264) and React/Electron frontend (WebCodecs).

## Root Files
- `README.md`: Setup instructions
- `naming_registry.json`: Centralized naming conventions
- `project_structure.md`: Architecture documentation (this file)
- `run_all.bat`: Quick start script to launch backend and frontend
- `STATUS_REPORT.md`: Development status and notes

---

## Backend (`backend/`)

### Entry Point
- `main.go`: Server initialization, starts HTTP/WebSocket servers

### Core Services (`service/`)
- `streaming.go`:
  - Manages H.264 streams using **scrcpy server v3.3.3** with context-based lifecycle
  - **Protocol:** Reads raw H.264 (Annex B) from TCP socket
  - Wraps in binary packet: `[1 byte ID Len] + [Device ID] + [NAL Unit]`
  
- `scrcpy_client.go`:
  - Manages scrcpy-server lifecycle: push jar, ADB forward, start server, TCP connect
  - **Protocol v3.3.3:**
    - `scid`: 31-bit random ID, sent as **8-char HEX** (e.g., `scid=3db7a2f1`)
    - Must be < `0x80000000` (Java's `Integer.parseInt(hex, 16)` limit)
    - Socket name: `scrcpy_{scid_hex}`
    - `raw_stream=true`: Pure H.264 Annex-B, no handshake headers
  
- `device_manager.go`: Scans and manages device list/status
- `action_dispatcher.go`: Handles input events (Touch, Key, Text) via ADB

### ADB Integration (`adb/`)
- `adb.go`:
  - Wraps ADB commands with device targeting
  - **Methods:** `PushFile`, `Forward`, `RemoveForward`, `ExecuteCommandBackground`
  - Parsers for device info and screen resolution

### Assets (`assets/`)
- `scrcpy-server`: Scrcpy server binary v3.3.3 (pushed to device)
- `scrcpy-server-v1.24.jar`: Legacy server (deprecated)

### API Layer (`api/`)
- `websocket.go`: Hub broadcasts binary messages to frontend
- `routes.go` & `handlers.go`: REST API endpoints

### Config (`config/`)
- Configuration files for server settings

### Models (`models/`)
- Data structures for Device, Action, etc.

---

## Frontend (`frontend/`)

### Architecture
- **Runtime:** Electron + Vite + React 18
- **State:** Zustand (`useAppStore`)
- **Network:** Singleton WebSocket Service

### Entry Points (`src/`)
- `main.tsx`: React app entry
- `App.tsx`: Main application component
- `index.css`: Global styles

### Components (`src/components/`)
- `ScreenView.tsx`:
  - WebCodecs `VideoDecoder` in Annex B mode
  - Auto-detects codec from SPS, patches SPS to 4.2
  - Stitches `SPS+PPS+IDR` for keyframes
  - Auto-resets decoder on error
  
- `DeviceCard.tsx`:
  - Hover-visible expand button
  - Drag vs Click detection (>5px)
  - Aspect ratio: `9/16`

- `DeviceGrid.tsx`: Grid layout with `auto-rows-fr`
- `ControlPanel.tsx`: Single device control modal
- `ExpandedDeviceView.tsx`: Full-screen device view
- `SettingsModal.tsx`: FPS, display settings
- `ActionBar.tsx`: Action buttons and controls

### Stores (`src/store/`)
- `useAppStore.ts`: Main state (devices, selection, expanded)
- `useSettingsStore.ts`: User settings with localStorage persistence

### Services (`src/services/`)
- `websocket.ts`: Singleton WebSocket manager
- `deviceService.ts`: Device control API wrapper
- `api.ts`: HTTP API client

### Types (`src/types/`)
- TypeScript interfaces for Device, Action, API responses

### Utils (`src/utils/`)
- Utility functions

---

## Key Protocol Notes (scrcpy 3.x)

### SCID Generation
```go
// Must be 31-bit to stay in Java signed int32 range
c.scid = rand.Uint32() & 0x7FFFFFFF

// Passed as 8-char HEX (no 0x prefix)
fmt.Sprintf("scid=%08x", c.scid)
```

### Server Args (v3.3.3 Real-Time Mode)
```
3.3.3
scid=xxxxxxxx        # 8-char HEX, < 0x80000000
log_level=debug
video=true
audio=false
max_size=720
video_bit_rate=8000000   # 8Mbps for real-time
max_fps=60               # 60fps for smooth interaction
tunnel_forward=true
control=false
raw_stream=true          # Pure H.264 Annex-B output
```

### Real-Time Optimizations Applied
- **WebSocket Buffer:** 16 frames (was 64), aggressive frame dropping
- **TCP:** `SetNoDelay(true)`, 1MB read/write buffers
- **Read Buffer:** 64KB chunks (was 4KB)
- **Result:** ~100-200ms latency, prioritizes current state over frame completeness
