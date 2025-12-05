# MonAndroid - Project Structure (Updated)

## Overview
Multi-device Android control system with Go backend (ADB/H.264) and React/Electron frontend (WebCodecs).

## Root Files
- `README.md`: Setup instructions
- `Work.md`: Project status and roadmap
- `naming_registry.json`: Centralized naming conventions
- `DEVELOPMENT_RULES.md`: Coding standards and protocols

---

## Backend (`backend/`)

### Core Services
- `main.go`: Entry point, server initialization.
- `service/streaming.go`:
  - Manages H.264 streams from ADB with **auto-restart loop**.
  - **Protocol:** Reads raw H.264 (Annex B), wraps it in custom binary packet: `[1 byte ID Len] + [Device ID] + [NAL Unit]`.
  - **State:** Idempotent Start/Stop logic.
  - **Auto-Restart:** Automatically restarts stream every 3 minutes for unlimited streaming (compatible with all devices).
- `service/device_manager.go`: Scans and manages device list/status.
- `service/action_dispatcher.go`: Handles input events (Touch, Key, Text) via ADB.

### ADB Integration
- `adb/adb.go`:
  - Wraps `screenrecord` command with default 3-minute limit (auto-restarted by streaming service).
  - **Config:** Bitrate 2Mbps, Size 720x1280 for sharp streaming.
  - Parsers for device info and screen resolution (handling "Override size").

### API Layer
- `api/websocket.go`:
  - **Hub:** Broadcasts binary messages to frontend.
  - **Logic:** No longer subscribes to "all" by default.
- `api/routes.go` & `api/handlers.go`: REST API endpoints.

---

## Frontend (`frontend/`)

### Architecture Highlights
- **Runtime:** Electron + Vite + React 18.
- **State:** Zustand (`useAppStore`).
- **Network:** Singleton WebSocket Service (`wsService`).

### Key Components (`src/components/`)
- `ScreenView.tsx`:
  - **Decoder:** WebCodecs `VideoDecoder` in **Annex B mode** (no `description`).
  - **Logic:** Auto-detects codec from SPS. Patches low-level SPS to 4.2. Stitches `SPS+PPS+IDR` for keyframes.
  - **Filtering:** Parses binary header to filter NALs by `device.id`.
  - **Recovery:** Auto-resets decoder on error.
  - **Canvas:** Uses `absolute inset-0` and `object-fill` to fill entire card without black bars.
- `DeviceCard.tsx`:
  - **Hover Detection:** Expand button (magnifying glass) only visible on hover.
  - **Global Position:** Expand button position shared across all cards via `useAppStore`.
  - **Drag vs Click:** Distinguishes drag (>5px movement) from click to prevent accidental expand.
- `DeviceGrid.tsx`: Renders grid of `DeviceCard`.
- `SettingsModal.tsx`: Settings UI for FPS control (5-30), FPS indicator toggle, device name toggle.
- `ControlPanel.tsx`: Modal for single device control (High res).

### Stores (`src/store/`)
- `useAppStore.ts`: Main app state (devices, selection, expanded device, expand button position).
- `useSettingsStore.ts`: User settings with localStorage persistence (targetFps, showFpsIndicator, showDeviceName).

### Services (`src/services/`)
- `websocket.ts`: **Singleton** class `WebSocketService`. Manages one single connection for the whole app.
- `deviceService.ts`: Device control API wrapper.
