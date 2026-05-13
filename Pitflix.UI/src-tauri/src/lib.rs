use std::{
    fs::OpenOptions,
    io::Write,
    net::TcpStream,
    path::PathBuf,
    process::{Child, Command, Stdio},
    sync::Mutex,
    time::Duration,
};

use tauri::{image::Image, App, Manager, RunEvent};

mod player;

use player::{playback_orchestrator, PlayerHost, PlayerHostState};
use player::tauri_commands::{
    append_player_debug_log,
    playback_pol_cancel_next_countdown,
    playback_pol_get_snapshot,
    playback_pol_load_episode_context,
    playback_pol_persist_progress,
    playback_pol_resume_hints_for_key,
    playback_pol_set_extension_skip_intro,
    playback_pol_set_extension_thumbnails,
    playback_pol_set_next_autoplay,
    playback_pol_show_next_countdown,
    playback_pol_tick_next_countdown,
    player2_close, player2_debug_log, player2_get_state, player2_list_external_subtitle_files, player2_open,
    player2_pause, player2_resume, player2_send, player2_set_video_bounds,
    player2_test_ipc_osd, player2_test_toggle_pause, player2_recover, player2_recover_no_config, player2_get_last_mpv_exit_report,
    player2_open_detached_no_wid,
    player2_set_embedded_safe_mode,
    player2_open_detached,
    player2_open_embedded_minimal_no_config,
    get_subtitle_tracks,
    extract_subtitle,
    translate_srt_to_arabic,
    generate_arabic_subtitle,
};

/// Holds the spawned Pitflix.API process so we can kill it on app exit.
pub struct ApiChild(pub Mutex<Option<Child>>);

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
    log_to_sidecar_file("Pitflix: shutdown_for_external_installer — stopping bundled API before installer.");
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

/// Launch a downloaded NSIS installer from `%TEMP%\\PitflixUpdates\\` and exit so the installer can replace files.
#[tauri::command]
fn launch_downloaded_installer_and_exit(app: tauri::AppHandle, installer_path: String) -> Result<(), String> {
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
    let pitflix_dir = std::fs::canonicalize(&pitflix_dir)
        .map_err(|_| "Update folder %TEMP%\\PitflixUpdates not found. Finish download first.".to_string())?;
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

fn sidecar_log_path() -> Option<PathBuf> {
    let Some(base) = std::env::var_os("LOCALAPPDATA") else {
        return None;
    };
    Some(PathBuf::from(base).join("Pitflix").join("sidecar.log"))
}

fn log_to_sidecar_file(msg: &str) {
    let Some(p) = sidecar_log_path() else {
        return;
    };
    let Ok(mut f) = OpenOptions::new().create(true).append(true).open(&p) else {
        return;
    };
    let _ = writeln!(f, "{msg}");
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
        log_to_sidecar_file(&format!("Pitflix: scanning for sidecar in dir: {}", dir.display()));
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
                log_to_sidecar_file(&format!("Pitflix: sidecar candidate matched: {}", p.display()));
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

    let workdir = exe.parent().map(PathBuf::from).unwrap_or_else(|| exe.into());

    // Capture stdout/stderr to a file so packaged builds can be debugged.
    let log_path = sidecar_log_path().unwrap_or_else(|| PathBuf::from("sidecar.log"));
    let stdout = OpenOptions::new().create(true).append(true).open(&log_path)?;
    let stderr = OpenOptions::new().create(true).append(true).open(&log_path)?;

    Command::new(exe)
        .current_dir(workdir)
        .env("ASPNETCORE_URLS", "http://127.0.0.1:5001")
        .env("DOTNET_ENVIRONMENT", "Production")
        .stdin(Stdio::null())
        .stdout(Stdio::from(stdout))
        .stderr(Stdio::from(stderr))
        .creation_flags(CREATE_NO_WINDOW)
        .spawn()
}

#[cfg(not(windows))]
fn spawn_api_process(exe: &std::path::Path) -> std::io::Result<Child> {
    let workdir = exe.parent().map(PathBuf::from).unwrap_or_else(|| exe.into());

    let log_path = sidecar_log_path().unwrap_or_else(|| PathBuf::from("sidecar.log"));
    let stdout = OpenOptions::new().create(true).append(true).open(&log_path)?;
    let stderr = OpenOptions::new().create(true).append(true).open(&log_path)?;

    Command::new(exe)
        .current_dir(workdir)
        .env("ASPNETCORE_URLS", "http://127.0.0.1:5001")
        .env("DOTNET_ENVIRONMENT", "Production")
        .stdin(Stdio::null())
        .stdout(Stdio::from(stdout))
        .stderr(Stdio::from(stderr))
        .spawn()
}

fn wait_for_api_port() {
    for _ in 0..80 {
        if TcpStream::connect("127.0.0.1:5001").is_ok() {
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
        let is_dir = meta.map(|m| m.is_dir()).unwrap_or(false);
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
        });
    }

    out.sort_by(|a, b| match (a.is_directory, b.is_directory) {
        (true, false) => std::cmp::Ordering::Less,
        (false, true) => std::cmp::Ordering::Greater,
        _ => a.name.to_lowercase().cmp(&b.name.to_lowercase()),
    });

    Ok(out)
}

const PITFLIX_BUILD_MARKER: &str = "0.3.6-detached-revert-2";

#[cfg_attr(mobile, tauri::mobile_entry_point)]
pub fn run() {
    let app = tauri::Builder::default()
        .invoke_handler(tauri::generate_handler![
            device_read_dir,
            prepare_update_exit,
            launch_downloaded_installer_and_exit,
            player2_open,
            player2_send,
            player2_pause,
            player2_resume,
            player2_close,
            player2_set_video_bounds,
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
            player2_open_embedded_minimal_no_config,
            playback_pol_load_episode_context,
            playback_pol_get_snapshot,
            playback_pol_resume_hints_for_key,
            playback_pol_set_next_autoplay,
            playback_pol_cancel_next_countdown,
            playback_pol_show_next_countdown,
            playback_pol_tick_next_countdown,
            playback_pol_persist_progress,
            playback_pol_set_extension_thumbnails,
            playback_pol_set_extension_skip_intro,
            get_subtitle_tracks,
            extract_subtitle,
            translate_srt_to_arabic,
            generate_arabic_subtitle,
        ])
        .plugin(tauri_plugin_opener::init())
        .plugin(tauri_plugin_dialog::init())
        .plugin(tauri_plugin_fs::init())
        .plugin(tauri_plugin_process::init())
        .plugin(
            tauri_plugin_autostart::Builder::new()
                .app_name("Pitflix")
                .build(),
        )
        .setup(|app| {
            cleanup_broken_autostart_registry_entries();
            let mut child: Option<Child> = None;
            if skip_bundled_api() {
                log_to_sidecar_file("Pitflix: PITFLIX_SKIP_BUNDLED_API=true, not starting bundled API.");
            }
            else if TcpStream::connect("127.0.0.1:5001").is_ok() {
                log_to_sidecar_file(
                    "Pitflix: 127.0.0.1:5001 already in use; skipping bundled sidecar (use that API or stop it).",
                );
            }
            else {
                log_to_sidecar_file("Pitflix: skip_bundled_api=false, attempting start bundled API.");
                log_to_sidecar_file("Pitflix: attempting to start bundled API sidecar...");
                if let Some(exe) = find_sidecar_exe(app) {
                    log_to_sidecar_file(&format!("Pitflix: will spawn sidecar path: {}", exe.display()));
                    log_to_sidecar_file(&format!("Pitflix: found sidecar exe: {}", exe.display()));
                    let log = sidecar_log_path();
                    if let Some(log_path) = log.as_ref() {
                        let _ = std::fs::create_dir_all(log_path.parent().unwrap_or(log_path.as_path()));
                    }

                    match spawn_api_process(&exe) {
                        Ok(c) => {
                            log_to_sidecar_file(&format!("Pitflix: sidecar spawned. child started."));
                            // See if the process immediately crashed (common packaging issue).
                            let mut c = c;
                            wait_for_api_port();
                            // After wait, verify it actually bound.
                            let ok = TcpStream::connect("127.0.0.1:5001").is_ok();
                            log_to_sidecar_file(&format!(
                                "Pitflix: API port readiness (5001): {}",
                                if ok { "OK" } else { "NOT READY" }
                            ));
                            if !ok {
                                match c.try_wait() {
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
            app.manage(playback_orchestrator::PlaybackOrchestratorState::default());
            if let Ok(mut pol) = app.state::<playback_orchestrator::PlaybackOrchestratorState>().0.lock() {
                pol.set_app_paths(app.handle());
            }
            app.manage(PlayerHostState(Mutex::new(Some(PlayerHost::new(app.handle().clone())))));

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
