//! Video thumbnail extraction & caching for the libmpv-embedded player.
//!
//! Port of the WPF `ThumbWorker` logic, simplified for Rust + Tauri.
//!
//!   • One ffmpeg keyframe scan at a time, on a background thread.
//!   • Each file is scanned at most once (marker file under cache dir).
//!   • 5-second bucket granularity; lookup returns nearest cached JPEG.
//!   • Cache root: `%LOCALAPPDATA%\Pitflix\thumbs\<sha1(filePath)>`.

use std::{
  fs,
  path::{Path, PathBuf},
  process::{Command, Stdio},
  sync::{
    atomic::{AtomicBool, AtomicU64, Ordering},
    Mutex,
  },
  thread,
  time::Duration,
};

use sha1::{Digest, Sha1};

const BUCKET_SECS: i64 = 10;
const PIXEL_WIDTH: i32 = 160;

static SCAN_GEN: AtomicU64 = AtomicU64::new(0);
static SCAN_RUNNING: AtomicBool = AtomicBool::new(false);
static SCAN_TARGET: Mutex<Option<String>> = Mutex::new(None);

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
  cache_root().join(sha1_hex(&file_path.to_lowercase()))
}

fn bucket_for(seconds: f64) -> i64 {
  let b = (seconds / BUCKET_SECS as f64).round() as i64 * BUCKET_SECS;
  b.max(0)
}

fn frame_path(file_path: &str, bucket: i64) -> PathBuf {
  file_cache_dir(file_path).join(format!("{bucket}.jpg"))
}

fn done_marker(file_path: &str) -> PathBuf {
  file_cache_dir(file_path).join(".done")
}

/// Search candidate locations for an ffmpeg.exe. Bundled copy is checked first.
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

  // Uniform fixed-interval sampling: one frame every BUCKET_SECS seconds for the
  // whole file in a single ffmpeg invocation. This is dramatically faster than
  // per-hover spawns and keeps ffmpeg's codec state warm between samples.
  // `fps=1/N` filter emits exactly 1 frame per N input seconds; output filenames
  // are 1-indexed by frame number, so out file N covers bucket (N-1) * BUCKET_SECS.
  let mut cmd = Command::new(&ffmpeg);
  cmd.args([
    "-hide_banner",
    "-loglevel", "error",
    "-hwaccel", "auto",
    "-i", file_path,
    "-an", "-sn", "-dn",
    "-vf", &format!("fps=1/{BUCKET_SECS},scale={PIXEL_WIDTH}:-2"),
    "-qscale:v", "5",
    "-y",
  ]);
  let out_pattern = tmp.join("f_%05d.jpg");
  cmd.arg(&out_pattern);
  cmd.stdin(Stdio::null()).stdout(Stdio::null()).stderr(Stdio::null());
  #[cfg(windows)]
  {
    use std::os::windows::process::CommandExt;
    const CREATE_NO_WINDOW: u32 = 0x0800_0000;
    cmd.creation_flags(CREATE_NO_WINDOW);
  }
  // Set below-normal priority so the bulk scan never starves the player.
  let mut child = cmd.spawn().map_err(|e| format!("ffmpeg spawn: {e}"))?;
  #[cfg(windows)]
  unsafe {
    use windows::Win32::System::Threading::{
      OpenProcess, SetPriorityClass, BELOW_NORMAL_PRIORITY_CLASS, PROCESS_SET_INFORMATION,
    };
    if let Ok(handle) = OpenProcess(PROCESS_SET_INFORMATION, false, child.id()) {
      let _ = SetPriorityClass(handle, BELOW_NORMAL_PRIORITY_CLASS);
    }
  }

  // Poll for cancellation while ffmpeg is running, and also publish frames to
  // the cache as they appear so the hover tooltip starts hitting cache quickly.
  use std::time::Instant;
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
      next_bucket = publish_new_frames(&tmp, file_path, next_bucket);
      last_publish = Instant::now();
    }
    thread::sleep(Duration::from_millis(40));
  }
  // Final publish pass.
  let _ = publish_new_frames(&tmp, file_path, next_bucket);

  let _ = fs::remove_dir_all(&tmp);
  let _ = fs::write(done_marker(file_path), b"ok");
  Ok(())
}

/// Move `tmp/f_NNNNN.jpg` files to `<cache>/<bucket>.jpg`. Returns the next
/// bucket index to start from on the next pass (so we don't re-scan files).
fn publish_new_frames(tmp: &Path, file_path: &str, start_idx: i64) -> i64 {
  let mut idx = start_idx;
  loop {
    let src = tmp.join(format!("f_{:05}.jpg", idx + 1));
    if !src.is_file() {
      return idx;
    }
    let bucket = idx * BUCKET_SECS;
    let dst = frame_path(file_path, bucket);
    // Skip if already present (could be from the on-demand fallback).
    if !dst.is_file() {
      let _ = fs::rename(&src, &dst);
    } else {
      let _ = fs::remove_file(&src);
    }
    idx += 1;
  }
}

/// Return a thumbnail JPEG for `seconds`. Tries the on-disk cache first; on miss
/// does an on-demand single-frame extract (`ffmpeg -ss <t> -frames:v 1`) so the
/// user gets a frame in ~200-500 ms instead of waiting on the bulk scan.
#[tauri::command]
pub fn thumb_at(file_path: String, seconds: f64) -> Result<Vec<u8>, String> {
  if file_path.is_empty() {
    return Err("empty file_path".to_string());
  }
  // 1) Disk cache lookup — nearest bucket within ~2 minutes.
  let center = bucket_for(seconds);
  let max_r = 24i64;
  for r in 0..=max_r {
    for sign in &[1i64, -1] {
      let b = center + sign * r * BUCKET_SECS;
      if b < 0 {
        continue;
      }
      let p = frame_path(&file_path, b);
      if let Ok(meta) = fs::metadata(&p) {
        if meta.len() > 0 {
          return fs::read(&p).map_err(|e| e.to_string());
        }
      }
      if r == 0 {
        break;
      }
    }
  }
  // 2) Miss — fall back to a quick on-demand extract at the exact bucket.
  let ffmpeg = find_ffmpeg().ok_or_else(|| "ffmpeg not found".to_string())?;
  let cache_dir = file_cache_dir(&file_path);
  fs::create_dir_all(&cache_dir).ok();
  let dst = frame_path(&file_path, center);
  // `-ss` BEFORE `-i` = fast input seek (keyframe-only, no per-frame decode walk).
  // `-noaccurate_seek` skips the precise-seek post-processing — fine for hover
  // previews because we're already snapping to the nearest 10s bucket.
  // `-threads 2` keeps the spawn light but uses multi-thread decode for big files.
  let mut cmd = Command::new(&ffmpeg);
  cmd.args([
    "-hide_banner",
    "-loglevel", "error",
    "-noaccurate_seek",
    "-ss", &format!("{}", center as f64),
    "-i", &file_path,
    "-frames:v", "1",
    "-vf", &format!("scale={PIXEL_WIDTH}:-2"),
    "-qscale:v", "5",
    "-threads", "2",
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
  let status = cmd.status().map_err(|e| format!("ffmpeg: {e}"))?;
  if !status.success() {
    return Err(format!("ffmpeg exit code {:?}", status.code()));
  }
  fs::read(&dst).map_err(|e| e.to_string())
}

/// One-shot single-frame poster for a file (for playlist tiles). Uses ffmpeg
/// `-ss <t> -frames:v 1`. Cached as `<cache_dir>/poster.jpg`.
#[tauri::command]
pub fn thumb_poster(file_path: String, at_seconds: Option<f64>) -> Result<Vec<u8>, String> {
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
