# MonAndroid - Project Structure (Updated)

## Overview
Multi-device Android control system with Go backend (ADB/H.264) and React/Electron frontend (WebCodecs).

## Root Files
- `README.md`: Setup instructions
- `naming_registry.json`: Centralized naming conventions
- `project_structure.md`: Architecture documentation
- `run_all.bat`: Quick start script to launch backend and frontend

---

## Backend (`backend/`)

### Core Services
- `main.go`: Entry point, server initialization.
- `service/streaming.go`:
  - Manages H.264 streams using **Scrcpy server** (v1.24) with **context-based lifecycle**.
  - **Protocol:** Reads raw H.264 (Annex B) from TCP socket, wraps in custom binary packet: `[1 byte ID Len] + [Device ID] + [NAL Unit]`.
  - **No time limit:** Scrcpy has no 3-minute limit like screenrecord.
- `service/scrcpy_client.go`:
  - Manages scrcpy-server lifecycle: push jar, ADB forward, start server, TCP handshake.
  - **Protocol v1.24:** Uses key=value args (`send_frame_meta=false` for pure Annex-B).
  - **Handshake:** Reads 1 dummy byte + 64-byte device name + 4-byte resolution.
- `service/device_manager.go`: Scans and manages device list/status.
- `service/action_dispatcher.go`: Handles input events (Touch, Key, Text) via ADB.

### ADB Integration
- `adb/adb.go`:
  - Wraps ADB commands with device targeting.
  - **Methods:** `PushFile`, `Forward`, `RemoveForward`, `ExecuteCommandBackground`.
  - Parsers for device info and screen resolution (handling "Override size").

### Assets
- `assets/scrcpy-server-v1.24.jar`: Scrcpy server binary pushed to device.

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
  - **Canvas:** Uses `canvasSizeRef` to track size and only update when changed, preventing context reset blur.
  - **Keyframe Waiting:** Enforces WebCodecs requirement to receive keyframe (IDR) after configure before decoding P-frames.
- `DeviceCard.tsx`:
  - **Hover Detection:** Expand button (magnifying glass) only visible on hover.
  - **Global Position:** Expand button position shared across all cards via `useAppStore`.
  - **Drag vs Click:** Distinguishes drag (>5px movement) from click to prevent accidental expand.
  - **Aspect Ratio:** Uses `aspect-[9/16]` for consistent card height in grid.
- `DeviceGrid.tsx`: Renders grid of `DeviceCard` with `auto-rows-fr` for equal height rows.
- `SettingsModal.tsx`: Settings UI for FPS control (5-30), FPS indicator toggle, device name toggle.
- `ControlPanel.tsx`: Modal for single device control (High res).

### Stores (`src/store/`)
- `useAppStore.ts`: Main app state (devices, selection, expanded device, expand button position).
- `useSettingsStore.ts`: User settings with localStorage persistence (targetFps, showFpsIndicator, showDeviceName).

### Services (`src/services/`)
- `websocket.ts`: **Singleton** class `WebSocketService`. Manages one single connection for the whole app.
- `deviceService.ts`: Device control API wrapper.
