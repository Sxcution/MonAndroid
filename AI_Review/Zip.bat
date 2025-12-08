@echo off
setlocal

:: ========================================================
:: 🕒 CẤU HÌNH TÊN FILE (AUTO DATE-TIME)
:: ========================================================
for /f "usebackq delims=" %%a in (`powershell -Command "Get-Date -Format 'HH-mm_dd-MM-yyyy'"`) do set "TIMESTAMP=%%a"
set "OUTPUT_ZIP=AIreview_%TIMESTAMP%.zip"

:: ========================================================
:: 📝 DANH SÁCH FILE CODE QUAN TRỌNG (TỰ ĐỘNG BAO GỒM)
:: ========================================================
:: Backend (Go):
::   - backend/main.go, backend/service/*.go, backend/adb/*.go
:: Frontend Core:
::   - frontend/src/App.tsx, frontend/src/main.tsx
:: Components:
::   - frontend/src/components/ScreenView.tsx (Worker-based decoding)
::   - frontend/src/components/DeviceCard.tsx, DeviceGrid.tsx
:: Workers (Video Streaming):
::   - frontend/src/workers/video-tile.worker.ts (Backpressure, Watchdog)
:: Services:
::   - frontend/src/services/startTileStream.ts (OffscreenCanvas API)
::   - frontend/src/services/websocket.ts, api.ts, deviceService.ts
:: Store:
::   - frontend/src/store/useAppStore.ts, useSettingsStore.ts
:: Documentation:
::   - project_structure.md, naming_registry.json, Rule.md
:: ========================================================

echo ========================================================
echo 📦 DANG DONG GOI SOURCE CODE (GIU NGUYEN CAU TRUC THU MUC)
echo 📂 Output: %OUTPUT_ZIP%
echo ========================================================

:: Xóa file cũ nếu trùng tên
if exist "%OUTPUT_ZIP%" del "%OUTPUT_ZIP%"

:: ========================================================
:: 🚀 LỆNH POWERSHELL NÉN FILE (GIỮ NGUYÊN CẤU TRÚC)
:: ========================================================
:: Logic:
:: 1. Chuyển context sang thư mục cha (..)
:: 2. Copy file code vào temp folder với cấu trúc relative path
:: 3. Nén temp folder → giữ nguyên cấu trúc thư mục
:: 4. Xóa temp folder

powershell -NoProfile -ExecutionPolicy Bypass -Command ^
    "$root = (Get-Item ..).FullName; " ^
    "$tempDir = Join-Path $env:TEMP ('AIReview_' + [guid]::NewGuid().ToString('N').Substring(0,8)); " ^
    "Write-Host 'Scanning Root: ' $root -ForegroundColor Cyan; " ^
    "$excludePattern = '\\\\(node_modules|\\.git|dist|build|out|bin|obj|\\.gemini|backend\\\\assets|backend\\\\data|AI_Review)\\\\'; " ^
    "$includeExt = '\\.(go|ts|tsx|js|jsx|css|html|json|md|sql|toml|bat|ps1)$'; " ^
    "$files = Get-ChildItem -Path $root -Recurse -File | Where-Object { ($_.FullName -notmatch $excludePattern) -and ($_.Extension -match $includeExt) }; " ^
    "if ($files.Count -eq 0) { Write-Host '❌ No source files found!' -ForegroundColor Red; exit 1 }; " ^
    "Write-Host ('✅ Found ' + $files.Count + ' code files. Copying with structure...') -ForegroundColor Green; " ^
    "foreach ($f in $files) { " ^
    "  $relPath = $f.FullName.Substring($root.Length + 1); " ^
    "  $destPath = Join-Path $tempDir $relPath; " ^
    "  $destDir = Split-Path $destPath -Parent; " ^
    "  if (!(Test-Path $destDir)) { New-Item -ItemType Directory -Path $destDir -Force | Out-Null }; " ^
    "  Copy-Item $f.FullName $destPath; " ^
    "}; " ^
    "Write-Host '📦 Compressing...' -ForegroundColor Yellow; " ^
    "Compress-Archive -Path (Join-Path $tempDir '*') -DestinationPath '%OUTPUT_ZIP%' -Force; " ^
    "Remove-Item $tempDir -Recurse -Force; " ^
    "Write-Host '🎉 Done! Structure preserved.' -ForegroundColor Green;"

echo.
echo ========================================================
echo ✅ HOAN TAT! 
echo 📂 File zip da san sang: AI_Review\%OUTPUT_ZIP%
echo 📂 Cau truc thu muc da duoc giu nguyen (frontend/src/...)
echo ========================================================
pause.