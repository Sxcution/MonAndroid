# Backend Build Instructions

## Prerequisites
- Go 1.21+ (download from https://go.dev/dl/)
- ADB (Android Debug Bridge)

## Setup

1. **Install Go**:
   - Download installer from https://go.dev/dl/
   - Run the `.msi` installer
   - Verify installation: `go version`

2. **Install Dependencies**:
   ```bash
   cd backend
   go mod tidy
   ```

3. **Build**:
   ```bash
   go build -o backend.exe .
   ```

4. **Run**:
   ```bash
   go run main.go
   ```

## Development

The backend will:
- Start HTTP server on port 8080
- Start WebSocket server on port 8081
- Create SQLite database in `./data/`
- Scan for connected Android devices via ADB

## Next Steps (After Go Installation)

1. Complete ADB wrapper implementation (`adb/`)
2. Implement device management logic (`service/device_manager.go`)
3. Implement action dispatching (`service/action_dispatcher.go`)
4. Add screen streaming (`service/streaming.go`)
5. Complete API handlers (`api/handlers.go`)
6. Add comprehensive error handling and logging
