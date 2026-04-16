# System Lag Diagnosis Summary

> **Update:** The main **app-integration** root cause (Tauri `player-ipc` spam + high-frequency `observe_property`) and fixes are documented in **[docs/PLAYER_PERFORMANCE_AND_EXTERNAL_IPC.md](docs/PLAYER_PERFORMANCE_AND_EXTERNAL_IPC.md)**. This file remains a **broader** checklist (hardware, drivers, test files, etc.).

## Current Status
**SEVERE SYSTEM LAG** during mpv video playback, even with ultra-minimal configuration.

## What We've Ruled Out

### ✅ App-Side Issues (NOT the problem)
- IPC rate: 3-6 events/sec (excellent)
- React rerenders: 32 in 46 seconds (excellent)
- Progress saves: minimal
- Close time: <5ms backend (excellent)
- No heavy polling or state churn

### ✅ MPV Configuration (NOT the problem)
Tested with ultra-minimal config:
- ❌ No interpolation
- ❌ No audio normalization
- ❌ No expensive scaling
- ❌ No gpu-hq profile
- ❌ No uosc/thumbfast scripts
- ❌ Minimal subtitles
- ✅ Lower process priority (BELOW_NORMAL)

**Result:** Still severe lag with bare-bones config.

## Likely Root Causes

### 1. Video File Characteristics
**MOST LIKELY CULPRIT**

Check your video file:
```powershell
# Get video info (if you have ffprobe or mediainfo)
ffprobe "path\to\your\video.mkv"
```

Problematic characteristics:
- **4K/2160p resolution** - Extremely demanding
- **HEVC/H.265 codec** - CPU-intensive to decode
- **High bitrate** (>20 Mbps) - Overwhelming I/O
- **10-bit color depth** - Extra processing
- **Large file size** - Memory pressure

### 2. System Hardware Limitations
Your system may not have sufficient:
- **CPU power** for software video decoding
- **GPU** for hardware acceleration
- **RAM** for large video buffers
- **Disk I/O** for high-bitrate streaming

### 3. Graphics Driver Issues
- Outdated GPU drivers
- Incompatible video output method
- Windows graphics stack problems

### 4. Background Processes
- Antivirus scanning video files
- Windows Defender real-time protection
- Other resource-heavy background apps

## Recommended Next Steps

### Step 1: Test with a Small, Simple Video
Create or download a small test video:
- **Resolution:** 720p or 480p
- **Codec:** H.264 (not HEVC)
- **Bitrate:** <5 Mbps
- **Duration:** 1-2 minutes

Test if lag still occurs with this simple file.

### Step 2: Test MPV Standalone (Without App)
1. Open Command Prompt
2. Navigate to mpv directory
3. Run: `mpv.exe --config-dir="path\to\mpv-config" "test-video.mp4"`

If lag occurs even without the Pitflix app, it's definitely a system/video issue.

### Step 3: Try Different Video Output Methods
Edit `mpv.conf` and test each:

```ini
# Try 1: Direct3D (Windows native)
vo=direct3d

# Try 2: DirectX
vo=gpu
gpu-api=d3d11

# Try 3: Software rendering (slowest but most compatible)
vo=x11
```

### Step 4: Update Graphics Drivers
- NVIDIA: GeForce Experience
- AMD: Radeon Software
- Intel: Intel Driver & Support Assistant

### Step 5: Check Windows Performance Settings
1. Open Task Manager during playback
2. Check:
   - CPU usage (should be <80%)
   - GPU usage
   - Disk usage (should be <100%)
   - Memory usage

### Step 6: Disable Hardware Decoding
If GPU is causing issues:
```ini
hwdec=no
```

This forces CPU decoding (slower but more stable).

## Current MPV Config Applied

Location: `f:\PitFilx-app\Pitflix.UI\src-tauri\binaries\mpv-config\mpv.conf`

```ini
# Video output: direct3d (Windows native)
vo=direct3d
hwdec=auto-safe

# Performance
video-sync=audio
interpolation=no
priority=belownormal
framedrop=no

# Minimal quality
deband=no
vf-clr=yes

# No scripts (uosc/thumbfast disabled)
osc=yes

# Reduced cache
demuxer-max-bytes=128M
demuxer-max-back-bytes=64M
```

## Questions to Answer

1. **What resolution/codec is your video file?**
   - Run: `ffprobe your-video.mkv` or check file properties

2. **Does lag occur with ALL videos or just specific ones?**
   - Test with different files

3. **What are your system specs?**
   - CPU model
   - GPU model
   - RAM amount

4. **Does mpv.exe alone (without Pitflix) cause lag?**
   - Test standalone

5. **What's your GPU usage during playback?**
   - Check Task Manager → Performance → GPU

## If Nothing Works

If the lag persists even with:
- Ultra-minimal mpv config
- Small/simple test videos
- Updated drivers
- Standalone mpv (no app)

Then the issue is likely:
- **Hardware limitation** - System cannot handle video playback smoothly
- **Windows system issue** - Requires OS-level troubleshooting
- **Disk I/O bottleneck** - Slow hard drive or fragmentation

Consider:
- Using a different video player (VLC, MPC-HC) to confirm
- Testing on a different computer
- Upgrading hardware
