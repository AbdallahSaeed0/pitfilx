use std::{
    net::TcpStream,
    path::PathBuf,
    process::{Child, Command, Stdio},
    sync::Mutex,
    time::Duration,
};

use serde::Serialize;
use tauri::{image::Image, App, Emitter, Manager, RunEvent};

mod browse;
mod player;
mod remote_player;
mod torrent_stream;

use browse::{
    browse_close, browse_get_ad_block_stats, browse_get_detected_media, browse_navigate,
    browse_open, browse_resize, browse_set_ad_block_enabled, handle_download_protocol,
    BrowseWebviewState, NetworkState,
};

#[cfg(windows)]
use player::libmpv_session::{
    player2_libmpv_close, player2_libmpv_open, player2_libmpv_send, player2_libmpv_set_bounds,
    LibMpvHostState,
};
#[cfg(windows)]
use player::player_export::{player2_export_clip, player2_export_screenshot};
#[cfg(windows)]
use player::playlist_window::{
    install_main_window_follower, playlist_window_close, playlist_window_open,
    playlist_window_resync, PlaylistWindowState,
};
#[cfg(windows)]
use player::quality_enhancement::check_hdr_capability;
use player::tauri_commands::{
    append_player_debug_log, extract_subtitle, generate_arabic_subtitle, get_subtitle_tracks,
    playback_pol_cancel_next_countdown, playback_pol_get_snapshot, playback_pol_get_subtitle_pick,
    playback_pol_load_episode_context, playback_pol_persist_progress,
    playback_pol_resume_hints_for_key, playback_pol_set_extension_skip_intro,
    playback_pol_set_extension_thumbnails, playback_pol_set_final_position,
    playback_pol_set_next_autoplay, playback_pol_set_subtitle_pick,
    playback_pol_show_next_countdown, playback_pol_tick_next_countdown, player2_close,
    player2_debug_log, player2_get_last_mpv_exit_report, player2_get_state,
    player2_list_external_subtitle_files, player2_notify_dpi_changed, player2_open,
    player2_open_detached, player2_open_detached_no_wid, player2_pause, player2_recover,
    player2_recover_no_config, player2_resume, player2_send, player2_set_embedded_safe_mode,
    player2_set_video_bounds, player2_set_video_visible, player2_test_ipc_osd,
    player2_test_toggle_pause, player3_open, taskbar_set_playing, taskbar_set_progress,
    translate_srt_to_arabic,
};
#[cfg(windows)]
use player::thumbs::{clear_thumb_posters, thumb_at, thumb_at_quick, thumb_note_current, thumb_poster};
use player::{playback_orchestrator, PlayerHost, PlayerHostState};
use remote_player::{remote_close, remote_open, remote_play_pause, remote_seek};

/// Holds the spawned Pitflix.API process so we can kill it on app exit.
pub struct ApiChild(pub Mutex<Option<Child>>);

/// Holds a video file path passed on cold-start argv (Explorer "Open with…" launching a fresh
/// process) until the frontend mounts and pulls it via `take_pending_open_file_path`. The
/// already-running-instance case (tauri-plugin-single-instance) instead emits `open-file-path`
/// directly, since the frontend is already mounted and listening by then.
pub struct PendingOpenFile(pub Mutex<Option<String>>);

const OPEN_FILE_VIDEO_EXTENSIONS: &[&str] = &["mp4", "mkv", "avi", "mov", "webm"];

/// Scans launch args (skipping argv[0], the exe path itself) for the first path that looks like
/// a video file we were asked to open — i.e. has a recognized extension and actually exists on
/// disk. Shared by both the cold-start argv scan and the single-instance re-launch handler.
fn extract_video_path_from_args(args: &[String]) -> Option<String> {
    args.iter().skip(1).find_map(|arg| {
        let path = PathBuf::from(arg);
        let ext_ok = path
            .extension()
            .and_then(|e| e.to_str())
            .map(|e| OPEN_FILE_VIDEO_EXTENSIONS.contains(&e.to_lowercase().as_str()))
            .unwrap_or(false);
        if ext_ok && path.is_file() {
            Some(arg.clone())
        } else {
            None
        }
    })
}

/// Called once by the frontend on mount to pick up a file path passed via cold-start argv
/// (Explorer "Open with" launching a brand-new process). Returns `None` on every subsequent
/// call — the value is consumed exactly once.
#[tauri::command]
fn take_pending_open_file_path(state: tauri::State<PendingOpenFile>) -> Option<String> {
    let taken = state.0.lock().ok().and_then(|mut g| g.take());
    append_player_debug_log(
        None,
        &format!("[open-with] take_pending_open_file_path -> {taken:?}"),
    );
    taken
}

// ── Explorer folder-context-menu actions ────────────────────────────────────
//
// "Scan this folder" / "Add this folder to My Device" — registered as right-click verbs on
// Directory items by the NSIS installer (src-tauri/nsis/installer-hooks.nsh), launching
// `pitflixui.exe --scan-folder "<path>"` / `pitflixui.exe --add-device-folder "<path>"`. Mirrors
// the PendingOpenFile / take_pending_open_file_path / single-instance pattern used for "Open with
// Pitflix" above — same cold-start-vs-already-running split, just carrying an action + a folder
// path instead of a bare file path.

#[derive(Clone, Copy, Serialize)]
#[serde(rename_all = "kebab-case")]
enum FolderAction {
    ScanFolder,
    AddDeviceFolder,
}

#[derive(Clone, Serialize)]
pub struct FolderActionPayload {
    action: FolderAction,
    path: String,
}

/// Holds a folder action passed on cold-start argv until the frontend mounts and pulls it via
/// `take_pending_folder_action`. See `PendingOpenFile` above for why cold start needs this
/// stash-and-pull instead of just emitting immediately.
pub struct PendingFolderAction(pub Mutex<Option<FolderActionPayload>>);

/// Scans launch args for `--scan-folder <path>` / `--add-device-folder <path>`, validating the
/// path is an existing directory. Shared by the cold-start argv scan and the single-instance
/// re-launch handler, same shape as `extract_video_path_from_args`.
fn extract_folder_action_from_args(args: &[String]) -> Option<FolderActionPayload> {
    let mut iter = args.iter().skip(1);
    while let Some(arg) = iter.next() {
        let action = match arg.as_str() {
            "--scan-folder" => FolderAction::ScanFolder,
            "--add-device-folder" => FolderAction::AddDeviceFolder,
            _ => continue,
        };
        let Some(path) = iter.next() else { continue };
        if PathBuf::from(path).is_dir() {
            return Some(FolderActionPayload {
                action,
                path: path.clone(),
            });
        }
    }
    None
}

/// Called once by the frontend on mount to pick up a folder action passed via cold-start argv.
/// Returns `None` on every subsequent call — the value is consumed exactly once.
#[tauri::command]
fn take_pending_folder_action(
    state: tauri::State<PendingFolderAction>,
) -> Option<FolderActionPayload> {
    let taken = state.0.lock().ok().and_then(|mut g| g.take());
    append_player_debug_log(
        None,
        &format!(
            "[folder-action] take_pending_folder_action -> {:?}",
            taken.as_ref().map(|p| &p.path)
        ),
    );
    taken
}

impl ApiChild {
    /// Stops the bundled Pitflix.API sidecar. Must run before an external installer runs:
    /// `std::process::exit(0)` skips `RunEvent::Exit`, so we cannot rely on exit handlers alone.
    pub(crate) fn shutdown(&self) {
        let Ok(mut guard) = self.0.lock() else {
            return;
        };
        if let Some(mut child) = guard.take() {
            let _ = child.kill();
            let _ = child.wait();
        }
    }
}

fn shutdown_for_external_installer(app: &tauri::AppHandle) {
    log_to_sidecar_file(
        "Pitflix: shutdown_for_external_installer — stopping bundled API before installer.",
    );
    app.state::<ApiChild>().shutdown();
    log_to_sidecar_file("Pitflix: shutdown_for_external_installer — stopping player (if running).");
    if let Ok(mut g) = app.state::<PlayerHostState>().0.lock() {
        if let Some(host) = g.take() {
            host.close();
        }
    }
    playback_orchestrator::notify_session_closed(app);
    #[cfg(windows)]
    std::thread::sleep(Duration::from_millis(450));
}

/// Legacy hook (e.g. scripts). GitHub release installs use `launch_downloaded_installer_and_exit` instead.
#[tauri::command]
fn prepare_update_exit(app: tauri::AppHandle) {
    shutdown_for_external_installer(&app);
}

/// Download an installer from `url` to `%TEMP%\\PitflixUpdates\\<file_name>` via the Rust backend
/// (avoids the CORS block that GitHub's CDN applies to webview `fetch` calls).
/// Emits `installer-download-progress` events with `number | null` payload (null = unknown size).
#[tauri::command]
async fn download_installer_with_progress(
    app: tauri::AppHandle,
    url: String,
    file_name: String,
) -> Result<String, String> {
    use futures_util::StreamExt;

    let safe_name = sanitize_installer_file_name(&file_name);
    let temp_dir = std::env::temp_dir().join("PitflixUpdates");
    std::fs::create_dir_all(&temp_dir).map_err(|e| format!("Cannot create update dir: {e}"))?;
    let dest = temp_dir.join(&safe_name);

    let client = reqwest::Client::builder()
        .redirect(reqwest::redirect::Policy::limited(10))
        .user_agent("PitflixApp")
        .build()
        .map_err(|e| format!("HTTP client error: {e}"))?;

    let response = client
        .get(&url)
        .send()
        .await
        .map_err(|e| format!("Request failed: {e}"))?;

    if !response.status().is_success() {
        return Err(format!("Download failed ({})", response.status()));
    }

    let total = response.content_length();
    let mut file = std::fs::File::create(&dest).map_err(|e| format!("Cannot create file: {e}"))?;
    let mut received: u64 = 0;
    let mut stream = response.bytes_stream();

    while let Some(chunk) = stream.next().await {
        let chunk = chunk.map_err(|e| format!("Stream error: {e}"))?;
        std::io::Write::write_all(&mut file, &chunk).map_err(|e| format!("Write error: {e}"))?;
        received += chunk.len() as u64;
        let percent: Option<u32> = total
            .filter(|&t| t > 0)
            .map(|t| ((received * 100) / t).min(100) as u32);
        let _ = app.emit("installer-download-progress", percent);
    }

    if received == 0 {
        return Err("Downloaded file is empty.".into());
    }

    Ok(dest.to_string_lossy().into_owned())
}

fn sanitize_installer_file_name(name: &str) -> String {
    let s: String = name
        .chars()
        .map(|c| {
            if matches!(c, '/' | '\\' | ':' | '?' | '*' | '"' | '<' | '>' | '|') {
                '_'
            } else {
                c
            }
        })
        .collect();
    let s = s.trim().to_string();
    if s.is_empty() {
        "Pitflix-setup.exe".into()
    } else {
        s
    }
}

/// Launch a downloaded NSIS installer from `%TEMP%\\PitflixUpdates\\` and exit so the installer can replace files.
#[tauri::command]
fn launch_downloaded_installer_and_exit(
    app: tauri::AppHandle,
    installer_path: String,
) -> Result<(), String> {
    let path = PathBuf::from(installer_path.trim());
    let abs = validate_pitflix_updates_installer(&path)?;
    shutdown_for_external_installer(&app);

    let path_str = abs.to_string_lossy().to_string();
    #[cfg(windows)]
    {
        Command::new("cmd")
            .args(["/C", "start", "", &path_str])
            .stdin(Stdio::null())
            .stdout(Stdio::null())
            .stderr(Stdio::null())
            .spawn()
            .map_err(|e| format!("Failed to start installer: {e}"))?;
    }
    #[cfg(not(windows))]
    {
        Command::new("xdg-open")
            .arg(&path_str)
            .stdin(Stdio::null())
            .stdout(Stdio::null())
            .stderr(Stdio::null())
            .spawn()
            .map_err(|e| format!("Failed to open installer: {e}"))?;
    }

    std::thread::sleep(Duration::from_millis(200));
    app.exit(0);
    Ok(())
}

fn validate_pitflix_updates_installer(path: &PathBuf) -> Result<PathBuf, String> {
    let meta = std::fs::metadata(path).map_err(|e| format!("Installer not found: {e}"))?;
    if meta.len() == 0 {
        return Err("Installer file is empty.".into());
    }
    let abs = std::fs::canonicalize(path).map_err(|e| format!("Invalid installer path: {e}"))?;
    let pitflix_dir = std::env::temp_dir().join("PitflixUpdates");
    let pitflix_dir = std::fs::canonicalize(&pitflix_dir).map_err(|_| {
        "Update folder %TEMP%\\PitflixUpdates not found. Finish download first.".to_string()
    })?;
    let parent = abs
        .parent()
        .ok_or_else(|| "Invalid installer path.".to_string())?;
    if parent != pitflix_dir.as_path() {
        return Err("Installer must be located under %TEMP%\\PitflixUpdates.".into());
    }
    Ok(abs)
}

fn skip_bundled_api() -> bool {
    std::env::var("PITFLIX_SKIP_BUNDLED_API")
        .map(|v| v == "1" || v.eq_ignore_ascii_case("true"))
        .unwrap_or(false)
}

/// No-op — log file removed per user request. Kept as a stub so call sites compile.
#[allow(dead_code)]
fn sidecar_log_path() -> Option<PathBuf> {
    None
}

/// No-op — log file removed per user request. Kept as a stub so call sites compile.
#[allow(unused_variables)]
fn log_to_sidecar_file(_msg: &str) {}

/// Tails a plain-text log file and re-prints new lines to this process's stderr
/// (prefixed with `tag`), so they show up in the `tauri dev` terminal instead of
/// needing a separate file open in a text editor. Waits (polling) for the first
/// existing candidate path if none exist yet, starts reading at end-of-file (never
/// replays history on launch), and handles truncation/rotation by restarting from 0.
fn spawn_log_tail(tag: &'static str, candidates: Vec<PathBuf>) {
    std::thread::spawn(move || {
        let path = loop {
            if let Some(p) = candidates.iter().find(|p| p.exists()) {
                break p.clone();
            }
            std::thread::sleep(Duration::from_secs(2));
        };

        eprintln!("[{tag}] tailing {}", path.display());

        let mut last_len: u64 = std::fs::metadata(&path).map(|m| m.len()).unwrap_or(0);
        loop {
            std::thread::sleep(Duration::from_millis(400));
            let Ok(meta) = std::fs::metadata(&path) else {
                continue;
            };
            let len = meta.len();
            if len < last_len {
                last_len = 0;
            }
            if len == last_len {
                continue;
            }

            if let Ok(mut file) = std::fs::File::open(&path) {
                use std::io::{Read, Seek, SeekFrom};
                if file.seek(SeekFrom::Start(last_len)).is_ok() {
                    let mut buf = String::new();
                    if file.read_to_string(&mut buf).is_ok() {
                        for line in buf.lines() {
                            if !line.trim().is_empty() {
                                eprintln!("[{tag}] {line}");
                            }
                        }
                    }
                }
            }
            last_len = len;
        }
    });
}

/// `PitflixPlayer.log` — the WPF companion's own plain-text debug log, written by
/// `App.Log` (PitflixPlayer/App.xaml.cs). Distinct tag from `[pitflix-player]`
/// (used by `player2_debug_log` for the React side) to keep the sources apparent.
/// `skip-debug.log` — Pitflix.API's dedicated, low-noise log for just the
/// intro/outro skip-detection services (SkipDebugFileLoggerProvider.cs); the main
/// API console is too drowned in EF Core SQL logging to spot anything in.
/// Dev-path resolution only — mirrors the candidate search in
/// `PlayerService.FindCompanionExe` on the .NET side, which also only
/// special-cases the dev build/Debug-or-Release-output layout.
fn spawn_dotnet_log_tails() {
    let Some(exe_dir) = std::env::current_exe()
        .ok()
        .and_then(|p| p.parent().map(|p| p.to_path_buf()))
    else {
        return;
    };
    let up4 = exe_dir.join("..").join("..").join("..").join("..");

    spawn_log_tail(
        "pitflixplayer.log",
        vec![
            exe_dir.join("PitflixPlayer.log"),
            up4.join("PitflixPlayer")
                .join("bin")
                .join("Debug")
                .join("net8.0-windows")
                .join("PitflixPlayer.log"),
            up4.join("PitflixPlayer")
                .join("bin")
                .join("Release")
                .join("net8.0-windows")
                .join("PitflixPlayer.log"),
        ],
    );

    spawn_log_tail(
        "skip.log",
        vec![
            up4.join("Pitflix.API")
                .join("bin")
                .join("Debug")
                .join("net8.0-windows")
                .join("skip-debug.log"),
            up4.join("Pitflix.API")
                .join("bin")
                .join("Release")
                .join("net8.0-windows")
                .join("skip-debug.log"),
        ],
    );
}

fn find_sidecar_exe(app: &App) -> Option<PathBuf> {
    let mut dirs: Vec<PathBuf> = Vec::new();

    // First try deterministic paths based on the build target triple.
    // This is the most reliable option in packaged builds.
    let target_triple = env!("TAURI_ENV_TARGET_TRIPLE");
    let expected_name = format!("pitflix-api-{}.exe", target_triple);
    let mut deterministic: Vec<PathBuf> = Vec::new();

    #[cfg(dev)]
    {
        let base = PathBuf::from(env!("CARGO_MANIFEST_DIR")).join("binaries");
        deterministic.push(base.join(&expected_name));
        deterministic.push(base.join("pitflix-api.exe"));
    }

    if let Ok(d) = app.path().resource_dir() {
        deterministic.push(d.join("binaries").join(&expected_name));
        deterministic.push(d.join(&expected_name));
        deterministic.push(d.join("binaries").join("pitflix-api.exe"));
    }

    if let Ok(exe) = std::env::current_exe() {
        if let Some(parent) = exe.parent() {
            deterministic.push(parent.join("binaries").join(&expected_name));
            deterministic.push(parent.join(&expected_name));
            deterministic.push(parent.join("binaries").join("pitflix-api.exe"));
        }
    }

    for p in deterministic {
        if p.is_file() {
            return Some(p);
        }
    }

    // `tauri dev` does not copy the sidecar next to the debug exe; it stays in src-tauri/binaries/.
    #[cfg(dev)]
    {
        let base = PathBuf::from(env!("CARGO_MANIFEST_DIR")).join("binaries");
        dirs.push(base.clone());
    }

    if let Ok(d) = app.path().resource_dir() {
        dirs.push(d.clone());
        dirs.push(d.join("binaries"));
    }
    if let Ok(exe) = std::env::current_exe() {
        if let Some(parent) = exe.parent() {
            let parent = parent.to_path_buf();
            dirs.push(parent.clone());
            dirs.push(parent.join("binaries"));
        }
    }

    for dir in dirs {
        log_to_sidecar_file(&format!(
            "Pitflix: scanning for sidecar in dir: {}",
            dir.display()
        ));
        let Ok(read) = std::fs::read_dir(&dir) else {
            continue;
        };
        for ent in read.flatten() {
            let name = ent.file_name();
            let name = name.to_string_lossy();
            if !(name.starts_with("pitflix-api-") || name.eq_ignore_ascii_case("pitflix-api.exe")) {
                continue;
            }
            if name.ends_with(".pdb") {
                continue;
            }
            let p = ent.path();
            if p.is_file() {
                log_to_sidecar_file(&format!(
                    "Pitflix: sidecar candidate matched: {}",
                    p.display()
                ));
                return Some(p);
            }
        }
    }
    None
}

#[cfg(windows)]
fn spawn_api_process(exe: &std::path::Path) -> std::io::Result<Child> {
    use std::os::windows::process::CommandExt;

    const CREATE_NO_WINDOW: u32 = 0x0800_0000;

    let workdir = exe
        .parent()
        .map(PathBuf::from)
        .unwrap_or_else(|| exe.into());

    Command::new(exe)
        .current_dir(workdir)
        .env("ASPNETCORE_URLS", "http://127.0.0.1:5280")
        .env("DOTNET_ENVIRONMENT", "Production")
        .stdin(Stdio::null())
        .stdout(Stdio::null())
        .stderr(Stdio::null())
        .creation_flags(CREATE_NO_WINDOW)
        .spawn()
}

#[cfg(not(windows))]
fn spawn_api_process(exe: &std::path::Path) -> std::io::Result<Child> {
    let workdir = exe
        .parent()
        .map(PathBuf::from)
        .unwrap_or_else(|| exe.into());

    Command::new(exe)
        .current_dir(workdir)
        .env("ASPNETCORE_URLS", "http://127.0.0.1:5280")
        .env("DOTNET_ENVIRONMENT", "Production")
        .stdin(Stdio::null())
        .stdout(Stdio::null())
        .stderr(Stdio::null())
        .spawn()
}

fn wait_for_api_port() {
    for _ in 0..80 {
        if TcpStream::connect("127.0.0.1:5280").is_ok() {
            return;
        }
        std::thread::sleep(Duration::from_millis(250));
    }
}

/// Removes `HKCU\...\Run\Pitflix` when it points at dotnet/API/console (legacy API-based autostart).
#[cfg(windows)]
fn cleanup_broken_autostart_registry_entries() {
    use winreg::enums::{HKEY_CURRENT_USER, KEY_READ, KEY_WRITE};
    use winreg::RegKey;

    let hkcu = RegKey::predef(HKEY_CURRENT_USER);
    let Ok(run) = hkcu.open_subkey_with_flags(
        r"Software\Microsoft\Windows\CurrentVersion\Run",
        KEY_READ | KEY_WRITE,
    ) else {
        return;
    };
    let Ok(val) = run.get_value::<String, _>("Pitflix") else {
        return;
    };
    let lower = val.to_lowercase();
    let bad = lower.contains("dotnet")
        || lower.contains("pitflix.api")
        || lower.contains("pitflixapi")
        || lower.contains("cmd.exe")
        || lower.contains("powershell")
        || lower.ends_with(".dll\"")
        || lower.ends_with(".dll");
    if bad {
        let _ = run.delete_value("Pitflix");
    }
}

#[cfg(not(windows))]
fn cleanup_broken_autostart_registry_entries() {}

#[derive(serde::Serialize)]
pub struct DeviceFsEntry {
    pub name: String,
    pub path: String,
    pub is_directory: bool,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub media_kind: Option<String>,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub size_bytes: Option<u64>,
    /// Milliseconds since epoch. Falls back to last-modified where the filesystem doesn't track a
    /// separate creation time — on Windows (this app's only real target) `created()` is reliable
    /// and reflects when the file landed on this disk (i.e. when it was downloaded/copied), not
    /// some earlier timestamp carried over from the source.
    #[serde(skip_serializing_if = "Option::is_none")]
    pub created_at: Option<i64>,
}

#[tauri::command]
fn device_read_dir(path: String) -> Result<Vec<DeviceFsEntry>, String> {
    let p = PathBuf::from(path.trim());
    if !p.is_dir() {
        return Err("Not a directory".into());
    }

    let read = std::fs::read_dir(&p).map_err(|e| e.to_string())?;
    let mut out: Vec<DeviceFsEntry> = Vec::new();

    for ent in read.flatten() {
        let meta = ent.metadata().ok();
        let is_dir = meta.as_ref().map(|m| m.is_dir()).unwrap_or(false);
        let size_bytes = meta.as_ref().filter(|m| !m.is_dir()).map(|m| m.len());
        let created_at = meta.as_ref().and_then(|m| {
            m.created()
                .or_else(|_| m.modified())
                .ok()
                .and_then(|t| t.duration_since(std::time::UNIX_EPOCH).ok())
                .map(|d| d.as_millis() as i64)
        });
        let name = ent.file_name().to_string_lossy().into_owned();
        let full = ent.path();
        let ext = full
            .extension()
            .and_then(|x| x.to_str())
            .unwrap_or("")
            .to_lowercase();

        let media_kind = if is_dir {
            None
        } else if matches!(
            ext.as_str(),
            "jpg" | "jpeg" | "png" | "gif" | "webp" | "bmp" | "avif" | "jfif"
        ) {
            Some("image".into())
        } else if matches!(
            ext.as_str(),
            "mp4" | "mkv" | "avi" | "mov" | "webm" | "m4v" | "wmv" | "mpg" | "mpeg"
        ) {
            Some("video".into())
        } else {
            Some("other".into())
        };

        out.push(DeviceFsEntry {
            name,
            path: full.to_string_lossy().into_owned(),
            is_directory: is_dir,
            media_kind,
            size_bytes,
            created_at,
        });
    }

    out.sort_by(|a, b| match (a.is_directory, b.is_directory) {
        (true, false) => std::cmp::Ordering::Less,
        (false, true) => std::cmp::Ordering::Greater,
        _ => a.name.to_lowercase().cmp(&b.name.to_lowercase()),
    });

    Ok(out)
}

fn normalize_path_key(path: &str) -> String {
    path.trim().trim_end_matches(['/', '\\']).to_string()
}

fn path_sep_for(path: &str) -> char {
    if path.contains('\\') {
        '\\'
    } else {
        '/'
    }
}

fn is_path_inside(child: &str, parent: &str) -> bool {
    let child_key = normalize_path_key(child).to_lowercase();
    let parent_key = normalize_path_key(parent).to_lowercase();
    if child_key.is_empty() || parent_key.is_empty() {
        return false;
    }
    if child_key == parent_key {
        return true;
    }
    let sep = path_sep_for(parent);
    let prefix = format!("{parent_key}{sep}");
    child_key.starts_with(&prefix)
}

fn is_cross_device_move_error(err: &std::io::Error) -> bool {
    err.kind() == std::io::ErrorKind::CrossesDevices
        || err.raw_os_error() == Some(17) // Windows ERROR_NOT_SAME_DEVICE
        || err.raw_os_error() == Some(18) // EXDEV on Unix
}

/// Recursively sums file sizes under `paths` (used up front to know the denominator for a
/// move/copy progress bar — this is a cheap metadata-only walk, no file contents are read).
fn total_size_of_paths(paths: &[PathBuf]) -> u64 {
    fn dir_size(p: &std::path::Path) -> u64 {
        let mut total = 0u64;
        if let Ok(entries) = std::fs::read_dir(p) {
            for entry in entries.flatten() {
                let path = entry.path();
                match entry.metadata() {
                    Ok(meta) if meta.is_dir() => total += dir_size(&path),
                    Ok(meta) => total += meta.len(),
                    Err(_) => {}
                }
            }
        }
        total
    }
    paths
        .iter()
        .map(|p| {
            if p.is_dir() {
                dir_size(p)
            } else {
                std::fs::metadata(p).map(|m| m.len()).unwrap_or(0)
            }
        })
        .sum()
}

/// Shared, throttled progress emitter for a whole move/copy operation (spans multiple files).
/// Emits `device-transfer-progress` at most ~5x/second so large transfers don't flood the webview
/// with events, while still updating often enough to feel live.
struct TransferProgress {
    app: tauri::AppHandle,
    copied: std::sync::atomic::AtomicU64,
    total: u64,
    last_emit: Mutex<std::time::Instant>,
}

impl TransferProgress {
    fn new(app: tauri::AppHandle, total: u64) -> Self {
        Self {
            app,
            copied: std::sync::atomic::AtomicU64::new(0),
            total,
            last_emit: Mutex::new(std::time::Instant::now()),
        }
    }

    fn add(&self, n: u64) {
        if n == 0 {
            return;
        }
        let copied = self
            .copied
            .fetch_add(n, std::sync::atomic::Ordering::Relaxed)
            + n;
        let mut last = self.last_emit.lock().unwrap();
        if last.elapsed() >= Duration::from_millis(200) || copied >= self.total {
            *last = std::time::Instant::now();
            let _ = self.app.emit(
                "device-transfer-progress",
                serde_json::json!({ "copiedBytes": copied, "totalBytes": self.total }),
            );
        }
    }
}

fn copy_file_with_progress(
    src: &std::path::Path,
    dst: &std::path::Path,
    progress: &TransferProgress,
) -> Result<(), String> {
    use std::io::{Read, Write};
    let mut reader = std::fs::File::open(src).map_err(|e| e.to_string())?;
    let mut writer = std::fs::File::create(dst).map_err(|e| e.to_string())?;
    let mut buf = vec![0u8; 4 * 1024 * 1024];
    loop {
        let n = reader.read(&mut buf).map_err(|e| e.to_string())?;
        if n == 0 {
            break;
        }
        writer.write_all(&buf[..n]).map_err(|e| e.to_string())?;
        progress.add(n as u64);
    }
    Ok(())
}

fn copy_path_recursively_with_progress(
    src: &std::path::Path,
    dst: &std::path::Path,
    progress: &TransferProgress,
) -> Result<(), String> {
    if src.is_dir() {
        std::fs::create_dir_all(dst).map_err(|e| e.to_string())?;
        for entry in std::fs::read_dir(src).map_err(|e| e.to_string())? {
            let entry = entry.map_err(|e| e.to_string())?;
            copy_path_recursively_with_progress(
                &entry.path(),
                &dst.join(entry.file_name()),
                progress,
            )?;
        }
        Ok(())
    } else {
        copy_file_with_progress(src, dst, progress)
    }
}

/// Proactively releases a lingering file handle from Pitflix's own players (embedded libmpv or the
/// external WPF companion) if one of `target_keys` is currently open. A file that was "just closed"
/// in the player can still hold an OS-level lock for a brief moment afterward — this is called
/// before both delete and move so that race resolves immediately instead of only via retry-with-delay.
fn release_any_player_lock_on_paths(app: tauri::AppHandle, target_keys: &[String]) {
    #[cfg(windows)]
    {
        let holds_target = {
            let state: tauri::State<'_, player::libmpv_session::LibMpvHostState> = app.state();
            let result = match state.0.lock() {
                Ok(g) => g.as_ref().is_some_and(|s| {
                    target_keys.contains(&normalize_path_key(&s.current_path).to_lowercase())
                }),
                Err(_) => false,
            };
            result
        };
        if holds_target {
            let state: tauri::State<'_, player::libmpv_session::LibMpvHostState> = app.state();
            let _ = player::libmpv_session::player2_libmpv_close(app.clone(), state);
        }

        // "Pitflix Player" engine (external-mpv / Path B) — a detached mpv.exe managed by
        // WindowsPlayerHost, distinct from both the embedded libmpv session above and the WPF
        // companion below. close() itself now returns quickly (kill() without blocking on exit —
        // waiting there caused a real UI stall elsewhere), so explicitly wait for the exit here,
        // where blocking is actually fine (this runs on a background thread for the move/delete
        // command), to guarantee the file handle is released before this function returns.
        let path_b_target = {
            let state: tauri::State<'_, player::PlayerHostState> = app.state();
            state.0.lock().ok().and_then(|g| {
                g.as_ref().and_then(|host| {
                    host.current_path().filter(|p| {
                        target_keys.contains(&normalize_path_key(p).to_lowercase())
                    })
                })
            })
        };
        if path_b_target.is_some() {
            let state: tauri::State<'_, player::PlayerHostState> = app.state();
            let lock_result = state.0.lock();
            if let Ok(g) = lock_result {
                if let Some(host) = g.as_ref() {
                    host.close();
                }
            }
            player::windows_host::wait_for_pending_external_exit();
        }
    }

    // My Device playback can also go through the external WPF companion (PitflixPlayer.exe,
    // launched by player3_open) whose mpv.exe is a separate process the embedded-session check
    // above can't see or close. If the API reports it currently has one of the target files open,
    // ask it to stop — PlayerService.StopAsync blocks until mpv actually exits (or kills it after
    // a 3 s grace period) before returning, so the file is released by the time this call returns.
    if let Ok(body) =
        player::tauri_commands::player3_http_get("127.0.0.1:5280", "/api/player/session")
    {
        if let Ok(json) = serde_json::from_str::<serde_json::Value>(&body) {
            let session_path = json
                .get("filePath")
                .or_else(|| json.get("FilePath"))
                .and_then(|v| v.as_str());
            if let Some(p) = session_path {
                if target_keys.contains(&normalize_path_key(p).to_lowercase()) {
                    let _ = player::tauri_commands::player3_http_post(
                        "127.0.0.1:5280",
                        "/api/player/stop",
                        "{}",
                    );
                }
            }
        }
    }
}

fn move_path_with_progress(
    src: &std::path::Path,
    target: &std::path::Path,
    progress: &TransferProgress,
) -> Result<(), String> {
    // Compute the item's size up front — a same-device rename below is instant (no bytes actually
    // move through this process), so without this the progress bar wouldn't advance for it at all.
    let item_size = total_size_of_paths(std::slice::from_ref(&src.to_path_buf()));

    // A file that was just playing can hold its OS-level handle open for a brief moment after the
    // player closes (same race as the Recycle Bin delete path) — release_any_player_lock_on_paths
    // handles the common case up front, but retry regardless in case the handle takes slightly
    // longer to release (e.g. antivirus scan, indexing, or the external WPF player's process
    // teardown lagging behind its own "stopped" response) so the user doesn't have to wait and
    // retry the move manually. 10 attempts x 300ms = up to ~2.7s, versus the previous ~1.2s budget
    // that was proving too short in practice (os error 32 / ERROR_SHARING_VIOLATION).
    let mut last_err: Option<std::io::Error> = None;
    for attempt in 0..10 {
        if attempt > 0 {
            std::thread::sleep(Duration::from_millis(300));
        }
        match std::fs::rename(src, target) {
            Ok(()) => {
                progress.add(item_size);
                return Ok(());
            }
            Err(err) if is_cross_device_move_error(&err) => {
                copy_path_recursively_with_progress(src, target, progress)?;
                if src.is_dir() {
                    std::fs::remove_dir_all(src)
                        .map_err(|e| format!("Copied but failed to remove source folder: {e}"))?;
                } else {
                    std::fs::remove_file(src)
                        .map_err(|e| format!("Copied but failed to remove source file: {e}"))?;
                }
                return Ok(());
            }
            Err(err) => last_err = Some(err),
        }
    }

    let err = last_err.expect("loop always sets last_err before exiting on non-success");
    Err(format!(
        "Failed to move: {err}\n\nThis usually means the file is still open — e.g. still playing, or the player was just closed. Close the player and try again."
    ))
}

#[tauri::command]
async fn device_move_entries(
    app: tauri::AppHandle,
    paths: Vec<String>,
    destination_dir: String,
) -> Result<(), String> {
    tauri::async_runtime::spawn_blocking(move || {
        device_move_entries_sync(app, paths, destination_dir)
    })
    .await
    .map_err(|e| format!("Move interrupted: {e}"))?
}

fn device_move_entries_sync(
    app: tauri::AppHandle,
    paths: Vec<String>,
    destination_dir: String,
) -> Result<(), String> {
    let dest = PathBuf::from(destination_dir.trim());
    if !dest.is_dir() {
        return Err("Destination is not a directory".into());
    }

    let dest_key = normalize_path_key(&dest.to_string_lossy());
    let src_paths: Vec<PathBuf> = paths.iter().map(|p| PathBuf::from(p.trim())).collect();
    let total_bytes = total_size_of_paths(&src_paths);

    let target_keys: Vec<String> = src_paths
        .iter()
        .map(|p| normalize_path_key(&p.to_string_lossy()).to_lowercase())
        .collect();
    release_any_player_lock_on_paths(app.clone(), &target_keys);

    let progress = TransferProgress::new(app, total_bytes);

    for path_str in paths {
        let src = PathBuf::from(path_str.trim());
        if !src.exists() {
            return Err(format!("Path not found: {path_str}"));
        }

        let src_key = normalize_path_key(&src.to_string_lossy());
        if src_key == dest_key {
            return Err("Cannot move an item into itself".into());
        }
        if is_path_inside(&dest_key, &src_key) {
            return Err(format!(
                "Cannot move \"{}\" into one of its subfolders",
                src.file_name()
                    .map(|n| n.to_string_lossy().into_owned())
                    .unwrap_or_else(|| path_str.clone())
            ));
        }

        let file_name = src
            .file_name()
            .ok_or_else(|| format!("Invalid path: {path_str}"))?;
        let target = dest.join(file_name);
        if target.exists() {
            return Err(format!(
                "Already exists in destination: {}",
                file_name.to_string_lossy()
            ));
        }

        move_path_with_progress(&src, &target, &progress)
            .map_err(|e| format!("Failed to move \"{}\": {e}", file_name.to_string_lossy()))?;
    }

    Ok(())
}

#[tauri::command]
async fn device_delete_entries(app: tauri::AppHandle, paths: Vec<String>) -> Result<(), String> {
    tauri::async_runtime::spawn_blocking(move || device_delete_entries_sync(app, paths))
        .await
        .map_err(|e| format!("Delete interrupted: {e}"))?
}

fn device_delete_entries_sync(app: tauri::AppHandle, paths: Vec<String>) -> Result<(), String> {
    let mut targets: Vec<PathBuf> = Vec::with_capacity(paths.len());
    for path_str in &paths {
        let p = PathBuf::from(path_str.trim());
        if !p.exists() {
            return Err(format!("Path not found: {path_str}"));
        }
        targets.push(p);
    }

    let target_keys: Vec<String> = targets
        .iter()
        .map(|p| normalize_path_key(&p.to_string_lossy()).to_lowercase())
        .collect();

    // If a target file is currently open in one of Pitflix's own players (still playing, or just
    // closed and the frontend's fire-and-forget close hasn't landed yet), force it shut
    // synchronously here rather than hoping the retry loop below outlasts the release. This lets
    // "delete while it's still open in the player" work in one shot instead of erroring out.
    release_any_player_lock_on_paths(app.clone(), &target_keys);

    // Move to the Recycle Bin instead of permanently deleting, so device-page deletes are undoable.
    //
    // If a file was just playing (or is still playing) in the embedded player, the mpv process can hold
    // its handle open for a brief moment after the player page closes, which makes Windows' trash
    // operation report "Some operations were aborted". Retry a few times with a short delay before
    // giving up — this covers the just-closed-playback race without requiring the user to do anything.
    let mut last_err = None;
    for attempt in 0..4 {
        if attempt > 0 {
            std::thread::sleep(Duration::from_millis(400));
        }
        match trash::delete_all(&targets) {
            Ok(()) => return Ok(()),
            Err(e) => last_err = Some(e),
        }
    }

    let e = last_err.expect("loop always sets last_err before exiting");
    Err(format!(
        "Failed to move to Recycle Bin: {e}\n\nThis usually means the file is still open — e.g. still playing, or the player was just closed. Close the player and try again."
    ))
}

#[tauri::command]
async fn device_copy_entries(
    app: tauri::AppHandle,
    paths: Vec<String>,
    destination_dir: String,
) -> Result<(), String> {
    tauri::async_runtime::spawn_blocking(move || {
        device_copy_entries_sync(app, paths, destination_dir)
    })
    .await
    .map_err(|e| format!("Copy interrupted: {e}"))?
}

fn device_copy_entries_sync(
    app: tauri::AppHandle,
    paths: Vec<String>,
    destination_dir: String,
) -> Result<(), String> {
    let dest = PathBuf::from(destination_dir.trim());
    if !dest.is_dir() {
        return Err("Destination is not a directory".into());
    }

    let dest_key = normalize_path_key(&dest.to_string_lossy());
    let total_bytes = total_size_of_paths(
        &paths
            .iter()
            .map(|p| PathBuf::from(p.trim()))
            .collect::<Vec<_>>(),
    );
    let progress = TransferProgress::new(app, total_bytes);

    for path_str in paths {
        let src = PathBuf::from(path_str.trim());
        if !src.exists() {
            return Err(format!("Path not found: {path_str}"));
        }

        let src_key = normalize_path_key(&src.to_string_lossy());
        if src_key == dest_key {
            return Err("Cannot copy an item into itself".into());
        }
        if is_path_inside(&dest_key, &src_key) {
            return Err(format!(
                "Cannot copy \"{}\" into one of its subfolders",
                src.file_name()
                    .map(|n| n.to_string_lossy().into_owned())
                    .unwrap_or_else(|| path_str.clone())
            ));
        }

        let file_name = src
            .file_name()
            .ok_or_else(|| format!("Invalid path: {path_str}"))?;
        let target = dest.join(file_name);
        if target.exists() {
            return Err(format!(
                "Already exists in destination: {}",
                file_name.to_string_lossy()
            ));
        }

        copy_path_recursively_with_progress(&src, &target, &progress)
            .map_err(|e| format!("Failed to copy \"{}\": {e}", file_name.to_string_lossy()))?;
    }

    Ok(())
}

#[tauri::command]
fn device_rename_entry(path: String, new_name: String) -> Result<String, String> {
    let src = PathBuf::from(path.trim());
    if !src.exists() {
        return Err("Path not found".into());
    }

    let name = new_name.trim();
    if name.is_empty() {
        return Err("Name cannot be empty".into());
    }
    if name.contains('/') || name.contains('\\') {
        return Err("Name cannot contain path separators".into());
    }

    let parent = src.parent().ok_or_else(|| "Invalid path".to_string())?;
    let dest = parent.join(name);
    if dest.exists() {
        return Err("A file or folder with that name already exists".into());
    }

    std::fs::rename(&src, &dest).map_err(|e| format!("Failed to rename: {e}"))?;
    Ok(dest.to_string_lossy().into_owned())
}

#[tauri::command]
fn device_create_folder(parent_dir: String, name: String) -> Result<String, String> {
    let parent = PathBuf::from(parent_dir.trim());
    if !parent.is_dir() {
        return Err("Parent is not a directory".into());
    }

    let folder_name = name.trim();
    if folder_name.is_empty() {
        return Err("Name cannot be empty".into());
    }
    if folder_name.contains('/') || folder_name.contains('\\') {
        return Err("Name cannot contain path separators".into());
    }

    let target = parent.join(folder_name);
    if target.exists() {
        return Err("A file or folder with that name already exists".into());
    }

    std::fs::create_dir(&target).map_err(|e| format!("Failed to create folder: {e}"))?;
    Ok(target.to_string_lossy().into_owned())
}

#[derive(serde::Serialize)]
pub struct DeviceEntryDetails {
    pub name: String,
    pub path: String,
    pub is_directory: bool,
    pub size_bytes: Option<u64>,
    pub child_count: Option<u64>,
    pub modified_ms: Option<i64>,
    pub created_ms: Option<i64>,
    pub media_kind: Option<String>,
}

#[tauri::command]
fn device_entry_details(path: String) -> Result<DeviceEntryDetails, String> {
    let p = PathBuf::from(path.trim());
    if !p.exists() {
        return Err("Path not found".into());
    }

    let meta = p.metadata().map_err(|e| e.to_string())?;
    let is_directory = meta.is_dir();
    let name = p
        .file_name()
        .map(|n| n.to_string_lossy().into_owned())
        .unwrap_or_else(|| path.clone());

    let ext = p
        .extension()
        .and_then(|x| x.to_str())
        .unwrap_or("")
        .to_lowercase();
    let media_kind = if is_directory {
        None
    } else if matches!(
        ext.as_str(),
        "jpg" | "jpeg" | "png" | "gif" | "webp" | "bmp" | "avif" | "jfif"
    ) {
        Some("image".into())
    } else if matches!(
        ext.as_str(),
        "mp4" | "mkv" | "avi" | "mov" | "webm" | "m4v" | "wmv" | "mpg" | "mpeg"
    ) {
        Some("video".into())
    } else {
        Some("other".into())
    };

    let modified_ms = meta
        .modified()
        .ok()
        .and_then(|t| t.duration_since(std::time::UNIX_EPOCH).ok())
        .map(|d| d.as_millis() as i64);
    let created_ms = meta
        .created()
        .ok()
        .and_then(|t| t.duration_since(std::time::UNIX_EPOCH).ok())
        .map(|d| d.as_millis() as i64);

    let (size_bytes, child_count) = if is_directory {
        let count = std::fs::read_dir(&p)
            .map(|read| read.flatten().count() as u64)
            .unwrap_or(0);
        (None, Some(count))
    } else {
        (Some(meta.len()), None)
    };

    Ok(DeviceEntryDetails {
        name,
        path: p.to_string_lossy().into_owned(),
        is_directory,
        size_bytes,
        child_count,
        modified_ms,
        created_ms,
        media_kind,
    })
}

/// Cheap batched existence check — one round-trip for every path a caller cares about, instead of
/// one `device_entry_details` call per path (which also gathers size/media-kind/timestamps the
/// caller doesn't need just to know "does this still exist"). Used by My Videos to check every
/// video in a folder for a stale (moved/deleted) path without one IPC call per video.
#[tauri::command]
fn device_paths_exist(paths: Vec<String>) -> Vec<bool> {
    paths
        .iter()
        .map(|p| PathBuf::from(p.trim()).exists())
        .collect()
}

#[derive(serde::Serialize)]
pub struct DeviceFoundFile {
    pub file_name: String,
    pub path: String,
    pub size_bytes: u64,
}

/// Recursively searches under `root` ONCE for files matching any of `file_names` (case-insensitive)
/// — used to auto-relink "My Videos" entries whose stored paths went stale because their containing
/// folder was renamed/moved elsewhere under the same library root, without touching the files' own
/// names. Takes a whole batch of names per call (rather than one name per call) so relinking several
/// missing videos against the same root only walks that root's tree once, not once per video.
/// Bounded by MAX_VISITED so a huge/unexpected root can't hang the app; callers only trust a result
/// when a given name has exactly one match overall.
#[tauri::command]
fn device_find_files(root: String, file_names: Vec<String>) -> Result<Vec<DeviceFoundFile>, String> {
    let root_path = PathBuf::from(root.trim());
    if !root_path.is_dir() || file_names.is_empty() {
        return Ok(Vec::new());
    }
    let targets: std::collections::HashSet<String> =
        file_names.iter().map(|f| f.to_lowercase()).collect();
    let mut found = Vec::new();
    let mut stack = vec![root_path];
    let mut visited: usize = 0;
    const MAX_VISITED: usize = 200_000;

    while let Some(dir) = stack.pop() {
        let read = match std::fs::read_dir(&dir) {
            Ok(r) => r,
            Err(_) => continue,
        };
        for ent in read.flatten() {
            visited += 1;
            if visited > MAX_VISITED {
                return Ok(found);
            }
            let path = ent.path();
            let meta = match ent.metadata() {
                Ok(m) => m,
                Err(_) => continue,
            };
            if meta.is_dir() {
                stack.push(path);
            } else if let Some(name) = path.file_name().and_then(|n| n.to_str()) {
                let lower = name.to_lowercase();
                if targets.contains(&lower) {
                    found.push(DeviceFoundFile {
                        file_name: name.to_string(),
                        path: path.to_string_lossy().into_owned(),
                        size_bytes: meta.len(),
                    });
                }
            }
        }
    }
    Ok(found)
}

const PITFLIX_BUILD_MARKER: &str = "0.4.3";

#[cfg_attr(mobile, tauri::mobile_entry_point)]
pub fn run() {
    let app = tauri::Builder::default()
        .invoke_handler(tauri::generate_handler![
            device_read_dir,
            device_move_entries,
            device_delete_entries,
            device_copy_entries,
            device_rename_entry,
            device_entry_details,
            device_paths_exist,
            device_find_files,
            device_create_folder,
            take_pending_open_file_path,
            take_pending_folder_action,
            prepare_update_exit,
            download_installer_with_progress,
            launch_downloaded_installer_and_exit,
            player2_open,
            player2_send,
            player2_pause,
            player2_resume,
            player2_close,
            player2_set_video_bounds,
            player2_notify_dpi_changed,
            player2_set_video_visible,
            player2_debug_log,
            player2_get_state,
            player2_list_external_subtitle_files,
            player2_test_ipc_osd,
            player2_test_toggle_pause,
            player2_recover,
            player2_recover_no_config,
            player2_get_last_mpv_exit_report,
            player2_open_detached_no_wid,
            player2_set_embedded_safe_mode,
            player2_open_detached,
            taskbar_set_playing,
            taskbar_set_progress,
            playback_pol_load_episode_context,
            playback_pol_get_snapshot,
            playback_pol_resume_hints_for_key,
            playback_pol_set_next_autoplay,
            playback_pol_cancel_next_countdown,
            playback_pol_show_next_countdown,
            playback_pol_tick_next_countdown,
            playback_pol_persist_progress,
            playback_pol_set_final_position,
            playback_pol_set_extension_thumbnails,
            playback_pol_set_subtitle_pick,
            playback_pol_get_subtitle_pick,
            playback_pol_set_extension_skip_intro,
            get_subtitle_tracks,
            extract_subtitle,
            translate_srt_to_arabic,
            generate_arabic_subtitle,
            player3_open,
            player2_libmpv_open,
            player2_libmpv_send,
            player2_libmpv_set_bounds,
            player2_libmpv_close,
            check_hdr_capability,
            thumb_note_current,
            thumb_at_quick,
            thumb_at,
            thumb_poster,
            clear_thumb_posters,
            player2_export_screenshot,
            player2_export_clip,
            playlist_window_open,
            playlist_window_close,
            playlist_window_resync,
            remote_open,
            remote_play_pause,
            remote_seek,
            remote_close,
            browse_open,
            browse_navigate,
            browse_resize,
            browse_close,
            browse_get_detected_media,
            browse_set_ad_block_enabled,
            browse_get_ad_block_stats,
            torrent_stream::torrent_stream_start,
            torrent_stream::torrent_stream_status,
            torrent_stream::torrent_stream_stop,
        ])
        .register_uri_scheme_protocol("pitflix-browse", handle_download_protocol)
        // Must be the first plugin registered (Tauri requirement) so it can intercept a
        // second launch before anything else runs. Explorer "Open with Pitflix" on a file
        // while the app is already running re-invokes the exe with the path as an arg;
        // this callback fires in the FIRST (already-running) instance with that arg — the
        // second process just exits. We forward the resolved path to the frontend and
        // bring the existing window to the foreground instead of opening a new one.
        .plugin(tauri_plugin_single_instance::init(|app, argv, _cwd| {
            append_player_debug_log(
                Some(app),
                &format!("[open-with] single-instance relaunch argv={argv:?}"),
            );
            let focus_main_window = |app: &tauri::AppHandle| {
                if let Some(window) = app.get_webview_window("main") {
                    let _ = window.unminimize();
                    let _ = window.show();
                    let _ = window.set_focus();
                }
            };
            if let Some(path) = extract_video_path_from_args(&argv) {
                append_player_debug_log(Some(app), &format!("[open-with] emitting open-file-path path={path}"));
                let _ = app.emit_to("main", "open-file-path", path);
                focus_main_window(app);
                return;
            }
            if let Some(payload) = extract_folder_action_from_args(&argv) {
                append_player_debug_log(
                    Some(app),
                    &format!("[folder-action] emitting folder-action path={}", payload.path),
                );
                let _ = app.emit_to("main", "folder-action", payload);
                focus_main_window(app);
            }
        }))
        .plugin(tauri_plugin_opener::init())
        .plugin(tauri_plugin_dialog::init())
        .plugin(tauri_plugin_fs::init())
        .plugin(tauri_plugin_process::init())
        .plugin(tauri_plugin_global_shortcut::Builder::new().build())
        .plugin(tauri_plugin_notification::init())
        .plugin(
            tauri_plugin_autostart::Builder::new()
                .app_name("Pitflix")
                .build(),
        )
        // Disable WebView2's native context menu only — do NOT set Flags::CONTEXT_MENU,
        // which injects JS that preventDefault()s every contextmenu event and breaks the
        // embedded player's custom right-click (show controls) handlers.
        .plugin(
            tauri_plugin_prevent_default::Builder::new()
                .with_flags(tauri_plugin_prevent_default::Flags::empty())
                .platform(
                    tauri_plugin_prevent_default::PlatformOptions::new()
                        .default_context_menus(false),
                )
                .build(),
        )
        .setup(|app| {
            // Explorer "Open with Pitflix" when no instance is running yet: the file path
            // arrives as a launch arg on this very first process. The single-instance plugin
            // above only covers the ALREADY-running case (it can't fire on cold start — there's
            // no earlier instance to intercept into). Stash it for the frontend to pull once
            // mounted (see `take_pending_open_file_path`); emitting the event here would race
            // the frontend's listener registration, since the webview hasn't loaded yet.
            let cold_start_args: Vec<String> = std::env::args().collect();
            let cold_start_path = extract_video_path_from_args(&cold_start_args);
            append_player_debug_log(
                Some(app.handle()),
                &format!(
                    "[open-with] cold-start argv={cold_start_args:?} extracted={cold_start_path:?}"
                ),
            );
            app.manage(PendingOpenFile(Mutex::new(cold_start_path)));
            let cold_start_folder_action = extract_folder_action_from_args(&cold_start_args);
            append_player_debug_log(
                Some(app.handle()),
                &format!(
                    "[folder-action] cold-start extracted={:?}",
                    cold_start_folder_action.as_ref().map(|p| &p.path)
                ),
            );
            app.manage(PendingFolderAction(Mutex::new(cold_start_folder_action)));
            cleanup_broken_autostart_registry_entries();
            spawn_dotnet_log_tails();
            let mut child: Option<Child> = None;
            if skip_bundled_api() {
                log_to_sidecar_file("Pitflix: PITFLIX_SKIP_BUNDLED_API=true, not starting bundled API.");
            }
            else if TcpStream::connect("127.0.0.1:5280").is_ok() {
                log_to_sidecar_file(
                    "Pitflix: 127.0.0.1:5280 already in use; skipping bundled sidecar (use that API or stop it).",
                );
            }
            else {
                log_to_sidecar_file("Pitflix: skip_bundled_api=false, attempting start bundled API.");
                log_to_sidecar_file("Pitflix: attempting to start bundled API sidecar...");
                if let Some(exe) = find_sidecar_exe(app) {
                    match spawn_api_process(&exe) {
                        Ok(c) => {
                            log_to_sidecar_file(&format!("Pitflix: sidecar spawned. child started."));
                            // Readiness polling (up to 20s) used to run right here, blocking
                            // setup() — which keeps the window from painting/responding until
                            // the .NET API finishes its own cold start (host startup + sequential
                            // migration checks). Move it off the setup thread: the frontend's own
                            // getSettings() polling + loading spinner (App.tsx) already covers
                            // waiting for the API to come up, so the window can show immediately.
                            let handle_for_readiness = app.handle().clone();
                            std::thread::spawn(move || {
                                wait_for_api_port();
                                let ok = TcpStream::connect("127.0.0.1:5280").is_ok();
                                log_to_sidecar_file(&format!(
                                    "Pitflix: API port readiness (5280): {}",
                                    if ok { "OK" } else { "NOT READY" }
                                ));
                                if !ok {
                                    // ApiChild is managed just below this block — by the time the
                                    // 20s poll above finishes, it's long since registered.
                                    if let Some(state) = handle_for_readiness.try_state::<ApiChild>() {
                                        if let Ok(mut guard) = state.0.lock() {
                                            if let Some(child) = guard.as_mut() {
                                                match child.try_wait() {
                                                    Ok(Some(status)) => {
                                                        log_to_sidecar_file(&format!("Pitflix: sidecar exited early. status={:?}", status));
                                                    }
                                                    Ok(None) => {
                                                        log_to_sidecar_file("Pitflix: sidecar still running but port not ready.");
                                                    }
                                                    Err(e) => {
                                                        log_to_sidecar_file(&format!("Pitflix: sidecar try_wait failed: {e}"));
                                                    }
                                                }
                                            }
                                        }
                                    }
                                }
                            });
                            child = Some(c);
                        }
                        Err(e) => {
                            log_to_sidecar_file(&format!("Pitflix: failed to start bundled API: {e}"));
                        }
                    }
                }
                else {
                    log_to_sidecar_file("Pitflix: did NOT find bundled sidecar exe.");
                }
            }
            app.manage(ApiChild(Mutex::new(child)));
            app.manage(BrowseWebviewState::default());
            app.manage(NetworkState::default());
            app.manage(playback_orchestrator::PlaybackOrchestratorState::default());
            if let Ok(mut pol) = app.state::<playback_orchestrator::PlaybackOrchestratorState>().0.lock() {
                pol.set_app_paths(app.handle());
            }
            app.manage(PlayerHostState(Mutex::new(Some(PlayerHost::new(app.handle().clone())))));
            #[cfg(windows)]
            app.manage(LibMpvHostState::default());
            #[cfg(windows)]
            app.manage(PlaylistWindowState::default());
            #[cfg(windows)]
            install_main_window_follower(app.handle());
            #[cfg(windows)]
            if let Some(main) = app.get_webview_window("main") {
                if let Ok(hwnd) = main.hwnd() {
                    // ThumbBarAddButtons silently no-ops if the shell hasn't
                    // associated a taskbar button with this HWND yet (i.e.
                    // called before the window is actually shown) — it
                    // returns S_OK but nothing ever renders. Poll for
                    // visibility instead of calling this at setup() time.
                    let app_for_taskbar = app.handle().clone();
                    let hwnd_raw = hwnd.0 as isize;
                    // Wait off the main thread (visibility polling only), then
                    // hop back onto it to actually call the Win32/COM taskbar
                    // APIs — ITaskbarList3/GDI calls need to run on the same
                    // thread that owns the window (STA), same as everywhere
                    // else in this codebase that touches its HWND. HWND isn't
                    // Send, so it's carried across threads as a raw isize and
                    // reconstructed on the main thread.
                    std::thread::spawn(move || {
                        for _ in 0..50 {
                            if main.is_visible().unwrap_or(false) {
                                break;
                            }
                            std::thread::sleep(std::time::Duration::from_millis(100));
                        }
                        let app_for_install = app_for_taskbar.clone();
                        let _ = app_for_taskbar.run_on_main_thread(move || {
                            let hwnd = windows::Win32::Foundation::HWND(hwnd_raw as *mut _);
                            player::taskbar_thumb_buttons::install(app_for_install, hwnd);
                        });
                    });
                }
            }

            let exe_path = std::env::current_exe()
                .map(|p| p.to_string_lossy().to_string())
                .unwrap_or_else(|e| format!("unknown ({e})"));
            let version = app.package_info().version.to_string();
            append_player_debug_log(
                Some(app.handle()),
                &format!(
                    "[pitflix-build] version={PITFLIX_BUILD_MARKER} app_version={version} exe={exe_path}"
                ),
            );
            append_player_debug_log(
                Some(app.handle()),
                "[playback-mode] normal_open=DETACHED",
            );

            // Frameless windows (`decorations: false`) often show a generic taskbar/Dock icon unless
            // the window icon is set explicitly. On Windows, prefer the `.ico` used for the exe.
            if let Some(window) = app.get_webview_window("main") {
                #[cfg(windows)]
                const WIN_ICON: &[u8] = include_bytes!("../icons/icon.ico");
                #[cfg(not(windows))]
                const WIN_ICON: &[u8] = include_bytes!("../icons/128x128.png");
                if let Ok(icon) = Image::from_bytes(WIN_ICON) {
                    let _ = window.set_icon(icon);
                }
            }

            Ok(())
        })
        .build(tauri::generate_context!())
        .expect("error while building tauri application");

    app.run(|app_handle, event| {
        if matches!(event, RunEvent::Exit) {
            torrent_stream::stop();
            app_handle.state::<ApiChild>().shutdown();
            if let Ok(mut g) = app_handle.state::<PlayerHostState>().0.lock() {
                if let Some(host) = g.take() {
                    host.close();
                }
            }
            playback_orchestrator::notify_session_closed(&app_handle);
        }
    });
}
