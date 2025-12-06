# MONANDROID PROJECT RULES

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
    - **Ctrl+A:** Select All cards (disabled if device is expanded)
    - **Right-click:** Go Back action (no touch)
    - **Click/Touch on Card:** Instant selection (on mousedown/touchstart)
    - **Click/Touch on Screen:** No selection (pass-through to device)
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