# MonAndroid Development Rules

## Project Overview
MonAndroid is a multi-device Android control system built with Go (backend) and React/Electron (frontend). This document defines the development standards and protocols that MUST be followed.

---

## I. PROJECT STRUCTURE PROTOCOL

### 1. **Mandatory Documentation Files**
Every session MUST start by reading these files:
- `naming_registry.json` - All identifiers and naming conventions
- `project_structure.md` - File relationships and data flow
- `Work.md` - Original specification + implementation status

### 2. **Update Protocol**
When adding/modifying ANY code:
1. **Read First**: Check `naming_registry.json` for existing identifiers
2. **Code Second**: Write code using existing naming conventions
3. **Update Files**: 
   - Add new identifiers to `naming_registry.json`
   - Update file list in `project_structure.md`
   - Update progress in `Work.md` (Implementation Status section)

---

## II. NAMING CONVENTIONS

### Backend (Go)
- **Exported**: `PascalCase` (e.g., `DeviceManager`, `ScanDevices`)
- **Unexported**: `camelCase` (e.g., `deviceList`, `parseOutput`)
- **Constants**: `UPPER_SNAKE_CASE` (e.g., `HTTP_PORT`, `WS_PORT`)
- **Files**: `snake_case.go` (e.g., `device_manager.go`)

### Frontend (TypeScript/React)
- **Components**: `PascalCase` (e.g., `DeviceCard`, `ScreenView`)
- **Functions/Variables**: `camelCase` (e.g., `handleClick`, `deviceList`)
- **Types/Interfaces**: `PascalCase` (e.g., `Device`, `Action`)
- **Files**: 
  - Components: `PascalCase.tsx` (e.g., `DeviceCard.tsx`)
  - Utilities: `camelCase.ts` (e.g., `helpers.ts`)

### CSS/Styling
- **Class Names**: `kebab-case` (e.g., `device-card`, `control-panel`)
- **CSS Variables**: `--kebab-case` (e.g., `--primary`, `--background`)

### General Rules
- ✅ **English ONLY** for code identifiers (variables, functions, types)
- ✅ **Vietnamese allowed** in comments for UI descriptions
- ❌ **NO Vietnamese** in variable names, function names, or type names

---

## III. CODE ORGANIZATION

### Backend Structure
```
backend/
├── main.go              # Entry point, server initialization
├── config/              # Configuration files
├── models/              # Data structures (Device, Action, etc.)
├── service/             # Business logic (DeviceManager, etc.)
├── api/                 # HTTP routes, handlers, WebSocket
├── adb/                 # ADB wrapper (device control)
└── utils/               # Helper functions
```

### Frontend Structure
```
frontend/
├── src/
│   ├── components/      # React UI components
│   ├── services/        # API, WebSocket, device control
│   ├── store/           # Zustand state management
│   ├── types/           # TypeScript interfaces
│   ├── utils/           # Helper functions
│   └── App.tsx          # Main component
└── electron/            # Electron main/preload
```

**Rule**: Each layer ONLY imports from same level or below:
- ✅ `components/` can use `services/`, `store/`, `utils/`
- ❌ `services/` should NOT import `components/`

---

## IV. STYLING PROTOCOL

### 1. **Centralized Styling**
- ALL global styles in `src/index.css`
- Use Tailwind CSS classes for components
- CSS variables for theme (light/dark)
- ❌ NO inline `style={{...}}` unless dynamic values required

### 2. **Theme Consistency**
```css
/* Light theme */
--background: 0 0% 100%;
--foreground: 222.2 84% 4.9%;

/* Dark theme */
--background: 222.2 84% 4.9%;
--foreground: 210 40% 98%;
```

### 3. **Component Styling**
- Use `cn()` helper to merge Tailwind classes
- Prefer Tailwind utilities over custom CSS
- Only create custom CSS for complex animations/layouts

---

## V. API & COMMUNICATION PROTOCOL

### 1. **REST API Endpoints**
Format: `/api/{resource}/{action}`

**Devices**:
- `GET /api/devices` - List all devices
- `POST /api/devices/scan` - Scan for new devices
- `DELETE /api/devices/:id` - Remove device

**Actions**:
- `POST /api/actions` - Execute single action
- `POST /api/actions/batch` - Execute batch action

### 2. **WebSocket Messages**
All messages MUST follow this structure:
```typescript
{
  type: 'device_status' | 'screen_frame' | 'action_result',
  device_id?: string,
  // ... type-specific data
}
```

### 3. **API Response Format**
```go
type APIResponse struct {
    Success bool        `json:"success"`
    Data    interface{} `json:"data,omitempty"`
    Error   string      `json:"error,omitempty"`
}
```

---

## VI. STATE MANAGEMENT (Frontend)

### 1. **Zustand Store**
All global state in `src/store/useAppStore.ts`:
- `devices` - Device list with live data
- `selectedDevices` - Multi-select for batch ops
- `selectedDeviceDetail` - Currently controlled device
- `actions` - Action history
- `isConnected` - WebSocket status

### 2. **Update Pattern**
```typescript
// ✅ Correct - Immutable updates
set((state) => ({
  devices: state.devices.map(d => 
    d.id === id ? { ...d, status } : d
  )
}))

// ❌ Wrong - Direct mutation
set((state) => {
  state.devices[0].status = 'offline'
  return state
})
```

---

## VII. ADB INTEGRATION PROTOCOL

### 1. **ADB Command Execution**
All ADB commands MUST go through `backend/adb/adb.go`:
```go
func ExecuteCommand(deviceID string, cmd string) (string, error) {
    // Use exec.Command("adb", "-s", deviceID, "shell", cmd)
    // Parse output and handle errors
}
```

### 2. **Device Detection**
```go
func ListDevices() ([]Device, error) {
    // Execute: adb devices -l
    // Parse output to get device IDs and properties
}
```

### 3. **Screen Capture**
```go
func CaptureScreen(deviceID string) ([]byte, error) {
    // Execute: adb -s {deviceID} exec-out screencap -p
    // Return raw PNG bytes
}
```

### 4. **Action Execution**
```go
func SendTap(deviceID string, x, y int) error {
    // Execute: adb -s {deviceID} shell input tap {x} {y}
}

func SendSwipe(deviceID string, x1, y1, x2, y2, duration int) error {
    // Execute: adb -s {deviceID} shell input swipe {x1} {y1} {x2} {y2} {duration}
}

func SendText(deviceID string, text string) error {
    // Execute: adb -s {deviceID} shell input text "{text}"
}
```

---

## VIII. ERROR HANDLING

### Backend (Go)
```go
// ✅ Correct - Return errors, don't panic
func ScanDevices() error {
    if err := adb.ListDevices(); err != nil {
        return fmt.Errorf("failed to scan: %w", err)
    }
}

// ❌ Wrong - Don't use panic for normal errors
panic("ADB not found")
```

### Frontend (TypeScript)
```typescript
// ✅ Correct - Try/catch with user feedback
try {
    await api.device.scanDevices()
} catch (error) {
    console.error('Scan failed:', error)
    // Show user notification
}

// ❌ Wrong - Silent failures
await api.device.scanDevices() // No error handling
```

---

## IX. PERFORMANCE TARGETS

### Screen Streaming
- **Target FPS**: 30 FPS
- **Max Latency**: 20ms
- **Method**: 
  1. Capture screen with `adb exec-out screencap -p`
  2. Encode to base64
  3. Send via WebSocket
  4. Throttle to 30 FPS max

### Action Execution
- **Target Latency**: <20ms from UI click to ADB command
- **Queue Size**: 100 actions max
- **Concurrent Devices**: Support 10-20+ devices

---

## X. TESTING PROTOCOL

### 1. **Backend Testing**
Before committing backend changes:
```bash
# Build test
go build -o backend.exe .

# Run test
.\backend.exe
# Verify: Server starts without errors
```

### 2. **Frontend Testing**
Before committing frontend changes:
```bash
# Type check
npm run type-check

# Build test
npm run build

# Run dev server
npm run dev
# Verify: UI loads without errors
```

### 3. **Integration Testing**
With real Android devices:
1. Connect device via USB
2. Enable USB debugging
3. Run `adb devices` to verify
4. Test scan, screen mirror, tap/swipe
5. Monitor latency and FPS

---

## XI. COMMIT PROTOCOL

### Before ANY Commit:
1. ✅ Update `naming_registry.json` if added identifiers
2. ✅ Update `project_structure.md` if added/removed files
3. ✅ Update `Work.md` Implementation Status
4. ✅ Test build (both backend and frontend)
5. ✅ Verify no TypeScript/Go errors

### Commit Message Format:
```
[Component] Brief description

- Detail 1
- Detail 2

Refs: #issue (if applicable)
```

Examples:
- `[Backend] Implement ADB device scanning`
- `[Frontend] Add screen mirroring component`
- `[Docs] Update implementation status`

---

## XII. DATABASE PROTOCOL (When SQLite Enabled)

### 1. **Schema Management**
- Schema in `backend/scripts/migrations.sql`
- Apply migrations on app start
- NO manual schema changes

### 2. **Query Pattern**
```go
// ✅ Use prepared statements
stmt, err := db.Prepare("SELECT * FROM devices WHERE id = ?")
row := stmt.QueryRow(deviceID)

// ❌ Don't concatenate SQL
query := "SELECT * FROM devices WHERE id = '" + deviceID + "'"
```

---

## XIII. DEBUGGING PROTOCOL

### Backend (Go)
- Use `log.Println()` for debugging
- Errors should be returned, not just logged
- Add verbose logging for ADB commands

### Frontend (React)
- Use `console.log()` for debugging
- React DevTools for component inspection
- Network tab for API/WebSocket debugging

### Common Issues:
1. **"Device not found"** → Check `adb devices`
2. **"WebSocket disconnected"** → Check backend is running
3. **"Screen not updating"** → Check FPS throttle logic
4. **"CORS error"** → Check CORS middleware in backend

---

## XIV. SECURITY CONSIDERATIONS

### 1. **ADB Access**
- Only allow ADB commands to USB-connected devices
- Validate all device IDs before executing commands
- Sanitize text input before sending to device

### 2. **WebSocket**
- Enable CORS only for development
- In production: Whitelist allowed origins
- Validate all incoming messages

### 3. **Electron Security**
- ✅ Context isolation enabled (`contextIsolation: true`)
- ✅ Node integration disabled (`nodeIntegration: false`)
- ✅ Preload script for safe IPC

---

## XV. DEPLOYMENT CHECKLIST

### Development Build
- [x] Backend: `go run main.go`
- [x] Frontend: `npm run dev`
- [x] Both running on localhost

### Production Build
- [ ] Backend: `go build -o backend.exe .`
- [ ] Frontend: `npm run build && npm run electron:build`
- [ ] Test built binary
- [ ] Package with electron-builder

---

## XVI. COMMON COMMANDS

### Backend
```bash
# Install dependencies
go mod tidy

# Build
go build -o backend.exe .

# Run
.\backend.exe

# Test specific package
go test ./adb/...
```

### Frontend
```bash
# Install dependencies
npm install

# Dev server
npm run dev

# Type check
npm run type-check

# Build
npm run build

# Electron
npm run electron
```

### ADB
```bash
# List devices
adb devices -l

# Screen capture
adb -s <device_id> exec-out screencap -p > screen.png

# Send tap
adb -s <device_id> shell input tap 100 200

# Send text
adb -s <device_id> shell input text "Hello"
```

---

## XVII. FILE CHANGE TRACKING

### When You Modify Files:
Keep this checklist in mind:

- [ ] Read `naming_registry.json` first
- [ ] Use existing naming conventions
- [ ] Add new identifiers to registry
- [ ] Update `project_structure.md` if new files
- [ ] Update `Work.md` implementation status
- [ ] Test build before committing
- [ ] Write descriptive commit message

---

## CRITICAL RULES SUMMARY

1. ✅ **ALWAYS** read `naming_registry.json` before coding
2. ✅ **ALWAYS** use English for code identifiers
3. ✅ **ALWAYS** update documentation after code changes
4. ✅ **ALWAYS** test build before committing
5. ✅ **NEVER** use Vietnamese in variable/function names
6. ✅ **NEVER** commit without updating status
7. ✅ **NEVER** use inline styles unless dynamic
8. ✅ **NEVER** mix naming conventions

---

## Contact & Support
- Project: MonAndroid
- Type: Desktop Application (Electron + Go)
- Platform: Windows
- Language: TypeScript (Frontend), Go (Backend)
