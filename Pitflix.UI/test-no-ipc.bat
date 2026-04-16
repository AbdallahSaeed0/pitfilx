@echo off
echo ========================================
echo Testing MPV WITHOUT IPC
echo ========================================
echo.
echo This will launch the app with IPC disabled.
echo If the lag is gone, IPC is the bottleneck.
echo.
set PITFLIX_NO_IPC=1
npm run tauri dev
