// remote_player.rs — Fullscreen-remote player mode.
//
// Spawns mpv --fullscreen with a named-pipe IPC server. A background reader
// thread subscribes to time-pos / duration / pause / eof-reached and emits
// `remote://state` Tauri events so the React controller can update its live UI.
// The four public commands are registered in lib.rs.

use std::{
    io::{BufRead, BufReader, Write},
    path::PathBuf,
    process::{Child, Command, Stdio},
    sync::{
        atomic::{AtomicBool, Ordering},
        Arc, Mutex,
    },
    thread,
    time::Duration,
};

use tauri::{AppHandle, Emitter, Manager};

// ─── Session state ────────────────────────────────────────────────────────────

struct RemoteSession {
    child: Child,
    pipe_path: String,
    stop: Arc<AtomicBool>,
}

// SAFETY: Child is Send in std; Arc<AtomicBool> is Send + Sync.
unsafe impl Send for RemoteSession {}

static SESSION: Mutex<Option<RemoteSession>> = Mutex::new(None);

// ─── Frontend event payload ───────────────────────────────────────────────────

#[derive(Clone, serde::Serialize)]
pub struct RemoteStatePayload {
    #[serde(rename = "timePos")]
    pub time_pos: Option<f64>,
    pub duration: Option<f64>,
    pub paused: bool,
    pub eof: bool,
}

// ─── Helpers — find bundled mpv ───────────────────────────────────────────────

fn find_mpv_exe(handle: &AppHandle) -> Option<PathBuf> {
    let triple = env!("TAURI_ENV_TARGET_TRIPLE");
    let name = format!("mpv-{}.exe", triple);
    let mut candidates: Vec<PathBuf> = Vec::new();

    #[cfg(debug_assertions)]
    {
        let base = PathBuf::from(env!("CARGO_MANIFEST_DIR")).join("binaries");
        candidates.push(base.join(&name));
        candidates.push(base.join("mpv.exe"));
    }

    if let Ok(d) = handle.path().resource_dir() {
        candidates.push(d.join("binaries").join(&name));
        candidates.push(d.join(&name));
        candidates.push(d.join("binaries").join("mpv.exe"));
    }
    if let Ok(exe) = std::env::current_exe() {
        if let Some(p) = exe.parent() {
            candidates.push(p.join("binaries").join(&name));
            candidates.push(p.join(&name));
            candidates.push(p.join("binaries").join("mpv.exe"));
        }
    }

    candidates.into_iter().find(|p| p.is_file())
}

// ─── Helpers — find bundled mpv-config dir ───────────────────────────────────

fn resolve_config_dir(handle: &AppHandle) -> Option<PathBuf> {
    #[cfg(debug_assertions)]
    {
        let src = PathBuf::from(env!("CARGO_MANIFEST_DIR")).join("mpv-config");
        if src.is_dir() {
            return Some(src);
        }
    }
    if let Ok(d) = handle.path().resource_dir() {
        let a = d.join("binaries").join("mpv-config");
        if a.is_dir() {
            return Some(a);
        }
        let b = d.join("mpv-config");
        if b.is_dir() {
            return Some(b);
        }
    }
    if let Ok(exe) = std::env::current_exe() {
        if let Some(p) = exe.parent() {
            let c = p.join("mpv-config");
            if c.is_dir() {
                return Some(c);
            }
        }
    }
    None
}

// ─── Helpers — IPC pipe ───────────────────────────────────────────────────────

/// Write a single JSON command line to a fresh pipe connection.
/// Each call opens a new client connection so it doesn't disturb the reader.
fn write_ipc(pipe_path: &str, cmd: &str) -> Result<(), String> {
    let mut f = std::fs::OpenOptions::new()
        .write(true)
        .open(pipe_path)
        .map_err(|e| format!("IPC open failed: {e}"))?;
    writeln!(f, "{cmd}").map_err(|e| format!("IPC write failed: {e}"))
}

// ─── Background reader thread ─────────────────────────────────────────────────

fn start_reader(pipe_path: String, stop: Arc<AtomicBool>, app: AppHandle) {
    thread::spawn(move || {
        // Give mpv time to create the named-pipe server.
        for _ in 0..20 {
            if stop.load(Ordering::Relaxed) {
                return;
            }
            thread::sleep(Duration::from_millis(50));
        }

        // Open ONE R+W connection — subscribe and read events on the same handle.
        let mut file: std::fs::File = {
            let mut result = None;
            for _ in 0..200 {
                if stop.load(Ordering::Relaxed) {
                    return;
                }
                match std::fs::OpenOptions::new()
                    .read(true)
                    .write(true)
                    .open(&pipe_path)
                {
                    Ok(f) => {
                        result = Some(f);
                        break;
                    }
                    Err(e) => {
                        let code = e.raw_os_error();
                        if matches!(code, Some(2) | Some(231)) {
                            thread::sleep(Duration::from_millis(25));
                            continue;
                        }
                        break;
                    }
                }
            }
            match result {
                Some(f) => f,
                None => return,
            }
        };

        // Subscribe to the properties we care about — SAME connection as the reader.
        let _ = writeln!(file, r#"{{"command":["observe_property",1,"time-pos"]}}"#);
        let _ = writeln!(file, r#"{{"command":["observe_property",2,"duration"]}}"#);
        let _ = writeln!(file, r#"{{"command":["observe_property",3,"pause"]}}"#);
        let _ = writeln!(file, r#"{{"command":["observe_property",4,"eof-reached"]}}"#);

        let mut st = RemoteStatePayload {
            time_pos: None,
            duration: None,
            paused: false,
            eof: false,
        };

        let reader = BufReader::new(file);
        for line in reader.lines() {
            if stop.load(Ordering::Relaxed) {
                return;
            }
            let Ok(line) = line else { break };
            let Ok(v) = serde_json::from_str::<serde_json::Value>(&line) else {
                continue;
            };

            if v.get("event").and_then(|e| e.as_str()) != Some("property-change") {
                continue;
            }

            let name = v.get("name").and_then(|n| n.as_str()).unwrap_or("");
            match name {
                "time-pos" => st.time_pos = v.get("data").and_then(|d| d.as_f64()),
                "duration" => st.duration = v.get("data").and_then(|d| d.as_f64()),
                "pause" => {
                    st.paused = v.get("data").and_then(|d| d.as_bool()).unwrap_or(false);
                }
                "eof-reached" => {
                    if v.get("data").and_then(|d| d.as_bool()).unwrap_or(false) {
                        st.eof = true;
                        let _ = app.emit("remote://state", st.clone());
                        let _ = app.emit("remote://closed", ());
                        return;
                    }
                }
                _ => continue,
            }

            let _ = app.emit("remote://state", st.clone());
        }

        // Pipe closed (mpv exited naturally).
        if !stop.load(Ordering::Relaxed) {
            let _ = app.emit("remote://closed", ());
        }
    });
}

// ─── Internal close ───────────────────────────────────────────────────────────

fn close_session() {
    let Ok(mut g) = SESSION.lock() else { return };
    if let Some(mut s) = g.take() {
        s.stop.store(true, Ordering::Relaxed);
        let _ = s.child.kill();
        let _ = s.child.wait();
    }
}

// ─── Tauri commands ───────────────────────────────────────────────────────────

/// Spawn mpv fullscreen with a named-pipe IPC server, start the reader thread.
#[tauri::command]
pub async fn remote_open(app: AppHandle, file_path: String, title: String) -> Result<(), String> {
    // Tear down any existing session first.
    close_session();

    let exe = find_mpv_exe(&app).ok_or("Bundled mpv not found. Run npm run bundle:prepare.")?;

    let pipe_id = uuid::Uuid::new_v4().simple().to_string();
    let pipe_path = if cfg!(windows) {
        format!(r"\\.\pipe\pitflix-remote-{}", pipe_id)
    } else {
        format!("/tmp/pitflix-remote-{}", pipe_id)
    };

    let mut cmd = Command::new(&exe);
    cmd.arg("--force-window=yes")
        .arg("--geometry=1280x720")
        .arg(format!("--input-ipc-server={}", pipe_path))
        .arg("--no-terminal");

    if let Some(cfg_dir) = resolve_config_dir(&app) {
        let s = cfg_dir.to_string_lossy();
        // Strip extended-length prefix \\?\ so mpv can parse the path.
        let s = s.trim_start_matches(r"\\?\");
        cmd.arg(format!("--config-dir={}", s))
            .arg("--load-scripts=yes")
            .arg("--osc=no");
    }

    cmd.arg(format!("--title={}", title))
        .arg(&file_path)
        .stdin(Stdio::null())
        .stdout(Stdio::null())
        .stderr(Stdio::null());

    #[cfg(windows)]
    {
        use std::os::windows::process::CommandExt;
        const CREATE_NO_WINDOW: u32 = 0x0800_0000;
        cmd.creation_flags(CREATE_NO_WINDOW);
    }

    let child = cmd.spawn().map_err(|e| format!("Failed to spawn mpv: {e}"))?;
    let stop = Arc::new(AtomicBool::new(false));

    {
        let mut g = SESSION.lock().map_err(|e| e.to_string())?;
        *g = Some(RemoteSession {
            child,
            pipe_path: pipe_path.clone(),
            stop: Arc::clone(&stop),
        });
    }

    start_reader(pipe_path, stop, app);
    Ok(())
}

/// Toggle play / pause in the running mpv instance.
#[tauri::command]
pub fn remote_play_pause(_app: AppHandle) -> Result<(), String> {
    let g = SESSION.lock().map_err(|e| e.to_string())?;
    let s = g.as_ref().ok_or("No active remote session")?;
    write_ipc(&s.pipe_path, r#"{"command":["cycle","pause"]}"#)
}

/// Seek to an absolute position (seconds).
#[tauri::command]
pub fn remote_seek(_app: AppHandle, position_seconds: f64) -> Result<(), String> {
    let g = SESSION.lock().map_err(|e| e.to_string())?;
    let s = g.as_ref().ok_or("No active remote session")?;
    write_ipc(
        &s.pipe_path,
        &format!(r#"{{"command":["seek",{},"absolute"]}}"#, position_seconds),
    )
}

/// Kill the running mpv instance and emit `remote://closed`.
#[tauri::command]
pub fn remote_close(app: AppHandle) -> Result<(), String> {
    close_session();
    let _ = app.emit("remote://closed", ());
    Ok(())
}
