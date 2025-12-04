# Android Multi-Device Control System

Control multiple Android devices simultaneously from Windows with real-time screen mirroring and batch operations.

## Features

- 🎯 Control 10-20+ devices simultaneously
- 📱 Real-time screen mirroring (30 FPS)
- ⚡ Low latency (<20ms)  
- 🔄 Batch operations (tap, swipe, input)
- 🎮 Sync mode (Follow Master)
- 💾 Device profiles and macros
- 🎨 Modern, responsive UI

## Tech Stack

**Backend:**
- Go 1.21+ (Gin, Gorilla WebSocket, SQLite)
- ADB (Android Debug Bridge)

**Frontend:**
- Electron + React 18 + TypeScript
- Tailwind CSS
- Zustand (state management)

## Installation

### Prerequisites

1. **Go 1.21+**: Download from https://go.dev/dl/
2. **Node.js 18+**: Already installed
3. **ADB**: Already installed

### Setup

1. **Backend Setup:**
```bash
cd backend
go mod tidy
go build -o backend.exe .
```

2. **Frontend Setup:**
```bash
cd frontend
npm install
```

## Development

### Run Backend:
```bash
cd backend
go run main.go
```

### Run Frontend (Dev):
```bash
cd frontend
npm run dev
```

### Run Electron App:
```bash
cd frontend
npm run electron
```

## Build

### Build Backend:
```bash
cd backend
go build -o ./dist/backend.exe .
```

### Build Electron App:
```bash
cd frontend
npm run build
npm run electron:build
```

## Usage

1. Connect Android devices via USB
2. Enable USB debugging on devices
3. Launch the application
4. Click "Scan Devices" to detect connected devices
5. Select devices and perform batch operations or control individually

## API Endpoints

### REST API (Port 8080)
- `GET /api/devices` - List all devices
- `POST /api/actions` - Execute action
- `POST /api/actions/batch` - Batch execute

### WebSocket (Port 8081)
- Real-time device status updates
- Live screen streaming
- Action result notifications

## License

MIT
