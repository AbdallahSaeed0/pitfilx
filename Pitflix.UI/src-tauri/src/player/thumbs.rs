//! Video thumbnail extraction & caching for the libmpv-embedded player.
//!
//! Port of the WPF `ThumbWorker` logic, simplified for Rust + Tauri.
//!
//!   • One ffmpeg keyframe scan at a time, on a background thread.
//!   • Each file is scanned at most once (marker file under cache dir).
//!   • Background bulk scan, two passes: keyframes only first (~12x faster, covers most
//!     buckets within seconds), then the full-decode pass that makes every bucket exact.
//!   • Hover preview: 5s buckets — instant disk lookup, ffmpeg only on miss.
//!   • Cache root: `%LOCALAPPDATA%\Pitflix\thumbs\<sha1(filePath)>`.

use std::{
    collections::HashMap,
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
        .unwrap_or_else(|| std::env::temp_dir());
    base.join("Pitflix").join("thumbs")
}

fn sha1_hex(s: &str) -> String {
    let mut hasher = Sha1::new();
    hasher.update(s.as_bytes());
    hasher
        .finalize()
        .iter()
        .map(|b| format!("{b:02x}"))
        .collect()
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

/// Nearest saved frame and the real time (seconds) it shows. Hover-cache frames were extracted at
/// exactly their second; bulk frames are keyframes, whose real time comes from the scan's index —
/// so the player can seek to precisely the frame the preview showed.
fn find_nearest_cached_frame_path(file_path: &str, second: i64) -> Option<(PathBuf, f64)> {
    let at = |s: i64| -> Option<(PathBuf, f64)> {
        if let Some(p) = hover_frame_file(file_path, s) {
            return Some((p, s as f64));
        }
        bulk_frame_file(file_path, s).map(|p| (p, bulk_frame_time(file_path, s)))
    };
    if let Some(hit) = at(second) {
        return Some(hit);
    }
    // Out to ±20 s: keyframes can be far apart (25 s gaps measured in a 10-bit HEVC episode), and a
    // nearby frame now is better than an empty box while the exact one is fetched.
    for step in [HOVER_STEP_SECS, HOVER_STEP_SECS * 2, HOVER_STEP_SECS * 3, HOVER_STEP_SECS * 4] {
        if second >= step {
            if let Some(hit) = at(second - step) {
                return Some(hit);
            }
        }
        if let Some(hit) = at(second + step) {
            return Some(hit);
        }
    }
    None
}

/// Real timestamps of the keyframes saved per bucket, written by the keyframe scan (`frames.idx`:
/// "bucket seconds" per line). Cached for the file last asked about.
static FRAME_TIMES: Mutex<Option<(String, HashMap<i64, f64>)>> = Mutex::new(None);

fn frame_times_path(file_path: &str) -> PathBuf {
    file_cache_dir(file_path).join("frames.idx")
}

/// A bulk frame's real time; the bucket itself for caches scanned before the index existed.
fn bulk_frame_time(file_path: &str, bucket: i64) -> f64 {
    let mut g = FRAME_TIMES.lock().unwrap();
    if g.as_ref().map(|(f, _)| f.as_str()) != Some(file_path) {
        let map = fs::read_to_string(frame_times_path(file_path))
            .map(|s| {
                s.lines()
                    .filter_map(|l| {
                        let (b, t) = l.split_once(' ')?;
                        Some((b.parse::<i64>().ok()?, t.parse::<f64>().ok()?))
                    })
                    .collect::<HashMap<_, _>>()
            })
            .unwrap_or_default();
        *g = Some((file_path.to_string(), map));
    }
    g.as_ref().and_then(|(_, m)| m.get(&bucket).copied()).unwrap_or(bucket as f64)
}

/// Frame bytes prefixed with the frame's real time (f64, little-endian) — the player reads it to
/// label the preview and to seek to exactly the frame it showed. JPEG data follows.
fn with_frame_time(time: f64, jpeg: Vec<u8>) -> Vec<u8> {
    let mut out = Vec::with_capacity(8 + jpeg.len());
    out.extend_from_slice(&time.to_le_bytes());
    out.extend_from_slice(&jpeg);
    out
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

/// Set once the quick keyframe pass finished, so reopening a file goes straight to the exact pass.
fn keyframes_marker(file_path: &str) -> PathBuf {
    file_cache_dir(file_path).join(".keyframes")
}

/// Search candidate locations for an ffmpeg.exe. Bundled copy is checked first.
pub fn resolve_ffmpeg() -> Option<PathBuf> {
    find_ffmpeg()
}

fn find_ffmpeg() -> Option<PathBuf> {
    // 1) Bundled binary next to the Tauri exe (production).
    if let Ok(exe) = std::env::current_exe() {
        if let Some(parent) = exe.parent() {
            for rel in &[
                "ffmpeg.exe",
                "binaries/ffmpeg.exe",
                "resources/binaries/ffmpeg.exe",
            ] {
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
        let p = PathBuf::from(env!("CARGO_MANIFEST_DIR"))
            .join("binaries")
            .join("ffmpeg.exe");
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

/// Last file handed to `file_prewarm`, so the per-tick calls near an episode's end read it once.
static PREWARMED: Mutex<Option<String>> = Mutex::new(None);

/// Reads the start and end of the file that will play next, in the background, shortly before the
/// current one ends. That spins up a sleeping drive (opens from H: were stalling ~1 s) and leaves
/// what mpv reads first — the header, and for MKV the seek index stored at the end — in the OS file
/// cache, so the next episode starts without waiting on the disk. Read-only; streams/missing files
/// are ignored.
#[tauri::command]
pub fn file_prewarm(file_path: String) {
    if file_path.is_empty() || file_path.contains("://") {
        return;
    }
    {
        let mut last = PREWARMED.lock().unwrap();
        if last.as_deref() == Some(file_path.as_str()) {
            return;
        }
        *last = Some(file_path.clone());
    }
    thread::spawn(move || {
        use std::io::{Read, Seek, SeekFrom};
        const HEAD: u64 = 16 << 20;
        const TAIL: u64 = 4 << 20;
        let t0 = Instant::now();
        let Ok(mut f) = fs::File::open(&file_path) else { return };
        let len = f.metadata().map(|m| m.len()).unwrap_or(0);
        let mut buf = vec![0u8; 1 << 20];
        let mut read_span = |f: &mut fs::File, start: u64, bytes: u64| {
            if f.seek(SeekFrom::Start(start)).is_err() {
                return;
            }
            let mut left = bytes;
            while left > 0 {
                let want = left.min(buf.len() as u64) as usize;
                match f.read(&mut buf[..want]) {
                    Ok(0) | Err(_) => break,
                    Ok(n) => left -= n as u64,
                }
            }
        };
        read_span(&mut f, 0, HEAD.min(len));
        if len > HEAD + TAIL {
            read_span(&mut f, len - TAIL, TAIL);
        }
        eprintln!("[thumb] file_prewarm {}ms path={file_path}", t0.elapsed().as_millis());
    });
}

/// The file to scan once the current scan is done (the next episode / playlist item), so its
/// previews are ready the moment it starts. Only ever one, and it never interrupts a running scan.
static NEXT_TARGET: Mutex<Option<String>> = Mutex::new(None);

#[tauri::command]
pub fn thumb_note_next(file_path: String) {
    if file_path.is_empty() || file_path.contains("://") || scan_complete(&file_path) {
        return;
    }
    if SCAN_RUNNING.swap(true, Ordering::SeqCst) {
        // A scan is running — queue it; scan_loop picks it up when that scan finishes.
        *NEXT_TARGET.lock().unwrap() = Some(file_path);
        return;
    }
    *SCAN_TARGET.lock().unwrap() = Some(file_path);
    SCAN_GEN.fetch_add(1, Ordering::SeqCst);
    thread::spawn(scan_loop);
}

#[tauri::command]
pub fn thumb_note_current(file_path: String) {
    if file_path.is_empty() {
        return;
    }
    // Now playing — no longer something to scan "next".
    {
        let mut next = NEXT_TARGET.lock().unwrap();
        if next.as_deref() == Some(file_path.as_str()) {
            *next = None;
        }
    }
    // Already fully scanned?
    if scan_complete(&file_path) {
        return;
    }
    {
        let mut g = SCAN_TARGET.lock().unwrap();
        let displaced = g.replace(file_path.clone());
        // If this pre-empts a queued next-file scan already in progress, keep it queued for after.
        if let Some(prev) = displaced.filter(|p| *p != file_path) {
            let mut next = NEXT_TARGET.lock().unwrap();
            if next.is_none() && !scan_complete(&prev) {
                *next = Some(prev);
            }
        }
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

        // Target unchanged during the scan: move on to the queued next file, if any, else stop.
        let mut g = SCAN_TARGET.lock().unwrap();
        if SCAN_GEN.load(Ordering::SeqCst) == gen {
            let next = NEXT_TARGET.lock().unwrap().take().filter(|n| *n != path && !scan_complete(n));
            if let Some(next) = next {
                *g = Some(next);
                SCAN_GEN.fetch_add(1, Ordering::SeqCst);
                continue;
            }
            *g = None;
            SCAN_RUNNING.store(false, Ordering::SeqCst);
            return;
        }
    }
}

/// True when the bulk scan finished AND actually left frames in the cache. Markers alone aren't
/// trusted: after the data folder moved to another drive (D:\Pitflix) every frame failed to move
/// out of the temp folder, yet both passes were still marked done — so nothing was ever cached and
/// hover previews only showed once the slow on-demand frame arrived.
fn scan_complete(file_path: &str) -> bool {
    // frames.idx (each saved frame's real time) too — caches from before it existed get one
    // background rescan so clicks can land exactly on the previewed frame.
    done_marker(file_path).is_file() && has_bucket_frames(file_path) && frame_times_path(file_path).is_file()
}

fn has_bucket_frames(file_path: &str) -> bool {
    let Ok(rd) = fs::read_dir(file_cache_dir(file_path)) else { return false };
    rd.flatten().any(|e| {
        let name = e.file_name();
        let name = name.to_string_lossy();
        name.ends_with(".jpg") && name[..name.len() - 4].chars().all(|c| c.is_ascii_digit())
    })
}

/// Rename, or copy + delete when that fails — the temp folder and the cache can be on different
/// drives (a rename can't cross drives).
fn move_file(src: &Path, dst: &Path) -> bool {
    if fs::rename(src, dst).is_ok() {
        return true;
    }
    let copied = fs::copy(src, dst).is_ok();
    let _ = fs::remove_file(src);
    copied
}

fn scan_file(file_path: &str, gen: u64) -> Result<(), String> {
    if scan_complete(file_path) {
        return Ok(());
    }
    // Marked done but nothing saved, or saved without the frame-time index (see scan_complete):
    // forget the markers and scan again.
    if !has_bucket_frames(file_path) || !frame_times_path(file_path).is_file() {
        let _ = fs::remove_file(done_marker(file_path));
        let _ = fs::remove_file(keyframes_marker(file_path));
    }
    let ffmpeg = find_ffmpeg().ok_or_else(|| "ffmpeg not found".to_string())?;
    let cache_dir = file_cache_dir(file_path);
    fs::create_dir_all(&cache_dir).ok();

    // Keyframes only: decoding every frame took minutes per movie (17-20 s per 10 min of video);
    // decoding only keyframes covers the same 10 min in ~1.5 s. A keyframe is only used for the
    // bucket it rounds to (never more than 2.5 s off); empty buckets are served by the nearest
    // saved one (find_nearest_cached_frame_path) until the exact frame is fetched on rest.
    if !keyframes_marker(file_path).is_file() {
        let t0 = Instant::now();
        if !run_scan_pass(&ffmpeg, file_path, gen, ScanPass::Keyframes)? {
            return Ok(());
        }
        // Only remember the pass if it really saved frames; otherwise it's retried next time.
        if has_bucket_frames(file_path) {
            let _ = fs::write(keyframes_marker(file_path), b"ok");
        }
        eprintln!("[thumb] keyframe pass done in {}ms", t0.elapsed().as_millis());
    }

    // No second, exact pass any more: it decoded the WHOLE file again (minutes for a 57-min 1080p
    // 10-bit HEVC episode) in the background, hogging the disk and CPU that on-demand previews and
    // playback needed — on-demand frames went from ~1.2-1.7 s to 2-3 s+ while it ran. Same lesson
    // as PitflixPlayer's ThumbWorker: one keyframe pass, hover reads the nearest saved frame, and
    // the exact frame is only fetched for the second the pointer rests on.
    if has_bucket_frames(file_path) {
        let _ = fs::write(done_marker(file_path), b"ok");
    }
    Ok(())
}

#[derive(Clone, Copy, PartialEq, Eq)]
enum ScanPass {
    Keyframes,
}

/// Runs one ffmpeg pass over the whole file, publishing frames into the cache as they appear.
/// Returns `Ok(false)` when it was cancelled because the user moved on to another file.
fn run_scan_pass(ffmpeg: &Path, file_path: &str, gen: u64, pass: ScanPass) -> Result<bool, String> {
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
    let mut cmd = Command::new(ffmpeg);
    cmd.args(["-hide_banner", "-loglevel", "info"]);
    match pass {
        // GPU decode (d3d11va): the device setup is paid once per scan, and on heavy sources it
        // wins clearly — 1080p 10-bit HEVC: 4.2 s vs 6.2 s per 10 min of video. (Single on-demand
        // frames stay on the CPU: there the setup cost dominates and the GPU was slower.) ffmpeg
        // falls back to software by itself if the GPU can't decode a codec. `select` keeps at
        // most one frame per 2 s for all-intra sources, where every frame is a keyframe.
        ScanPass::Keyframes => {
            cmd.args(["-hwaccel", "d3d11va", "-skip_frame", "nokey", "-i", file_path, "-an", "-sn", "-dn", "-vf"]);
            cmd.arg(format!(
                "select='isnan(prev_selected_t)+gte(t-prev_selected_t\\,2)',scale={PIXEL_WIDTH}:-2,showinfo"
            ));
            cmd.args(["-fps_mode", "passthrough"]);
        }
    }
    cmd.args(["-qscale:v", "5", "-y"]);
    let out_pattern = tmp.join("f_%05d.jpg");
    cmd.arg(&out_pattern);
    cmd.stdin(Stdio::null())
        .stdout(Stdio::null())
        .stderr(Stdio::piped());
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
    // bucket -> (distance from the bucket, real time) of the keyframe kept for it.
    let mut keyframe_best: HashMap<i64, (f64, f64)> = HashMap::new();
    loop {
        if SCAN_GEN.load(Ordering::SeqCst) != gen {
            let _ = child.kill();
            let _ = fs::remove_dir_all(&tmp);
            return Ok(false);
        }
        match child.try_wait() {
            Ok(Some(_)) => break,
            Ok(None) => {}
            Err(_) => break,
        }
        // Every ~150 ms, publish any new f_NNNNN.jpg files into cache as bucket files.
        if last_publish.elapsed().as_millis() > 150 {
            next_bucket =
                publish_new_frames(&tmp, file_path, next_bucket, &pts_by_index, pass, &mut keyframe_best);
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
    let _ = publish_new_frames(&tmp, file_path, next_bucket, &pts_by_index, pass, &mut keyframe_best);

    // Record each saved keyframe's real time (see bulk_frame_time).
    let mut index: Vec<(i64, f64)> = keyframe_best.iter().map(|(b, (_, t))| (*b, *t)).collect();
    index.sort_by_key(|(b, _)| *b);
    let text: String = index.iter().map(|(b, t)| format!("{b} {t:.3}\n")).collect();
    let _ = fs::write(frame_times_path(file_path), text);
    *FRAME_TIMES.lock().unwrap() = None;

    let _ = fs::remove_dir_all(&tmp);
    Ok(true)
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
fn publish_new_frames(
    tmp: &Path,
    file_path: &str,
    start_idx: i64,
    pts_by_index: &Mutex<Vec<f64>>,
    pass: ScanPass,
    keyframe_best: &mut HashMap<i64, (f64, f64)>,
) -> i64 {
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
        let dst = frame_path(file_path, bucket);
        idx += 1;
        if pass == ScanPass::Keyframes {
            // Keep only the keyframe closest to the bucket, and never replace a frame an earlier
            // exact pass (from a previous, interrupted session) already wrote.
            let dist = (pts - bucket as f64).abs();
            let closer = keyframe_best.get(&bucket).map_or(!dst.is_file(), |&(best, _)| dist < best);
            if !closer {
                let _ = fs::remove_file(&src);
                continue;
            }
            keyframe_best.insert(bucket, (dist, pts));
        }
        // Exact-pass frames are timeline-accurate; replace any keyframe/on-demand placeholder.
        let _ = fs::remove_file(&dst);
        move_file(&src, &dst);
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
        // No `-hwaccel auto` here: for a single frame the GPU device setup dominates. Measured
        // on 720p x264/HEVC: 490-1000 ms with it (3.3 s on a cold first call), 160-430 ms without.
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
        "-y",
    ]);
    cmd.arg(dst);
    cmd.stdin(Stdio::null())
        .stdout(Stdio::null())
        .stderr(Stdio::null());
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
    eprintln!(
        "[thumb] extract_frame_at_second total={}ms second={second}",
        t0.elapsed().as_millis()
    );
    Ok(dst)
}

fn thumb_at_quick_sync(file_path: String, seconds: f64) -> Result<(String, f64), String> {
    if file_path.is_empty() {
        return Err("empty file_path".to_string());
    }
    let t0 = Instant::now();
    let second = hover_second(seconds);
    let result = find_nearest_cached_frame_path(&file_path, second)
        .map(|(p, t)| (p.to_string_lossy().into_owned(), t))
        .ok_or_else(|| "no cached thumbnail".to_string());
    eprintln!(
        "[thumb] thumb_at_quick second={second} hit={} total={}ms",
        result.is_ok(),
        t0.elapsed().as_millis()
    );
    result
}

/// Frame at the exact (whole) second — what the player shows after a click there (mpv seeks
/// `absolute exact`). Bucket rounding here used to make the "accurate" preview up to 2.5 s off.
fn thumb_at_sync(file_path: String, seconds: f64) -> Result<String, String> {
    if file_path.is_empty() {
        return Err("empty file_path".to_string());
    }
    let t0 = Instant::now();
    let second = if seconds.is_finite() { seconds.round().max(0.0) as i64 } else { 0 };

    // The hover cache only ever holds frames extracted at exactly their second.
    if let Some(p) = hover_frame_file(&file_path, second) {
        eprintln!(
            "[thumb] thumb_at second={second} source=hover-cache total={}ms",
            t0.elapsed().as_millis()
        );
        return Ok(p.to_string_lossy().into_owned());
    }

    // Bulk frames are keyframes (only the keyframe pass runs now), i.e. near this second but not at
    // it — never an answer for the exact frame.

    // Only one ffmpeg extraction runs at a time (see ACCURATE_EXTRACT_LOCK doc
    // comment). Register this request as the latest before waiting for the
    // lock; if a newer hover position registers and grabs the lock first, this
    // one is stale by the time it would run — bail instead of spawning ffmpeg
    // for a position the user has already moved past.
    let my_gen = ACCURATE_EXTRACT_GEN.fetch_add(1, Ordering::SeqCst) + 1;
    let _extract_guard = ACCURATE_EXTRACT_LOCK.lock().unwrap();
    if ACCURATE_EXTRACT_GEN.load(Ordering::SeqCst) != my_gen {
        eprintln!(
            "[thumb] thumb_at second={second} superseded queue_wait={}ms",
            t0.elapsed().as_millis()
        );
        return Err("superseded by newer hover position".to_string());
    }

    eprintln!(
        "[thumb] thumb_at second={second} source=ffmpeg-extract starting (queue_wait={}ms)",
        t0.elapsed().as_millis()
    );
    let out = extract_frame_at_second(&file_path, second).map(|p| p.to_string_lossy().into_owned());
    eprintln!(
        "[thumb] thumb_at second={second} source=ffmpeg-extract total={}ms ok={}",
        t0.elapsed().as_millis(),
        out.is_ok()
    );
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
    let (path, time) = thumb_at_quick_sync(file_path, seconds)?;
    let bytes = fs::read(&path).map_err(|e| e.to_string())?;
    Ok(Response::new(with_frame_time(time, bytes)))
}

/// Return raw JPEG bytes for `seconds`. Uses cache first, then ffmpeg on
/// miss. See `thumb_at_quick` for why this returns bytes via `Response`
/// instead of a path or a JSON array.
#[tauri::command]
pub async fn thumb_at(file_path: String, seconds: f64) -> Result<Response, String> {
    let dispatch_t0 = Instant::now();
    let exact_time = if seconds.is_finite() { seconds.round().max(0.0) } else { 0.0 };
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
    eprintln!(
        "[thumb] thumb_at command round-trip total={}ms",
        dispatch_t0.elapsed().as_millis()
    );
    Ok(Response::new(with_frame_time(exact_time, bytes)))
}

/// One-shot single-frame poster for a file (for playlist tiles, and My Device folder thumbnails).
/// Uses ffmpeg `-ss <t> -frames:v 1`. Cached as `<cache_dir>/poster.jpg`.
///
/// Runs the ffmpeg wait on a blocking-pool thread (like `thumb_at` above) —
/// `Command::status()` blocks for the duration of the extraction (100s of ms
/// to seconds on a cold cache), and running that inline on an async runtime
/// worker thread stalled other in-flight IPC calls (seek-bar hover prefetch,
/// state polling) whenever a playlist tile needed an uncached poster.
///
/// Returns a `Response` (raw bytes) rather than `Vec<u8>` — a plain `Vec<u8>` return gets JSON-
/// encoded as a `number[]` array of individual byte values, which `thumb_at`/`thumb_at_quick`
/// above already found to be "dramatically more expensive to encode/decode" than sending raw
/// bytes. That overhead is easy to miss when this command only ever ran a handful of times per
/// playlist open, but calling it for every video in a folder of hundreds made it dominant — this
/// was making bulk My Device thumbnail preloading slower than the plain canvas capture it replaced.
#[tauri::command]
pub async fn thumb_poster(
    file_path: String,
    at_seconds: Option<f64>,
    width: Option<i32>,
    min_pct: Option<f64>,
    max_pct: Option<f64>,
) -> Result<Response, String> {
    let bytes = tauri::async_runtime::spawn_blocking(move || {
        thumb_poster_sync(file_path, at_seconds, width, min_pct, max_pct)
    })
    .await
    .map_err(|e| format!("thumbnail poster interrupted: {e}"))??;
    Ok(Response::new(bytes))
}

/// Reads ffmpeg's own "Duration: HH:MM:SS.ms" line from running it with no output requested — this
/// is a metadata-only read (ffmpeg parses just enough of the container header to report format
/// info, then errors out with "at least one output file must be specified" since none was given),
/// not a decode. Needed so `min_pct`/`max_pct` below can be resolved into an actual seek time
/// without probing duration client-side (which would mean going back to loading the file into a
/// browser `<video>` element — the exact per-file cost native capture exists to avoid).
pub(crate) fn probe_duration_seconds(ffmpeg: &Path, file_path: &str) -> Option<f64> {
    let mut cmd = Command::new(ffmpeg);
    cmd.args(["-hide_banner", "-i", file_path]);
    cmd.stdin(Stdio::null()).stdout(Stdio::null()).stderr(Stdio::piped());
    #[cfg(windows)]
    {
        use std::os::windows::process::CommandExt;
        const CREATE_NO_WINDOW: u32 = 0x0800_0000;
        cmd.creation_flags(CREATE_NO_WINDOW);
    }
    let mut child = cmd.spawn().ok()?;
    // A channel rather than a shared buffer + thread::join(): join() has no timeout, and a reader
    // thread that never sees EOF (e.g. a Windows pipe-handle edge case where something else still
    // holds the write end open even after the child is killed) would then block this function
    // forever — exactly the class of bug the bounded wait loop below exists to prevent, just moved
    // one step later. recv_timeout lets this fail closed (empty output, probe returns None) instead.
    let (tx, rx) = std::sync::mpsc::channel();
    if let Some(mut stderr) = child.stderr.take() {
        thread::spawn(move || {
            use std::io::Read;
            let mut buf = String::new();
            let _ = stderr.read_to_string(&mut buf);
            let _ = tx.send(buf);
        });
    }

    // Same bounded-wait reasoning as try_extract_poster — a probe that can hang is exactly as
    // dangerous to the capture queue as a capture that can hang.
    const PROBE_TIMEOUT: Duration = Duration::from_secs(8);
    let deadline = Instant::now() + PROBE_TIMEOUT;
    loop {
        match child.try_wait() {
            Ok(Some(_)) => break,
            Ok(None) => {
                if Instant::now() >= deadline {
                    let _ = child.kill();
                    let _ = child.wait();
                    break;
                }
                thread::sleep(Duration::from_millis(40));
            }
            Err(_) => break,
        }
    }
    // The process has exited (or been killed) by this point, so the reader thread's read_to_string
    // should return almost immediately — this extra couple of seconds is just headroom for that,
    // never a real wait for ffmpeg itself.
    let output = rx.recv_timeout(Duration::from_secs(2)).unwrap_or_default();
    parse_duration_from_ffmpeg_output(&output)
}

fn parse_duration_from_ffmpeg_output(output: &str) -> Option<f64> {
    let after = output.split("Duration: ").nth(1)?;
    let token = after.split(',').next()?.trim();
    let mut parts = token.split(':');
    let hours: f64 = parts.next()?.trim().parse().ok()?;
    let minutes: f64 = parts.next()?.trim().parse().ok()?;
    let seconds: f64 = parts.next()?.trim().parse().ok()?;
    let total = hours * 3600.0 + minutes * 60.0 + seconds;
    if total.is_finite() && total > 0.0 { Some(total) } else { None }
}

/// A value in [0, 1) derived from the current instant — not cryptographic, just enough variation
/// that successive calls (one per file in a folder) land at different points within the configured
/// range, matching the frontend's `Math.random()`-based `thumbnailSeekTime` for the canvas fallback
/// path. Adding a real `rand` crate dependency for this one non-critical use wasn't worth it.
fn pseudo_random_fraction() -> f64 {
    use std::time::{SystemTime, UNIX_EPOCH};
    let nanos = SystemTime::now()
        .duration_since(UNIX_EPOCH)
        .map(|d| d.subsec_nanos())
        .unwrap_or(0);
    (nanos % 1_000_000) as f64 / 1_000_000.0
}

/// Runs one `-ss <at> -frames:v 1` extraction to `dst`. Returns Ok only if ffmpeg exited
/// successfully AND produced a real (non-empty) JPEG — `-ss` past a short clip's actual duration
/// exits "successfully" with zero frames written, which without the length check would otherwise
/// look like success and hand back a 0-byte "thumbnail".
fn try_extract_poster(
    ffmpeg: &Path,
    file_path: &str,
    at: f64,
    width: i32,
    dst: &Path,
) -> Result<(), String> {
    let mut cmd = Command::new(ffmpeg);
    cmd.args([
        "-hide_banner",
        // A grid thumbnail doesn't need the exact frame at `at` (it's a random point in the user's
        // range anyway): decode keyframes only, so there's no decoding forward from the previous
        // keyframe — that forward decode is most of the cost on long-GOP movie files.
        "-skip_frame",
        "nokey",
        "-ss",
        &format!("{at}"),
        "-i",
        file_path,
        "-an",
        "-sn",
        "-dn",
        "-frames:v",
        "1",
        "-vf",
        &format!("scale={width}:-2"),
        "-qscale:v",
        "5",
        "-y",
    ]);
    cmd.arg(dst);
    cmd.stdin(Stdio::null())
        .stdout(Stdio::null())
        .stderr(Stdio::null());
    #[cfg(windows)]
    {
        use std::os::windows::process::CommandExt;
        const CREATE_NO_WINDOW: u32 = 0x0800_0000;
        cmd.creation_flags(CREATE_NO_WINDOW);
    }
    // `cmd.status()` blocks with NO timeout — if ffmpeg gets stuck on some particular file (a
    // corrupted file, an unusual codec, a flaky read off a network/external drive), that call never
    // returns. With a fixed number of concurrent capture slots (NATIVE_CAPTURE_CONCURRENCY on the
    // JS side), even a handful of files hitting this permanently occupies every slot and stalls the
    // entire queue forever — this is what made a folder-wide regenerate appear to hang partway
    // through instead of just being slow. Poll with try_wait() and kill the process past a deadline
    // instead, so one bad file fails and moves on rather than jamming everything behind it.
    const POSTER_TIMEOUT: Duration = Duration::from_secs(20);
    let mut child = cmd.spawn().map_err(|e| e.to_string())?;
    let deadline = Instant::now() + POSTER_TIMEOUT;
    let status = loop {
        match child.try_wait().map_err(|e| e.to_string())? {
            Some(status) => break status,
            None => {
                if Instant::now() >= deadline {
                    let _ = child.kill();
                    let _ = child.wait();
                    return Err("ffmpeg timed out".to_string());
                }
                thread::sleep(Duration::from_millis(40));
            }
        }
    };
    if !status.success() {
        return Err(format!("ffmpeg exit code {:?}", status.code()));
    }
    match fs::metadata(dst) {
        Ok(meta) if meta.len() > 0 => Ok(()),
        _ => Err("ffmpeg produced no frame".to_string()),
    }
}

/// A video's duration read straight from its container header — MP4/MOV `mvhd`, Matroska/WebM
/// `Info` — without spawning ffmpeg (whose startup alone is ~200-250 ms). None for other formats or
/// anything unexpected; callers then fall back to `probe_duration_seconds`.
pub(crate) fn fast_duration_seconds(path: &str) -> Option<f64> {
    let ext = Path::new(path).extension()?.to_str()?.to_ascii_lowercase();
    let d = match ext.as_str() {
        "mp4" | "m4v" | "mov" => mp4_duration_seconds(path),
        "mkv" | "webm" => mkv_duration_seconds(path),
        _ => None,
    }?;
    (d.is_finite() && d > 0.0).then_some(d)
}

fn mp4_duration_seconds(path: &str) -> Option<f64> {
    use std::io::{Read, Seek, SeekFrom};
    let mut f = fs::File::open(path).ok()?;
    let len = f.metadata().ok()?.len();
    // Walk the top-level boxes (headers only) to `moov` — it can be at the start or the end.
    let mut pos = 0u64;
    for _ in 0..64 {
        if pos + 8 > len {
            return None;
        }
        f.seek(SeekFrom::Start(pos)).ok()?;
        let mut hdr = [0u8; 16];
        f.read_exact(&mut hdr[..8]).ok()?;
        let mut size = u32::from_be_bytes(hdr[0..4].try_into().ok()?) as u64;
        let mut header_len = 8u64;
        if size == 1 {
            f.read_exact(&mut hdr[8..16]).ok()?;
            size = u64::from_be_bytes(hdr[8..16].try_into().ok()?);
            header_len = 16;
        } else if size == 0 {
            size = len - pos;
        }
        if size < header_len {
            return None;
        }
        if &hdr[4..8] == b"moov" {
            let end = pos + size;
            let mut c = pos + header_len;
            while c + 8 <= end {
                f.seek(SeekFrom::Start(c)).ok()?;
                let mut ch = [0u8; 8];
                f.read_exact(&mut ch).ok()?;
                let csize = u32::from_be_bytes(ch[0..4].try_into().ok()?) as u64;
                if &ch[4..8] == b"mvhd" {
                    let mut body = [0u8; 32];
                    f.read_exact(&mut body).ok()?;
                    let (timescale, duration) = if body[0] == 1 {
                        (
                            u32::from_be_bytes(body[20..24].try_into().ok()?),
                            u64::from_be_bytes(body[24..32].try_into().ok()?),
                        )
                    } else {
                        (
                            u32::from_be_bytes(body[12..16].try_into().ok()?),
                            u32::from_be_bytes(body[16..20].try_into().ok()?) as u64,
                        )
                    };
                    return (timescale > 0).then(|| duration as f64 / timescale as f64);
                }
                if csize < 8 {
                    return None;
                }
                c += csize;
            }
            return None;
        }
        pos += size;
    }
    None
}

/// Matroska variable-length integer. IDs keep their length marker bits; sizes don't, and an
/// all-ones size means "unknown" (returned as u64::MAX).
fn read_ebml_vint(r: &mut impl std::io::Read, is_id: bool) -> Option<u64> {
    let mut b = [0u8; 1];
    r.read_exact(&mut b).ok()?;
    let first = b[0];
    if first == 0 {
        return None;
    }
    let len = first.leading_zeros() as usize + 1;
    let mut val = if is_id { first as u64 } else { (first as u32 & (0xFFu32 >> len)) as u64 };
    for _ in 1..len {
        r.read_exact(&mut b).ok()?;
        val = (val << 8) | b[0] as u64;
    }
    if !is_id && val == (1u64 << (7 * len)) - 1 {
        return Some(u64::MAX);
    }
    Some(val)
}

fn mkv_duration_seconds(path: &str) -> Option<f64> {
    use std::io::{BufReader, Cursor, Read};
    let mut f = BufReader::new(fs::File::open(path).ok()?);
    if read_ebml_vint(&mut f, true)? != 0x1A45_DFA3 {
        return None; // not EBML
    }
    let ebml_size = read_ebml_vint(&mut f, false)?;
    f.seek_relative(i64::try_from(ebml_size).ok()?).ok()?;
    if read_ebml_vint(&mut f, true)? != 0x1853_8067 {
        return None; // no Segment
    }
    read_ebml_vint(&mut f, false)?; // Segment size (often "unknown")
    for _ in 0..64 {
        let id = read_ebml_vint(&mut f, true)?;
        let size = read_ebml_vint(&mut f, false)?;
        match id {
            0x1549_A966 => {
                // Info: small; read it whole and pick TimecodeScale + Duration.
                if size > 1 << 20 {
                    return None;
                }
                let mut info = vec![0u8; size as usize];
                f.read_exact(&mut info).ok()?;
                let mut cur = Cursor::new(info.as_slice());
                let (mut scale, mut duration) = (1_000_000u64, None::<f64>);
                while (cur.position() as usize) < info.len() {
                    let cid = read_ebml_vint(&mut cur, true)?;
                    let csize = read_ebml_vint(&mut cur, false)? as usize;
                    let start = cur.position() as usize;
                    let bytes = info.get(start..start.checked_add(csize)?)?;
                    match (cid, csize) {
                        (0x2A_D7B1, 1..=8) => scale = bytes.iter().fold(0u64, |a, b| (a << 8) | *b as u64),
                        (0x4489, 4) => duration = Some(f32::from_be_bytes(bytes.try_into().ok()?) as f64),
                        (0x4489, 8) => duration = Some(f64::from_be_bytes(bytes.try_into().ok()?)),
                        _ => {}
                    }
                    cur.set_position((start + csize) as u64);
                }
                return duration.map(|d| d * scale as f64 / 1e9);
            }
            0x1F43_B675 => return None, // reached the first Cluster without an Info
            _ if size == u64::MAX => return None,
            _ => f.seek_relative(i64::try_from(size).ok()?).ok()?,
        }
    }
    None
}

const DEVICE_VIDEO_EXTS: &[&str] = &["mp4", "mkv", "avi", "mov", "webm", "m4v", "wmv", "mpg", "mpeg"];
/// Bumped per `device_thumbs_prewarm` call; a running walk stops when it's no longer the latest.
static DEVICE_PREWARM_GEN: AtomicU64 = AtomicU64::new(0);

fn collect_device_videos(dir: &Path, depth: u32, out: &mut Vec<String>) {
    const MAX_DEPTH: u32 = 4;
    const MAX_FILES: usize = 20_000;
    let Ok(rd) = fs::read_dir(dir) else { return };
    for entry in rd.flatten() {
        if out.len() >= MAX_FILES {
            return;
        }
        let name = entry.file_name();
        let name = name.to_string_lossy();
        if name.starts_with('.') || name.starts_with('$') {
            continue;
        }
        let path = entry.path();
        let Ok(ft) = entry.file_type() else { continue };
        if ft.is_dir() {
            if depth < MAX_DEPTH {
                collect_device_videos(&path, depth + 1, out);
            }
        } else if path
            .extension()
            .and_then(|e| e.to_str())
            .map(|e| DEVICE_VIDEO_EXTS.contains(&e.to_ascii_lowercase().as_str()))
            .unwrap_or(false)
        {
            out.push(path.to_string_lossy().into_owned());
        }
    }
}

fn libmpv_playing(app: &tauri::AppHandle) -> bool {
    use tauri::Manager;
    app.try_state::<crate::player::libmpv_session::LibMpvHostState>()
        .and_then(|s| s.0.lock().ok().map(|g| g.is_some()))
        .unwrap_or(false)
}

/// Makes My Device grid thumbnails for every video under the user's saved locations ahead of time
/// — the same `poster_w{width}.jpg` files `thumb_poster` serves the grid from — so opening a
/// folder shows them straight away instead of extracting each one on view. One file at a time,
/// skipping ones already made, and waiting whenever a video is playing so it never competes with
/// playback for the disk. A new call (app start, locations changed) supersedes a running one.
#[tauri::command]
pub fn device_thumbs_prewarm(
    app: tauri::AppHandle,
    roots: Vec<String>,
    width: Option<i32>,
    min_pct: Option<f64>,
    max_pct: Option<f64>,
) {
    let gen = DEVICE_PREWARM_GEN.fetch_add(1, Ordering::SeqCst) + 1;
    thread::spawn(move || {
        let width = width.unwrap_or(320);
        let t0 = Instant::now();
        let mut files = Vec::new();
        for root in &roots {
            collect_device_videos(Path::new(root), 0, &mut files);
        }
        let mut made = 0usize;
        for file in &files {
            if DEVICE_PREWARM_GEN.load(Ordering::SeqCst) != gen {
                return;
            }
            let dst = file_cache_dir(file).join(format!("poster_w{width}.jpg"));
            if fs::metadata(&dst).map(|m| m.len() > 0).unwrap_or(false) {
                continue;
            }
            while libmpv_playing(&app) {
                thread::sleep(Duration::from_secs(3));
                if DEVICE_PREWARM_GEN.load(Ordering::SeqCst) != gen {
                    return;
                }
            }
            if thumb_poster_sync(file.clone(), Some(15.0), Some(width), min_pct, max_pct).is_ok() {
                made += 1;
            }
            thread::sleep(Duration::from_millis(100));
        }
        eprintln!(
            "[thumb] device_thumbs_prewarm made={made} of {} videos in {}s",
            files.len(),
            t0.elapsed().as_secs()
        );
    });
}

#[cfg(test)]
mod duration_tests {
    /// Compares the header readers with ffmpeg on real files. Machine-specific, so only runs when
    /// PITFLIX_DURATION_SAMPLES lists files (separated by `|`).
    #[test]
    fn header_duration_matches_ffmpeg() {
        let Ok(list) = std::env::var("PITFLIX_DURATION_SAMPLES") else { return };
        let ffmpeg = super::find_ffmpeg().expect("ffmpeg");
        for path in list.split('|').filter(|p| !p.is_empty()) {
            let fast = super::fast_duration_seconds(path).expect(path);
            let probed = super::probe_duration_seconds(&ffmpeg, path).expect(path);
            println!("{path}: header={fast:.2}s ffmpeg={probed:.2}s");
            assert!((fast - probed).abs() < 1.0, "{path}: {fast} vs {probed}");
        }
    }
}

fn thumb_poster_sync(
    file_path: String,
    at_seconds: Option<f64>,
    width: Option<i32>,
    min_pct: Option<f64>,
    max_pct: Option<f64>,
) -> Result<Vec<u8>, String> {
    if file_path.is_empty() {
        return Err("empty file_path".to_string());
    }
    let width = width.unwrap_or(PIXEL_WIDTH);
    let cache_dir = file_cache_dir(&file_path);
    fs::create_dir_all(&cache_dir).ok();
    // Keyed by width: this command now serves two different callers with different quality needs
    // (playlist tiles at the original PIXEL_WIDTH, My Device grid tiles at a higher one) — sharing
    // a single `poster.jpg` regardless of requested width meant whichever caller extracted first
    // silently decided the resolution for the other one too. Not keyed by `at_seconds`/percentage
    // range as well: both callers are fine reusing whatever position was already extracted for a
    // file, they just need their own resolution.
    let dst = cache_dir.join(format!("poster_w{width}.jpg"));
    if let Ok(meta) = fs::metadata(&dst) {
        if meta.len() > 0 {
            return fs::read(&dst).map_err(|e| e.to_string());
        }
    }
    let ffmpeg = find_ffmpeg().ok_or_else(|| "ffmpeg not found".to_string())?;
    // `min_pct`/`max_pct` (My Device's user-configured "frame range" setting) take priority over a
    // flat `at_seconds` — that fixed default only ever existed because native capture had no way to
    // resolve a percentage into an actual time without knowing the file's duration, so it silently
    // ignored the user's configured range entirely and always landed in roughly the first minute of
    // every video. Probing duration costs one extra (bounded, metadata-only) ffmpeg run per file,
    // but is the only way to honor "the middle third of the video" instead of "15 seconds in".
    let at = match (min_pct, max_pct) {
        // The container header first (a few ms, no process): an ffmpeg run just to learn the
        // duration was ~300 ms of the ~1.1 s each My Device thumbnail cost, measured on H:\AR.TV.
        (Some(min_pct), Some(max_pct)) => match fast_duration_seconds(&file_path)
            .or_else(|| probe_duration_seconds(&ffmpeg, &file_path))
        {
            Some(duration) => {
                let lo = duration * (min_pct / 100.0).max(0.0);
                let hi = duration * (max_pct / 100.0).max(0.0);
                let span = (hi - lo).max(0.1);
                lo + pseudo_random_fraction() * span
            }
            // Duration probe failed (e.g. genuinely corrupt file) — fall back to the flat default
            // rather than failing the whole capture outright.
            None => at_seconds.unwrap_or(60.0).max(0.0),
        },
        _ => at_seconds.unwrap_or(60.0).max(0.0),
    };
    // `-ss` (fast/input seeking, before `-i`) jumps straight to the nearest keyframe instead of
    // decoding forward from one to reach an exact frame-accurate timestamp — this is what makes
    // native extraction meaningfully faster than the browser's `<video>.currentTime` seek, but it
    // also means a request past a short clip's actual length produces no frame at all. Retry at the
    // very start rather than failing outright — a clip under `at` seconds long is exactly the case
    // where this matters most (personal clips/shorts, not just movies/episodes).
    if try_extract_poster(&ffmpeg, &file_path, at, width, &dst).is_err() && at > 0.0 {
        try_extract_poster(&ffmpeg, &file_path, 0.0, width, &dst)?;
    }
    fs::read(&dst).map_err(|e| e.to_string())
}

/// Deletes any cached `thumb_poster` output (all widths — `poster_w*.jpg`) for the given files.
/// `thumb_poster` caches by width per-file and doesn't otherwise know a caller wants a *different*
/// frame from the same file (e.g. after changing the "frame range" setting in Media settings) —
/// without this, "Regenerate thumbnails" cleared the frontend's own IndexedDB cache but left the
/// native poster cache untouched, so the next capture just served back the old cached frame instead
/// of actually re-extracting.
#[tauri::command]
pub async fn clear_thumb_posters(file_paths: Vec<String>) {
    // Like thumb_poster/thumb_at above: hundreds of directory scans + file removals is real
    // blocking I/O, and running that directly on an async runtime worker thread stalls every other
    // in-flight IPC call (including the fresh thumb_poster captures this same regenerate flow is
    // about to fire) until it finishes.
    let _ = tauri::async_runtime::spawn_blocking(move || {
        for file_path in file_paths {
            let dir = file_cache_dir(&file_path);
            let Ok(read) = fs::read_dir(&dir) else { continue };
            for entry in read.flatten() {
                let name = entry.file_name();
                let name = name.to_string_lossy();
                if name.starts_with("poster_w") && name.ends_with(".jpg") {
                    let _ = fs::remove_file(entry.path());
                }
            }
        }
    })
    .await;
}
