# MonAndroid - Project Structure

## Overview
Multi-device Android control system with Go backend (ADB/H.264) and React frontend (WebCodecs).

## Root Files
- `README.md`: Setup instructions
- `naming_registry.json`: Centralized naming conventions
- `project_structure.md`: Architecture documentation (this file)
- `Rule.md`: Development rules and conventions
- `run_all.bat`: Quick start script to launch backend and frontend

---

## Backend (`backend/`)

### Entry Point
- `main.go`: Server initialization, starts HTTP/WebSocket servers

### Core Services (`service/`)
- `streaming.go`:
  - Manages H.264 streams using **scrcpy server v3.3.3** with context-based lifecycle
  - **Auto-Reconnect:** Retries up to 3 times with exponential backoff on stream failure
  - **Warm Session:** Viewer counting, 120s TTL, cached SPS/PPS/IDR for instant re-attach
  - **Protocol:** Reads raw H.264 (Annex B) from TCP socket
  - Wraps in binary packet: `[1 byte ID Len] + [Device ID] + [NAL Unit]`
  
- `scrcpy_client.go`:
  - Manages scrcpy-server lifecycle: push jar, ADB forward, start server, TCP connect
  - **Auto-Retry Quality Profiles:**
    - Profile 0 (USB): 1.5Mbps, 720p, 30fps
    - Profile 0 (WiFi): 800Kbps, 480p, 30fps
    - Profile 1 (fallback): 500Kbps, 360p, 24fps
    - Profile 2 (last resort): 300Kbps, 240p, 15fps
  - **Protocol v3.3.3:**
    - `scid`: 31-bit random ID, sent as **8-char HEX**
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
  - **WiFi Deduplication:** Prefers WiFi over USB for same device (based on `ro.serialno`)
  - **Methods:** `PushFile`, `Forward`, `RemoveForward`, `ExecuteCommandBackground`, `deduplicateDevices`
  - Parsers for device info and screen resolution

### Assets (`assets/`)
- `scrcpy-server`: Scrcpy server binary v3.3.3 (pushed to device)

### API Layer (`api/`)
- `websocket.go`: Hub broadcasts binary messages to frontend
- `routes.go` & `handlers.go`: REST API endpoints

### Config (`config/`)
- Configuration files for server settings

### Models (`models/`)
- `device.go`: Device struct with `HardwareSerial` for deduplication
- Data structures for Device, Action, etc.

---

## Frontend (`frontend/`)

### Architecture
- **Runtime:** Vite + React 18
- **State:** Zustand (`useAppStore`, `useSettingsStore`)
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
  - **Selection:** 
    - Ctrl+Click: Multi-select toggle
    - Selected: 3px blue border + shadow
    - Hover: 2px light blue border
  - **Mouse Actions:**
    - Right-click: Android Back button
    - Alt+Right-click: Open context menu
  - Magnify button with draggable position
  - `data-device-id` attribute for selection detection

- `DeviceContextMenu.tsx`: Context menu for device actions (Tags, Slot change)

- `DeviceGrid.tsx`: 
  - Grid layout with `repeat(auto-fill, minmax(120px, 1fr))`
  - Passes `dragHighlightedDevices` to cards
  
- `ControlPanel.tsx`: Single device control modal
- `ExpandedDeviceView.tsx`: Full-screen device view with keyboard support
- `SettingsModal.tsx`: FPS indicator, device name display settings
- `ActionBar.tsx`: Action buttons and controls
- `EditTagModal.tsx`: Tag editing modal

### App.tsx Features
- **Drag-to-Select:** Selection box only starts when clicking OUTSIDE cards
- **Sidebar:** Device slots with right-click context menu
- **Tags:** Tag filtering and management

### Stores (`src/store/`)
- `useAppStore.ts`: 
  - Device state, selection, expanded device
  - `deviceSlotRegistry`: Device-to-slot mapping (persisted to localStorage)
  - `getDevicesBySlot()`: Returns devices filtered to current registry
- `useSettingsStore.ts`: User settings with localStorage persistence

### Services (`src/services/`)
- `websocket.ts`: Singleton WebSocket manager
- `deviceService.ts`: Device control API wrapper (tap, swipe, goBack, etc.)
- `api.ts`: HTTP API client

### Types (`src/types/`)
- TypeScript interfaces for Device, Action, API responses

### Utils (`src/utils/`)
- Utility functions

---

## Key Protocol Notes

### Quality Profile Fallback
When encoder crashes (immediate EOF), system automatically retries with lower quality:
1. WiFi default: 800Kbps, 480p, 30fps
2. Fallback: 500Kbps, 360p, 24fps
3. Last resort: 300Kbps, 240p, 15fps

### Auto-Reconnect
- Stream dies < 5 seconds: Retry with exponential backoff (2s, 4s, 8s)
- Stream dies > 5 seconds: Immediate reconnect (reset retry counter)
- Max 3 retry attempts
