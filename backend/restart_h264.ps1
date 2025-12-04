# H.264 Backend Restart Script
Write-Host "=== RESTARTING H.264 BACKEND ===" -ForegroundColor Cyan

# 1. Kill old processes
Write-Host "[1/4] Killing old backend processes..." -ForegroundColor Yellow
Get-Process | Where-Object {$_.ProcessName -like '*android*' -or $_.ProcessName -like '*server*' -or $_.ProcessName -like '*backend*'} | Stop-Process -Force -ErrorAction SilentlyContinue
Start-Sleep -Seconds 1

# 2. Rebuild backend
Write-Host "[2/4] Building backend..." -ForegroundColor Yellow
Set-Location "C:\Users\Mon\Desktop\MonAndroid\backend"
go build .
if ($LASTEXITCODE -ne 0) {
    Write-Host "BUILD FAILED!" -ForegroundColor Red
    exit 1
}
Write-Host "BUILD SUCCESSFUL!" -ForegroundColor Green

# 3. Start backend
Write-Host "[3/4] Starting H.264 backend..." -ForegroundColor Yellow
Start-Process powershell -ArgumentList @(
    "-NoExit",
    "-Command",
    "cd 'C:\Users\Mon\Desktop\MonAndroid\backend'; Write-Host '=== H.264 AUTO-STREAMING BACKEND ===' -ForegroundColor Green; .\androidcontrol.exe"
) -WindowStyle Normal

Start-Sleep -Seconds 5

# 4. Check if backend is running
Write-Host "[4/4] Checking backend status..." -ForegroundColor Yellow
try {
    $response = Invoke-WebRequest -Uri "http://localhost:8080/health" -UseBasicParsing -TimeoutSec 3
    if ($response.StatusCode -eq 200) {
        Write-Host "BACKEND IS RUNNING!" -ForegroundColor Green
        Write-Host ""
        Write-Host "Opening browser at http://localhost:5173" -ForegroundColor Cyan
        Start-Sleep -Seconds 2
        Start-Process "http://localhost:5173"
        
        Write-Host ""
        Write-Host "=== INSTRUCTIONS ===" -ForegroundColor Cyan
        Write-Host "1. Open browser Console (F12)"
        Write-Host "2. Look for these logs:"
        Write-Host "   CORRECT (H.264): 'Received NAL unit: XX bytes'"
        Write-Host "   WRONG (PNG): 'JSON message: {frame: iVBORw0...}'"
        Write-Host ""
        Write-Host "If you see PNG messages, the old backend is still running!"
    }
} catch {
    Write-Host "BACKEND NOT RESPONDING on port 8080!" -ForegroundColor Red
}
