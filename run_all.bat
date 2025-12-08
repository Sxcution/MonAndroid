@echo off
echo Stopping all backend and frontend processes...

:: Kill all Go backend processes
taskkill /F /IM go.exe 2>nul
taskkill /F /IM air.exe 2>nul
taskkill /F /IM main.exe 2>nul

:: Kill all Node/NPM frontend processes
taskkill /F /IM node.exe 2>nul

echo Waiting for processes to terminate...
timeout /t 2 /nobreak >nul

echo Starting Backend...
if exist "C:\Users\Mon\Desktop\Protect\Mon ViewPhone\backend\.air.toml" (
    start "Backend" cmd /k "cd /d C:\Users\Mon\Desktop\Protect\Mon ViewPhone\backend && air -c .air.toml"
) else (
    start "Backend" cmd /k "cd /d C:\Users\Mon\Desktop\Protect\Mon ViewPhone\backend && go run ./..."
)

echo Starting Frontend...
start "Frontend" cmd /k "cd /d C:\Users\Mon\Desktop\Protect\Mon ViewPhone\frontend && npm run dev"

exit
