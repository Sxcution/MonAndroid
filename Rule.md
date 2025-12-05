# MONANDROID PROJECT RULES

Đọc và tuân thủ đúng quy tắc rule và cập nhật `naming_registry.json`, `project_structure.md` nếu cần (Sau khi sửa đổi code mới hoặc thêm chức năng mới).

## I. TECHNOLOGY STACK
- **Backend**: Go 1.21+ with Gin framework
- **Frontend**: React 18 + TypeScript + Vite + TailwindCSS
- **Streaming**: scrcpy 3.x server, H.264 Annex-B, WebCodecs API
- **State**: Zustand for React, Go channels for backend

## II. DEBUGGING PROTOCOL

1. **Backend Debug (Go):**
   - **Action:** Add `log.Printf()` calls directly into source code (e.g., `main.go`, `streaming.go`)
   - **Execution:** Restart server `./server.exe` and watch logs
   - **Constraint:** Do NOT ask user to open separate terminals unless unavoidable

2. **Frontend Debug (React):**
   - **Action:** Use `console.log()` in components, check browser DevTools
   - **Execution:** Vite auto-reloads on save
   - **Constraint:** Do NOT burden user with manual execution

3. **Stream Debug (H.264):**
   - Check NAL types: SPS=7, PPS=8, IDR=5, Slice=1
   - Verify WebSocket binary frames are received

## III. WORKFLOW & VERIFICATION

4. **Post-Implementation Verification:**
   - **Go:** Run `go build -o server.exe .` after changes to check syntax
   - **React:** Vite shows compile errors immediately
   - **Constraint:** NEVER ask user to run if build fails. Fix silently first

## IV. CODING STANDARDS

5. **Naming & Commenting:**
   - **Go:** snake_case for files, PascalCase for exported identifiers
   - **React:** PascalCase for components, camelCase for functions/variables
   - **IDs:** Use descriptive names (e.g., `device-card`, `btn-scan`)
   - **Comments:** English in code, Vietnamese ok for UI descriptions

6. **Naming Registry Protocol:**
   - **File:** `naming_registry.json` at project root
   - **Workflow:**
     1. READ before writing any code
     2. UPDATE when adding new features/variables
   - **Goal:** Consistency across AI sessions. No duplicate variables

## V. ARCHITECTURE

7. **Project Structure:**
   - **File:** `project_structure.md` at project root
   - **Workflow:**
     - **New File:** Add to list immediately
     - **Delete File:** Remove from list
   - **Goal:** Prevent orphan files, instant AI context

### Backend Structure
```
backend/
├── api/         # HTTP/WS handlers
├── service/     # Business logic (streaming, scrcpy)
├── assets/      # scrcpy-server binary
├── adb/         # ADB wrapper
└── main.go
```

### Frontend Structure
```
frontend/src/
├── components/  # React components (DeviceCard, ScreenView, etc.)
├── services/    # API/WS services
├── store/       # Zustand stores (useAppStore, useSettingsStore)
├── types/       # TypeScript interfaces
└── utils/       # Helpers
```

## VI. UI & STYLING PROTOCOL

8. **Centralized Styling:**
   - Use TailwindCSS classes, avoid inline styles
   - Global styles in `index.css`

9. **Input Field Standards:**
   - **No Spinners:** Hide via CSS:
     ```css
     input[type=number]::-webkit-inner-spin-button { -webkit-appearance: none; }
     ```

10. **Dialog Standards:**
    - Use custom modals (no browser `alert()`, `confirm()`, `prompt()`)
    - Use TailwindCSS for modal styling

## VII. UI INTERACTION STANDARDS

11. **Mouse Interaction:**
    - **Left-click:** Touch/swipe on device screen
    - **Ctrl+Click:** Multi-select cards (toggle selection)
    - **Right-click:** Go Back action (no touch)
    - **Drag on empty area:** Select multiple cards with box

12. **Selection Visual:**
    - **Hover:** Light blue border (`hover:border-blue-400/60`)
    - **Selected:** Blue border + shadow, no checkmarks
    - **Drag highlight:** Real-time blue border during drag

## VIII. STREAMING PROTOCOL

13. **scrcpy 3.x Protocol:**
    - `scid`: 31-bit HEX (must be < 0x80000000)
    - `raw_stream=true`: Pure H.264 Annex-B
    - `control=true`: Enable keyboard/clipboard socket

14. **H.264 Handling:**
    - Parse NAL units with 0x00000001 start codes
    - Cache SPS/PPS for decoder configuration
    - Use WebCodecs VideoDecoder

## IX. AI REVIEW PACKAGING

15. **Automatic Packaging:**
    - **Trigger:** When user requests "đóng gói file .zip"
    - **Output:** `AI_Review/AIreview_HH-MM-DD.zip`
    - **Include:** .go, .tsx, .ts, .json, .md files
    - **Exclude:** node_modules, .git, dist, binary files