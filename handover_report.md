# H.264 Streaming Implementation Handover Report

## Status
- **Goal:** Implement low-latency H.264 streaming from Android devices using `screenrecord` and WebCodecs.
- **Current State:**
  - Backend starts `screenrecord` and receives H.264 stream.
  - Backend broadcasts frames via WebSocket (binary format).
  - Frontend receives frames.
  - **Critical Issue:** Frontend receives SPS (NAL type 7) but **MISSING PPS (NAL type 8)**. Decoder cannot be configured without PPS.

## Identified Bug
The issue is likely in `backend/service/streaming.go`, specifically in the `readNextAnnexBFrame` function.

### The Bug: `bufio.Reader.UnreadByte` Misuse
When the parser detects the start of a new frame (IDR or Non-IDR), it attempts to "unread" the start code so it can be read by the next call.
```go
// IDR (5) or Non-IDR (1) = new frame if we already have NALs
if (nalType == 5 || nalType == 1) && nalCount > 0 {
    // Unread the start code and NAL header for next read
    for i := len(startCode) - 1; i >= 0; i-- {
        br.UnreadByte() // <--- BUG HERE
    }
    br.UnreadByte()
    return frame, nil
}
```
**Problem:** `bufio.Reader.UnreadByte()` only supports unreading **the single most recently read byte**. Calling it multiple times (to unread a 4-byte start code + 1-byte header) will fail or corrupt the buffer.
**Consequence:** The start code of the next frame (e.g., the IDR frame following PPS) is lost. This likely causes the parser to skip the next NAL unit or misinterpret data, leading to missing PPS or corrupted frames.

## Files Included
1.  `backend/service/streaming.go`: Core streaming logic (contains the bug).
2.  `backend/adb/adb.go`: ADB command execution (`exec-out screenrecord`).
3.  `backend/api/websocket.go`: Binary WebSocket implementation.
4.  `frontend/src/components/ScreenView.tsx`: Frontend WebCodecs implementation (includes SPS/PPS extraction logic).
5.  `frontend/src/services/websocket.ts`: Frontend WebSocket service.
6.  `backend/start_server.bat`: Helper script to run backend.

## Next Steps for Fix
1.  **Refactor `readNextAnnexBFrame`**:
    - Do NOT use `UnreadByte` for start codes.
    - Instead, return the `nextStartCode` and `nextHeader` along with the frame.
    - Pass this "leftover" data back into `readNextAnnexBFrame` on the next call.
    - Or, refactor to a stateful parser struct that holds the buffer.

2.  **Verify PPS**:
    - Once the parser is fixed, verify that `ScreenView.tsx` receives both SPS (7) and PPS (8).
    - The current frontend logic accumulates SPS/PPS across frames, so it should work once backend sends them correctly.
