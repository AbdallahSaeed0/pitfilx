# How Arabic Subtitle Generation Works - Simple Guide

## Quick Overview

```
Video with English subtitles
    ↓
[Arabic Subtitle Generator]
    ↓
Video with Arabic subtitles (auto-loaded)
```

---

## Method 1: UI Button (Easy)

### Step-by-Step

**Step 1: Play a Video**
- Open any video with embedded English subtitles in Pitflix player

**Step 2: Locate Button**
- Look at bottom of player screen where it says "Bring mpv to front" and "Browse app"
- Next to these buttons is: **"Generate Arabic Subtitle"**

**Step 3: Click Button**
- Click the button
- Button will show: ⟳ **"Generating Arabic..."** with spinning animation

**Step 4: Wait**
- Processing time: **4-9 seconds** (first time)
- Already translated? **< 0.5 seconds** (cached)

**Step 5: Done!**
- Arabic subtitle auto-loads in mpv
- Subtitles now display in Arabic
- Button returns to normal

**Step 6: (Optional) Reuse**
- Next time you open same video
- Generation is instant (cached result reused)

---

## Method 2: Keyboard Shortcut (Fast)

### Step-by-Step

**Step 1: Play a Video**
- Open video with English subtitles

**Step 2: Press Shortcut**
- Press: **`Ctrl+G`** while mpv is focused
- OSD Message appears: **"Generating Arabic subtitle..."**

**Step 3: mpv Shows Progress**
- Text overlay appears in mpv player
- Shows: "Generating Arabic subtitle..."

**Step 4: Wait**
- Same timing as button method

**Step 5: Done!**
- Arabic subtitle loads automatically
- OSD message disappears
- Subtitles switch to Arabic

---

## What Happens Behind the Scenes

### Architecture Overview

```
┌─────────────────────────────────────────────────────┐
│                   FRONTEND (React)                   │
│  "Generate Arabic Subtitle" Button / Ctrl+G Handler │
└────────────────┬────────────────────────────────────┘
                 │ invoke("generate-arabic-subtitle")
                 ↓
┌─────────────────────────────────────────────────────┐
│              TAURI BACKEND (Rust)                    │
│  - Orchestrates the generation process              │
│  - Calls external tools                             │
└────────────────┬────────────────────────────────────┘
                 │
        ┌────────┴────────┐
        ↓                 ↓
┌──────────────┐  ┌──────────────────┐
│  ffprobe     │  │ SUBTITLE         │
│  Detects     │  │ GENERATOR        │
│  subtitle    │  │ Module (Rust)    │
│  tracks      │  └──────────────────┘
└──────────────┘         │
                 ┌────────┴────────┐
                 ↓                 ↓
            ┌─────────┐      ┌──────────┐
            │ ffmpeg  │      │ Argos    │
            │ Extract │      │ Translate│
            │ SRT     │      │ to Arabic│
            └─────────┘      └──────────┘
                 │                 │
                 └────────┬────────┘
                          ↓
                 ┌──────────────────┐
                 │ movie.ar.srt     │
                 │ (Arabic subtitle)│
                 └────────┬─────────┘
                          ↓
                   [Auto-load in mpv]
```

---

## The 5-Step Process

### 1️⃣ Detect English Subtitles (ffprobe)

```
ffprobe scans the video file
    ↓
Finds all subtitle tracks
    ↓
Lists: track 0 (English), track 1 (French), etc.
    ↓
Selects: English track
```

**What you see:** Nothing visible yet (happening in background)

---

### 2️⃣ Extract English Subtitle (ffmpeg)

```
ffmpeg reads the video
    ↓
Extracts only the English subtitle track
    ↓
Saves to temporary file: movie.temp.srt
    ↓
Format: Standard SRT with timestamps
```

**Output format:**
```
1
00:00:01,234 --> 00:00:05,678
Hello, how are you?

2
00:00:06,000 --> 00:00:10,500
I'm doing well, thanks.
```

**What you see:** Button still showing "Generating..."

---

### 3️⃣ Parse SRT File (Regex)

```
Read the SRT file
    ↓
Extract each subtitle:
  - Subtitle number (1, 2, 3...)
  - Start time (00:00:01,234)
  - End time (00:00:05,678)
  - English text ("Hello, how are you?")
    ↓
Store in memory as list of cues
```

**What you see:** Still generating...

---

### 4️⃣ Translate Each Cue to Arabic (Argos Translate)

```
For EACH subtitle cue:
  
  Input:  "Hello, how are you?"
    ↓
  [Argos Translate - Offline AI]
    ↓
  Output: "مرحبا، كيف حالك؟"
    ↓
  Keep: Start time (00:00:01,234) - UNCHANGED
        End time (00:00:05,678)   - UNCHANGED
  
  Repeat for all ~300+ subtitle lines
```

**Timeline:**
- 50-100 subtitles: ~1-2 seconds
- 100-200 subtitles: ~2-4 seconds  
- 200+ subtitles: ~4-9 seconds

**What you see:** Button: "⟳ Generating Arabic..." (spinning)

---

### 5️⃣ Save & Auto-Load (mpv Integration)

```
Create new file: movie.ar.srt
    ↓
Write all translated subtitles with timestamps
    ↓
Send to mpv: "Load this subtitle file"
    ↓
mpv loads the Arabic subtitle
    ↓
Subtitles display in Arabic on screen
```

**Output file:**
```
1
00:00:01,234 --> 00:00:05,678
مرحبا، كيف حالك؟

2
00:00:06,000 --> 00:00:10,500
أنا بحال جيد، شكرا.
```

**What you see:**
- Button returns to normal: "Generate Arabic Subtitle"
- Subtitles on screen now in Arabic
- ✓ Done!

---

## Real Example: Movie Timeline

### Scenario: "Inception" (2h 28min movie, ~500 English subtitles)

```
T=0s     User clicks "Generate Arabic Subtitle"
         ├─ Button: ⟳ Generating Arabic...

T=0.1s   ffprobe detects subtitle tracks
         ├─ Found: English (track 0), French (track 1)

T=0.2s   ffmpeg extracts English subtitle
         ├─ Output: /path/to/Inception.temp.srt
         ├─ Size: ~50KB

T=0.3s   Parse SRT file
         ├─ Found: 487 subtitle cues
         ├─ Button still: ⟳ Generating Arabic...

T=1s     START: Translate 487 cues to Arabic
         ├─ Processing... 50 cues translated
         ├─ Processing... 100 cues translated
         ├─ Processing... 250 cues translated
         ├─ Processing... 487 cues done

T=8s     CREATE: /path/to/Inception.ar.srt
         ├─ Arabic subtitle file ready
         ├─ Size: ~55KB

T=8.1s   LOAD: mpv loads Arabic subtitle
         ├─ Subtitle file detected
         ├─ Arabic text displays on screen

T=8.5s   DONE! ✓
         ├─ Button: Generate Arabic Subtitle (normal)
         ├─ Screen: Subtitles in Arabic
         ├─ Total time: ~8.5 seconds
```

---

## Special Feature: Caching

### What is Caching?

First time you generate Arabic subtitle for a video:
```
Video: /Movies/Inception.mkv
Generate → Translate → Save: /Movies/Inception.ar.srt (Time: 8 seconds)
```

Second time you open the SAME video:
```
Video: /Movies/Inception.mkv
Check: Does Inception.ar.srt exist? 
  YES! → Load it directly (Time: 0.3 seconds)
```

### How It Works

```
┌──────────────────────────┐
│ Check Cache              │
│ /path/to/movie.ar.srt    │
└──────┬───────────────────┘
       │
       ├─ File EXISTS? 
       │  ├─ YES → Return cached file (INSTANT)
       │  └─ NO  → Run full generation (8 seconds)
       │
       ↓
    [Result]
```

**Benefit:** Reopen same movie = instant Arabic subtitles! ⚡

---

## Requirements: What You Need

### Tools Required

**1. FFmpeg** (for extraction)
```bash
# Windows: Use chocolatey
choco install ffmpeg

# macOS: Use homebrew
brew install ffmpeg

# Linux: Use apt
sudo apt install ffmpeg
```

**2. Argos Translate** (for translation)
```bash
# Install Python package
pip install argostranslate

# Download English→Arabic model (one-time)
python -m argostranslate.cli install-model en ar
```

### Check Installation

```bash
# Verify ffprobe
ffprobe --version

# Verify ffmpeg  
ffmpeg --version

# Verify Argos
python -c "from argostranslate import translate; print('OK')"
```

---

## Error Scenarios & Fixes

### ❌ Error: "No English subtitle track found"
**Cause:** Video has no English subtitles embedded  
**Fix:** 
- Use external subtitle file instead
- Download English subtitles separately
- Check if video actually has English subs

### ❌ Error: "ffmpeg not found" / "ffprobe not found"
**Cause:** FFmpeg not installed or not in PATH  
**Fix:**
```bash
# Windows
choco install ffmpeg

# Verify
ffmpeg --version
```

### ❌ Error: "Argos translate error"
**Cause:** Argos not installed or model missing  
**Fix:**
```bash
pip install argostranslate
python -m argostranslate.cli install-model en ar
```

### ❌ Taking too long (>15 seconds)
**Cause:** 
- Large subtitle file (1000+ lines)
- Slow CPU
- System resources busy  
**Fix:**
- Close other apps
- Wait longer
- Result is cached for next time

---

## Flow Diagram: User to Subtitle

```
┌─────────────────────┐
│  PITFLIX UI         │
│  "Generate Arabic   │
│   Subtitle" Button  │
└──────────┬──────────┘
           │ Click
           ↓
┌─────────────────────┐
│  REACT HANDLER      │
│  generateArabic     │
│  Subtitle()         │
└──────────┬──────────┘
           │ invoke(command)
           ↓
┌─────────────────────────────┐
│  TAURI BACKEND              │
│  generate_arabic_subtitle   │
│  function                   │
└──────────┬──────────────────┘
           │
      ┌────┴────┐
      │          │
   ┌──▼──┐   ┌──▼─────────┐
   │Check│   │   NO        │
   │Cache│   └─────┬───────┘
   └──┬──┘         │
      │            ↓
     YES      ┌──────────────┐
      │       │ Run Full     │
      │       │ Generation  │
      │       │ Process      │
      │       └──────┬───────┘
      │              │
      └──────┬───────┘
             │
             ↓
      ┌─────────────┐
      │ Return Path │
      │ .ar.srt     │
      └──────┬──────┘
             │
             ↓
      ┌─────────────────┐
      │ FRONTEND        │
      │ receive path    │
      └──────┬──────────┘
             │
             ↓
      ┌─────────────────┐
      │ SEND TO MPV     │
      │ SubAddSelect    │
      │ command         │
      └──────┬──────────┘
             │
             ↓
      ┌─────────────────────┐
      │ MPV PLAYER          │
      │ Loads subtitle file │
      │ Displays Arabic     │
      │ subtitles           │
      └─────────────────────┘
             ↓
          ✓ DONE
```

---

## Summary Table

| Aspect | Details |
|--------|---------|
| **Language** | English → Arabic |
| **Method** | Offline AI (Argos Translate) |
| **Speed** | 4-9 seconds (first time), <0.5s (cached) |
| **Input** | Embedded English subtitle in video |
| **Output** | `MovieName.ar.srt` file (auto-loaded) |
| **Tools** | ffprobe, ffmpeg, Argos Translate |
| **Cost** | Free (offline, open-source) |
| **Keyboard** | `Ctrl+G` in mpv |
| **Button** | "Generate Arabic Subtitle" in player |
| **Cache** | Automatic (reuse same file next time) |

---

## Key Points to Remember

✅ **Offline Only** - No internet required  
✅ **Automatic** - Arabic subtitle auto-loads  
✅ **Fast** - Cached results for reuse  
✅ **Preserves Timing** - All timestamps kept  
✅ **Easy UI** - One click or Ctrl+G  
✅ **Free** - Uses open-source tools  

---

**Want more details?** Read: `ARABIC_SUBTITLE_FLOW.md` for technical deep-dive!
