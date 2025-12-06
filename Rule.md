# MONANDROID PROJECT RULES

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

## VI. UI & STYLING PROTOCOL

8. **Centralized Styling:**
   - Use TailwindCSS classes, avoid inline styles
   - Global styles in `index.css`

9. **Input Field Standards:**
   - **No Spinners:** Hide via CSS

10. **Dialog Standards:**
    - Use custom modals (no browser `alert()`, `confirm()`, `prompt()`)

## VII. UI INTERACTION STANDARDS

11. **Mouse Interaction on DeviceCard:**
    - **Left-click on screen:** Touch/swipe on device screen
    - **Ctrl+Click anywhere:** Toggle card selection (multi-select)
    - **Right-click on screen:** Android Back button
    - **Alt+Right-click:** Open context menu (Thêm thẻ, Đổi slot, etc.)
    - **Ctrl+A:** Select All cards (disabled if device is expanded)

12. **Sidebar Slot Buttons:**
    - **Left-click:** Toggle device selection
    - **Right-click:** Open context menu (same as Alt+right-click on card)

13. **Selection Visual:**
    - **Hover:** Light blue border (`hover:border-blue-400/60`)
    - **Selected:** Blue border + shadow, no checkmarks
    - **Drag highlight:** Real-time blue border during drag

## VIII. STREAMING PROTOCOL

14. **scrcpy 3.x Protocol:**
    - `scid`: 31-bit HEX (must be < 0x80000000)
    - `raw_stream=true`: Pure H.264 Annex-B
    - `control=true`: Enable keyboard/clipboard socket

15. **WiFi Device Optimization:**
    - Auto-detect WiFi by checking for ":" in device ID
    - USB: 1.5Mbps, 720p
    - WiFi: 800Kbps, 480p (reduced to prevent encoder crash)

16. **Device Deduplication:**
    - Same device connected via USB+WiFi: prefer WiFi, hide USB
    - Based on hardware serial (`ro.serialno`)

17. **H.264 Handling:**
    - Parse NAL units with 0x00000001 start codes
    - Cache SPS/PPS for decoder configuration
    - Use WebCodecs VideoDecoder

## IX. ERROR LOGGING

18. **Stream EOF Handling:**
    - `io.EOF`: Log "Stream closed by remote device" - check WiFi/encoder
    - Connection reset: Auto-retry after 200ms
    - Other errors: Log and stop stream

## X. AI REVIEW PACKAGING

19. **Automatic Packaging:**
    - **Trigger:** When user requests "đóng gói file .zip"
    - **Output:** `AI_Review/AIreview_HH-MM-DD.zip`
    - **Include:** .go, .tsx, .ts, .json, .md files
    - **Exclude:** node_modules, .git, dist, binary files