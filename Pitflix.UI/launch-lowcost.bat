@echo off
echo ========================================
echo Launching Pitflix with LOW COST mpv profile
echo This disables expensive video processing for performance testing
echo ========================================
set PITFLIX_MPV_LOWCOST=1
npm run tauri dev
