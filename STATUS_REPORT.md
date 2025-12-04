# MonAndroid - H.264 Streaming Status Report
**Date:** 2025-12-04  
**Status:** ⚠️ NOT WORKING - avcC Format Issue

---

## 🎯 Project Goal
Stream Android device screen via H.264 to web frontend using WebCodecs API.

## 📊 Current Status

### ✅ Working Components
1. **Backend (Go):**
   - ✅ ADB device detection (27 devices)
   - ✅ H.264 stream from `adb screenrecord --output-format=h264`
   - ✅ NAL unit parsing (Annex-B format)
   - ✅ NAL type detection fixed (finds SPS type 7, PPS type 8)
   - ✅ WebSocket broadcasting to frontend
   - ✅ Buffer accumulation strategy (no byte loss)

2. **Frontend (React/TypeScript):**
   - ✅ WebSocket connection
   - ✅ NAL unit reception
   - ✅ SPS/PPS detection working
   - ✅ Start code stripping implemented

### ❌ Broken Component
**WebCodecs Decoder Configuration**

**Error:**
```
❌ WebCodecs decoder error: NotSupportedError: Failed to parse avcC.
```

**Console Logs:**
```typescript
✅ Found SPS NAL (type 7)           // Detection works
✅ Found PPS NAL (type 8)           // Detection works
✅ Configuring decoder with SPS and PPS
✅ Decoder configured successfully! {spsLen: 18, ppsLen: 5}  // Strip works
❌ WebCodecs decoder error: NotSupportedError: Failed to parse avcC.  // But fails here
```

---

## 🐛 Root Cause Analysis

### Problem
WebCodecs `VideoDecoder.configure()` expects **avcC format** (ISO/IEC 14496-15), but current implementation only:
1. Strips Annex-B start codes (00 00 01)
2. Concatenates raw SPS + PPS

**This is insufficient!** avcC format requires:
- AVCDecoderConfigurationRecord structure
- Length prefixes for each NAL unit
- Specific byte ordering

### What We're Sending
```
[SPS raw data 18 bytes][PPS raw data 5 bytes]
```

### What WebCodecs Needs (avcC)
```
[configurationVersion=1]
[AVCProfileIndication]
[profile_compatibility]
[AVCLevelIndication]
[lengthSizeMinusOne]
[numOfSequenceParameterSets]
[SPS length (2 bytes)][SPS data]
[numOfPictureParameterSets]
[PPS length (2 bytes)][PPS data]
```

---

## 📁 Files Modified During Debug Session

### Backend (Go)
| File | Changes | Status |
|------|---------|--------|
| `backend/service/streaming.go` | Fixed NAL type detection (lines 251-263) | ✅ Working |

**Change:**
```go
// OLD (WRONG):
nalType := nalData[3] & 0x1F

// NEW (CORRECT):
nalType := -1
if len(nalData) >= 4 && nalData[0] == 0 && nalData[1] == 0 {
    if nalData[2] == 1 {
        nalType = int(nalData[3] & 0x1F)
    } else if nalData[2] == 0 && nalData[3] == 1 {
        if len(nalData) > 4 {
            nalType = int(nalData[4] & 0x1F)
        }
    }
}
```

### Frontend (TypeScript)
| File | Changes | Status |
|------|---------|--------|
| `frontend/src/services/api.ts` | Increased timeout 10s → 30s (line 10) | ✅ Working |
| `frontend/src/components/ScreenView.tsx` | Added `stripStartCode()` helper (lines 322-344) | ⚠️ Incomplete |
| `frontend/src/components/ScreenView.tsx` | Updated decoder config (lines 161-179) | ❌ Not working |

**Changes:**
1. **Timeout fix:** Prevents device scan timeout
2. **stripStartCode():** Removes Annex-B start codes
3. **Decoder config:** Attempts to use stripped SPS/PPS ← **THIS FAILS**

---

## 🔧 Solutions Attempted

### Attempt 1: Fix NAL Type Detection ✅ SUCCESS
**Problem:** Backend couldn't detect SPS/PPS  
**Solution:** Find start code first, then extract NAL type  
**Result:** Backend now logs "Sent SPS" and "Sent PPS" correctly

### Attempt 2: Strip Start Codes ✅ PARTIAL
**Problem:** WebCodecs expects avcC format, not Annex-B  
**Solution:** Strip 00 00 01 or 00 00 00 01 from SPS/PPS  
**Result:** Start codes removed, but avcC still invalid

### Attempt 3: Direct Concatenation ❌ FAILED
**Problem:** avcC needs proper structure, not just concatenation  
**Solution:** `description = spsRaw + ppsRaw`  
**Result:** "Failed to parse avcC" error

---

## 💡 Recommended Solutions

### Option 1: Build Proper avcC Format (Recommended)
Create `AVCDecoderConfigurationRecord` manually:

```typescript
function buildAvcC(sps: Uint8Array, pps: Uint8Array): Uint8Array {
    // Parse SPS to get profile/level
    const profile = sps[1];
    const compatibility = sps[2];
    const level = sps[3];
    
    // Build avcC structure
    const avcC = new Uint8Array(11 + sps.length + pps.length);
    let offset = 0;
    
    avcC[offset++] = 1;                    // configurationVersion
    avcC[offset++] = profile;              // AVCProfileIndication
    avcC[offset++] = compatibility;        // profile_compatibility
    avcC[offset++] = level;                // AVCLevelIndication
    avcC[offset++] = 0xFF;                 // lengthSizeMinusOne (4 bytes)
    avcC[offset++] = 0xE1;                 // numOfSequenceParameterSets (1)
    
    // SPS length (2 bytes, big-endian)
    avcC[offset++] = (sps.length >> 8) & 0xFF;
    avcC[offset++] = sps.length & 0xFF;
    avcC.set(sps, offset);
    offset += sps.length;
    
    avcC[offset++] = 1;                    // numOfPictureParameterSets
    
    // PPS length (2 bytes, big-endian)
    avcC[offset++] = (pps.length >> 8) & 0xFF;
    avcC[offset++] = pps.length & 0xFF;
    avcC.set(pps, offset);
    
    return avcC;
}
```

**Implementation:** Add to `ScreenView.tsx` and use in decoder config

### Option 2: Use scrcpy Library ⭐ EASIER
- **scrcpy** already handles H.264 decoding properly
- Has web client implementations available
- Well-tested, production-ready
- **Downside:** Requires protocol rewrite

### Option 3: Fall Back to PNG Screenshots
- Simple, no codec issues
- Works immediately
- **Downside:** Lower FPS (~5-10 FPS vs 30 FPS)

---

## 🏗️ Architecture Overview

```
┌─────────────────┐
│ Android Device  │
└────────┬────────┘
         │ ADB
         ↓
┌─────────────────────────────────┐
│ Backend (Go)                    │
│ ┌─────────────────────────────┐ │
│ │ adb screenrecord --format   │ │
│ │ h264 (Annex-B stream)       │ │
│ └──────────┬──────────────────┘ │
│            ↓                     │
│ ┌─────────────────────────────┐ │
│ │ Buffer Accumulation         │ │
│ │ Find start codes            │ │
│ │ Extract NAL units           │ │
│ └──────────┬──────────────────┘ │
│            ↓                     │
│ ┌─────────────────────────────┐ │
│ │ WebSocket Broadcast         │ │
│ │ [4-byte length][NAL data]   │ │
│ └──────────┬──────────────────┘ │
└────────────┼────────────────────┘
             │ WebSocket
             ↓
┌─────────────────────────────────┐
│ Frontend (React)                │
│ ┌─────────────────────────────┐ │
│ │ Receive NAL units           │ │
│ │ Detect SPS/PPS ✅           │ │
│ └──────────┬──────────────────┘ │
│            ↓                     │
│ ┌─────────────────────────────┐ │
│ │ Strip start codes ✅        │ │
│ │ spsRaw, ppsRaw             │ │
│ └──────────┬──────────────────┘ │
│            ↓                     │
│ ┌─────────────────────────────┐ │
│ │ VideoDecoder.configure()    │ │
│ │ ❌ FAILS HERE              │ │
│ │ "Failed to parse avcC"      │ │
│ └─────────────────────────────┘ │
└─────────────────────────────────┘
```

**Bottleneck:** avcC format conversion (missing AVCDecoderConfigurationRecord)

---

## 📦 Project Structure

```
MonAndroid/
├── backend/                 (Go)
│   ├── main.go             
│   ├── service/
│   │   ├── streaming.go    ← NAL detection fixed
│   │   ├── device_manager.go
│   │   └── action_dispatcher.go
│   ├── adb/
│   │   └── adb.go          
│   └── api/
│       └── streaming_handlers.go
├── frontend/               (React/TypeScript)
│   └── src/
│       ├── components/
│       │   └── ScreenView.tsx  ← avcC issue here
│       └── services/
│           ├── api.ts          ← Timeout fixed
│           └── websocket.ts
└── STATUS_REPORT.md        ← This file
```

---

## 🧪 Test Data

### Working NAL Detection
**Backend logs:**
```
📦 Device xxx: Sent SPS (seq 1)
📦 Device xxx: Sent PPS (seq 2)
📺 Device xxx: NAL seq 30
```

**Frontend logs:**
```
📦 Received NAL unit: 22 bytes     // SPS with start code
🔍 Found SPS NAL (type 7)
📦 Received NAL unit: 9 bytes      // PPS with start code
🔍 Found PPS NAL (type 8)
```

### Stripped Lengths
- **SPS:** 22 bytes (with start code) → 18 bytes (raw)
- **PPS:** 9 bytes (with start code) → 5 bytes (raw)

**Start code removed:** 4 bytes (00 00 00 01)

---

## ⚙️ Environment

- **OS:** Windows
- **Go Version:** (check with `go version`)
- **Node Version:** (check with `node -v`)
- **ADB Devices:** 27 connected
- **Backend Port:** 8080
- **Frontend Port:** 5173 (Vite dev server)

---

## 🚀 How to Run

### Backend
```bash
cd backend
go build .
.\androidcontrol.exe
```

### Frontend
```bash
cd frontend
npm run dev
```

### Access
- Frontend: http://localhost:5173
- Backend API: http://localhost:8080

---

## 📝 Next Steps for Another Developer

1. **Implement proper avcC builder** (see Option 1 above)
2. **OR switch to scrcpy** for proven H.264 handling
3. **OR use PNG fallback** for immediate working solution

### Quick Fix Priority
1. Try Option 1 (build avcC) - ~30 minutes
2. If fails, try scrcpy integration - ~2-3 hours
3. Fallback to PNG - ~10 minutes

---

## 🔗 References

- [ISO/IEC 14496-15 avcC Format](https://www.iso.org/standard/68960.html)
- [WebCodecs VideoDecoder API](https://developer.mozilla.org/en-US/docs/Web/API/VideoDecoder)
- [H.264 Annex B vs avcC](https://stackoverflow.com/questions/24884827/possible-locations-for-sequence-picture-parameter-sets-for-h-264-stream)
- [scrcpy GitHub](https://github.com/Genymobile/scrcpy)

---

## 📧 Handoff Summary

**What works:**
- ✅ Backend NAL parsing and detection
- ✅ WebSocket communication
- ✅ Frontend SPS/PPS recognition

**What doesn't:**
- ❌ WebCodecs decoder configuration (avcC format issue)

**Blocker:**
WebCodecs needs `AVCDecoderConfigurationRecord`, not just raw SPS+PPS concatenation.

**Recommended fix:**
Implement `buildAvcC()` function as shown in Option 1.

**Time estimate:** 30-60 minutes to implement and test.

---

**End of Report**
