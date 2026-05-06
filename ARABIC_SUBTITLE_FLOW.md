# Arabic Subtitle Generation - Complete Function Flow

## Overview
This document explains how the Arabic subtitle generation feature works end-to-end, from user interaction to subtitle output.

---

## 1. User Interaction Points

### Option A: UI Button Click
**Location:** `PlayerPage.tsx` - Main player hero card  
**Button:** "Generate Arabic Subtitle" (next to "Browse app")

```
User clicks button
    ↓
generateArabicSubtitle() handler triggered
    ↓
invoke("generate-arabic-subtitle", { videoPath: state.filePath })
```

### Option B: Keyboard Shortcut (mpv)
**Keybinding:** `Ctrl+G` (in mpv player window)

```
User presses Ctrl+G in mpv
    ↓
pitflix-player-controls.lua detects key
    ↓
emit_shortcut("generate_arabic_subtitle") called
    ↓
[PITFLIX_SHORTCUT]generate_arabic_subtitle sent to stdout
    ↓
Rust IPC loop captures it
    ↓
emit("player2-shortcut", "generate_arabic_subtitle")
    ↓
PlayerPage listener catches event
    ↓
switch case "generate_arabic_subtitle": generateArabicSubtitle()
```

---

## 2. Frontend Handler (`PlayerPage.tsx`)

### Function: `generateArabicSubtitle()`
**Purpose:** Orchestrate the subtitle generation process

```typescript
const generateArabicSubtitle = useCallback(async () => {
  // 1. Validate video path exists
  if (!state?.filePath) {
    setArabicSubtitleError("No video file path available");
    return;
  }
  
  // 2. Show loading state
  setArabicSubtitleGenerating(true);
  setArabicSubtitleError(null);
  
  try {
    // 3. Call Tauri command (kebab-case name!)
    const outputPath = await invoke<string>("generate-arabic-subtitle", {
      videoPath: state.filePath,
    });
    
    // 4. Auto-load subtitle in mpv
    await send({ type: "SubAddSelect", payload: outputPath });
    
    // 5. Clear loading state
    setTimeout(() => {
      setArabicSubtitleGenerating(false);
    }, 500);
  } catch (err) {
    // 6. Handle errors
    const errorMsg = err instanceof Error ? err.message : String(err);
    setArabicSubtitleError(errorMsg);
    setArabicSubtitleGenerating(false);
  }
}, [state?.filePath, send]);
```

**State Variables:**
- `arabicSubtitleGenerating` - Boolean flag for loading animation
- `arabicSubtitleError` - String for error display

**UI Updates:**
- Button shows spinner while generating
- Error displays below button if generation fails
- Subtitle auto-loads when done

---

## 3. Tauri Command Bridge

### Command Registration (`lib.rs`)
```rust
.invoke_handler(tauri::generate_handler![
    // ... other commands ...
    generate_arabic_subtitle,  // ← Registered here
])
```

**Important:** Tauri auto-converts `generate_arabic_subtitle` (snake_case) to `generate-arabic-subtitle` (kebab-case) for JavaScript invocation!

---

## 4. Rust Backend Command (`tauri_commands.rs`)

### Function: `generate_arabic_subtitle()`

```rust
#[tauri::command]
pub fn generate_arabic_subtitle(video_path: String) -> Result<String, String> {
  // Step 1: Check Cache
  if subtitle_generator::is_subtitle_cached(&video_path) {
    eprintln!("[generate-arabic-subtitle] Returning cached: {}", cache_path);
    return Ok(cache_path);
  }
  
  // Step 2: Detect Subtitle Tracks
  let tracks = subtitle_generator::get_subtitle_tracks(&video_path)?;
  // Uses ffprobe to scan video
  // Returns: Vec<SubtitleTrack> with index, language, title
  
  // Step 3: Find English Track
  let english_track = subtitle_generator::find_english_subtitle_track(&tracks)?;
  // Matches: "eng", "en", "english"
  // Returns: SubtitleTrack with index of English subtitle
  
  // Step 4: Extract English Subtitle
  subtitle_generator::extract_subtitle_to_srt(
    &video_path, 
    english_track.index, 
    &temp_srt_path
  )?;
  // Uses ffmpeg to extract track
  // Output: temp.srt file with English subtitle
  
  // Step 5: Translate to Arabic
  translate_srt_to_arabic(&temp_srt_path, &output_srt_path)?;
  // Processes each subtitle cue
  // Translates text via Argos Translate
  // Preserves timestamps and formatting
  
  // Step 6: Cleanup & Return
  std::fs::remove_file(&temp_srt_path);
  // Removes temporary file
  // Returns: Path to final .ar.srt file
}
```

---

## 5. Subtitle Generator Module (`subtitle_generator.rs`)

### Step-by-Step Process

#### **Step 5A: Get Subtitle Tracks**
```
Function: get_subtitle_tracks(video_path: &str)

Command: ffprobe -v error -select_streams s -show_entries stream=index,language,tags=title -of json <video>

Output: Vec<SubtitleTrack>
  [
    { index: 0, language: "eng", title: "English" },
    { index: 1, language: "fr", title: "French" },
  ]

Log: [subtitle-gen] Detecting subtitle tracks in: /path/to/movie.mkv
     [subtitle-gen] Found track 0: eng (English)
     [subtitle-gen] Found track 1: fr (French)
     [subtitle-gen] Total subtitle tracks found: 2
```

#### **Step 5B: Find English Track**
```
Function: find_english_subtitle_track(tracks: &[SubtitleTrack])

Match: language == "eng" OR "en" OR "english"

Output: Option<SubtitleTrack>
  Some(SubtitleTrack { index: 0, language: "eng", ... })

Log: [subtitle-gen] Found English track at index: 0
```

#### **Step 5C: Extract Subtitle with ffmpeg**
```
Function: extract_subtitle_to_srt(video_path, track_index, output_path)

Command: ffmpeg -i <video> -map 0:s:<index> -c:s srt -y <output.srt>

Example: ffmpeg -i movie.mkv -map 0:s:0 -c:s srt -y movie.temp.srt

Output File:
  1
  00:00:01,234 --> 00:00:05,678
  Hello, how are you?
  
  2
  00:00:06,000 --> 00:00:10,500
  I'm doing well, thanks.

Log: [subtitle-gen] Extracting subtitle track 0 to: /path/movie.temp.srt
     [subtitle-gen] Subtitle extraction completed successfully
```

#### **Step 5D: Parse SRT File**
```
Function: parse_srt_file(srt_path: &str)

Regex: Matches SRT format
  (\d+)                          - Index (1, 2, 3, ...)
  (\d{2}:\d{2}:\d{2},\d{3})      - Start time
  -->\s*                          - Arrow separator
  (\d{2}:\d{2}:\d{2},\d{3})      - End time
  (text...)                       - Subtitle text

Output: Vec<SubtitleCue>
  [
    {
      index: 1,
      start: "00:00:01,234",
      end: "00:00:05,678",
      text: "Hello, how are you?"
    },
    {
      index: 2,
      start: "00:00:06,000",
      end: "00:00:10,500",
      text: "I'm doing well, thanks."
    }
  ]

Log: [subtitle-gen] Parsing SRT file: /path/movie.temp.srt
     [subtitle-gen] Parsed 342 subtitle cues
```

#### **Step 5E: Translate Each Cue**
```
Function: translate_cue_with_argos(text: &str)

Command: 
  Try 1: argospm-translate --from-lang en --to-lang ar "<text>"
  Try 2: python -m argostranslate.cli --from-lang en --to-lang ar "<text>"

Process (for each subtitle cue):
  Input:  "Hello, how are you?"
    ↓
  Argos Translate (offline, free)
    ↓
  Output: "مرحبا، كيف حالك؟"

Example Loop:
  for cue in cues {
    let translated = translate_cue_with_argos(&cue.text)?;
    translated_cues.push(SubtitleCue {
      index: cue.index,
      start: cue.start,           // ← Preserved!
      end: cue.end,               // ← Preserved!
      text: translated,            // ← Translated!
    });
  }

Log: [subtitle-gen] Translating 342 cues to Arabic...
     (One line per cue - shows progress)
```

#### **Step 5F: Write Translated SRT**
```
Function: write_srt_file(cues: &[SubtitleCue], output_path)

Process:
  for cue in cues {
    write("{index}\n{start} --> {end}\n{text}\n\n")
  }

Output File: movie.ar.srt
  1
  00:00:01,234 --> 00:00:05,678
  مرحبا، كيف حالك؟
  
  2
  00:00:06,000 --> 00:00:10,500
  أنا بحال جيد، شكرا.

Log: [subtitle-gen] Writing 342 cues to: /path/movie.ar.srt
     [subtitle-gen] SRT file written successfully
```

---

## 6. MPV Script Integration (`pitflix-player-controls.lua`)

### Keybinding Setup
```lua
-- When user presses Ctrl+G
mp.add_forced_key_binding("Ctrl+g", "pitflix-generate-arabic-subtitle", 
  generate_arabic_subtitle
)

-- Function implementation
local function generate_arabic_subtitle()
  osd("Generating Arabic subtitle...")  -- Show OSD message
  emit_shortcut("generate_arabic_subtitle")  -- Send to IPC
end

-- Emit shortcut via user-data property
local function emit_shortcut(code)
  local payload = code .. ":" .. tostring(mp.get_time())
  mp.set_property_native("user-data/pitflix-shortcut", payload)
  print("[PITFLIX_SHORTCUT]" .. code)
  io.stdout:flush()
end
```

### Output Flow
```
Ctrl+G pressed
    ↓
generate_arabic_subtitle() called
    ↓
OSD message: "Generating Arabic subtitle..."
    ↓
print("[PITFLIX_SHORTCUT]generate_arabic_subtitle")
    ↓
Rust IPC loop reads stdout
    ↓
emit("player2-shortcut", "generate_arabic_subtitle")
    ↓
Frontend listener receives event
    ↓
PlayerPage switch case handles it
```

---

## 7. Caching Mechanism

### Cache Check
```rust
pub fn is_subtitle_cached(video_path: &str) -> bool {
  let cache_path = get_subtitle_output_path(video_path);
  // Example: /path/to/movie.ar.srt
  
  if cache_path.exists() {
    log("Found cached Arabic subtitle");
    return true;
  }
  return false;
}

pub fn get_subtitle_output_path(video_path: &str) -> PathBuf {
  // Input:  /path/to/movie.mkv
  // Output: /path/to/movie.ar.srt
  
  let file_stem = Path::new(video_path).file_stem();  // "movie"
  let parent = Path::new(video_path).parent();         // "/path/to"
  parent.join(format!("{}.ar.srt", file_stem))
}
```

### Cache Workflow
```
User clicks button on same video second time

First Run:
  ✗ Cache miss
  → Extract English subtitle
  → Translate to Arabic
  → Save as movie.ar.srt

Second Run:
  ✓ Cache hit
  → Return /path/to/movie.ar.srt immediately
  → Skip extraction and translation
  → Much faster!
```

---

## 8. Complete Data Flow Timeline

```
T=0ms:   User clicks "Generate Arabic Subtitle" button
         ├─ State: arabicSubtitleGenerating = true
         └─ UI: Button shows spinner

T=10ms:  Frontend invoke("generate-arabic-subtitle", { videoPath })
         └─ Sends to Tauri backend

T=20ms:  Rust: Check cache
         ├─ Cache miss → Continue
         └─ Cache hit → Return path (skip to T=500ms)

T=100ms: ffprobe detects subtitle tracks
         ├─ Find English track at index 0
         └─ Log: "[subtitle-gen] Found English track at index: 0"

T=200ms: ffmpeg extracts English subtitle
         ├─ Outputs: movie.temp.srt
         └─ Log: "[subtitle-gen] Extracting... completed successfully"

T=300ms: Parse SRT file
         ├─ Regex matches 342 cues
         └─ Log: "[subtitle-gen] Parsed 342 subtitle cues"

T=400ms: Translate to Arabic (MAIN WORK - Slowest Step)
         ├─ For each of 342 cues:
         │  ├─ Extract English text
         │  ├─ Call Argos Translate
         │  ├─ Get Arabic translation
         │  └─ Preserve timestamps
         └─ Log: "[subtitle-gen] Translating... done"

T=4400ms: Write translated SRT
         ├─ Outputs: movie.ar.srt
         └─ Log: "[subtitle-gen] SRT file written successfully"

T=4410ms: Clean up temp file
         └─ Delete: movie.temp.srt

T=4420ms: Return path to frontend
         ├─ Payload: "/path/to/movie.ar.srt"
         └─ Send to mpv: SubAddSelect

T=4500ms: mpv loads Arabic subtitle
         ├─ Parses .ar.srt file
         └─ Displays translated subtitles

T=5000ms: Frontend updates UI
         ├─ State: arabicSubtitleGenerating = false
         ├─ Button: Back to normal
         └─ Subtitle: Showing in Arabic
```

---

## 9. Error Handling

### Possible Errors & Messages

| Error | When | Message |
|-------|------|---------|
| No video path | State missing | "No video file path available" |
| ffprobe not found | Tool unavailable | "ffprobe error: ..." |
| No English track | Video has no English subtitle | "No English subtitle track found" |
| ffmpeg extraction fails | Extraction issue | "ffmpeg extraction failed: ..." |
| Argos not installed | Translation tool missing | "Argos translate error: ..." |
| Translation fails | Specific cue issue | "Translation error for line: ..." |
| File write fails | Permissions | "Failed to write SRT file: ..." |

### Debug Logging
Every step logs to stderr with `[generate-arabic-subtitle]` prefix:
```
[generate-arabic-subtitle] Starting with video_path: /path/to/movie.mkv
[generate-arabic-subtitle] Getting subtitle tracks...
[generate-arabic-subtitle] Found 2 tracks
[generate-arabic-subtitle] Found English track at index: 0
[generate-arabic-subtitle] Extracting English track 0...
[generate-arabic-subtitle] Translating to Arabic...
[generate-arabic-subtitle] Success! Output: /path/to/movie.ar.srt
```

---

## 10. Dependencies & Requirements

### External Tools
- **ffprobe** - Detect subtitle tracks
- **ffmpeg** - Extract subtitles to SRT format
- **Argos Translate** - Offline subtitle translation

### Rust Crates
- `regex` - SRT file parsing
- `serde_json` - ffprobe output parsing
- `tauri` - Backend command framework

### Installation

```bash
# Windows
choco install ffmpeg

# macOS
brew install ffmpeg

# Linux
sudo apt install ffmpeg

# Python (for Argos Translate)
pip install argostranslate

# Download English→Arabic model
python -m argostranslate.cli install-model en ar
```

---

## 11. Performance Characteristics

| Stage | Time | Notes |
|-------|------|-------|
| Cache lookup | <5ms | Near instant if cached |
| ffprobe detection | 50-200ms | Depends on video format |
| ffmpeg extraction | 100-500ms | Stream copy, relatively fast |
| SRT parsing | 10-50ms | Regex-based |
| Translation | 2000-8000ms | **SLOWEST** - CPU-intensive |
| SRT writing | 5-20ms | File I/O |
| **Total (first run)** | **~4000-9000ms** | **4-9 seconds** |
| **Total (cached)** | **<500ms** | **< 0.5 seconds** |

---

## Summary

The Arabic subtitle generation feature is a **complete offline translation pipeline**:

1. **Detects** English subtitles using ffprobe
2. **Extracts** them using ffmpeg  
3. **Parses** SRT format with regex
4. **Translates** each subtitle cue to Arabic with Argos
5. **Preserves** all timing and formatting
6. **Caches** results to avoid re-translation
7. **Auto-loads** in mpv for immediate viewing

All processing happens **offline and locally** with zero internet dependency! 🎯
