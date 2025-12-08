# GEMINI AGENT RULES - MON VIEWPHONE (ANDROID CONTROL)

## I. DEBUGGING PROTOCOL
1. **Interactive Debug (UI, WebSocket, Streaming):**
   - **Action:** Add console.log in React, log.Printf in Go.
   - **Execution:** Instruct user to run in IDE Terminal.
   - **Constraint:** Do NOT ask user to open external cmd.exe unless unavoidable.

2. **Logic/Automated Debug:**
   - **Action:** Create test scripts (e.g., `test_adb.go`, `test_stream.ts`).
   - **Execution:** Auto-run and analyze output yourself.

## II. WORKFLOW & VERIFICATION
3. **Post-Implementation Verification:**
   - **Action:** After ANY code modification, verify syntax (`go build`, `npm run build`).
   - **Constraint:** NEVER ask user to run if you haven't verified it first.

## III. CODING STANDARDS
4. **Naming & Commenting Standards:**
   - **Code Identifiers:** MUST use English, descriptive names.
   - **Comments:** Bilingual or Vietnamese for UI elements.
   - **Consistency:** camelCase for JS/TS, PascalCase for Go exports, snake_case for Go internal.

5. **Naming Registry Protocol:**
   - **Mandatory File:** `naming_registry.json` at project root.
   - **Workflow:** READ first, UPDATE when adding new features.

## IV. ARCHITECTURE & FILE MANAGEMENT
6. **Project Structure Protocol:**
   - **Mandatory File:** `project_structure.md` at project root.
   - **Workflow:** Update when creating/deleting files.

## V. PROJECT STRUCTURE
```
frontend/
└── src/
    ├── components/  # React components
    ├── services/    # API/device services
    ├── store/       # Zustand state
    └── utils/       # Helpers
backend/
├── adb/             # ADB client with WiFi deduplication
├── service/         # Streaming, scrcpy, control
└── models/          # Device models
```

## VI. UI & STYLING PROTOCOL (REACT + TAILWIND)
7. **Centralized Styling:**
   - Use TailwindCSS classes, avoid inline styles
   - Global styles in `index.css`

8. **Input Field Standards:**
   - **No Spinners:** Hide via CSS

9. **Dialog Standards:**
   - Use custom modals (no browser `alert()`, `confirm()`, `prompt()`)

## VII. UI INTERACTION STANDARDS
10. **Mouse Interaction on DeviceCard:**
    - **Left-click on screen:** Touch/swipe on device screen
    - **Ctrl+Click anywhere:** Toggle card selection (multi-select)
    - **Right-click on screen:** Android Back button
    - **Alt+Right-click:** Open context menu (Thêm thẻ, Đổi slot, etc.)
    - **Ctrl+A:** Select All cards (disabled if device is expanded)

11. **Sidebar Slot Buttons:**
    - **Left-click:** Toggle device selection
    - **Right-click:** Open context menu

12. **Selection Visual:**
    - **Hover:** Light blue border (`hover:border-blue-400/60`)
    - **Selected:** Blue border + shadow, no checkmarks
    - **Drag highlight:** Real-time blue border during drag

## VIII. STREAMING PROTOCOL
13. **scrcpy 3.x Protocol:**
    - `scid`: 31-bit HEX (must be < 0x80000000)
    - `raw_stream=true`: Pure H.264 Annex-B
    - `control=true`: Enable keyboard/clipboard socket

14. **WiFi Device Optimization:**
    - Auto-detect WiFi by checking for ":" in device ID
    - USB: 1.5Mbps, 720p
    - WiFi: 800Kbps, 480p

15. **Device Deduplication:**
    - Same device via USB+WiFi: prefer WiFi, hide USB
    - Based on hardware serial (`ro.serialno`)

16. **H.264 Handling:**
    - Parse NAL units with 0x00000001 start codes
    - Cache SPS/PPS for decoder configuration
    - Use WebCodecs VideoDecoder

## IX. ERROR LOGGING
17. **Stream EOF Handling:**
    - `io.EOF`: Log "Stream closed by remote device"
    - Connection reset: Auto-retry after 200ms
    - Other errors: Log and stop stream

## X. WEBSOCKET HUB PATTERNS
18. **Race-Safe Client Management:**
    - Use `atomic.Bool closed` flag instead of `close(channel)` to prevent panic
    - Use `trySend()` method with drop-oldest policy for non-blocking sends
    - Bundle SPS+PPS+IDR into single packet via `bundleNALsWithPrefix()`
    - Check `closed.Load()` before sending to prevent send-on-closed

19. **Message Detection:**
    - Use `firstNonSpace()` + `isJSONPayload()` for robust binary/JSON detection
    - Do NOT rely on first byte alone (may have whitespace)

## XI. AI REVIEW PACKAGING
20. **Automatic Packaging:**
    - **Trigger:** "đóng gói file .zip"
    - **Output:** `AI_Review/AIreview_HH-MM-DD.zip`
    - **Include:** .go, .tsx, .ts, .json, .md files
    - **Exclude:** node_modules, .git, dist, binary files

## XII. RULE COMMAND PROTOCOL
21. **Rule Trigger Command:**
    - **Trigger:** When user says "Rule", "/Rule", or "đọc Rule"
    - **Immediate Action:** 
      1. READ and ACKNOWLEDGE this `Rule.md` file
      2. READ `project_structure.md` to understand current architecture
      3. READ `naming_registry.json` to load existing variable names
    - **Compliance:** STRICTLY follow all rules for the entire session

22. **Post-Coding Documentation Update:**
    - **Trigger:** After completing ANY coding task that adds new features/elements
    - **Mandatory Updates:**
      1. `project_structure.md`: Add new files, update descriptions
      2. `naming_registry.json`: Add new IDs, button names, variables
    - **Goal:** Keep documentation in sync with codebase