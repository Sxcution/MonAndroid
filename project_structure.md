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
  - Manages H.264 streams from ADB.
  - **Protocol:** Reads raw H.264 (Annex B), wraps it in custom binary packet: `[1 byte ID Len] + [Device ID] + [NAL Unit]`.
  - **State:** Idempotent Start/Stop logic.
- `service/device_manager.go`: Scans and manages device list/status.
- `service/action_dispatcher.go`: Handles input events (Touch, Key, Text) via ADB.

### ADB Integration
- `adb/adb.go`:
  - Wraps `screenrecord` command.
  - **Config:** Bitrate 1Mbps-4Mbps, Size 1024px max, **NO** `--verbose` flag.
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
- `DeviceGrid.tsx`: Renders grid of `DeviceCard`.
- `ControlPanel.tsx`: Modal for single device control (High res).

### Services (`src/services/`)
- `websocket.ts`: **Singleton** class `WebSocketService`. Manages one single connection for the whole app.
- `deviceService.ts`: Device control API wrapper.
