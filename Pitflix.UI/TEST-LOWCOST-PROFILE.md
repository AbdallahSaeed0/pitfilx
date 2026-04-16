# Testing Low-Cost MPV Profile

## Problem
The app metrics are excellent (low IPC, low rerenders, fast close), but the **whole computer lags** during playback. This indicates mpv's video processing is too expensive.

## Solution
Test with a minimal mpv configuration that disables expensive features.

## How to Test

### 1. Test Normal Profile (Current)
```bash
npm run tauri dev
```
- Look for: `[mpv-profile] normal`
- Note system responsiveness during playback

### 2. Test Low-Cost Profile
Close the app, then run:

**PowerShell:**
```powershell
$env:PITFLIX_MPV_LOWCOST=1
npm run tauri dev
```

**OR use the batch file:**
```bash
launch-lowcost.bat
```

- Look for: `[mpv-profile] low_cost`
- Note system responsiveness during playback

### 3. Compare
If low-cost profile is significantly more responsive, the culprit is one of these expensive features:

**Most Likely Culprits (in order):**
1. **`interpolation=yes`** - Frame interpolation (very CPU-intensive)
2. **`video-sync=display-resample`** - Display resampling for smooth playback
3. **`profile=gpu-hq`** - High-quality GPU processing
4. **`scale=ewa_lanczossharp`** - Expensive scaling algorithm
5. **`deband=yes`** - Debanding filter
6. **Audio normalization filter** - Real-time audio processing

### 4. Find the Culprit
If low-cost helps, re-enable features one by one in `mpv.conf`:
1. Start with low-cost profile
2. Add back one feature
3. Test responsiveness
4. Repeat until you find the expensive one

## What Was Disabled in Low-Cost Profile

| Feature | Normal | Low-Cost |
|---------|--------|----------|
| Profile | `gpu-hq` | default |
| Scaling | `ewa_lanczossharp` | `bilinear` |
| Debanding | `yes` | `no` |
| Video output | `gpu-next` | `gpu` |
| Video sync | `display-resample` | `audio` |
| Interpolation | `yes` | `no` |
| Audio filter | `dynaudnorm` | none |
| Subtitle effects | shadow, blur | simple |
| Cache | 512M/256M | 256M/128M |
| Thumbfast | Full | Minimal |

## Expected Result
Low-cost profile should make the system much more responsive if mpv config is the issue.
