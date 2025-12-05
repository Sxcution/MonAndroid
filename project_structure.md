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
  - **Warm Session:** Viewer counting, 120s TTL, cached SPS/PPS/IDR for instant re-attach
  - **Protocol:** Reads raw H.264 (Annex B) from TCP socket
  - Wraps in binary packet: `[1 byte ID Len] + [Device ID] + [NAL Unit]`
  
- `scrcpy_client.go`:
  - Manages scrcpy-server lifecycle: push jar, ADB forward, start server, TCP connect
  - **Protocol v3.3.3:**
    - `scid`: 31-bit random ID, sent as **8-char HEX** (e.g., `scid=3db7a2f1`)
    - Must be < `0x80000000` (Java's `Integer.parseInt(hex, 16)` limit)
    - Socket name: `scrcpy_{scid_hex}`
    - `raw_stream=true`: Pure H.264 Annex-B, no handshake headers
    - `control=true`: Enables second socket for keyboard/clipboard
  - **Control Socket:** SendKeyEvent, SendText, SendClipboard methods

- `control.go`:
  - Binary serialization for scrcpy control messages
  - Key injection, text injection, clipboard operations
  
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
  - `isDragHighlighted` prop for real-time drag selection preview
  - Ctrl+Click for multi-select toggle
  - Hover: light blue border, Selected: blue border + shadow
  - Right-click: Go Back (no touch)
  - Magnify button (w-5 h-5) with draggable position
  - `data-device-id` attribute for selection detection

- `DeviceGrid.tsx`: 
  - Grid layout with `repeat(auto-fill, minmax(120px, 1fr))`
  - Passes `dragHighlightedDevices` to cards
  
- `ControlPanel.tsx`: Single device control modal
- `ExpandedDeviceView.tsx`: Full-screen device view
- `SettingsModal.tsx`: FPS indicator, device name display settings
- `ActionBar.tsx`: Action buttons and controls

### App.tsx Features
- **Drag-to-Select:** Selection box only starts when clicking OUTSIDE cards
- **Clear Selection:** Only clears when clicking on empty area (not on cards)
- **Sidebar:** Auto-hide, appears on left edge hover

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
