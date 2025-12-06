@echo off
setlocal

:: ========================================================
:: 🕒 CẤU HÌNH TÊN FILE (AUTO DATE-TIME)
:: ========================================================
:: Dùng PowerShell lấy ngày giờ chuẩn để tránh lỗi định dạng vùng (Region)
for /f "usebackq delims=" %%a in (`powershell -Command "Get-Date -Format 'HH-mm_dd-MM-yyyy'"`) do set "TIMESTAMP=%%a"
set "OUTPUT_ZIP=AIreview_%TIMESTAMP%.zip"

echo ========================================================
echo 📦 DANG DONG GOI SOURCE CODE (FROM PARENT ROOT)
echo 📂 Output: %OUTPUT_ZIP%
echo ========================================================

:: Xóa file cũ nếu trùng tên (hiếm khi xảy ra do có timestamp)
if exist "%OUTPUT_ZIP%" del "%OUTPUT_ZIP%"

:: ========================================================
:: 🚀 LỆNH POWERSHELL NÉN FILE (ĐÃ FIX LỖI)
:: ========================================================
:: Logic:
:: 1. Chuyển context sang thư mục cha (..) vì script nằm trong folder AI_Review
:: 2. Loại bỏ folder rác (node_modules, .git, dist, build, AI_Review...).
:: 3. CHỈ LẤY các đuôi file code.
:: 4. Nén vào file zip nằm tại folder hiện tại (AI_Review)

powershell -NoProfile -ExecutionPolicy Bypass -Command ^
    "$ws = (Get-Item ..).FullName; Write-Host 'Scanning Root: ' $ws -ForegroundColor Cyan; $files = Get-ChildItem -Path .. -Recurse -File | Where-Object { ($_.FullName -notmatch '\\(node_modules|\.git|dist|build|out|bin|obj|\.gemini|backend\\assets|backend\\data|AI_Review)\\') -and ($_.Extension -match '\.(go|ts|tsx|js|jsx|css|html|json|md|sql|toml|bat|ps1)$') }; if ($files.Count -eq 0) { Write-Host '❌ No source files found!' -ForegroundColor Red; exit 1 }; Write-Host ('✅ Found ' + $files.Count + ' clean code files.') -ForegroundColor Green; Compress-Archive -Path $files.FullName -DestinationPath '%OUTPUT_ZIP%' -Force; Write-Host '🎉 Done!' -ForegroundColor Yellow;"

echo.
echo ========================================================
echo ✅ HOAN TAT! 
echo 📂 File zip da san sang: AI_Review\%OUTPUT_ZIP%
echo ========================================================
pause.