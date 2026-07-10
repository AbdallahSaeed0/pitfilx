//! Video thumbnail extraction & caching for the libmpv-embedded player.
//!
//! Port of the WPF `ThumbWorker` logic, simplified for Rust + Tauri.
//!
//!   • One ffmpeg keyframe scan at a time, on a background thread.
//!   • Each file is scanned at most once (marker file under cache dir).
//!   • Background bulk scan: one frame every 5s for fast warm cache.
//!   • Hover preview: 5s buckets — instant disk lookup, ffmpeg only on miss.
//!   • Cache root: `%LOCALAPPDATA%\Pitflix\thumbs\<sha1(filePath)>`.

use std::{
  fs,
  path::{Path, PathBuf},
  process::{Command, Stdio},
  sync::{
    atomic::{AtomicBool, AtomicU64, Ordering},
    Arc, Mutex,
  },
  thread,
  time::{Duration, Instant},
};

use sha1::{Digest, Sha1};
use tauri::ipc::Response;

const BUCKET_SECS: i64 = 5;
const HOVER_STEP_SECS: i64 = 5;
const PIXEL_WIDTH: i32 = 160;
/// Bump when thumbnail extraction logic changes (invalidates stale disk cache).
/// v5: bulk scan buckets by real ffmpeg `pts_time` instead of assuming frame
/// index N always means N * BUCKET_SECS seconds — old v4 caches can be
/// mis-bucketed for VFR/re-encoded source files and must not be reused.
const THUMB_CACHE_VERSION: &str = "v5";

static SCAN_GEN: AtomicU64 = AtomicU64::new(0);
static SCAN_RUNNING: AtomicBool = AtomicBool::new(false);
static SCAN_TARGET: Mutex<Option<String>> = Mutex::new(None);

/// Serializes on-demand ffmpeg extractions (`thumb_at`'s ffmpeg fallback) to
/// one at a time. A fast timeline sweep can queue up many distinct un-cached
/// buckets; letting them all spawn ffmpeg concurrently makes every single one
/// slower (they fight each other for disk/CPU — observed wait times went from
/// ~300-900ms isolated up to 5+ seconds under concurrent load) instead of
/// bounding the worst case to roughly N * (single-extraction time).
static ACCURATE_EXTRACT_GEN: AtomicU64 = AtomicU64::new(0);
static ACCURATE_EXTRACT_LOCK: Mutex<()> = Mutex::new(());

fn cache_root() -> PathBuf {
  let base = std::env::var("LOCALAPPDATA")
    .ok()
    .map(PathBuf::from)
    .unwrap_or_else(|| {
      std::env::temp_dir()
    });
  base.join("Pitflix").join("thumbs")
}

fn sha1_hex(s: &str) -> String {
  let mut hasher = Sha1::new();
  hasher.update(s.as_bytes());
  hasher.finalize().iter().map(|b| format!("{b:02x}")).collect()
}

fn file_cache_dir(file_path: &str) -> PathBuf {
  cache_root()
    .join(THUMB_CACHE_VERSION)
    .join(sha1_hex(&file_path.to_lowercase()))
}

fn hover_second(seconds: f64) -> i64 {
  if !seconds.is_finite() || seconds <= 0.0 {
    return 0;
  }
  ((seconds / HOVER_STEP_SECS as f64).round() as i64 * HOVER_STEP_SECS).max(0)
}

fn find_nearest_cached_frame_path(file_path: &str, second: i64) -> Option<PathBuf> {
  if let Some(p) = hover_frame_file(file_path, second) {
    return Some(p);
  }
  if let Some(p) = bulk_frame_file(file_path, second) {
    return Some(p);
  }
  for step in [HOVER_STEP_SECS, HOVER_STEP_SECS * 2] {
    if second >= step {
      if let Some(p) = hover_frame_file(file_path, second - step) {
        return Some(p);
      }
      if let Some(p) = bulk_frame_file(file_path, second - step) {
        return Some(p);
      }
    }
    if let Some(p) = hover_frame_file(file_path, second + step) {
      return Some(p);
    }
    if let Some(p) = bulk_frame_file(file_path, second + step) {
      return Some(p);
    }
  }
  None
}

fn frame_path(file_path: &str, bucket: i64) -> PathBuf {
  file_cache_dir(file_path).join(format!("{bucket}.jpg"))
}

fn hover_frame_path(file_path: &str, second: i64) -> PathBuf {
  file_cache_dir(file_path)
    .join("hover")
    .join(format!("{second:07}.jpg"))
}

fn done_marker(file_path: &str) -> PathBuf {
  file_cache_dir(file_path).join(".done")
}

/// Search candidate locations for an ffmpeg.exe. Bundled copy is checked first.
pub fn resolve_ffmpeg() -> Option<PathBuf> {
  find_ffmpeg()
}

fn find_ffmpeg() -> Option<PathBuf> {
  // 1) Bundled binary next to the Tauri exe (production).
  if let Ok(exe) = std::env::current_exe() {
    if let Some(parent) = exe.parent() {
      for rel in &["ffmpeg.exe", "binaries/ffmpeg.exe", "resources/binaries/ffmpeg.exe"] {
        let p = parent.join(rel);
        if p.is_file() {
          return Some(p);
        }
      }
    }
  }
  // 2) Dev-mode: src-tauri/binaries/ffmpeg.exe via CARGO_MANIFEST_DIR.
  #[cfg(dev)]
  {
    let p = PathBuf::from(env!("CARGO_MANIFEST_DIR")).join("binaries").join("ffmpeg.exe");
    if p.is_file() {
      return Some(p);
    }
  }
  // 3) PATH lookup.
  if let Some(path_env) = std::env::var_os("PATH") {
    for dir in std::env::split_paths(&path_env) {
      let p = dir.join("ffmpeg.exe");
      if p.is_file() {
        return Some(p);
      }
    }
  }
  // 4) WinGet shim.
  if let Ok(local) = std::env::var("LOCALAPPDATA") {
    let p = PathBuf::from(local)
      .join("Microsoft")
      .join("WinGet")
      .join("Links")
      .join("ffmpeg.exe");
    if p.is_file() {
      return Some(p);
    }
  }
  // 5) Harbor / Jellyfin bundled copies.
  if let Ok(local) = std::env::var("LOCALAPPDATA") {
    let p = PathBuf::from(local).join("Harbor").join("ffmpeg.exe");
    if p.is_file() {
      return Some(p);
    }
  }
  let jf = PathBuf::from(r"C:\Program Files\Jellyfin\Server\ffmpeg.exe");
  if jf.is_file() {
    return Some(jf);
  }
  None
}

#[tauri::command]
pub fn thumb_note_current(file_path: String) {
  if file_path.is_empty() {
    return;
  }
  // Already fully scanned?
  if done_marker(&file_path).is_file() {
    return;
  }
  {
    let mut g = SCAN_TARGET.lock().unwrap();
    *g = Some(file_path);
  }
  SCAN_GEN.fetch_add(1, Ordering::SeqCst);
  if SCAN_RUNNING.swap(true, Ordering::SeqCst) {
    return; // already running, will pick up new target on next loop iteration
  }
  thread::spawn(scan_loop);
}

fn scan_loop() {
  loop {
    let (path, gen) = {
      let g = SCAN_TARGET.lock().unwrap();
      match g.clone() {
        Some(p) => (p, SCAN_GEN.load(Ordering::SeqCst)),
        None => {
          SCAN_RUNNING.store(false, Ordering::SeqCst);
          return;
        }
      }
    };

    // Tiny settle (~250 ms) so we don't fight the player's file open. Bail out
    // if the user navigates away during the wait — fresh target reloads on the
    // next iteration.
    thread::sleep(Duration::from_millis(250));
    if SCAN_GEN.load(Ordering::SeqCst) != gen {
      continue;
    }

    let _ = scan_file(&path, gen);

    // Clear if target wasn't changed during the scan.
    let mut g = SCAN_TARGET.lock().unwrap();
    if SCAN_GEN.load(Ordering::SeqCst) == gen {
      *g = None;
      SCAN_RUNNING.store(false, Ordering::SeqCst);
      return;
    }
  }
}

fn scan_file(file_path: &str, gen: u64) -> Result<(), String> {
  if done_marker(file_path).is_file() {
    return Ok(());
  }
  let ffmpeg = find_ffmpeg().ok_or_else(|| "ffmpeg not found".to_string())?;
  let cache_dir = file_cache_dir(file_path);
  fs::create_dir_all(&cache_dir).ok();

  let tmp = std::env::temp_dir().join(format!("pf-thumbgen-{}", uuid::Uuid::new_v4()));
  fs::create_dir_all(&tmp).ok();

  // Fixed-interval sampling: one frame every BUCKET_SECS seconds for the whole
  // file in a single ffmpeg invocation. This is dramatically faster than
  // per-hover spawns and keeps ffmpeg's codec state warm between samples.
  // `fps=1/N` *usually* emits one frame per N input seconds, but that's only
  // exact for perfectly-timestamped CFR input — re-encoded/VFR source files
  // (common for downloaded episodes) can drift, so frame index N doesn't
  // reliably mean "N * BUCKET_SECS seconds in". `showinfo` reports each
  // emitted frame's real `pts_time`, which the stderr reader thread below
  // parses so buckets are keyed by actual timestamp, not by frame count.
  let mut cmd = Command::new(&ffmpeg);
  cmd.args([
    "-hide_banner",
    "-loglevel", "info",
    "-hwaccel", "auto",
    "-i", file_path,
    "-an", "-sn", "-dn",
    "-vf", &format!("fps=1/{BUCKET_SECS},scale={PIXEL_WIDTH}:-2,showinfo"),
    "-qscale:v", "5",
    "-y",
  ]);
  let out_pattern = tmp.join("f_%05d.jpg");
  cmd.arg(&out_pattern);
  cmd.stdin(Stdio::null()).stdout(Stdio::null()).stderr(Stdio::piped());
  #[cfg(windows)]
  {
    use std::os::windows::process::CommandExt;
    const CREATE_NO_WINDOW: u32 = 0x0800_0000;
    cmd.creation_flags(CREATE_NO_WINDOW);
  }
  // Background mode (not just below-normal CPU priority) so the bulk scan's
  // sequential full-file decode yields *disk I/O* bandwidth too — it competes
  // for the same physical disk as live mpv playback and on-demand hover
  // extraction, and CPU priority alone doesn't affect I/O scheduling.
  let mut child = cmd.spawn().map_err(|e| format!("ffmpeg spawn: {e}"))?;
  #[cfg(windows)]
  unsafe {
    use windows::Win32::System::Threading::{
      OpenProcess, SetPriorityClass, PROCESS_MODE_BACKGROUND_BEGIN, PROCESS_SET_INFORMATION,
    };
    if let Ok(handle) = OpenProcess(PROCESS_SET_INFORMATION, false, child.id()) {
      let _ = SetPriorityClass(handle, PROCESS_MODE_BACKGROUND_BEGIN);
    }
  }

  // Read stderr on a background thread, parsing each `showinfo` line's
  // `pts_time:` into a running list — index i is frame i's real timestamp.
  let pts_by_index: Arc<Mutex<Vec<f64>>> = Arc::new(Mutex::new(Vec::new()));
  let stderr_reader = {
    let pts_by_index = pts_by_index.clone();
    child.stderr.take().map(|stderr| {
      thread::spawn(move || {
        use std::io::{BufRead, BufReader};
        for line in BufReader::new(stderr).lines().map_while(Result::ok) {
          if let Some(pts) = parse_showinfo_pts_time(&line) {
            pts_by_index.lock().unwrap().push(pts);
          }
        }
      })
    })
  };

  // Poll for cancellation while ffmpeg is running, and also publish frames to
  // the cache as they appear so the hover tooltip starts hitting cache quickly.
  let mut next_bucket: i64 = 0;
  let mut last_publish = Instant::now();
  loop {
    if SCAN_GEN.load(Ordering::SeqCst) != gen {
      let _ = child.kill();
      let _ = fs::remove_dir_all(&tmp);
      return Ok(());
    }
    match child.try_wait() {
      Ok(Some(_)) => break,
      Ok(None) => {}
      Err(_) => break,
    }
    // Every ~150 ms, publish any new f_NNNNN.jpg files into cache as bucket files.
    if last_publish.elapsed().as_millis() > 150 {
      next_bucket = publish_new_frames(&tmp, file_path, next_bucket, &pts_by_index);
      last_publish = Instant::now();
    }
    thread::sleep(Duration::from_millis(40));
  }
  // ffmpeg exited — join the stderr reader so every frame's pts_time is
  // parsed before the final publish pass (otherwise the last few frames
  // would race the reader thread and silently fall behind).
  if let Some(handle) = stderr_reader {
    let _ = handle.join();
  }
  // Final publish pass.
  let _ = publish_new_frames(&tmp, file_path, next_bucket, &pts_by_index);

  let _ = fs::remove_dir_all(&tmp);
  let _ = fs::write(done_marker(file_path), b"ok");
  Ok(())
}

fn parse_showinfo_pts_time(line: &str) -> Option<f64> {
  let after = line.split("pts_time:").nth(1)?;
  let token = after.split_whitespace().next()?;
  token.parse::<f64>().ok()
}

/// Move `tmp/f_NNNNN.jpg` files to `<cache>/<bucket>.jpg`, keyed by each
/// frame's real `pts_time` (not by frame index — see the scan_file comment on
/// why the naive index * BUCKET_SECS assumption drifts). Returns the next
/// frame index to resume from on the next pass.
fn publish_new_frames(tmp: &Path, file_path: &str, start_idx: i64, pts_by_index: &Mutex<Vec<f64>>) -> i64 {
  let mut idx = start_idx;
  loop {
    let src = tmp.join(format!("f_{:05}.jpg", idx + 1));
    if !src.is_file() {
      return idx;
    }
    let pts = pts_by_index.lock().unwrap().get(idx as usize).copied();
    let Some(pts) = pts else {
      // The JPG landed on disk before its showinfo stderr line was parsed —
      // wait for the next poll rather than guessing a bucket from index alone.
      return idx;
    };
    let bucket = ((pts / BUCKET_SECS as f64).round() as i64) * BUCKET_SECS;
    let naive_bucket = idx * BUCKET_SECS;
    if (bucket - naive_bucket).abs() >= BUCKET_SECS {
      eprintln!(
        "[thumb] bulk-scan drift frame={idx} pts={pts:.2}s bucket={bucket} naive_bucket={naive_bucket} drift={}s",
        bucket - naive_bucket
      );
    }
    let dst = frame_path(file_path, bucket);
    // Bulk-scan frames are timeline-accurate; replace any quick on-demand placeholder.
    let _ = fs::remove_file(&dst);
    let _ = fs::rename(&src, &dst);
    idx += 1;
  }
}

/// Returns the hover-cache path for `second` if it holds a valid JPEG. Reads
/// only file metadata (no content read) — callers hand the path to the
/// frontend's asset protocol instead of shipping bytes over IPC.
fn hover_frame_file(file_path: &str, second: i64) -> Option<PathBuf> {
  let p = hover_frame_path(file_path, second);
  match fs::metadata(&p) {
    Ok(meta) if is_valid_jpeg_len(meta.len()) => Some(p),
    Ok(_) => {
      let _ = fs::remove_file(&p);
      None
    }
    Err(_) => None,
  }
}

fn bulk_frame_file(file_path: &str, second: i64) -> Option<PathBuf> {
  if second % BUCKET_SECS != 0 {
    return None;
  }
  let p = frame_path(file_path, second);
  match fs::metadata(&p) {
    Ok(meta) if is_valid_jpeg_len(meta.len()) => Some(p),
    _ => None,
  }
}

fn is_valid_jpeg_len(len: u64) -> bool {
  len >= 1200
}

fn run_extract_cmd(cmd: &mut Command, dst: &Path) -> Result<(), String> {
  let spawn_start = Instant::now();
  let mut child = cmd.spawn().map_err(|e| format!("ffmpeg spawn: {e}"))?;
  let spawn_ms = spawn_start.elapsed().as_millis();
  #[cfg(windows)]
  unsafe {
    use windows::Win32::System::Threading::{
      OpenProcess, SetPriorityClass, BELOW_NORMAL_PRIORITY_CLASS, PROCESS_SET_INFORMATION,
    };
    if let Ok(handle) = OpenProcess(PROCESS_SET_INFORMATION, false, child.id()) {
      let _ = SetPriorityClass(handle, BELOW_NORMAL_PRIORITY_CLASS);
    }
  }
  let wait_start = Instant::now();
  let status = child.wait().map_err(|e| format!("ffmpeg wait: {e}"))?;
  eprintln!(
    "[thumb] ffmpeg spawn={spawn_ms}ms wait={}ms dst={}",
    wait_start.elapsed().as_millis(),
    dst.display()
  );
  if !status.success() {
    return Err(format!("ffmpeg exit code {:?}", status.code()));
  }
  let meta = fs::metadata(dst).map_err(|e| e.to_string())?;
  if !is_valid_jpeg_len(meta.len()) {
    return Err("thumbnail frame was empty".to_string());
  }
  Ok(())
}

fn build_extract_cmd(ffmpeg: &Path, file_path: &str, second: i64, dst: &Path) -> Command {
  let sec_s = format!("{}", second.max(0));
  let mut cmd = Command::new(ffmpeg);
  cmd.args([
    "-hide_banner",
    "-loglevel",
    "error",
    "-hwaccel",
    "auto",
    "-ss",
    &sec_s,
    "-i",
    file_path,
    "-an",
    "-sn",
    "-dn",
    "-frames:v",
    "1",
    "-vf",
    &format!("scale={PIXEL_WIDTH}:-2"),
    "-qscale:v",
    "8",
    "-threads",
    "4",
    "-y",
  ]);
  cmd.arg(dst);
  cmd.stdin(Stdio::null()).stdout(Stdio::null()).stderr(Stdio::null());
  #[cfg(windows)]
  {
    use std::os::windows::process::CommandExt;
    const CREATE_NO_WINDOW: u32 = 0x0800_0000;
    cmd.creation_flags(CREATE_NO_WINDOW);
  }
  cmd
}

fn extract_frame_at_second(file_path: &str, second: i64) -> Result<PathBuf, String> {
  let t0 = Instant::now();
  let ffmpeg = find_ffmpeg().ok_or_else(|| "ffmpeg not found".to_string())?;
  eprintln!("[thumb] find_ffmpeg={}ms", t0.elapsed().as_millis());
  let cache_dir = file_cache_dir(file_path);
  fs::create_dir_all(cache_dir.join("hover")).ok();
  let dst = hover_frame_path(file_path, second);
  let mut fast = build_extract_cmd(&ffmpeg, file_path, second, &dst);
  run_extract_cmd(&mut fast, &dst)?;
  eprintln!("[thumb] extract_frame_at_second total={}ms second={second}", t0.elapsed().as_millis());
  Ok(dst)
}

fn thumb_at_quick_sync(file_path: String, seconds: f64) -> Result<String, String> {
  if file_path.is_empty() {
    return Err("empty file_path".to_string());
  }
  let t0 = Instant::now();
  let second = hover_second(seconds);
  let result = find_nearest_cached_frame_path(&file_path, second)
    .map(|p| p.to_string_lossy().into_owned())
    .ok_or_else(|| "no cached thumbnail".to_string());
  eprintln!(
    "[thumb] thumb_at_quick second={second} hit={} total={}ms",
    result.is_ok(),
    t0.elapsed().as_millis()
  );
  result
}

fn thumb_at_sync(file_path: String, seconds: f64) -> Result<String, String> {
  if file_path.is_empty() {
    return Err("empty file_path".to_string());
  }
  let t0 = Instant::now();
  let second = hover_second(seconds);

  if let Some(p) = hover_frame_file(&file_path, second) {
    eprintln!("[thumb] thumb_at second={second} source=hover-cache total={}ms", t0.elapsed().as_millis());
    return Ok(p.to_string_lossy().into_owned());
  }

  if let Some(p) = bulk_frame_file(&file_path, second) {
    // Promote bulk frame into hover cache so the next lookup is instant.
    let hover_dst = hover_frame_path(&file_path, second);
    let _ = fs::copy(&p, &hover_dst);
    eprintln!("[thumb] thumb_at second={second} source=bulk-cache total={}ms", t0.elapsed().as_millis());
    return Ok(hover_dst.to_string_lossy().into_owned());
  }

  // Only one ffmpeg extraction runs at a time (see ACCURATE_EXTRACT_LOCK doc
  // comment). Register this request as the latest before waiting for the
  // lock; if a newer hover position registers and grabs the lock first, this
  // one is stale by the time it would run — bail instead of spawning ffmpeg
  // for a position the user has already moved past.
  let my_gen = ACCURATE_EXTRACT_GEN.fetch_add(1, Ordering::SeqCst) + 1;
  let _extract_guard = ACCURATE_EXTRACT_LOCK.lock().unwrap();
  if ACCURATE_EXTRACT_GEN.load(Ordering::SeqCst) != my_gen {
    eprintln!("[thumb] thumb_at second={second} superseded queue_wait={}ms", t0.elapsed().as_millis());
    return Err("superseded by newer hover position".to_string());
  }

  eprintln!("[thumb] thumb_at second={second} source=ffmpeg-extract starting (queue_wait={}ms)", t0.elapsed().as_millis());
  let out = extract_frame_at_second(&file_path, second).map(|p| p.to_string_lossy().into_owned());
  eprintln!("[thumb] thumb_at second={second} source=ffmpeg-extract total={}ms ok={}", t0.elapsed().as_millis(), out.is_ok());
  out
}

/// Instant disk-only thumbnail (bulk / hover cache). No ffmpeg. Returns raw
/// JPEG bytes via `tauri::ipc::Response` — a binary IPC payload, not a
/// JSON `number[]` (which is dramatically more expensive to encode/decode,
/// especially under the request bursts a fast timeline sweep produces) and
/// not a `convertFileSrc` path either: routing images through a separate
/// asset-protocol `<img>` fetch moves them off the invoke channel entirely,
/// where they're subject to the webview's per-origin connection limits —
/// invisible to this file's timing logs and, empirically, slower under a
/// sweep than paying JSON overhead was. One round trip, raw bytes, done.
#[tauri::command]
pub fn thumb_at_quick(file_path: String, seconds: f64) -> Result<Response, String> {
  let path = thumb_at_quick_sync(file_path, seconds)?;
  let bytes = fs::read(&path).map_err(|e| e.to_string())?;
  Ok(Response::new(bytes))
}

/// Return raw JPEG bytes for `seconds`. Uses cache first, then ffmpeg on
/// miss. See `thumb_at_quick` for why this returns bytes via `Response`
/// instead of a path or a JSON array.
#[tauri::command]
pub async fn thumb_at(file_path: String, seconds: f64) -> Result<Response, String> {
  let dispatch_t0 = Instant::now();
  let path = tauri::async_runtime::spawn_blocking(move || {
    let pool_wait_ms = dispatch_t0.elapsed().as_millis();
    if pool_wait_ms > 20 {
      eprintln!("[thumb] thumb_at blocking-pool queue wait={pool_wait_ms}ms");
    }
    thumb_at_sync(file_path, seconds)
  })
  .await
  .map_err(|e| format!("thumbnail lookup interrupted: {e}"))??;
  let bytes = fs::read(&path).map_err(|e| e.to_string())?;
  eprintln!("[thumb] thumb_at command round-trip total={}ms", dispatch_t0.elapsed().as_millis());
  Ok(Response::new(bytes))
}

/// One-shot single-frame poster for a file (for playlist tiles). Uses ffmpeg
/// `-ss <t> -frames:v 1`. Cached as `<cache_dir>/poster.jpg`.
///
/// Runs the ffmpeg wait on a blocking-pool thread (like `thumb_at` above) —
/// `Command::status()` blocks for the duration of the extraction (100s of ms
/// to seconds on a cold cache), and running that inline on an async runtime
/// worker thread stalled other in-flight IPC calls (seek-bar hover prefetch,
/// state polling) whenever a playlist tile needed an uncached poster.
#[tauri::command]
pub async fn thumb_poster(file_path: String, at_seconds: Option<f64>) -> Result<Vec<u8>, String> {
  tauri::async_runtime::spawn_blocking(move || thumb_poster_sync(file_path, at_seconds))
    .await
    .map_err(|e| format!("thumbnail poster interrupted: {e}"))?
}

fn thumb_poster_sync(file_path: String, at_seconds: Option<f64>) -> Result<Vec<u8>, String> {
  if file_path.is_empty() {
    return Err("empty file_path".to_string());
  }
  let cache_dir = file_cache_dir(&file_path);
  fs::create_dir_all(&cache_dir).ok();
  let dst = cache_dir.join("poster.jpg");
  if let Ok(meta) = fs::metadata(&dst) {
    if meta.len() > 0 {
      return fs::read(&dst).map_err(|e| e.to_string());
    }
  }
  let ffmpeg = find_ffmpeg().ok_or_else(|| "ffmpeg not found".to_string())?;
  let at = at_seconds.unwrap_or(60.0).max(0.0);
  let mut cmd = Command::new(&ffmpeg);
  cmd.args([
    "-hide_banner",
    "-ss", &format!("{at}"),
    "-i", &file_path,
    "-frames:v", "1",
    "-vf", &format!("scale={PIXEL_WIDTH}:-2"),
    "-qscale:v", "5",
    "-y",
  ]);
  cmd.arg(&dst);
  cmd.stdin(Stdio::null()).stdout(Stdio::null()).stderr(Stdio::null());
  #[cfg(windows)]
  {
    use std::os::windows::process::CommandExt;
    const CREATE_NO_WINDOW: u32 = 0x0800_0000;
    cmd.creation_flags(CREATE_NO_WINDOW);
  }
  let status = cmd.status().map_err(|e| e.to_string())?;
  if !status.success() {
    return Err(format!("ffmpeg exit code {:?}", status.code()));
  }
  fs::read(&dst).map_err(|e| e.to_string())
}
