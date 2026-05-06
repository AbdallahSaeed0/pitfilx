# Arabic Subtitle Generation Feature

## Overview
This feature enables offline, free Arabic subtitle generation from embedded English subtitles using ffprobe, ffmpeg, and Argos Translate.

## Files Modified / Created

### 1. **Dependencies** (`Cargo.toml`)
Added:
- `regex = "1"` - for SRT parsing
- `walkdir = "2"` - for file system operations (optional enhancement)

### 2. **New Module: Subtitle Generator** (`src/player/subtitle_generator.rs`)
Complete module handling all subtitle operations:

**Public Functions:**
- `get_subtitle_tracks(video_path)` → `Result<Vec<SubtitleTrack>>`
  - Uses ffprobe to detect all subtitle tracks with language and title
  
- `find_english_subtitle_track(tracks)` → `Option<SubtitleTrack>`
  - Automatically selects English track (en/eng/english)
  
- `extract_subtitle_to_srt(video_path, track_index, output_srt)` → `Result<()>`
  - Uses ffmpeg to extract subtitle track to SRT file
  
- `parse_srt_file(srt_path)` → `Result<Vec<SubtitleCue>>`
  - Regex-based SRT parser, preserves timestamps and formatting
  
- `translate_cue_with_argos(text)` → `Result<String>`
  - Translates single cue-by-cue using Argos Translate CLI
  - Tries both `argospm-translate` and Python module fallback
  
- `write_srt_file(cues, output_path)` → `Result<()>`
  - Writes translated cues back to SRT format
  
- `get_subtitle_output_path(video_path)` → `PathBuf`
  - Returns `{MovieName}.ar.srt` in same directory
  
- `is_subtitle_cached(video_path)` → `bool`
  - Checks if Arabic subtitle already exists (cache)

**Progress Logging:**
All operations log to stderr with `[subtitle-gen]` prefix:
```
[subtitle-gen] Detecting subtitle tracks in: /path/to/movie.mkv
[subtitle-gen] Found track 0: eng (English)
[subtitle-gen] Found English track at index: 0
[subtitle-gen] Extracting subtitle track 0 to: /path/to/movie.ar.srt
[subtitle-gen] Parsing SRT file: /tmp/movie.temp.srt
[subtitle-gen] Parsed 342 subtitle cues
[subtitle-gen] Writing 342 cues to: /path/to/movie.ar.srt
[subtitle-gen] SRT file written successfully
```

### 3. **Player Module Updates** (`src/player/mod.rs`)
Added module declaration:
```rust
pub mod subtitle_generator;
```

### 4. **Tauri Commands** (`src/player/tauri_commands.rs`)
Added 4 new Tauri commands:

```rust
#[tauri::command]
pub fn get_subtitle_tracks(video_path: String) -> Result<Vec<SubtitleTrack>, String>

#[tauri::command]
pub fn extract_subtitle(video_path: String, track_index: i32, output_path: String) -> Result<(), String>

#[tauri::command]
pub fn translate_srt_to_arabic(srt_path: String, output_path: String) -> Result<(), String>

#[tauri::command]
pub fn generate_arabic_subtitle(video_path: String) -> Result<String, String>
```

**Main orchestrator command (`generate_arabic_subtitle`):**
1. Checks cache → if exists, returns cached path
2. Gets subtitle tracks via ffprobe
3. Finds English track (fails if not found)
4. Extracts English SRT to temp file
5. Translates temp SRT to Arabic
6. Cleans up temp file
7. Returns output path

### 5. **Tauri Handler Registration** (`src/lib.rs`)
Added imports and registered all 4 commands in `invoke_handler`:
```rust
generate_handler![
    // ... existing commands ...
    get_subtitle_tracks,
    extract_subtitle,
    translate_srt_to_arabic,
    generate_arabic_subtitle,
]
```

### 6. **Player UI** (`src/pages/PlayerPage.tsx`)

**State:**
```typescript
const [arabicSubtitleGenerating, setArabicSubtitleGenerating] = useState(false);
const [arabicSubtitleError, setArabicSubtitleError] = useState<string | null>(null);
```

**Handler:**
```typescript
const generateArabicSubtitle = useCallback(async () => {
  if (!state?.filePath) {
    setArabicSubtitleError("No video file path available");
    return;
  }
  
  setArabicSubtitleGenerating(true);
  setArabicSubtitleError(null);
  
  try {
    const outputPath = await invoke<string>("generate_arabic_subtitle", {
      videoPath: state.filePath,
    });
    
    // Auto-load the generated subtitle in mpv
    await send({ type: "SubAddSelect", payload: outputPath });
    
    setTimeout(() => {
      setArabicSubtitleGenerating(false);
    }, 500);
  } catch (err) {
    const errorMsg = err instanceof Error ? err.message : String(err);
    setArabicSubtitleError(errorMsg);
    setArabicSubtitleGenerating(false);
  }
}, [state?.filePath, send]);
```

**UI Button (in Subtitles menu):**
Located in the subtitle panel, after "Appearance" section:

```tsx
<div className="border-t border-white/10 pt-2 mt-2">
  <p className="text-[9px] uppercase tracking-wide text-pitflix-muted mb-2">
    Generate Arabic Subtitle
  </p>
  <button
    type="button"
    disabled={sessionBlocksTransport || arabicSubtitleGenerating}
    className="w-full rounded-md border border-pitflix-primary/50 bg-pitflix-primary/10 px-2 py-1.5 text-[10px] text-pitflix-primary hover:bg-pitflix-primary/20 disabled:opacity-40"
    title="Extract English subtitle and translate to Arabic using Argos Translate"
    onClick={() => void generateArabicSubtitle()}
  >
    {arabicSubtitleGenerating ? "Generating..." : "Generate Arabic Subtitle"}
  </button>
  {arabicSubtitleError && (
    <p className="mt-1 text-[9px] text-red-400">{arabicSubtitleError}</p>
  )}
</div>
```

## Feature Behavior

### User Flow:
1. Click **Captions button** in player controls
2. Scroll down to **"Generate Arabic Subtitle"** section
3. Click **"Generate Arabic Subtitle"** button
4. Button shows **"Generating..."** while processing
5. On success:
   - Arabic subtitle automatically loads in mpv
   - Button returns to normal state
   - File saved as `{MovieName}.ar.srt` next to video
6. On error:
   - Error message displayed below button
   - User can retry or troubleshoot

### Caching:
- If `{MovieName}.ar.srt` already exists, skips extraction/translation
- Returns cached file path immediately
- Reduces redundant processing for same video

### Error Handling:
- If no English subtitle found → "No English subtitle track found"
- If ffmpeg fails → FFmpeg error message shown
- If translation fails → Translation error message shown
- If file operations fail → File system error message shown

## Prerequisites

Users must have installed:
1. **ffprobe** (from FFmpeg)
   - Windows: via choco or from ffmpeg.org
   - Linux: `apt install ffmpeg`
   - macOS: `brew install ffmpeg`

2. **ffmpeg** (for subtitle extraction)
   - Same as above

3. **Argos Translate** (offline translation)
   ```bash
   pip install argostranslate
   # Download English→Arabic model once:
   python -m argostranslate.cli install-model en ar
   ```
   - Or use: `argospm` package manager for pre-built models

## Testing

### Manual Test:
1. Find a video with embedded English subtitles
2. Open in Pitflix player
3. Click Captions → "Generate Arabic Subtitle"
4. Check logs: `[subtitle-gen]` messages show progress
5. Verify `VideoName.ar.srt` created in same folder
6. Verify subtitle loads and displays in player

### Check Generated File:
```bash
# View first 20 lines of generated Arabic subtitle
head -20 "Movie Title.ar.srt"
```

Output should look like:
```
1
00:00:01,234 --> 00:00:05,678
السلام عليكم ورحمة الله وبركاته

2
00:00:06,000 --> 00:00:10,500
كيف حالك؟
...
```

## Performance Notes

- **Extraction:** Fast (~1-3 seconds depending on video)
- **Translation:** Slow (~2-5 seconds per subtitle or slower depending on total subtitle count)
  - Argos Translate runs on CPU, single-threaded
  - No external API calls needed (offline)
- **Overall:** First run ~5-15 seconds total
- **Subsequent runs:** <500ms (cache lookup)

## Limitations & Future Enhancements

Current:
- English → Arabic only (hardcoded lang pair)
- Subtitle-by-subtitle translation (slow for large files)

Possible enhancements:
- Multi-language support (selectable source/target)
- Batch translation using Argos Translate Python API
- Progress callback to UI (show cue-by-cue progress)
- Parallel translation workers
- Support for other subtitle formats (ASS, VTT, SUB)
- Fallback to Google Translate API if Argos unavailable

## Troubleshooting

| Issue | Solution |
|-------|----------|
| "ffprobe error" | Install ffmpeg: `choco install ffmpeg` (Windows) or `brew install ffmpeg` (macOS) |
| "No English subtitle found" | Video must have English subtitle track embedded. Use external subtitle picker as fallback. |
| "Translation failed" | Install Argos: `pip install argostranslate` and download model: `python -m argostranslate.cli install-model en ar` |
| Button disabled | Player is still loading or subtitle generation in progress. Wait a moment and retry. |
| File not saved | Check video folder permissions, ensure parent directory is writable |
| Very slow generation | Argos Translate is CPU-bound. Larger subtitle files take longer. Check system resources. |
