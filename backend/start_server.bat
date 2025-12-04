@echo off
title MonAndroid Backend Server
echo Starting MonAndroid Backend...
echo.

:: Configuration - TỐI ƯU CHO 20+ MÁY
:: 2Mbps cân bằng chất lượng và performance cho grid view
set H264_BITRATE=2000000
:: 720p giúp giảm tải CPU decode trên trình duyệt
set H264_SIZE=720x1280

echo Configuration:
echo   Bitrate: %H264_BITRATE%
echo   Size:    %H264_SIZE%
echo.

:: Check if server.exe exists
if not exist server.exe (
    echo ❌ server.exe not found!
    echo Please build the server first: go build -o server.exe
    pause
    exit /b
)

:: Run server
server.exe
pause
