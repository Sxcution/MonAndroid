Bạn là Senior Full-Stack Developer + Solution Architect. Nhiệm vụ: thiết kế và implement MVP (Minimum Viable Product) của phần mềm điều khiển nhiều điện thoại Android từ Windows, tương tự Xiaowei / Total Control.

Mục tiêu:

✅ Mượt, realtime, latency thấp (<20ms)

✅ Hỗ trợ 10–20+ devices cùng lúc

✅ UX đẹp, responsive

✅ Code clean, modular, dễ mở rộng

II. STACK CÔNG NGHỆ (CHỐT CỨU)
Backend
Ngôn ngữ: Go 1.21+

Framework HTTP: Gin (high-performance)

WebSocket: Gorilla WebSocket (realtime)

Database: SQLite (config, logs)

ADB: adb CLI via os/exec

Concurrency: Goroutines + channels

Frontend
Runtime: Electron (Chromium wrapper)

UI Framework: React 18 + TypeScript

Styling: Tailwind CSS + shadcn/ui

State: Zustand (lightweight)

Real-time: socket.io-client (WebSocket)

Build: Vite

III. KIẾN TRÚC TỔNG THỂ
text
┌─────────────────────────────────────────┐
│     WINDOWS USER MACHINE                 │
├─────────────────────────────────────────┤
│                                          │
│  ┌────────────────────────────────────┐ │
│  │  Electron App (React UI)           │ │
│  │  - Device Grid View                │ │
│  │  - Control Panel                   │ │
│  │  - Batch Actions                   │ │
│  └────────┬─────────────────────────┘ │
│           │ WebSocket + HTTP           │
│           ↓                            │
│  ┌────────────────────────────────────┐ │
│  │  Go Backend (Port 8080 + 8081)    │ │
│  │  - Device Manager                  │ │
│  │  - Action Dispatcher               │ │
│  │  - ADB Command Executor            │ │
│  │  - Streaming Server                │ │
│  │  - SQLite Storage                  │ │
│  └────────┬─────────────────────────┘ │
│           │ USB/Network               │
│           ↓                            │
└─────────────────────────────────────────┘
      │         │         │
    USB       USB       USB
      │         │         │
 [Phone1]  [Phone2]  [PhoneN]
IV. BACKEND KIẾN TRÚC (Go)
Cấu trúc thư mục
text
backend/
├── main.go
├── go.mod
├── config/
│   ├── config.go
│   └── database.go
├── adb/
│   ├── adb.go
│   ├── device.go
│   └── command.go
├── service/
│   ├── device_manager.go
│   ├── action_dispatcher.go
│   ├── streaming.go
│   └── storage.go
├── api/
│   ├── routes.go
│   ├── handlers.go
│   ├── websocket.go
│   └── middleware.go
├── models/
│   ├── device.go
│   ├── action.go
│   └── response.go
├── utils/
│   ├── logger.go
│   └── helpers.go
└── scripts/
    └── migrations.sql
Core Components
adb/adb.go – ADB Wrapper

go
package adb

type ADBClient struct {
    AdbPath string
    Devices map[string]*Device
}

// Implement:
func (c *ADBClient) ListDevices() ([]string, error)
func (c *ADBClient) ExecuteCommand(deviceID, cmd string) (string, error)
func (c *ADBClient) ScreenCapture(deviceID) ([]byte, error)
func (c *ADBClient) SendTap(deviceID string, x, y int) error
func (c *ADBClient) SendSwipe(deviceID string, x1, y1, x2, y2 int) error
func (c *ADBClient) SendText(deviceID, text string) error
func (c *ADBClient) SendKey(deviceID string, keycode int) error
func (c *ADBClient) InstallAPK(deviceID, apkPath string) error
func (c *ADBClient) PushFile(deviceID, local, remote string) error
service/device_manager.go – Device Manager

go
package service

type DeviceManager struct {
    devices   map[string]*Device
    mu        sync.RWMutex
    adbClient *adb.ADBClient
    db        *sql.DB
}

// Implement:
func (m *DeviceManager) ScanDevices() error
func (m *DeviceManager) GetDevice(id string) *Device
func (m *DeviceManager) GetAllDevices() []*Device
func (m *DeviceManager) AddDevice(device *Device) error
func (m *DeviceManager) RemoveDevice(id string) error
func (m *DeviceManager) UpdateDeviceStatus(id, status string) error
func (m *DeviceManager) Reconnect(id string) error
service/action_dispatcher.go – Action Router

go
package service

type ActionDispatcher struct {
    deviceManager *DeviceManager
    actionQueue   chan *Action
}

// Implement:
func (d *ActionDispatcher) DispatchToDevice(deviceID string, action *Action) error
func (d *ActionDispatcher) DispatchToGroup(groupID string, action *Action) error
func (d *ActionDispatcher) ReplayOnDevices(masterID string, slaveIDs []string) error
func (d *ActionDispatcher) ProcessActionQueue()
api/websocket.go – WebSocket Hub

go
package api

type WebSocketHub struct {
    clients    map[*Client]bool
    broadcast  chan interface{}
    register   chan *Client
    unregister chan *Client
}

// Implement:
func (h *WebSocketHub) Run()
func (h *WebSocketHub) BroadcastDeviceStatus(status interface{})
func (h *WebSocketHub) BroadcastScreenFrame(deviceID string, frame []byte)
func (c *Client) ReadMessages()
func (c *Client) WriteMessages()
models/action.go – Action Model

go
package models

type Action struct {
    ID        string                 `json:"id"`
    DeviceID  string                 `json:"device_id"`
    Type      string                 `json:"type"`  // tap, swipe, input, open_app
    Params    map[string]interface{} `json:"params"`
    Timestamp int64                  `json:"timestamp"`
    Status    string                 `json:"status"`  // pending, executing, done
    Result    string                 `json:"result"`
}

type Device struct {
    ID           string `json:"id"`
    Name         string `json:"name"`
    ADBDeviceID  string `json:"adb_device_id"`
    Status       string `json:"status"`  // online, offline
    Resolution   string `json:"resolution"`
    Battery      int    `json:"battery"`
    AndroidVer   string `json:"android_version"`
    LastSeen     int64  `json:"last_seen"`
}
API Endpoints
REST:

text
GET    /api/devices              # List all
GET    /api/devices/:id          # Get detail
POST   /api/devices/:id/scan     # Scan device
DELETE /api/devices/:id          # Remove

POST   /api/actions              # Execute action
POST   /api/actions/batch        # Batch execute
GET    /api/actions/:id          # Get status

GET    /api/profiles             # List profiles
POST   /api/profiles             # Create
DELETE /api/profiles/:id         # Delete
WebSocket Messages:

json
// Client → Server
{
  "type": "action",
  "device_id": "device_123",
  "action": {
    "type": "tap",
    "params": {"x": 100, "y": 200}
  }
}

// Server → Client (Device Status)
{
  "type": "device_status",
  "device_id": "device_123",
  "status": "online"
}

// Server → Client (Screen Frame)
{
  "type": "screen_frame",
  "device_id": "device_123",
  "frame_data": "base64_encoded"
}

// Server → Client (Action Result)
{
  "type": "action_result",
  "action_id": "action_123",
  "status": "done"
}
V. FRONTEND KIẾN TRÚC (Electron + React)
Cấu trúc thư mục
text
frontend/
├── electron/
│   ├── main.ts
│   ├── preload.ts
│   └── builder-config.json
├── src/
│   ├── main.tsx
│   ├── App.tsx
│   ├── components/
│   │   ├── DeviceGrid.tsx
│   │   ├── DeviceCard.tsx
│   │   ├── ControlPanel.tsx
│   │   ├── ActionBar.tsx
│   │   └── ScreenView.tsx
│   ├── pages/
│   │   ├── Dashboard.tsx
│   │   └── Devices.tsx
│   ├── services/
│   │   ├── api.ts
│   │   ├── websocket.ts
│   │   └── deviceService.ts
│   ├── store/
│   │   └── useAppStore.ts
│   ├── types/
│   │   ├── device.ts
│   │   ├── action.ts
│   │   └── api.ts
│   └── utils/
│       ├── constants.ts
│       └── helpers.ts
├── package.json
├── vite.config.ts
└── tsconfig.json
Key Components
electron/main.ts – Electron Main

typescript
import { app, BrowserWindow } from 'electron';
import { spawn } from 'child_process';

let backendProcess;
let mainWindow;

app.on('ready', () => {
  // Spawn Go backend
  backendProcess = spawn('./backend/backend.exe');
  
  // Create window
  mainWindow = new BrowserWindow({
    width: 1400,
    height: 900,
    webPreferences: {
      preload: './preload.ts'
    }
  });
  
  mainWindow.loadURL('http://localhost:5173');
});
src/store/useAppStore.ts – Global State (Zustand)

typescript
import { create } from 'zustand';

interface AppStore {
  devices: Device[];
  selectedDevices: string[];
  selectedDeviceDetail: Device | null;
  
  setDevices: (devices: Device[]) => void;
  toggleDeviceSelection: (id: string) => void;
  selectDevice: (id: string) => void;
  onDeviceStatusChange: (id: string, status: string) => void;
  onScreenFrameUpdate: (id: string, frame: string) => void;
}

export const useAppStore = create<AppStore>((set) => ({
  devices: [],
  selectedDevices: [],
  selectedDeviceDetail: null,
  
  setDevices: (devices) => set({ devices }),
  toggleDeviceSelection: (id) => set((state) => ({
    selectedDevices: state.selectedDevices.includes(id)
      ? state.selectedDevices.filter(d => d !== id)
      : [...state.selectedDevices, id]
  })),
  selectDevice: (id) => set((state) => ({
    selectedDeviceDetail: state.devices.find(d => d.id === id)
  })),
  onDeviceStatusChange: (id, status) => set((state) => ({
    devices: state.devices.map(d => 
      d.id === id ? { ...d, status } : d
    )
  })),
  onScreenFrameUpdate: (id, frame) => set((state) => ({
    devices: state.devices.map(d => 
      d.id === id ? { ...d, frame } : d
    )
  }))
}));
src/components/DeviceGrid.tsx – Grid View

typescript
import React, { useEffect } from 'react';
import { useAppStore } from '../store/useAppStore';
import { useWebSocket } from '../services/websocket';
import DeviceCard from './DeviceCard';

export const DeviceGrid: React.FC = () => {
  const { devices, toggleDeviceSelection } = useAppStore();
  const ws = useWebSocket();
  
  useEffect(() => {
    if (ws) {
      // Listen to WebSocket updates
    }
  }, [ws]);
  
  return (
    <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 xl:grid-cols-4 gap-4 p-4">
      {devices.map(device => (
        <DeviceCard
          key={device.id}
          device={device}
          onSelect={() => toggleDeviceSelection(device.id)}
        />
      ))}
    </div>
  );
};
src/services/websocket.ts – WebSocket Hook

typescript
import { useEffect, useRef } from 'react';
import { useAppStore } from '../store/useAppStore';

export const useWebSocket = () => {
  const wsRef = useRef<WebSocket | null>(null);
  const store = useAppStore();
  
  useEffect(() => {
    wsRef.current = new WebSocket('ws://localhost:8081/ws');
    
    wsRef.current.onmessage = (event) => {
      const message = JSON.parse(event.data);
      
      switch (message.type) {
        case 'device_status':
          store.onDeviceStatusChange(message.device_id, message.status);
          break;
        case 'screen_frame':
          store.onScreenFrameUpdate(message.device_id, message.frame_data);
          break;
      }
    };
    
    return () => wsRef.current?.close();
  }, []);
  
  return wsRef.current;
};
src/components/ControlPanel.tsx – Device Control

typescript
import React from 'react';
import { Device } from '../types/device';
import { api } from '../services/api';
import ScreenView from './ScreenView';
import ActionBar from './ActionBar';

export const ControlPanel: React.FC<{ device: Device }> = ({ device }) => {
  const handleTap = (x: number, y: number) => {
    api.executeAction(device.id, {
      type: 'tap',
      params: { x, y }
    });
  };
  
  const handleInput = (text: string) => {
    api.executeAction(device.id, {
      type: 'input',
      params: { text }
    });
  };
  
  const handleOpenApp = (packageName: string) => {
    api.executeAction(device.id, {
      type: 'open_app',
      params: { package: packageName }
    });
  };
  
  return (
    <div className="control-panel">
      <ScreenView device={device} onTap={handleTap} />
      <ActionBar onInput={handleInput} onOpenApp={handleOpenApp} />
    </div>
  );
};
VI. CHỨC NĂNG MVP (Phân cấp)
Cấp 1: Phải có
✅ Scan & list devices

✅ Live screen mirror (30 FPS)

✅ Single device control (tap, swipe, input, keys)

✅ Batch operations (multi-select, batch tap, batch input)

✅ Sync mode (Follow Master)

✅ Real-time status updates

✅ Device grouping

Cấp 2: Nên có
✅ Device profiles (save configurations)

✅ Basic macros (record/replay actions)

✅ Action logs

✅ Settings panel

✅ Device renaming

Cấp 3: Nice to have
⭐ Advanced macro editor

⭐ Performance metrics

⭐ Scheduled tasks

⭐ Export/import profiles

VII. DATABASE SCHEMA (SQLite)
sql
CREATE TABLE devices (
  id TEXT PRIMARY KEY,
  name TEXT NOT NULL,
  device_id TEXT UNIQUE,
  status TEXT,
  resolution TEXT,
  android_version TEXT,
  created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP
);

CREATE TABLE device_groups (
  id TEXT PRIMARY KEY,
  name TEXT NOT NULL,
  description TEXT,
  created_at TIMESTAMP
);

CREATE TABLE group_devices (
  group_id TEXT,
  device_id TEXT,
  PRIMARY KEY (group_id, device_id),
  FOREIGN KEY (group_id) REFERENCES device_groups(id),
  FOREIGN KEY (device_id) REFERENCES devices(id)
);

CREATE TABLE action_logs (
  id TEXT PRIMARY KEY,
  device_id TEXT,
  action_type TEXT,
  params TEXT,
  status TEXT,
  result TEXT,
  created_at TIMESTAMP,
  FOREIGN KEY (device_id) REFERENCES devices(id)
);

CREATE TABLE profiles (
  id TEXT PRIMARY KEY,
  name TEXT NOT NULL,
  config TEXT,
  devices_included TEXT,
  created_at TIMESTAMP
);

CREATE TABLE macros (
  id TEXT PRIMARY KEY,
  name TEXT NOT NULL,
  description TEXT,
  actions TEXT,
  created_at TIMESTAMP
);
VIII. PHƯƠNG PHÁP TRIỂN KHAI (13 ngày)
Phase 1: Backend Skeleton (2 days)
Setup Go project + modules

Implement ADB wrapper

Setup SQLite + schema

Setup HTTP server (Gin)

Setup WebSocket hub

Deploy models

Phase 2: Backend Services (3 days)
Device Manager (scan, connect)

Action Dispatcher (single + batch)

Streaming Server (screen capture)

Sync Mode logic (Follow Master)

Macro execution

Logging + error handling

Phase 3: Frontend Setup (1 day)
Electron + React + TypeScript

Zustand store

WebSocket client

HTTP API client

Tailwind + shadcn/ui

Phase 4: Frontend UI Components (3 days)
DeviceGrid (responsive layout)

DeviceCard

ScreenView

ControlPanel

ActionBar

Sidebar

Phase 5: Frontend Services (2 days)
WebSocket integration

API service

Device service

Real-time state sync

Error handling

Phase 6: Integration & Polish (2 days)
Electron main process

Backend spawn logic

Build & package

Performance optimization

Testing

UI polish

IX. DEPENDENCIES
Go
go
require (
  github.com/gin-gonic/gin v1.9.0
  github.com/gorilla/websocket v1.5.0
  github.com/mattn/go-sqlite3 v1.14.16
  github.com/sirupsen/logrus v1.9.3
)
npm
json
{
  "dependencies": {
    "react": "^18.2.0",
    "react-dom": "^18.2.0",
    "zustand": "^4.4.0",
    "socket.io-client": "^4.7.0",
    "axios": "^1.6.0",
    "tailwindcss": "^3.3.0"
  },
  "devDependencies": {
    "typescript": "^5.2.0",
    "vite": "^4.5.0",
    "electron": "^26.0.0",
    "electron-builder": "^24.6.0"
  }
}
X. BUILD & RUN
Backend
bash
cd backend
go mod tidy
go build -o ./dist/backend.exe .

# Run
go run main.go
# Server: http://localhost:8080
# WebSocket: ws://localhost:8081
Frontend
bash
cd frontend
npm install
npm run dev

# Build
npm run build
npm run electron-builder
XI. TIPS FOR CURSOR
✅ Code nên:

Modular, independent services

Verbose logging

Graceful error handling

Clean code, no globals

Type-safe (TypeScript, structs)

Performance-focused (profile early)

✅ Ưu tiên:

Core functionality first (device scan, control)

WebSocket realtime second

UI polish last

✅ Thực hành tốt:

Go: CamelCase export, snake_case internal

React: Feature-driven structure

Commit: Descriptive messages

Test: Manual on real devices

---

# 📊 IMPLEMENTATION STATUS (Updated)

## ✅ COMPLETED

### Core Features
- [x] **Multi-Device Streaming:** 22+ devices support.
- [x] **Stable H.264 Decoding:** WebCodecs Annex B mode, Auto-level patching.
- [x] **Grid View:** No cross-talk/glitching (ID-based filtering).
- [x] **Performance:** Optimized Bitrate & Resolution, Singleton WebSocket.

### Backend
- [x] **ADB Wrapper:** Robust parsing, "Override size" support.
- [x] **Process Management:** Idempotent Start/Stop (No 500 errors).
- [x] **Protocol:** Custom Binary Protocol with Device ID header.
- [x] **Streaming Service:** H.264 buffer strategy, SPS/PPS caching.
- [x] **WebSocket Hub:** Device-specific broadcasting, no "all" subscription.

### Frontend
- [x] **Architecture:** Service-based WebSocket (Singleton).
- [x] **UI:** Responsive Grid, Control Panel, Action Bar.
- [x] **Decoder:** WebCodecs Annex B mode, Auto codec detection.
- [x] **Filtering:** Device ID-based message filtering.
- [x] **Recovery:** Auto decoder reset on errors.

### Phase 3: Frontend Setup (100%)
- [x] Electron + React 18 + TypeScript
- [x] Vite build configuration
- [x] Zustand state management
- [x] WebSocket Singleton Service
- [x] HTTP API client (axios)
- [x] Tailwind CSS + custom theme

### Phase 4: Frontend UI Components (100%)
- [x] DeviceCard - Device thumbnail với live preview
- [x] DeviceGrid - Responsive grid layout (22+ devices)
- [x] ScreenView - Canvas screen mirroring (Annex B mode)
- [x] ControlPanel - Modal device control
- [x] ActionBar - Quick actions (Back, Home, Volume, Input)
- [x] App - Main component với header, toolbar

### Phase 5: Frontend Services (100%)
- [x] API service - REST endpoints với axios
- [x] WebSocket Singleton - One connection for entire app
- [x] Device service - High-level control methods

### Phase 1 & 2: Backend Services (100%)
- [x] ADB wrapper - Device scanning, command execution
- [x] Device Manager - Real-time device status
- [x] Action Dispatcher - Touch, Key, Text input
- [x] Streaming Service - H.264 hardware encoding
- [x] WebSocket Hub - Binary message broadcasting

## 📁 PROJECT FILES

**Created**: 38 files
- Backend: 13 files (Go)
- Frontend: 25 files (React/TypeScript)

**Documentation**:
- `README.md` - Setup instructions
- `Work.md` - This file (specification + status)
- `naming_registry.json` - Naming conventions
- `project_structure.md` - Architecture documentation

## 🚀 HOW TO RUN

### Development Mode
```powershell
# Terminal 1 - Backend (with Air hot reload)
cd backend
air
# Or: go run main.go

# Terminal 2 - Frontend  
cd frontend
npm run dev

# Open browser: http://localhost:5173
```

### Production Build
```powershell
# Backend
cd backend
go build -o backend.exe .

# Frontend
cd frontend
npm run build
npm run electron:build
```

### Current Features Available for Testing
- Original Spec: Lines 1-693 (above)