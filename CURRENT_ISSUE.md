# VẤN ĐỀ HIỆN TẠI: Backend Crash & FPS Thấp

## Trạng Thái: 🔴 CẦN TRỢ GIÚP KHẨN CẤP

### Vấn Đề 1: Backend Liên Tục Crash
- ❌ Backend Go khởi động được nhưng crash sau vài giây
- ❌ WebSocket disconnect liên tục: `ERR_CONNECTION_REFUSED`
- ❌ Không thể kết nối tới `http://localhost:8080`

### Vấn Đề 2: FPS Cực Thấp (1 FPS)
- 🎯 Mục tiêu: 30 FPS
- 📉 Thực tế: 1 FPS
- ⏱️ Mỗi frame capture: ~647ms
- � Frame size: ~1MB PNG (1024096 chars base64)

## Đã Sửa Thành Công
1. ✅ Màn hình đen (canvas 0x0) → Dùng regex parse resolution
2. ✅ Backend crash khi reload → StartStreaming idempotent
3. ✅ Console log spam → Giảm xuống 1 log/giây

## Files Đã Đóng Gói
📁 **Location:** `C:\Users\Mon\Desktop\Mon\Main\AI_Review\MonAndroid_Streaming_Issue.zip`

**Bao gồm:**
- `ScreenView.tsx` - Frontend component
- `websocket.ts` - WebSocket client
- `streaming.go` - Backend streaming service
- `adb.go` - ADB screencap handler
- `websocket.go` - WebSocket hub
- `walkthrough.md` - Chi tiết đầy đủ
- `README.md` - Tổng kết vấn đề

## Nguyên Nhân Nghi Ngờ

### Backend Crash:
1. Frame quá lớn (~1MB) làm buffer overflow
2. Memory leak trong streaming goroutine
3. ADB process blocking làm deadlock
4. Panic không được recover

### FPS Thấp:
1. ADB screencap -p chậm (647ms/frame)
2. Frame PNG không nén tốt (~1MB)
3. Bandwidth WebSocket không đủ (cần 30MB/s cho 30 FPS)
4. Browser decode PNG chậm

## Giải Pháp Đề Xuất (Chưa Thực Hiện)

### Để tăng FPS:
```go
// Option 1: Giảm resolution 50%
cmd := exec.Command(c.ADBPath, "-s", deviceID, "exec-out", "screencap", "-p", "-s", "720x1200")

// Option 2: Skip frames (chỉ gửi mỗi frame thứ 3)
if frameCount % 3 == 0 {
    continue
}

// Option 3: Compress PNG → JPEG quality 60
// Decode PNG → Encode JPEG → Base64
// Giảm: 1MB → ~200KB
```

### Để fix backend crash:
```go
// Add panic recovery
defer func() {
    if r := recover(); r != nil {
        log.Printf("Recovered from panic: %v", r)
    }
}()

// Add memory profiling
import _ "net/http/pprof"

// Check goroutine leaks
runtime.NumGoroutine() // Nếu tăng liên tục = leak
```

## Cần AI Khác Trợ Giúp

**Câu hỏi:**
1. Làm sao debug backend Go crash? Check log ở đâu?
2. Cách tối ưu nhất để giảm frame size 1MB → 200KB?
3. ADB screencap có command nhanh hơn không?
4. WebSocket buffer size nên set bao nhiêu?
5. Nên chuyển sang protocol khác? (gRPC/WebRTC/WebTransport)

---

**Cập nhật:** 2025-12-04 17:32  
**Trạng thái:** Chờ AI review zip file  
**Priority:** 🔴 HIGH
