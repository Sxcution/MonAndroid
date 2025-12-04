# MonAndroid - Project Structure

## Overview
Multi-device Android control system with Go backend and React/Electron frontend.

## Root Files
- `README.md` - Project documentation
- `Work.md` - Original specification and requirements
- `naming_registry.json` - Centralized naming conventions and identifiers
- `project_structure.md` - This file

---

## Backend (`backend/`)

### Entry Point
- `main.go` - Server initialization, starts HTTP + WebSocket servers

### Configuration (`config/`)
- `config.go` - Server ports, ADB path, streaming settings
- `database.go` - SQLite initialization (currently disabled, uses in-memory)

### Models (`models/`)
- `device.go` - Device and DeviceGroup structs
- `action.go` - Action, ActionRequest, Macro structs
- `response.go` - Standard API response helpers

### Services (`service/`)
- `device_manager.go` - Device lifecycle management (scan, list, update)
  - Used by: `api/handlers.go`
- `action_dispatcher.go` - Action routing and execution queue
  - Used by: `api/handlers.go`

### API (`api/`)
- `routes.go` - HTTP route definitions + CORS middleware
  - Calls: `handlers.go`, `websocket.go`
- `handlers.go` - REST API request handlers
  - Calls: `service/device_manager.go`
- `websocket.go` - WebSocket hub for real-time communication
  - Used by: `routes.go`

### Scripts (`scripts/`)
- `migrations.sql` - Database schema (for future SQLite integration)

### Build Output
- `backend.exe` - Compiled Go binary

---

## Frontend (`frontend/`)

### Entry Point
- `index.html` - HTML entry point
- `src/main.tsx` - React entry point, renders App component

### Electron (`electron/`)
- `main.js` - Electron main process, spawns Go backend
  - Spawns: `../backend/backend.exe`
- `preload.js` - Context isolation for security

### Application (`src/`)

#### Main Component
- `App.tsx` - Root component with header, toolbar, device grid
  - Uses: `components/DeviceGrid.tsx`, `components/ControlPanel.tsx`
  - Uses: `services/websocket.ts`, `services/api.ts`
  - Uses: `store/useAppStore.ts`

#### Components (`src/components/`)
- `DeviceCard.tsx` - Individual device card with screen preview
  - Used by: `DeviceGrid.tsx`
- `DeviceGrid.tsx` - Responsive grid layout for devices
  - Used by: `App.tsx`
  - Uses: `DeviceCard.tsx`
- `ScreenView.tsx` - Canvas-based screen mirroring with touch
  - Used by: `ControlPanel.tsx`
  - Uses: `services/deviceService.ts`
- `ControlPanel.tsx` - Modal for single device control
  - Used by: `App.tsx`
  - Uses: `ScreenView.tsx`, `ActionBar.tsx`
- `ActionBar.tsx` - Quick actions and input controls
  - Used by: `ControlPanel.tsx`
  - Uses: `services/deviceService.ts`

#### Services (`src/services/`)
- `api.ts` - Axios HTTP client for REST API
  - Calls: Backend `/api/*` endpoints
  - Used by: `App.tsx`, `deviceService.ts`
- `websocket.ts` - WebSocket hook with auto-reconnect
  - Connects to: Backend `/ws`
  - Updates: `store/useAppStore.ts`
  - Used by: `App.tsx`
- `deviceService.ts` - High-level device control methods
  - Uses: `api.ts`
  - Used by: `ScreenView.tsx`, `ActionBar.tsx`

#### State Management (`src/store/`)
- `useAppStore.ts` - Zustand global state
  - Stores: devices, selections, actions, connection status
  - Used by: All components and services

#### Types (`src/types/`)
- `device.ts` - Device and DeviceGroup interfaces
  - Used by: All components and services
- `action.ts` - Action, ActionRequest, Macro interfaces
  - Used by: Services and components
- `api.ts` - APIResponse and WebSocketMessage interfaces
  - Used by: Services

#### Utilities (`src/utils/`)
- `constants.ts` - API URLs, action types, key codes
  - Used by: All services
- `helpers.ts` - Utility functions (ID gen, formatting, colors)
  - Used by: All components

#### Styles
- `index.css` - Global Tailwind CSS with theme variables
  - Used by: `main.tsx`

### Configuration Files
- `package.json` - npm dependencies and scripts
- `vite.config.ts` - Vite build configuration
- `tsconfig.json` - TypeScript configuration
- `tailwind.config.js` - Tailwind CSS theme
- `postcss.config.js` - PostCSS for Tailwind

---

## Data Flow

### Device Scanning
```
User clicks "Scan Devices"
  → App.tsx calls api.device.scanDevices()
    → Backend /api/devices/scan
      → DeviceManager.ScanDevices()
        → Returns device list
  → Frontend updates useAppStore
    → DeviceGrid re-renders with devices
```

### Device Control
```
User clicks device card
  → App.tsx opens ControlPanel
    → ScreenView displays device screen
    → User taps on screen
      → deviceService.tap(x, y)
        → Backend /api/actions
          → ActionDispatcher executes
            → ADB command sent to device
```

### Real-time Updates
```
Backend detects device status change
  → Broadcasts via WebSocket /ws
    → Frontend websocket.ts receives
      → Updates useAppStore
        → Components auto re-render
```

---

## Dependencies

### Backend (Go)
- `github.com/gin-gonic/gin` - HTTP framework
- `github.com/gorilla/websocket` - WebSocket library

### Frontend (npm)
- `react`, `react-dom` - UI framework
- `electron` - Desktop wrapper
- `zustand` - State management
- `axios` - HTTP client
- `tailwindcss` - CSS framework
- `lucide-react` - Icons
- `vite` - Build tool
- `typescript` - Type safety

---

## Build & Run

### Development
```bash
# Backend
cd backend
go run main.go

# Frontend
cd frontend
npm run dev
```

### Production
```bash
# Backend
cd backend
go build -o backend.exe .

# Frontend
cd frontend
npm run build
npm run electron:build
```

---

## Current Status

✅ **Complete:**
- Frontend UI (all components)
- Backend HTTP server
- API endpoints (basic)
- WebSocket hub (structure)
- Mock device data

⏸️ **Pending:**
- ADB device integration
- Screen streaming
- Touch event execution
- Database persistence (SQLite + GCC required)
- WebSocket full implementation

---

## Next Steps

1. Implement ADB wrapper (`backend/adb/adb.go`)
2. Add screen capture streaming
3. Complete action execution
4. Add WebSocket bidirectional communication
5. Enable SQLite database (after installing GCC)
