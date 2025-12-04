@echo off
title MonAndroid Backend Server
echo Starting MonAndroid Backend...
echo.

:: Configuration
set H264_BITRATE=4000000
set H264_SIZE=1280x720

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
