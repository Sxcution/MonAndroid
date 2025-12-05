@echo off

:: Start Backend (using air if available, otherwise go run)
if exist "C:\Users\Mon\Desktop\MonAndroid\backend\.air.toml" (
    start "Backend" cmd /k "cd /d C:\Users\Mon\Desktop\MonAndroid\backend && air -c .air.toml"
) else (
    start "Backend" cmd /k "cd /d C:\Users\Mon\Desktop\MonAndroid\backend && go run ./..."
)

:: Start Frontend
start "Frontend" cmd /k "cd /d C:\Users\Mon\Desktop\MonAndroid\frontend && npm run dev"

exit
