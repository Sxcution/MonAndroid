# MonAndroid - Code Export for AI Analysis

## 📦 File Structure in ZIP

### Backend Files (Go)
- `backend_adb.go` - ADB client wrapper, H.264 streaming setup
- `backend_service_streaming.go` - Streaming service, NAL unit processing, auto-restart logic
- `backend_api_websocket.go` - WebSocket hub, auto-start stream on subscribe
- `backend_api_routes.go` - HTTP and WebSocket routes
- `backend_main.go` - Server entry point
- `backend_start_server.bat` - Server startup script with bitrate config

### Frontend Files (TypeScript/React)
- `frontend_ScreenView.tsx` - Video decoder component (WebCodecs, Annex B mode)
- `frontend_DeviceCard.tsx` - Device card with draggable magnifier button
- `frontend_ExpandedDeviceView.tsx` - Floating window for expanded device view
- `frontend_App.tsx` - Main app component with auto-scan
- `frontend_websocket.ts` - WebSocket singleton service
- `frontend_deviceService.ts` - Device control API wrapper

### Documentation
- `project_structure.md` - Project architecture overview
- `DEVELOPMENT_RULES.md` - Coding standards and protocols
- `naming_registry.json` - Centralized naming conventions
- `Work.md` - Project status and roadmap

## 🔑 Key Features Implemented

1. **H.264 Streaming**: Real-time video streaming via ADB screenrecord
2. **WebSocket Singleton**: Single persistent connection for all devices
3. **Auto-Start Stream**: Backend starts stream automatically on WebSocket subscribe
4. **Auto-Restart**: Stream automatically restarts when interrupted
5. **Delta Frame Filtering**: Skips delta frames until first keyframe received
6. **Fire-and-Forget Actions**: Tap/Swipe actions don't wait for API response
7. **Stream Persistence**: Streams run in background, no HTTP stop requests

## ⚙️ Configuration

- **Bitrate**: 1Mbps (1000000) - optimized for 20+ devices
- **Size**: 600x1024 - reduced for grid view performance
- **Time Limit**: 0 (unlimited) - for Android 10+

## 🐛 Known Issues / Areas to Fix

- Decoder may crash on InvalidStateError (needs better error handling)
- Stream restart may be too aggressive (500ms delay may need adjustment)
- Grid view performance with 20+ devices may need further optimization

