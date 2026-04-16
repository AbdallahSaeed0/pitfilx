//! Windows player: **single main window** — native video `HWND` is a **child** of the Tauri main window.
//! React owns all controls; **external `mpv.exe`** embeds via `--wid` and JSON IPC (in-process libmpv disabled).

use std::{
  collections::{HashMap, VecDeque},
  io::{BufRead, BufReader, BufWriter, Write},
  path::{Path, PathBuf},
  process::{Child, Command, Stdio},
  sync::{
    atomic::{AtomicBool, AtomicU64, Ordering},
    mpsc, Arc, Mutex, Once,
  },
  thread,
  time::{Duration, Instant},
};

use serde_json::{json, Value};
use serde::Serialize;
use tauri::{AppHandle, Emitter, Manager};

use windows::Win32::{
  Foundation::{HWND, LPARAM, LRESULT, POINT, RECT, WPARAM},
  Graphics::Gdi::{InvalidateRect, MapWindowPoints},
  System::Threading::{OpenProcess, GetExitCodeProcess, PROCESS_QUERY_LIMITED_INFORMATION},
  System::LibraryLoader::GetModuleHandleW,
  UI::HiDpi::GetDpiForWindow,
  UI::Input::KeyboardAndMouse::GetAsyncKeyState,
  UI::WindowsAndMessaging::{
    CreateWindowExW, DefWindowProcW, DestroyWindow, EnumChildWindows, GetClassNameW, GetClientRect,
    GetCursorPos, GetParent, GetWindow, GetWindowLongPtrW, GetWindowRect, RegisterClassW,
    SetParent, SetWindowLongPtrW, SetWindowPos, ShowWindow, PostMessageW, CS_OWNDC, GW_CHILD,
    GW_HWNDNEXT, GWL_EXSTYLE, GWL_STYLE, HTTRANSPARENT, HWND_BOTTOM, HWND_TOP, IsWindow,
    MA_NOACTIVATE, SWP_NOACTIVATE, SWP_SHOWWINDOW, WM_MOUSEACTIVATE, WM_NCHITTEST, WNDCLASSW,
    WS_CHILD, WS_DISABLED, WS_EX_NOACTIVATE, WS_EX_TRANSPARENT, WS_VISIBLE,
  },
};
use windows::core::{w, BOOL};

use super::commands::{PlayerCommand, PlayerOpen};
use super::events::{PauseIpcVerifySnapshot, Player2NativeState, PlayerEvent, PlayerState, PlayerTrack, PlayerTracks};
use super::playback_orchestrator;
use super::mpv_gl_win::{render_health_snapshot, WM_MPV_RENDER};
use super::tauri_commands::append_player_debug_log;
use super::windows_libmpv_host::{self, EmbeddedLibMpvSession};

pub struct WindowsPlayerHost {
  app: AppHandle,
  state: Arc<Mutex<Option<Session>>>,
  last_mpv_exit_report: Arc<Mutex<Option<MpvExitReport>>>,
  embedded_safe_mode: Arc<AtomicBool>,
}

enum BackendSession {
  External(MpvSession),
  LibMpv(EmbeddedLibMpvSession),
}

struct Session {
  session_id: u64,
  video_hwnd: usize,
  /// Tauri main window — mpv may create HWNDs as **siblings** of the video child; we enumerate this.
  parent_hwnd: usize,
  /// Diagnostic flag: keep `--wid` embedding but skip non-essential window choreography (esp. restack/refresh around pause/resume).
  embedded_safe_mode: bool,
  /// Diagnostic flag: **minimal** embedded `--wid` mode. After launch, avoid *all* non-essential Win32 window ops
  /// (no overlay refresh, no focus juggling, no bounds updates).
  embedded_minimal_mode: bool,
  /// Last `player2_open` payload — used to recreate external mpv after IPC failure.
  last_open: PlayerOpen,
  backend: BackendSession,
  state: Arc<Mutex<PlayerState>>,
  /// Last user action routed to mpv (for exit diagnostics).
  last_action: Arc<Mutex<String>>,
  /// If `close()` was requested for this session, record the reason so we can rule out app-side kills.
  close_reason: Arc<Mutex<Option<String>>>,
  /// Stops the background thread that re-applies click-through (mpv may create new child HWNDs after pause).
  passthrough_stop: Arc<AtomicBool>,
  /// Last correlated pause/resume IPC attempt (surfaced in `player2_get_state`).
  pause_verify: Arc<Mutex<PauseIpcVerifySnapshot>>,
}

#[derive(Debug, Clone, Serialize, Default)]
pub struct MpvExitReport {
  pub session_id: u64,
  pub mpv_pid: u32,
  pub exit_code: Option<u32>,
  pub mpv_alive: Option<bool>,
  pub pipe: String,
  pub media_path: String,
  pub last_action: String,
  pub time_pos: f64,
  pub close_reason: Option<String>,
  pub exe: String,
  pub args: Vec<String>,
  pub stderr_tail: Vec<String>,
  pub stdout_tail: Vec<String>,
  pub no_config: bool,
}

fn backend_label() -> &'static str {
  "external_mpv"
}

static NEXT_PLAYER_SESSION_ID: AtomicU64 = AtomicU64::new(1);

/// Correlated `request_id` for pause/resume verification — must not overlap `observe_property` ids (1–10).
const IPC_CORRELATED_REQ_ID_START: u64 = 1_000_000;
/// `get_property time-pos` poll replies (detached / external mode only) — must not overlap observe ids or pause verify ids.
const MPV_EXTERNAL_TIME_POLL_REQ_BASE: u64 = 5_000_000;

static EXTERNAL_TIME_POS_POLL_SEQ: AtomicU64 = AtomicU64::new(0);

struct MpvSession {
  child: Child,
  /// Shared with the writer thread; cloned for pause/resume verification without holding `Session`.
  tx: Arc<mpsc::SyncSender<IpcWriteMsg>>,
  /// Named pipe path for the mpv IPC server (e.g. `\\.\pipe\pitflix-mpv-...`).
  ipc_client_path: String,
  /// OS process id for the spawned mpv instance.
  mpv_pid: u32,
  /// Tail of mpv stderr lines (for exit diagnostics).
  stderr_tail: Arc<Mutex<VecDeque<String>>>,
  /// Tail of mpv stdout lines (optional diagnostics).
  stdout_tail: Arc<Mutex<VecDeque<String>>>,
  /// Set once we know the IPC transport is dead/unrecoverable; used to prevent command spam.
  ipc_dead: Arc<AtomicBool>,
  /// Set after a failed reconnect attempt (or confirmed mpv exit). Prevents repeated reconnect loops.
  ipc_unrecoverable: Arc<AtomicBool>,
  /// True while a reconnect attempt is in progress; used to stop accepting commands and prevent split-brain.
  ipc_reconnecting: Arc<AtomicBool>,
  /// Monotonic generation for the active pipe connection. Each successful (re)connect increments this.
  ipc_generation: Arc<AtomicU64>,
  /// Unique token for the writer thread for this session.
  ipc_writer_token: u64,
  /// Waiters for `read_ipc_loop` to deliver mpv JSON lines matching `request_id`.
  ipc_pending: Arc<Mutex<HashMap<u64, mpsc::Sender<Value>>>>,
  next_correlated_req_id: Arc<AtomicU64>,
}

fn mpv_pid_alive(pid: u32) -> Option<bool> {
  unsafe {
    let h = OpenProcess(PROCESS_QUERY_LIMITED_INFORMATION, false, pid).ok()?;
    let mut code: u32 = 0;
    if GetExitCodeProcess(h, &mut code).is_err() {
      return None;
    }
    // Win32 STILL_ACTIVE == 259
    Some(code == 259)
  }
}

fn mpv_pid_exit_code(pid: u32) -> Option<u32> {
  unsafe {
    let h = OpenProcess(PROCESS_QUERY_LIMITED_INFORMATION, false, pid).ok()?;
    let mut code: u32 = 0;
    if GetExitCodeProcess(h, &mut code).is_err() {
      return None;
    }
    Some(code)
  }
}

impl WindowsPlayerHost {
  fn normalize_media_path_key(path: &str) -> String {
    path.replace('\\', "/").to_ascii_lowercase()
  }

  /// Guard against duplicate same-file opens while detached external mpv is already active *and healthy*.
  fn is_redundant_external_open(&self, payload: &PlayerOpen) -> bool {
    let Ok(g) = self.state.lock() else {
      return false;
    };
    let Some(s) = g.as_ref() else {
      return false;
    };
    let BackendSession::External(backend) = &s.backend else {
      return false;
    };
    // Only suppress re-open when the current external transport/process is healthy.
    if backend.ipc_dead.load(Ordering::SeqCst) || backend.ipc_unrecoverable.load(Ordering::SeqCst) {
      return false;
    }
    if !matches!(mpv_pid_alive(backend.mpv_pid), Some(true)) {
      return false;
    }
    if let Ok(st) = s.state.lock() {
      if !st.ipc_healthy {
        return false;
      }
    }
    let incoming = Self::normalize_media_path_key(&payload.path);
    let current = Self::normalize_media_path_key(&s.last_open.path);
    !incoming.is_empty() && incoming == current
  }

  pub fn new(app: AppHandle) -> Self {
    Self {
      app,
      state: Arc::new(Mutex::new(None)),
      last_mpv_exit_report: Arc::new(Mutex::new(None)),
      embedded_safe_mode: Arc::new(AtomicBool::new(false)),
    }
  }

  pub fn set_embedded_safe_mode(&self, enabled: bool) {
    self.embedded_safe_mode.store(enabled, Ordering::SeqCst);
    append_player_debug_log(
      Some(&self.app),
      &format!("[embedded-safe-mode] set enabled={enabled}"),
    );
  }

  pub fn open(&self, payload: PlayerOpen) -> Result<(), String> {
    if self.is_redundant_external_open(&payload) {
      let msg = format!(
        "[open-guard] skipping redundant external open for path={}",
        payload.path
      );
      eprintln!("{msg}");
      append_player_debug_log(Some(&self.app), &msg);
      return Ok(());
    }
    self.close_with_reason("open");
    self.open_detached_impl(payload, false)
  }

  pub fn open_no_config(&self, payload: PlayerOpen) -> Result<(), String> {
    self.close_with_reason("open_no_config");
    self.open_detached_impl(payload, true)
  }

  /// Diagnostic: spawn mpv as a normal detached window (no `--wid` embedding).
  pub fn open_detached_no_wid(&self, payload: PlayerOpen) -> Result<(), String> {
    self.close_with_reason("open_detached_no_wid");
    self.open_detached_impl(payload, true)
  }

  /// Supported fallback: spawn mpv as a normal detached window (no `--wid` embedding), using user config.
  pub fn open_detached(&self, payload: PlayerOpen) -> Result<(), String> {
    self.close_with_reason("open_detached");
    self.open_detached_impl(payload, false)
  }

  /// Diagnostic: minimal embedded `--wid` mode; after launch do not touch window stacking/bounds/focus.
  pub fn open_embedded_minimal_no_config(&self, payload: PlayerOpen) -> Result<(), String> {
    self.close_with_reason("open_embedded_minimal_no_config");
    self.open_embedded_minimal_impl(payload, true)
  }

  fn open_impl(&self, payload: PlayerOpen, no_config: bool) -> Result<(), String> {

    let Some(exe) = find_mpv_exe(&self.app) else {
      return Err("Bundled mpv not found. Run npm run bundle:prepare.".to_string());
    };

    let main_win = self
      .app
      .get_webview_window("main")
      .ok_or("Main window not found")?;
    let parent_hwnd: HWND = main_win.hwnd().map_err(|e| e.to_string())?;

    let video_hwnd = create_embed_video_child(parent_hwnd)?;

    let state = Arc::new(Mutex::new(PlayerState {
      loading: true,
      ipc_healthy: true,
      sub_visible: true,
      sid: -1,
      aid: -1,
      ..Default::default()
    }));

    let passthrough_stop = Arc::new(AtomicBool::new(false));

    let pause_verify = Arc::new(Mutex::new(PauseIpcVerifySnapshot::default()));
    let last_action = Arc::new(Mutex::new("open".to_string()));
    let close_reason = Arc::new(Mutex::new(None));

    let session_id = NEXT_PLAYER_SESSION_ID.fetch_add(1, Ordering::SeqCst);
    let embedded_safe_mode = self.embedded_safe_mode.load(Ordering::SeqCst);
    let (backend, reader) = spawn_mpv_embedded(
      self.app.clone(),
      session_id,
      Arc::clone(&state),
      Arc::clone(&last_action),
      Arc::clone(&close_reason),
      Arc::clone(&self.last_mpv_exit_report),
      &exe,
      video_hwnd.0 as usize,
      &payload,
      no_config,
      false,
    )?;

    unsafe {
      embed_op_log(
        Some(&self.app),
        "SetWindowPos(video_hwnd)",
        "before",
        session_id,
        parent_hwnd.0 as usize,
        video_hwnd.0 as usize,
      );
      let _ = SetWindowPos(
        video_hwnd,
        Some(HWND_TOP),
        0,
        0,
        0,
        0,
        windows::Win32::UI::WindowsAndMessaging::SWP_NOMOVE
          | windows::Win32::UI::WindowsAndMessaging::SWP_NOSIZE
          | SWP_NOACTIVATE,
      );
      embed_op_log(
        Some(&self.app),
        "SetWindowPos(video_hwnd)",
        "after",
        session_id,
        parent_hwnd.0 as usize,
        video_hwnd.0 as usize,
      );
    }

    let app_clone = self.app.clone();
    let state_clone = Arc::clone(&state);
    let v = video_hwnd.0 as usize;
    let ipc_pending_in = Arc::clone(&backend.ipc_pending);
    let pause_verify_in = Arc::clone(&pause_verify);
    let pipe_for_read = backend.ipc_client_path.clone();
    let pid_for_read = backend.mpv_pid;
    let ipc_dead_for_read = Arc::clone(&backend.ipc_dead);
    let session_id_for_read = session_id;
    thread::spawn(move || {
      read_ipc_loop(
        app_clone,
        session_id_for_read,
        pipe_for_read,
        pid_for_read,
        ipc_dead_for_read,
        state_clone,
        v,
        false,
        reader,
        ipc_pending_in,
        pause_verify_in,
      )
    });

    // mpv can add HWNDs under the video root **or** as extra main-window children; skip wry's `WRY_WEBVIEW`.
    // In embedded-safe-mode, skip non-essential restacking after launch.
    if !embedded_safe_mode {
      refresh_native_overlay_stack_traced(
        Some(&self.app),
        session_id,
        parent_hwnd,
        video_hwnd.0 as usize,
        NativeOverlayRefreshScope::ExternalMpvChildren,
      );
    } else {
      append_player_debug_log(
        Some(&self.app),
        &format!(
          "[embed-op] skip refresh_native_overlay_stack (post-launch) session_id={} embedded_safe_mode=true parent_hwnd=0x{:x} video_hwnd=0x{:x}",
          session_id,
          parent_hwnd.0 as usize,
          video_hwnd.0 as usize
        ),
      );
    }

    *self.state.lock().map_err(|_| "player state poisoned")? = Some(Session {
      session_id,
      video_hwnd: video_hwnd.0 as usize,
      parent_hwnd: parent_hwnd.0 as usize,
      embedded_safe_mode,
      embedded_minimal_mode: false,
      last_open: payload.clone(),
      backend: BackendSession::External(backend),
      state,
      last_action,
      close_reason,
      passthrough_stop: Arc::clone(&passthrough_stop),
      pause_verify,
    });

    if embedded_safe_mode {
      append_player_debug_log(
        Some(&self.app),
        &format!(
          "[embed-op] skip background overlay restack thread session_id={} embedded_safe_mode=true parent_hwnd=0x{:x} video_hwnd=0x{:x}",
          session_id,
          parent_hwnd.0 as usize,
          video_hwnd.0 as usize
        ),
      );
      return Ok(());
    }

    // mpv can create child HWNDs after the first pause; re-apply WS_EX_TRANSPARENT + WS_DISABLED often.
    // Also poll cursor vs video rect so React can wake controls when the WebView does not receive pointer events.
    let state_arc = Arc::clone(&self.state);
    let app_loop = self.app.clone();
    let stop_flag = Arc::clone(&passthrough_stop);
    thread::spawn(move || {
      let mut last_hover_emit = Instant::now() - Duration::from_secs(10);
      let mut last_lbutton_down = false;
      let mut tick: u32 = 0;
      while !stop_flag.load(Ordering::SeqCst) {
        thread::sleep(Duration::from_millis(40));
        if stop_flag.load(Ordering::SeqCst) {
          break;
        }
        tick = tick.wrapping_add(1);
        let hwnd_opt = state_arc.lock().ok().and_then(|g| {
          g.as_ref().map(|s| (s.parent_hwnd, s.video_hwnd))
        });
        let Some((parent, video)) = hwnd_opt else {
          break;
        };
        if tick % 3 == 0 {
          let app = app_loop.clone();
          let app_for_closure = app.clone();
          let _ = app.run_on_main_thread(move || {
            refresh_native_overlay_stack_traced(
              Some(&app_for_closure),
              session_id,
              HWND(parent as *mut _),
              video,
              NativeOverlayRefreshScope::ExternalMpvChildren,
            );
          });
        }
        unsafe {
          let mut pt = POINT::default();
          if GetCursorPos(&mut pt).is_err() {
            continue;
          }
          let mut r = RECT::default();
          if GetWindowRect(HWND(video as *mut _), &mut r).is_err() {
            continue;
          }
          let inside = pt.x >= r.left && pt.x < r.right && pt.y >= r.top && pt.y < r.bottom;
          if !inside {
            last_lbutton_down = false;
            continue;
          }
          if last_hover_emit.elapsed() >= Duration::from_millis(90) {
            let _ = app_loop.emit("player2-video-hover", ());
            last_hover_emit = Instant::now();
          }
          let lb = GetAsyncKeyState(1);
          let down = (lb as u16 & 0x8000) != 0;
          if down && !last_lbutton_down {
            let _ = app_loop.emit("player2-video-pointerdown", ());
          }
          last_lbutton_down = down;
        }
      }
    });

    Ok(())
  }

  fn open_embedded_minimal_impl(&self, payload: PlayerOpen, no_config: bool) -> Result<(), String> {
    let Some(exe) = find_mpv_exe(&self.app) else {
      return Err("Bundled mpv not found. Run npm run bundle:prepare.".to_string());
    };

    let main_win = self
      .app
      .get_webview_window("main")
      .ok_or("Main window not found")?;
    let parent_hwnd: HWND = main_win.hwnd().map_err(|e| e.to_string())?;

    let video_hwnd = create_embed_video_child(parent_hwnd)?;

    let state = Arc::new(Mutex::new(PlayerState {
      loading: true,
      ipc_healthy: true,
      sub_visible: true,
      sid: -1,
      aid: -1,
      ..Default::default()
    }));

    let passthrough_stop = Arc::new(AtomicBool::new(false));
    let pause_verify = Arc::new(Mutex::new(PauseIpcVerifySnapshot::default()));
    let last_action = Arc::new(Mutex::new("open_embedded_minimal".to_string()));
    let close_reason = Arc::new(Mutex::new(None));

    let session_id = NEXT_PLAYER_SESSION_ID.fetch_add(1, Ordering::SeqCst);
    let (backend, reader) = spawn_mpv_embedded(
      self.app.clone(),
      session_id,
      Arc::clone(&state),
      Arc::clone(&last_action),
      Arc::clone(&close_reason),
      Arc::clone(&self.last_mpv_exit_report),
      &exe,
      video_hwnd.0 as usize,
      &payload,
      no_config,
      true,
    )?;

    append_player_debug_log(
      Some(&self.app),
      &format!(
        "[mpv-launch-embedded-minimal] session_id={session_id} pid={} no_config={no_config} parent_hwnd=0x{:x} video_hwnd=0x{:x}",
        backend.mpv_pid,
        parent_hwnd.0 as usize,
        video_hwnd.0 as usize
      ),
    );

    // Initial placement only (required).
    unsafe {
      embed_op_log(
        Some(&self.app),
        "SetWindowPos(video_hwnd) minimal initial placement",
        "before",
        session_id,
        parent_hwnd.0 as usize,
        video_hwnd.0 as usize,
      );
      let _ = SetWindowPos(
        video_hwnd,
        Some(HWND_TOP),
        0,
        0,
        0,
        0,
        windows::Win32::UI::WindowsAndMessaging::SWP_NOMOVE
          | windows::Win32::UI::WindowsAndMessaging::SWP_NOSIZE
          | SWP_NOACTIVATE,
      );
      embed_op_log(
        Some(&self.app),
        "SetWindowPos(video_hwnd) minimal initial placement",
        "after",
        session_id,
        parent_hwnd.0 as usize,
        video_hwnd.0 as usize,
      );
    }

    // IPC reader only. No overlay refresh, no background restack thread, no click-through forcing.
    let app_clone = self.app.clone();
    let state_clone = Arc::clone(&state);
    let ipc_pending_in = Arc::clone(&backend.ipc_pending);
    let pause_verify_in = Arc::clone(&pause_verify);
    let pipe_for_read = backend.ipc_client_path.clone();
    let pid_for_read = backend.mpv_pid;
    let ipc_dead_for_read = Arc::clone(&backend.ipc_dead);
    let session_id_for_read = session_id;
    let v = video_hwnd.0 as usize;
    thread::spawn(move || {
      read_ipc_loop(
        app_clone,
        session_id_for_read,
        pipe_for_read,
        pid_for_read,
        ipc_dead_for_read,
        state_clone,
        v,
        true,
        reader,
        ipc_pending_in,
        pause_verify_in,
      )
    });

    *self.state.lock().map_err(|_| "player state poisoned")? = Some(Session {
      session_id,
      video_hwnd: video_hwnd.0 as usize,
      parent_hwnd: parent_hwnd.0 as usize,
      embedded_safe_mode: false,
      embedded_minimal_mode: true,
      last_open: payload.clone(),
      backend: BackendSession::External(backend),
      state,
      last_action,
      close_reason,
      passthrough_stop: Arc::clone(&passthrough_stop),
      pause_verify,
    });

    Ok(())
  }

  fn open_detached_impl(&self, payload: PlayerOpen, no_config: bool) -> Result<(), String> {
    let Some(exe) = find_mpv_exe(&self.app) else {
      return Err("Bundled mpv not found. Run npm run bundle:prepare.".to_string());
    };
    let main_win = self
      .app
      .get_webview_window("main")
      .ok_or("Main window not found")?;
    let parent_hwnd: HWND = main_win.hwnd().map_err(|e| e.to_string())?;

    let state = Arc::new(Mutex::new(PlayerState {
      loading: true,
      ipc_healthy: true,
      sub_visible: true,
      sid: -1,
      aid: -1,
      ..Default::default()
    }));
    let passthrough_stop = Arc::new(AtomicBool::new(false));
    let pause_verify = Arc::new(Mutex::new(PauseIpcVerifySnapshot::default()));
    let last_action = Arc::new(Mutex::new("open_detached".to_string()));
    let close_reason = Arc::new(Mutex::new(None));

    let session_id = NEXT_PLAYER_SESSION_ID.fetch_add(1, Ordering::SeqCst);
    let (backend, reader) = spawn_mpv_embedded(
      self.app.clone(),
      session_id,
      Arc::clone(&state),
      Arc::clone(&last_action),
      Arc::clone(&close_reason),
      Arc::clone(&self.last_mpv_exit_report),
      &exe,
      0, // no --wid
      &payload,
      no_config,
      false,
    )?;

  // Only start IPC reader if IPC is enabled
  let disable_ipc = std::env::var("PITFLIX_NO_IPC").is_ok();
  if !disable_ipc {
    let app_clone = self.app.clone();
    let state_clone = Arc::clone(&state);
    let ipc_pending_in = Arc::clone(&backend.ipc_pending);
    let pause_verify_in = Arc::clone(&pause_verify);
    let pipe_for_read = backend.ipc_client_path.clone();
    let pid_for_read = backend.mpv_pid;
    let ipc_dead_for_read = Arc::clone(&backend.ipc_dead);
    let session_id_for_read = session_id;
    thread::spawn(move || {
      read_ipc_loop(
        app_clone,
        session_id_for_read,
        pipe_for_read,
        pid_for_read,
        ipc_dead_for_read,
        state_clone,
        0,
        false,
        reader,
        ipc_pending_in,
        pause_verify_in,
      )
    });
  } else {
    eprintln!("[mpv-diagnostic] Skipping IPC reader thread (PITFLIX_NO_IPC=1)");
  }

    *self.state.lock().map_err(|_| "player state poisoned")? = Some(Session {
      session_id,
      video_hwnd: 0,
      parent_hwnd: parent_hwnd.0 as usize,
      embedded_safe_mode: false,
      embedded_minimal_mode: false,
      last_open: payload.clone(),
      backend: BackendSession::External(backend),
      state,
      last_action,
      close_reason,
      passthrough_stop: Arc::clone(&passthrough_stop),
      pause_verify,
    });
    Ok(())
  }

  /// Dormant: embedded libmpv + GL path. Not used by `open()` or `recover` by default.
  /// Kept for diagnostic commands like `player2_open_embedded_minimal_no_config`.
  fn open_libmpv_impl(&self, payload: PlayerOpen) -> Result<(), String> {
    let Some(libmpv) = find_libmpv_dll(&self.app) else {
      return Err("Embedded libmpv not available: libmpv-2.dll missing or failed to load".to_string());
    };
    let main_win = self
      .app
      .get_webview_window("main")
      .ok_or("Main window not found")?;
    let parent_hwnd: HWND = main_win.hwnd().map_err(|e| e.to_string())?;

    let video_hwnd = create_embed_video_child(parent_hwnd)?;
    let session_id = NEXT_PLAYER_SESSION_ID.fetch_add(1, Ordering::SeqCst);
    let parent_hwnd_usize = parent_hwnd.0 as usize;
    let video_hwnd_usize = video_hwnd.0 as usize;

    let (tx, rx) = mpsc::channel::<Result<EmbeddedLibMpvSession, String>>();
    let app_main = self.app.clone();
    let app_for_closure = app_main.clone();
    let payload_for_closure = payload.clone();
    app_main
      .run_on_main_thread(move || {
        reparent_pitflix_video_into_wry_tree(
          Some(&app_for_closure),
          HWND(parent_hwnd_usize as *mut _),
          HWND(video_hwnd_usize as *mut _),
        );
        unsafe {
          let _ = ShowWindow(
            HWND(video_hwnd_usize as *mut _),
            windows::Win32::UI::WindowsAndMessaging::SW_HIDE,
          );
        }
        let r = windows_libmpv_host::create_embedded_libmpv_session(
          app_for_closure.clone(),
          session_id,
          HWND(parent_hwnd_usize as *mut _),
          HWND(video_hwnd_usize as *mut _),
          libmpv,
          payload_for_closure,
        );
        let _ = tx.send(r);
      })
      .map_err(|e| e.to_string())?;
    let backend = rx.recv().map_err(|_| "libmpv init thread failed".to_string())??;

    let state = Arc::clone(&backend.state);
    // libmpv: video is reparented under `WRY_WEBVIEW` and kept at `HWND_BOTTOM`; refresh keeps Z-order
    // stable. External `--wid` still uses click-through + `HWND_TOP` on the main window.
    let passthrough_stop = Arc::new(AtomicBool::new(false));
    let pause_verify = Arc::new(Mutex::new(PauseIpcVerifySnapshot::default()));
    let last_action = Arc::new(Mutex::new("open(libmpv)".to_string()));
    let close_reason = Arc::new(Mutex::new(None));

    append_player_debug_log(
      Some(&self.app),
      &format!(
        "[libmpv-render] refresh_native_overlay_stack after open session_id={session_id} parent_hwnd=0x{:x} video_hwnd=0x{:x}",
        parent_hwnd.0 as usize,
        video_hwnd.0 as usize
      ),
    );
    refresh_native_overlay_stack_traced(
      Some(&self.app),
      session_id,
      parent_hwnd,
      video_hwnd.0 as usize,
      NativeOverlayRefreshScope::LibMpvVideoEmbedOnly,
    );
    request_repaint_video_traced(
      Some(&self.app),
      video_hwnd.0 as usize,
      session_id,
      "open_libmpv(after_overlay_refresh)",
    );

    *self.state.lock().map_err(|_| "player state poisoned")? = Some(Session {
      session_id,
      video_hwnd: video_hwnd.0 as usize,
      parent_hwnd: parent_hwnd.0 as usize,
      embedded_safe_mode: false,
      embedded_minimal_mode: false,
      last_open: payload,
      backend: BackendSession::LibMpv(backend),
      state,
      last_action,
      close_reason,
      passthrough_stop: Arc::clone(&passthrough_stop),
      pause_verify,
    });

    append_player_debug_log(
      Some(&self.app),
      &format!(
        "[libmpv-render] spawn overlay restack thread session_id={session_id} parent_hwnd=0x{:x} video_hwnd=0x{:x}",
        parent_hwnd.0 as usize,
        video_hwnd.0 as usize
      ),
    );
    let state_arc = Arc::clone(&self.state);
    let app_loop = self.app.clone();
    let stop_flag = Arc::clone(&passthrough_stop);
    thread::spawn(move || {
      let mut tick: u32 = 0;
      while !stop_flag.load(Ordering::SeqCst) {
        thread::sleep(Duration::from_millis(40));
        if stop_flag.load(Ordering::SeqCst) {
          break;
        }
        tick = tick.wrapping_add(1);
        let hwnd_opt = state_arc.lock().ok().and_then(|g| {
          g.as_ref().map(|s| (s.parent_hwnd, s.video_hwnd))
        });
        let Some((parent, video)) = hwnd_opt else {
          break;
        };
        if tick % 3 == 0 {
          let app = app_loop.clone();
          let app_for_closure = app.clone();
          let _ = app.run_on_main_thread(move || {
            refresh_native_overlay_stack_traced(
              Some(&app_for_closure),
              session_id,
              HWND(parent as *mut _),
              video,
              NativeOverlayRefreshScope::LibMpvVideoEmbedOnly,
            );
          });
        }
      }
    });

    Ok(())
  }

  pub fn set_video_bounds(&self, x: i32, y: i32, width: i32, height: i32) -> Result<(), String> {
    let g = self.state.lock().map_err(|_| "player state poisoned")?;
    let Some(s) = g.as_ref() else {
      return Err("No active player".to_string());
    };
    if s.video_hwnd == 0 {
      // Detached mode: no native embedded surface to move.
      return Ok(());
    }
    if s.embedded_minimal_mode {
      // Minimal embedded diagnostic: no bounds choreography after launch.
      return Ok(());
    }
    if width <= 0 || height <= 0 {
      return Ok(());
    }
    // Frontend sends **logical** CSS pixels (same space as `getBoundingClientRect`). Convert to
    // physical pixels using the main window DPI so the native child matches WebView2 layout.
    let parent = HWND(s.parent_hwnd as *mut _);
    let logical = DebugBounds { x, y, width, height };
    let x = logical_px_to_physical(parent, x);
    let y = logical_px_to_physical(parent, y);
    let width = logical_px_to_physical(parent, width);
    let height = logical_px_to_physical(parent, height);
    let is_libmpv = matches!(s.backend, BackendSession::LibMpv(_));
    let vid = HWND(s.video_hwnd as *mut _);
    let mut px = x;
    let mut py = y;
    unsafe {
      let actual_parent = GetParent(vid).unwrap_or(parent);
      if actual_parent.0 != parent.0 {
        let mut pt = POINT { x: px, y: py };
        let mapped = MapWindowPoints(Some(parent), Some(actual_parent), std::slice::from_mut(&mut pt));
        if mapped != 0 {
          px = pt.x;
          py = pt.y;
        } else {
          append_player_debug_log(
            Some(&self.app),
            "[libmpv-render] MapWindowPoints(main->video_parent) failed; using coordinates relative to main HWND",
          );
        }
      }
      embed_op_log(
        Some(&self.app),
        "SetWindowPos(video_hwnd) set_video_bounds",
        "before",
        s.session_id,
        s.parent_hwnd,
        s.video_hwnd,
      );
      // libmpv: `HWND_BOTTOM` keeps the GL child under WebView2’s Edge HWND after reparent under WRY.
      let insert = if is_libmpv {
        Some(HWND_BOTTOM)
      } else {
        Some(HWND_TOP)
      };
      let flags = SWP_SHOWWINDOW | SWP_NOACTIVATE;
      let _ = SetWindowPos(vid, insert, px, py, width, height, flags);
      embed_op_log(
        Some(&self.app),
        "SetWindowPos(video_hwnd) set_video_bounds",
        "after",
        s.session_id,
        s.parent_hwnd,
        s.video_hwnd,
      );
      if is_libmpv {
        let mut cr = RECT::default();
        let _ = GetClientRect(vid, &mut cr);
        let cw = (cr.right - cr.left).max(0);
        let ch = (cr.bottom - cr.top).max(0);
        append_player_debug_log(
          Some(&self.app),
          &format!(
            "[libmpv-render] set_video_bounds client_rect after SetWindowPos session_id={} video_hwnd=0x{:x} client=({cw}x{ch}) visible=WS_VISIBLE",
            s.session_id,
            s.video_hwnd
          ),
        );
      }
    }
    log_video_bounds("set_video_bounds", parent, HWND(s.video_hwnd as *mut _), logical, DebugBounds { x, y, width, height });
    if is_libmpv || !s.embedded_safe_mode {
      if is_libmpv && s.embedded_safe_mode {
        append_player_debug_log(
          Some(&self.app),
          &format!(
            "[libmpv-render] refresh_native_overlay_stack (set_video_bounds) forced for libmpv despite embedded_safe_mode session_id={} parent_hwnd=0x{:x} video_hwnd=0x{:x}",
            s.session_id,
            s.parent_hwnd,
            s.video_hwnd
          ),
        );
      }
      let overlay_scope = if is_libmpv {
        NativeOverlayRefreshScope::LibMpvVideoEmbedOnly
      } else {
        NativeOverlayRefreshScope::ExternalMpvChildren
      };
      refresh_native_overlay_stack_traced(
        Some(&self.app),
        s.session_id,
        HWND(s.parent_hwnd as *mut _),
        s.video_hwnd,
        overlay_scope,
      );
    } else {
      append_player_debug_log(
        Some(&self.app),
        &format!(
          "[embed-op] skip refresh_native_overlay_stack (set_video_bounds) session_id={} embedded_safe_mode=true parent_hwnd=0x{:x} video_hwnd=0x{:x}",
          s.session_id,
          s.parent_hwnd,
          s.video_hwnd
        ),
      );
    }
    append_player_debug_log(
      Some(&self.app),
      &format!(
        "[libmpv-render] repaint request after set_video_bounds session_id={} video_hwnd=0x{:x}",
        s.session_id, s.video_hwnd
      ),
    );
    request_repaint_video_traced(
      Some(&self.app),
      s.video_hwnd,
      s.session_id,
      "set_video_bounds",
    );
    Ok(())
  }

  /// Subtitle files in the same folder as the current media (`.srt`, `.ass`, `.ssa`, `.vtt`).
  pub fn list_external_subtitle_files(&self) -> Result<Vec<String>, String> {
    let g = self.state.lock().map_err(|_| "player state poisoned")?;
    let Some(s) = g.as_ref() else {
      return Err("No active player".to_string());
    };
    let media = Path::new(&s.last_open.path);
    let Some(dir) = media.parent() else {
      return Ok(Vec::new());
    };
    let Ok(read) = std::fs::read_dir(dir) else {
      return Ok(Vec::new());
    };
    let mut out: Vec<String> = Vec::new();
    for ent in read.flatten() {
      let p = ent.path();
      if !p.is_file() {
        continue;
      }
      let Some(ext) = p.extension().and_then(|e| e.to_str()) else {
        continue;
      };
      let ext = ext.to_ascii_lowercase();
      if matches!(ext.as_str(), "srt" | "ass" | "ssa" | "vtt") {
        out.push(p.to_string_lossy().to_string());
      }
    }
    out.sort();
    Ok(out)
  }

  /// Native host snapshot (external mpv mirror vs libmpv property query).
  pub fn get_native_state(&self) -> Player2NativeState {
    let Ok(g) = self.state.lock() else {
      return Player2NativeState {
        session_active: false,
        backend: "none".to_string(),
        session_id: None,
        video_hwnd: None,
        ipc_mirror: None,
        libmpv_pause_property: None,
        libmpv_property_error: Some("player state mutex poisoned".to_string()),
        pause_verification: None,
        render_frame_count: 0,
        last_render_error: None,
        window_thread_id: None,
      };
    };
    let Some(s) = g.as_ref() else {
      return Player2NativeState {
        session_active: false,
        backend: "none".to_string(),
        session_id: None,
        video_hwnd: None,
        ipc_mirror: None,
        libmpv_pause_property: None,
        libmpv_property_error: None,
        pause_verification: None,
        render_frame_count: 0,
        last_render_error: None,
        window_thread_id: None,
      };
    };
    let session_id = s.session_id;
    let video_hwnd = s.video_hwnd;
    let state_arc = Arc::clone(&s.state);
    let pause_verify_arc = Arc::clone(&s.pause_verify);
    // Stable strings consumed by `PlayerPage` / TS (`isNativeBackendExternal` / embedded checks).
    let (backend, libmpv_mpvc, libmpv_tid) = match &s.backend {
      BackendSession::LibMpv(b) => (
        "libmpv".to_string(),
        Some(Arc::clone(&b.mpv)),
        Some(b.window_thread_id),
      ),
      BackendSession::External(_) => ("external_mpv".to_string(), None, None),
    };
    drop(g);

    let ipc_mirror = state_arc.lock().ok().map(|x| x.clone());
    let pause_verification = pause_verify_arc.lock().ok().map(|x| x.clone());
    let (libmpv_pause_property, libmpv_property_error) = if let Some(mpv) = &libmpv_mpvc {
      (mpv.get_property_flag("pause").ok(), None)
    } else {
      (None, None)
    };
    let (render_frame_count, last_render_error) = render_health_snapshot();
    let (render_frame_count, last_render_error) = if libmpv_tid.is_some() {
      (render_frame_count, last_render_error)
    } else {
      (0u64, None)
    };

    Player2NativeState {
      session_active: true,
      backend,
      session_id: Some(session_id),
      video_hwnd: Some(video_hwnd as u64),
      ipc_mirror,
      libmpv_pause_property,
      libmpv_property_error,
      pause_verification,
      render_frame_count,
      last_render_error,
      window_thread_id: libmpv_tid,
    }
  }

  pub fn close(&self) {
    self.close_with_reason("close");
  }

  fn close_with_reason(&self, reason: &str) {
    let entry_time = std::time::Instant::now();
    eprintln!("[close-backend] step=entry elapsed=0ms");
    
    let lock_start = std::time::Instant::now();
    let Ok(mut g) = self.state.lock() else {
      return;
    };
    eprintln!("[close-backend] step=lock_acquired elapsed={}ms", lock_start.elapsed().as_millis());
    
    let mut was_embedded_minimal = false;
    let mut is_external = false;
    if let Some(mut s) = g.take() {
      was_embedded_minimal = s.embedded_minimal_mode;
      is_external = matches!(s.backend, BackendSession::External(_));
      
      if let Ok(mut cr) = s.close_reason.lock() {
        *cr = Some(reason.to_string());
      }
      unsafe {
        let p_ok = IsWindow(Some(HWND(s.parent_hwnd as *mut _))).as_bool();
        let v_ok = if s.video_hwnd == 0 {
          true
        } else {
          IsWindow(Some(HWND(s.video_hwnd as *mut _))).as_bool()
        };
        append_player_debug_log(
          Some(&self.app),
          &format!(
            "[hwnd-check] close reason={} session_id={} parent_ok={} video_ok={} parent_hwnd=0x{:x} video_hwnd=0x{:x}",
            reason,
            s.session_id,
            p_ok,
            v_ok,
            s.parent_hwnd,
            s.video_hwnd
          ),
        );
      }
      let session_id = s.session_id;
      let mpv_pid = match &s.backend {
        BackendSession::External(b) => Some(b.child.id()),
        BackendSession::LibMpv(_) => None,
      };
      
      eprintln!("[close-backend] step=session_extracted elapsed={}ms", entry_time.elapsed().as_millis());
      
      append_player_debug_log(
        Some(&self.app),
        &format!("[session-close-request] session_id={} reason={} mpv_pid={:?}", session_id, reason, mpv_pid),
      );
      
      s.passthrough_stop.store(true, Ordering::SeqCst);
      eprintln!("[close-backend] step=passthrough_stop_set elapsed={}ms", entry_time.elapsed().as_millis());
      
      match &mut s.backend {
        BackendSession::External(b) => {
          eprintln!("[close-backend] step=external_backend_start elapsed={}ms", entry_time.elapsed().as_millis());
          
          // Send quit command via IPC (non-blocking)
          if !b.ipc_dead.load(Ordering::SeqCst) {
            let quit_start = std::time::Instant::now();
            let quit_cmd = serde_json::json!({"command": ["quit"]});
            let quit_line = serde_json::to_string(&quit_cmd).unwrap_or_default();
            let mut quit_bytes = quit_line.as_bytes().to_vec();
            quit_bytes.push(b'\n');
            
            let quit_msg = IpcWriteMsg {
              bytes: quit_bytes,
              generation: b.ipc_generation.load(Ordering::SeqCst),
              label: "quit".to_string(),
              line_for_log: quit_line,
              log_success: false,
            };
            
            let _ = b.tx.try_send(quit_msg);
            eprintln!("[close-backend] step=quit_sent elapsed={}ms duration={}ms", entry_time.elapsed().as_millis(), quit_start.elapsed().as_millis());
          }
          
          // Kill process immediately (don't wait for graceful exit)
          let kill_start = std::time::Instant::now();
          let _ = b.child.kill();
          eprintln!("[close-backend] step=kill_sent elapsed={}ms duration={}ms", entry_time.elapsed().as_millis(), kill_start.elapsed().as_millis());
          
          append_player_debug_log(
            Some(&self.app),
            &format!("[session-close-immediate] session_id={} mpv_pid={:?}", session_id, mpv_pid),
          );
        }
        BackendSession::LibMpv(b) => {
          eprintln!("[close-backend] step=libmpv_backend_start elapsed={}ms", entry_time.elapsed().as_millis());
          windows_libmpv_host::shutdown(b);
          let _ = windows_libmpv_host::teardown_gl_renderer(&self.app, b.video_hwnd);
          eprintln!("[close-backend] step=libmpv_shutdown_done elapsed={}ms", entry_time.elapsed().as_millis());
        }
      }
      eprintln!("[close-backend] step=backend_cleanup_done elapsed={}ms", entry_time.elapsed().as_millis());
      
      if s.video_hwnd != 0 {
        let destroy_start = std::time::Instant::now();
        unsafe {
          let _ = DestroyWindow(HWND(s.video_hwnd as *mut _));
        }
        eprintln!("[close-backend] step=destroy_window elapsed={}ms duration={}ms", entry_time.elapsed().as_millis(), destroy_start.elapsed().as_millis());
      }
      eprintln!("[close-backend] step=before_drop elapsed={}ms", entry_time.elapsed().as_millis());
      // s will be dropped here, releasing the lock
    }
    eprintln!("[close-backend] step=after_drop elapsed={}ms", entry_time.elapsed().as_millis());
    
    // CRITICAL: For external mode, skip set_focus entirely - it blocks for ~1 second
    if is_external {
      eprintln!("[close-backend] step=skip_focus_external elapsed={}ms", entry_time.elapsed().as_millis());
      return;
    }
    
    // Minimal embedded diagnostic: no focus juggling after close.
    if was_embedded_minimal {
      append_player_debug_log(
        Some(&self.app),
        "[embed-op] skip set_focus(main window) embedded_minimal_mode=true",
      );
      eprintln!("[close-backend] step=skip_focus_minimal elapsed={}ms", entry_time.elapsed().as_millis());
      return;
    }
    
    let focus_start = std::time::Instant::now();
    let _ = self.app.get_webview_window("main").map(|w| {
      append_player_debug_log(Some(&self.app), "[embed-op] before set_focus(main window)");
      let r = w.set_focus();
      append_player_debug_log(Some(&self.app), "[embed-op] after set_focus(main window)");
      r
    });
    eprintln!("[close-backend] step=set_focus_done elapsed={}ms duration={}ms", entry_time.elapsed().as_millis(), focus_start.elapsed().as_millis());
  }

  pub fn send(&self, cmd: PlayerCommand) -> Result<(), String> {
    // Record last action for exit diagnostics.
    if let Ok(mut g) = self.state.lock() {
      if let Some(s) = g.as_ref() {
        if let Ok(mut a) = s.last_action.lock() {
          *a = format!("send:{cmd:?}");
        }
      }
    }
    // libmpv backend: enqueue command and return.
    {
      let g = self.state.lock().map_err(|_| "player state poisoned")?;
      let Some(s) = g.as_ref() else {
        append_player_debug_log(
          Some(&self.app),
          "[native-send] rejected: no active session (player2_send)",
        );
        return Err("No active player".to_string());
      };
      match &s.backend {
        BackendSession::LibMpv(b) => {
          let _ = b.cmd_tx.send(cmd).map_err(|_| "libmpv command channel closed".to_string())?;
          return Ok(());
        }
        BackendSession::External(_) => {}
      }
    }

    let msg = cmd_to_mpv_ipc(&cmd);
    let payload_line = serde_json::to_string(&msg).unwrap_or_else(|_| "<json err>".to_string());
    let pause_related = matches!(
      &cmd,
      PlayerCommand::SetPaused(_) | PlayerCommand::Play | PlayerCommand::Pause
    );

    let (session_id, parent_hwnd, video_hwnd, embedded_safe_mode, embedded_minimal_mode, pause_related) = {
      let g = self.state.lock().map_err(|_| "player state poisoned")?;
      let Some(s) = g.as_ref() else {
        append_player_debug_log(
          Some(&self.app),
          "[native-send] rejected: no active session (player2_send)",
        );
        return Err("No active player".to_string());
      };
      let BackendSession::External(backend) = &s.backend else {
        return Ok(());
      };
      if backend.ipc_dead.load(Ordering::SeqCst)
        || backend.ipc_unrecoverable.load(Ordering::SeqCst)
        || backend.ipc_reconnecting.load(Ordering::SeqCst)
      {
        return Err("mpv IPC disconnected. Reopen player.".to_string());
      }
      append_player_debug_log(
        Some(&self.app),
        &format!(
          "[native-send] recv backend={} cmd={cmd:?} json={}",
          backend_label(),
          payload_line.trim()
        ),
      );
      let gen = backend.ipc_generation.load(Ordering::SeqCst);
      enqueue_ipc(backend.tx.as_ref(), gen, &msg)?;
      if pause_related {
        if let Ok(st) = s.state.lock() {
          append_player_debug_log(
            Some(&self.app),
            &format!(
              "[native-send] ok external_mpv ipc_mirror paused={} playing={} ended={}",
              st.paused, st.playing, st.ended
            ),
          );
        }
      }
      (
        s.session_id,
        s.parent_hwnd,
        s.video_hwnd,
        s.embedded_safe_mode,
        s.embedded_minimal_mode,
        pause_related,
      )
    };

    // Detached mode: no embedded window ops.
    if video_hwnd == 0 {
      return Ok(());
    }
    if embedded_minimal_mode {
      // Minimal embedded diagnostic: no post-send window ops.
      return Ok(());
    }

    // Diagnostic: skip restack/overlay refresh around pause/resume transitions for embedded mode.
    if embedded_safe_mode && pause_related {
      append_player_debug_log(
        Some(&self.app),
        &format!(
          "[embed-op] skip refresh_native_overlay_stack (send pause-related) session_id={} embedded_safe_mode=true parent_hwnd=0x{:x} video_hwnd=0x{:x} cmd={cmd:?}",
          session_id,
          parent_hwnd,
          video_hwnd
        ),
      );
      return Ok(());
    }

    let app = self.app.clone();
    let app_for_closure = app.clone();
    app
      .run_on_main_thread(move || {
        refresh_native_overlay_stack_traced(
          Some(&app_for_closure),
          session_id,
          HWND(parent_hwnd as *mut _),
          video_hwnd,
          NativeOverlayRefreshScope::ExternalMpvChildren,
        );
      })
      .map_err(|e| e.to_string())?;
    Ok(())
  }

  /// Hard transport diagnostic: send an OSD message over the *active* mpv IPC writer.
  pub fn test_ipc_osd(&self) -> Result<(), String> {
    // IPC diagnostics only apply to external mpv.
    {
      let g = self.state.lock().map_err(|_| "player state poisoned".to_string())?;
      let Some(s) = g.as_ref() else {
        return Err("No active player".to_string());
      };
      if matches!(&s.backend, BackendSession::LibMpv(_)) {
        return Err("IPC diagnostics not available for libmpv embedded mode".to_string());
      }
    }
    let (tx, session_id, pipe, pid) = {
      let g = self.state.lock().map_err(|_| "player state poisoned".to_string())?;
      let Some(s) = g.as_ref() else {
        return Err("No active player".to_string());
      };
      let BackendSession::External(backend) = &s.backend else {
        return Err("No active external mpv session".to_string());
      };
      if backend.ipc_dead.load(Ordering::SeqCst)
        || backend.ipc_unrecoverable.load(Ordering::SeqCst)
        || backend.ipc_reconnecting.load(Ordering::SeqCst)
      {
        return Err("mpv IPC disconnected. Reopen player.".to_string());
      }
      (
        Arc::clone(&backend.tx),
        s.session_id,
        backend.ipc_client_path.clone(),
        backend.mpv_pid,
      )
    };

    let msg = json!({"command":["show-text","HELLO FROM IPC",2000]});
    append_player_debug_log(
      Some(&self.app),
      &format!(
        "[ipc-test] osd SEND session_id={session_id} mpv_pid={pid} pipe={} enqueue=attempt",
        pipe
      ),
    );
    let gen = {
      let g = self.state.lock().map_err(|_| "player state poisoned".to_string())?;
      let Some(s) = g.as_ref() else {
        return Err("No active player".to_string());
      };
      let BackendSession::External(backend) = &s.backend else {
        return Err("No active external mpv session".to_string());
      };
      backend.ipc_generation.load(Ordering::SeqCst)
    };
    enqueue_ipc_with_diagnostics(tx.as_ref(), gen, &msg, "test_osd", true, Some(&self.app))?;
    append_player_debug_log(
      Some(&self.app),
      &format!("[ipc-test] osd ENQUEUED OK session_id={session_id} mpv_pid={pid} pipe={pipe}"),
    );
    Ok(())
  }

  /// Hard transport diagnostic: send `cycle pause` over the *active* mpv IPC writer.
  pub fn test_toggle_pause(&self) -> Result<(), String> {
    // IPC diagnostics only apply to external mpv.
    {
      let g = self.state.lock().map_err(|_| "player state poisoned".to_string())?;
      let Some(s) = g.as_ref() else {
        return Err("No active player".to_string());
      };
      if matches!(&s.backend, BackendSession::LibMpv(_)) {
        return Err("IPC diagnostics not available for libmpv embedded mode".to_string());
      }
    }
    let (tx, session_id, pipe, pid) = {
      let g = self.state.lock().map_err(|_| "player state poisoned".to_string())?;
      let Some(s) = g.as_ref() else {
        return Err("No active player".to_string());
      };
      let BackendSession::External(backend) = &s.backend else {
        return Err("No active external mpv session".to_string());
      };
      if backend.ipc_dead.load(Ordering::SeqCst)
        || backend.ipc_unrecoverable.load(Ordering::SeqCst)
        || backend.ipc_reconnecting.load(Ordering::SeqCst)
      {
        return Err("mpv IPC disconnected. Reopen player.".to_string());
      }
      (
        Arc::clone(&backend.tx),
        s.session_id,
        backend.ipc_client_path.clone(),
        backend.mpv_pid,
      )
    };

    let msg = json!({"command":["cycle","pause"]});
    append_player_debug_log(
      Some(&self.app),
      &format!(
        "[ipc-test] toggle_pause SEND session_id={session_id} mpv_pid={pid} pipe={} enqueue=attempt",
        pipe
      ),
    );
    let gen = {
      let g = self.state.lock().map_err(|_| "player state poisoned".to_string())?;
      let Some(s) = g.as_ref() else {
        return Err("No active player".to_string());
      };
      let BackendSession::External(backend) = &s.backend else {
        return Err("No active external mpv session".to_string());
      };
      backend.ipc_generation.load(Ordering::SeqCst)
    };
    enqueue_ipc_with_diagnostics(tx.as_ref(), gen, &msg, "test_toggle_pause", true, Some(&self.app))?;
    append_player_debug_log(
      Some(&self.app),
      &format!(
        "[ipc-test] toggle_pause ENQUEUED OK session_id={session_id} mpv_pid={pid} pipe={pipe}"
      ),
    );
    Ok(())
  }

  pub fn get_last_mpv_exit_report(&self) -> Option<MpvExitReport> {
    self.last_mpv_exit_report.lock().ok().and_then(|g| g.clone())
  }

  /// Pause: `set_property` pause true (no wait), then `get_property` pause by `request_id` (blocking).
  pub fn pause_with_confirmation(&self) -> Result<(), String> {
    if let Ok(mut g) = self.state.lock() {
      if let Some(s) = g.as_ref() {
        if let Ok(mut a) = s.last_action.lock() {
          *a = "pause".to_string();
        }
      }
    }
    // libmpv: fire-and-forget pause.
    let libmpv_video: Option<(usize, u64)> = {
      let g = self.state.lock().map_err(|_| "player state poisoned".to_string())?;
      let Some(s) = g.as_ref() else {
        return Err("No active player".to_string());
      };
      if let BackendSession::LibMpv(b) = &s.backend {
        let _ = b.cmd_tx.send(PlayerCommand::Pause).map_err(|_| "libmpv command channel closed".to_string())?;
        Some((s.video_hwnd, s.session_id))
      } else {
        None
      }
    };
    if let Some((v, sid)) = libmpv_video {
      append_player_debug_log(
        Some(&self.app),
        &format!("[libmpv-render] repaint request after libmpv pause video_hwnd=0x{v:x}"),
      );
      request_repaint_video_traced(Some(&self.app), v, sid, "libmpv_pause");
      return Ok(());
    }
    self.verify_pause_resume_correlated(true, "player2_pause")
  }

  /// Resume: enqueue a non-blocking unpause command and return immediately. A background thread polls
  /// the mirror state over ~1500ms (initial 200ms delay, then ~175ms between attempts); on failure
  /// performs soft verification in the background for diagnostics only.
  pub fn resume_with_confirmation(&self) -> Result<(), String> {
    if let Ok(mut g) = self.state.lock() {
      if let Some(s) = g.as_ref() {
        if let Ok(mut a) = s.last_action.lock() {
          *a = "resume".to_string();
        }
      }
    }
    // libmpv: fire-and-forget resume.
    let libmpv_video: Option<(usize, u64)> = {
      let g = self.state.lock().map_err(|_| "player state poisoned".to_string())?;
      let Some(s) = g.as_ref() else {
        return Err("No active player".to_string());
      };
      if let BackendSession::LibMpv(b) = &s.backend {
        let _ = b.cmd_tx.send(PlayerCommand::Play).map_err(|_| "libmpv command channel closed".to_string())?;
        Some((s.video_hwnd, s.session_id))
      } else {
        None
      }
    };
    if let Some((v, sid)) = libmpv_video {
      append_player_debug_log(
        Some(&self.app),
        &format!("[libmpv-render] repaint request after libmpv resume video_hwnd=0x{v:x}"),
      );
      request_repaint_video_traced(Some(&self.app), v, sid, "libmpv_resume");
      return Ok(());
    }
    // Host window validity diagnostics around resume.
    if let Ok(g) = self.state.lock() {
      if let Some(s) = g.as_ref() {
        unsafe {
          let p_ok = IsWindow(Some(HWND(s.parent_hwnd as *mut _))).as_bool();
          let v_ok = if s.video_hwnd == 0 {
            true
          } else {
            IsWindow(Some(HWND(s.video_hwnd as *mut _))).as_bool()
          };
          append_player_debug_log(
            Some(&self.app),
            &format!(
              "[hwnd-check] before resume session_id={} parent_ok={} video_ok={} parent_hwnd=0x{:x} video_hwnd=0x{:x}",
              s.session_id,
              p_ok,
              v_ok,
              s.parent_hwnd,
              s.video_hwnd
            ),
          );
        }
      }
    }
    let (ipc_tx, player_state, pause_verify, parent_hwnd, video_hwnd, app, session_id, embedded_safe_mode, embedded_minimal_mode) = {
      let g = self.state.lock().map_err(|_| "player state poisoned".to_string())?;
      let Some(s) = g.as_ref() else {
        return Err("No active player".to_string());
      };
      let BackendSession::External(backend) = &s.backend else {
        return Err("No active external mpv session".to_string());
      };
      if backend.ipc_dead.load(Ordering::SeqCst)
        || backend.ipc_unrecoverable.load(Ordering::SeqCst)
        || backend.ipc_reconnecting.load(Ordering::SeqCst)
      {
        return Err("mpv IPC disconnected. Reopen player.".to_string());
      }
      (
        Arc::clone(&backend.tx),
        Arc::clone(&s.state),
        Arc::clone(&s.pause_verify),
        s.parent_hwnd,
        s.video_hwnd,
        self.app.clone(),
        s.session_id,
        s.embedded_safe_mode,
        s.embedded_minimal_mode,
      )
    };

    let (before_paused, before_core_idle, before_audio_pts_full, before_time_pos_full) = {
      let st = player_state
        .lock()
        .map_err(|_| "player state poisoned".to_string())?;
      (st.paused, st.core_idle, st.audio_pts_full, st.time_pos_full)
    };

    // mpv's own OSC uses `cycle pause` to toggle. Empirically, this can be more reliable than
    // `set_property pause false` on some embedded/IPC setups.
    //
    // IMPORTANT:
    // - Only use `cycle pause` when we already *know* we're paused via the mirror.
    // - If we don't believe we're paused, keep the explicit unpause command (idempotent).
    let msg = if before_paused {
      json!({"command":["cycle","pause"]})
    } else {
      json!({"command":["set_property","pause", false]})
    };
    let set_json_line = serde_json::to_string(&msg).unwrap_or_else(|_| "{}".to_string());
    if let Ok(mut snap) = pause_verify.lock() {
      snap.last_resume_command_sent_json = Some(set_json_line);
      snap.last_error = None;
    }

    let gen = {
      let g = self.state.lock().map_err(|_| "player state poisoned".to_string())?;
      let Some(s) = g.as_ref() else {
        return Err("No active player".to_string());
      };
      let BackendSession::External(backend) = &s.backend else {
        return Err("No active external mpv session".to_string());
      };
      backend.ipc_generation.load(Ordering::SeqCst)
    };
    enqueue_ipc(ipc_tx.as_ref(), gen, &msg).map_err(|e| format!("player2_resume: IPC enqueue failed: {e}"))?;

    // Diagnostics: skip embed-side refresh during resume when embedded-safe-mode/minimal is on.
    if video_hwnd != 0 {
      if embedded_safe_mode || embedded_minimal_mode {
        append_player_debug_log(
          Some(&app),
          &format!(
            "[embed-op] skip refresh_native_overlay_stack (resume) session_id={} embedded_safe_mode={} embedded_minimal_mode={} parent_hwnd=0x{:x} video_hwnd=0x{:x}",
            session_id,
            embedded_safe_mode,
            embedded_minimal_mode,
            parent_hwnd,
            video_hwnd
          ),
        );
      } else {
        let app_rt = app.clone();
        let app_for_closure = app_rt.clone();
        app_rt
          .run_on_main_thread(move || {
            refresh_native_overlay_stack_traced(
              Some(&app_for_closure),
              session_id,
              HWND(parent_hwnd as *mut _),
              video_hwnd,
              NativeOverlayRefreshScope::ExternalMpvChildren,
            );
          })
          .map_err(|e| e.to_string())?;
      }
    }

    if before_paused {
      let app_bg = app.clone();
      let state_bg = Arc::clone(&player_state);
      let parent = parent_hwnd;
      let video = video_hwnd;
      let sid = session_id;
      let safe = embedded_safe_mode;
      let minimal = embedded_minimal_mode;
      thread::spawn(move || {
        const RESUME_VERIFY_INITIAL_MS: u64 = 200;
        const RESUME_VERIFY_RETRY_MS: u64 = 175;
        const RESUME_VERIFY_MAX_MS: u64 = 1500;

        let thread_start = Instant::now();
        thread::sleep(Duration::from_millis(RESUME_VERIFY_INITIAL_MS));

        let mut verified = false;
        while thread_start.elapsed() < Duration::from_millis(RESUME_VERIFY_MAX_MS) {
          let ok = match state_bg.lock() {
            Ok(st) => resume_verify_mirror_ok(
              &st,
              before_paused,
              before_core_idle,
              before_audio_pts_full,
              before_time_pos_full,
            ),
            Err(_) => false,
          };
          if ok {
            verified = true;
            break;
          }
          let remaining = Duration::from_millis(RESUME_VERIFY_MAX_MS).saturating_sub(thread_start.elapsed());
          let sleep_for = Duration::from_millis(RESUME_VERIFY_RETRY_MS).min(remaining);
          if sleep_for.is_zero() {
            break;
          }
          thread::sleep(sleep_for);
        }

        if verified {
          if video != 0 && !safe && !minimal {
            let app_for_closure = app_bg.clone();
            let _ = app_bg.run_on_main_thread(move || {
              refresh_native_overlay_stack_traced(
                Some(&app_for_closure),
                sid,
                HWND(parent as *mut _),
                video,
                NativeOverlayRefreshScope::ExternalMpvChildren,
              );
            });
          }
          return;
        }

        // Soft verification failure policy:
        // - Do NOT surface a user-facing error for lack of confirmation alone (mirror can lag).
        // - Keep only internal diagnostics so hard transport failures remain the only inline errors.
        append_player_debug_log(
          Some(&app_bg),
          &format!(
            "[resume-verify] no confirmation within {}ms window (soft fail): paused/core-idle/audio-pts/full/time-pos/full did not prove resume",
            RESUME_VERIFY_MAX_MS
          ),
        );
        if video != 0 && !safe && !minimal {
          let app_for_closure = app_bg.clone();
          let _ = app_bg.run_on_main_thread(move || {
            refresh_native_overlay_stack_traced(
              Some(&app_for_closure),
              sid,
              HWND(parent as *mut _),
              video,
              NativeOverlayRefreshScope::ExternalMpvChildren,
            );
          });
        }
      });
    }

    Ok(())
  }

  /// Send `set_property` pause (fire-and-forget), then confirm only via correlated `get_property` reply.
  /// Waiter for `get_property` is registered **before** any writes so a fast reply cannot arrive before the map entry exists.
  fn verify_pause_resume_correlated(&self, want_paused: bool, label: &str) -> Result<(), String> {
    const IPC_WAIT: Duration = Duration::from_secs(8);
    let (ipc_tx, pending, next_id, player_state, pause_verify, parent_hwnd, video_hwnd, gen, session_id, embedded_safe_mode, embedded_minimal_mode) = {
      let g = self.state.lock().map_err(|_| "player state poisoned".to_string())?;
      let Some(s) = g.as_ref() else {
        return Err("No active player".to_string());
      };
      let BackendSession::External(backend) = &s.backend else {
        return Err("No active external mpv session".to_string());
      };
      if backend.ipc_dead.load(Ordering::SeqCst)
        || backend.ipc_unrecoverable.load(Ordering::SeqCst)
        || backend.ipc_reconnecting.load(Ordering::SeqCst)
      {
        return Err("mpv IPC disconnected. Reopen player.".to_string());
      }
      (
        Arc::clone(&backend.tx),
        Arc::clone(&backend.ipc_pending),
        Arc::clone(&backend.next_correlated_req_id),
        Arc::clone(&s.state),
        Arc::clone(&s.pause_verify),
        s.parent_hwnd,
        s.video_hwnd,
        backend.ipc_generation.load(Ordering::SeqCst),
        s.session_id,
        s.embedded_safe_mode,
        s.embedded_minimal_mode,
      )
    };

    if let Ok(mut snap) = pause_verify.lock() {
      snap.last_error = None;
    }

    let msg_set = if want_paused {
      json!({"command":["set_property","pause", true]})
    } else {
      json!({"command":["set_property","pause", false]})
    };
    let set_json_line = serde_json::to_string(&msg_set).unwrap_or_else(|_| "{}".to_string());
    if let Ok(mut snap) = pause_verify.lock() {
      if want_paused {
        snap.last_pause_command_sent_json = Some(set_json_line.clone());
      } else {
        snap.last_resume_command_sent_json = Some(set_json_line.clone());
      }
    }

    // 1) Allocate id and register waiter BEFORE any outbound IPC — eliminates race with a fast mpv reply.
    let id_get = next_id.fetch_add(1, Ordering::SeqCst);
    let msg_get = json!({"command":["get_property","pause"],"request_id": id_get});
    let (tx2, rx2) = mpsc::channel();
    {
      let mut m = pending.lock().map_err(|_| "ipc pending map poisoned".to_string())?;
      m.insert(id_get, tx2);
    }
    append_player_debug_log(
      Some(&self.app),
      &format!(
        "[verify] {label} waiter REGISTERED request_id={id_get} (before set_property + get_property writes)",
      ),
    );

    let phase = if want_paused { "pause" } else { "resume" };
    let set_trace = format!("{phase}_set_property");
    let get_trace = format!("{phase}_get_property_pause");

    if let Err(e) = enqueue_ipc_traced(ipc_tx.as_ref(), gen, &msg_set, &set_trace, &self.app) {
      let _ = pending.lock().ok().map(|mut p| p.remove(&id_get));
      let err = format!("{label}: IPC enqueue failed (set_property): {e}");
      if let Ok(mut snap) = pause_verify.lock() {
        snap.last_error = Some(err.clone());
      }
      return Err(err);
    }

    if let Err(e) = enqueue_ipc_traced(ipc_tx.as_ref(), gen, &msg_get, &get_trace, &self.app) {
      let _ = pending.lock().ok().map(|mut p| p.remove(&id_get));
      let err = format!("{label}: IPC enqueue failed (get_property): {e}");
      if let Ok(mut snap) = pause_verify.lock() {
        snap.last_error = Some(err.clone());
      }
      return Err(err);
    }

    let r2 = match rx2.recv_timeout(IPC_WAIT) {
      Ok(v) => v,
      Err(_) => {
        let _ = pending.lock().ok().map(|mut p| p.remove(&id_get));
        let err = format!("{label}: timeout waiting for get_property pause (request_id={id_get})");
        if let Ok(mut snap) = pause_verify.lock() {
          snap.last_error = Some(err.clone());
          snap.last_get_property_pause_request_id = Some(id_get);
        }
        return Err(err);
      }
    };

    let reply_line = serde_json::to_string(&r2).unwrap_or_else(|_| "{}".to_string());
    if let Ok(mut snap) = pause_verify.lock() {
      snap.last_get_property_pause_request_id = Some(id_get);
      snap.last_get_property_pause_reply_json = Some(reply_line);
    }

    if !mpv_ipc_error_is_success(&r2) {
      let err = format!("{label}: get_property pause failed: {:?}", r2.get("error"));
      if let Ok(mut snap) = pause_verify.lock() {
        snap.last_error = Some(err.clone());
      }
      return Err(err);
    }

    let Some(data) = r2.get("data") else {
      let err = format!("{label}: get_property pause reply missing data");
      if let Ok(mut snap) = pause_verify.lock() {
        snap.last_error = Some(err.clone());
      }
      return Err(err);
    };
    let Some(p) = mpv_ipc_pause_data_as_bool(data) else {
      let err = format!("{label}: could not parse pause value: {data}");
      if let Ok(mut snap) = pause_verify.lock() {
        snap.last_error = Some(err.clone());
      }
      return Err(err);
    };

    if p != want_paused {
      let err = format!("{label}: verification mismatch (expected paused={want_paused}, got {p})");
      if let Ok(mut snap) = pause_verify.lock() {
        snap.last_error = Some(err.clone());
        snap.last_confirmed_paused = Some(p);
      }
      return Err(err);
    }

    {
      let mut st = player_state.lock().map_err(|_| "player state poisoned".to_string())?;
      st.paused = p;
      st.playing = !st.paused && !st.ended && st.duration > 0.1;
      st.loading = false;
      st.ipc_healthy = true;
      let snap = st.clone();
      drop(st);
      emit_state(&self.app, &snap);
    }
    if let Ok(mut snap) = pause_verify.lock() {
      snap.last_confirmed_paused = Some(p);
      snap.last_error = None;
    }

    append_player_debug_log(
      Some(&self.app),
      &format!("{label} verified paused={p} via get_property request_id={id_get} (set_property sent, not awaited)"),
    );

    // Detached mode: no embedded window ops.
    if video_hwnd == 0 {
      return Ok(());
    }
    if embedded_minimal_mode {
      // Minimal embedded diagnostic: no embed-side refresh during pause/resume.
      return Ok(());
    }

    // Diagnostic: skip embed-side refresh during pause/resume verification.
    if embedded_safe_mode {
      append_player_debug_log(
        Some(&self.app),
        &format!(
          "[embed-op] skip refresh_native_overlay_stack ({}) session_id={} embedded_safe_mode=true parent_hwnd=0x{:x} video_hwnd=0x{:x}",
          if want_paused { "pause" } else { "resume" },
          session_id,
          parent_hwnd,
          video_hwnd
        ),
      );
      return Ok(());
    }

    let app = self.app.clone();
    let app_for_closure = app.clone();
    app
      .run_on_main_thread(move || {
        refresh_native_overlay_stack_traced(
          Some(&app_for_closure),
          session_id,
          HWND(parent_hwnd as *mut _),
          video_hwnd,
          NativeOverlayRefreshScope::ExternalMpvChildren,
        );
      })
      .map_err(|e| e.to_string())?;
    Ok(())
  }

  fn mark_ipc_unhealthy(&self) {
    let Some(state_arc) = (|| {
      let g = self.state.lock().ok()?;
      let s = g.as_ref()?;
      Some(Arc::clone(&s.state))
    })() else {
      return;
    };
    let mut st = match state_arc.lock() {
      Ok(g) => g,
      Err(_) => return,
    };
    st.ipc_healthy = false;
    let snapshot = st.clone();
    drop(st);
    emit_state(&self.app, &snapshot);
  }

  /// Kill embedded mpv and reopen the same file at `time_pos` from the mirror.
  pub fn recover_external_session(&self) -> Result<(), String> {
    {
      let g = self.state.lock().map_err(|_| "player state poisoned")?;
      let Some(s) = g.as_ref() else {
        return Err("No active session to recover".to_string());
      };
      if matches!(&s.backend, BackendSession::LibMpv(_)) {
        return Err("Recover is not implemented for libmpv embedded mode (Phase 1)".to_string());
      }
    }
    self.recover_external_session_impl(false)
  }

  pub fn recover_external_session_no_config(&self) -> Result<(), String> {
    {
      let g = self.state.lock().map_err(|_| "player state poisoned")?;
      let Some(s) = g.as_ref() else {
        return Err("No active session to recover".to_string());
      };
      if matches!(&s.backend, BackendSession::LibMpv(_)) {
        return Err("Recover is not implemented for libmpv embedded mode (Phase 1)".to_string());
      }
    }
    self.recover_external_session_impl(true)
  }

  fn recover_external_session_impl(&self, no_config: bool) -> Result<(), String> {
    let (payload, time_pos) = {
      let g = self.state.lock().map_err(|_| "player state poisoned")?;
      let Some(s) = g.as_ref() else {
        return Err("No active session to recover".to_string());
      };
      let pos = s.state.lock().ok().map(|st| st.time_pos).unwrap_or(0.0);
      (s.last_open.clone(), pos)
    };
    append_player_debug_log(
      Some(&self.app),
      &format!(
        "[recover] reopen path={} start_seconds={} no_config={}",
        payload.path,
        time_pos.max(0.0),
        no_config
      ),
    );
    self.mark_ipc_unhealthy();
    self.close_with_reason(if no_config { "recover_no_config" } else { "recover" });
    let mut reopen = payload;
    reopen.start_seconds = Some(time_pos.max(0.0));
    if no_config {
      self.open_no_config(reopen)
    } else {
      self.open(reopen)
    }
  }

}

/// Resume verification using only the IPC mirror (`read_ipc_loop` applies `pause` / `time-pos`
/// `property-change` updates). Success if any sample shows unpaused or plausible time advance.
fn resume_verify_mirror_ok(
  st: &PlayerState,
  _before_paused: bool,
  before_core_idle: bool,
  before_audio_pts_full: f64,
  before_time_pos_full: f64,
) -> bool {
  // 1) Strongest signal: pause observed false.
  if !st.paused {
    return true;
  }
  // 2) Next: core-idle observed false (active playback).
  // Some sessions might start with core-idle=false already; require a transition.
  if before_core_idle && !st.core_idle {
    return true;
  }
  // 3) Preferred clock: audio-pts/full advances.
  if st.audio_pts_full.is_finite() && st.audio_pts_full > before_audio_pts_full + 0.001 {
    return true;
  }
  // 4) Fallback only: time-pos/full advances.
  if st.time_pos_full.is_finite() && st.time_pos_full > before_time_pos_full + 0.01 {
    return true;
  }
  false
}

#[derive(Debug, Clone)]
struct IpcWriteMsg {
  bytes: Vec<u8>,
  generation: u64,
  /// Human label for diagnostics (e.g. `test_osd`).
  label: String,
  /// The exact newline-terminated JSON line that will be written (for logging / proof).
  line_for_log: String,
  /// When true, writer thread logs flush success (not only failures).
  log_success: bool,
}

fn cmd_to_mpv_ipc(cmd: &PlayerCommand) -> Value {
  match cmd {
    // Prefer `set pause yes|no` over `set_property` — matches libmpv path and is more reliable for
    // unpause on some Windows mpv builds over JSON IPC.
    PlayerCommand::Play => json!({"command":["set","pause","no"]}),
    PlayerCommand::Pause => json!({"command":["set","pause","yes"]}),
    PlayerCommand::SetPaused(v) => json!({"command":["set","pause", if *v { "yes" } else { "no" }]}),
    PlayerCommand::SeekRelative(sec) => json!({"command":["seek", *sec, "relative"]}),
    PlayerCommand::SeekAbsolute(sec) => json!({"command":["seek", *sec, "absolute"]}),
    PlayerCommand::SetMute(v) => json!({"command":["set_property","mute", *v]}),
    PlayerCommand::SetVolume(v) => json!({"command":["set_property","volume", *v]}),
    PlayerCommand::SetSubVisibility(v) => json!({"command":["set_property","sub-visibility", *v]}),
    PlayerCommand::SetSid(v) => json!({"command":["set_property","sid", *v]}),
    PlayerCommand::SetAid(v) => json!({"command":["set_property","aid", *v]}),
    PlayerCommand::AddSubDelay(delta) => json!({"command":["add","sub-delay", *delta]}),
    PlayerCommand::SetSubFontSize(v) => json!({"command":["set_property","sub-font-size", *v]}),
    PlayerCommand::SetSubColor(v) => json!({"command":["set_property","sub-color", v]}),
    PlayerCommand::SetSubBorderColor(v) => json!({"command":["set_property","sub-border-color", v]}),
    PlayerCommand::SetSubBorderSize(v) => json!({"command":["set_property","sub-border-size", *v]}),
    PlayerCommand::SetSubBackColor(v) => json!({"command":["set_property","sub-back-color", v]}),
    PlayerCommand::SetSubShadowColor(v) => json!({"command":["set_property","sub-shadow-color", v]}),
    PlayerCommand::SetSubShadowOffset(v) => json!({"command":["set_property","sub-shadow-offset", *v]}),
    PlayerCommand::SetSubPosition(v) => json!({"command":["set_property","sub-pos", *v]}),
    PlayerCommand::SetSubFont(v) => json!({"command":["set_property","sub-font", v]}),
    PlayerCommand::SubAddSelect(path) => json!({"command":["sub-add", path, "select"]}),
    PlayerCommand::Stop => json!({"command":["quit"]}),
  }
}

fn enqueue_ipc(tx: &mpsc::SyncSender<IpcWriteMsg>, generation: u64, msg: &Value) -> Result<(), String> {
  enqueue_ipc_with_diagnostics(tx, generation, msg, "ipc", false, None)
}

fn enqueue_ipc_with_diagnostics(
  tx: &mpsc::SyncSender<IpcWriteMsg>,
  generation: u64,
  msg: &Value,
  label: &str,
  log_success: bool,
  app: Option<&AppHandle>,
) -> Result<(), String> {
  let mut line = serde_json::to_string(msg).map_err(|e| e.to_string())?;
  line.push('\n');
  let bytes = line.clone().into_bytes();

  if let Some(app) = app {
    // Raw byte proof (newline-terminated JSON) at enqueue time.
    append_player_debug_log(
      Some(app),
      &format!(
        "[ipc-diag] enqueue label={label} bytes={} line={:?}",
        bytes.len(),
        line
      ),
    );
  }

  tx.try_send(IpcWriteMsg {
    bytes,
    generation,
    label: label.to_string(),
    line_for_log: line,
    log_success,
  })
  .map_err(|_| "mpv ipc queue full/disconnected".to_string())
}

fn enqueue_ipc_traced(
  tx: &mpsc::SyncSender<IpcWriteMsg>,
  generation: u64,
  msg: &Value,
  trace_label: &str,
  app: &AppHandle,
) -> Result<(), String> {
  let serialized = serde_json::to_string(msg).map_err(|e| e.to_string())?;
  let byte_len = serialized.len() + 1;
  append_player_debug_log(
    Some(app),
    &format!("[ipc-write] {trace_label} START enqueue bytes={byte_len}"),
  );
  let r = enqueue_ipc_with_diagnostics(tx, generation, msg, trace_label, false, None);
  match &r {
    Ok(()) => append_player_debug_log(
      Some(app),
      &format!("[ipc-write] {trace_label} END queued ok (writer thread will flush)"),
    ),
    Err(e) => append_player_debug_log(
      Some(app),
      &format!("[ipc-write] {trace_label} END queue FAILED: {e}"),
    ),
  }
  r
}

fn emit_state(app: &AppHandle, st: &PlayerState) {
  let _ = app.emit("player2-event", PlayerEvent::State(st.clone()));
  playback_orchestrator::notify_engine_state(app, st);
}

/// Coalesced state emitter for external mode - only emits when necessary
/// Returns true if emitted, false if skipped
fn emit_state_coalesced(
  app: &AppHandle,
  st: &PlayerState,
  last_emit: &Arc<Mutex<(std::time::Instant, PlayerState)>>,
  is_external: bool,
) -> bool {
  // For embedded mode, always emit (old behavior)
  if !is_external {
    emit_state(app, st);
    return true;
  }

  // For external mode, coalesce aggressively
  let now = std::time::Instant::now();
  let mut should_emit = false;
  let mut reason = "";

  if let Ok(mut last) = last_emit.lock() {
    let (last_time, last_state) = &*last;
    let elapsed = now.duration_since(*last_time);

    // Critical state changes - emit immediately
    if st.paused != last_state.paused {
      should_emit = true;
      reason = "pause_changed";
    } else if st.ended != last_state.ended {
      should_emit = true;
      reason = "ended_changed";
    } else if st.loading != last_state.loading {
      should_emit = true;
      reason = "loading_changed";
    } else if (st.duration - last_state.duration).abs() > 0.5 {
      should_emit = true;
      reason = "duration_changed";
    } else if elapsed.as_millis() >= 1000 {
      // Non-critical updates: throttle to once per second
      should_emit = true;
      reason = "throttle_interval";
    }

    if should_emit {
      *last = (now, st.clone());
      emit_state(app, st);
      true
    } else {
      false
    }
  } else {
    // Failed to lock, emit anyway
    emit_state(app, st);
    true
  }
}

/// mpv JSON IPC may use bool, 0/1, or "yes"/"no" for the `pause` property in `property-change` events.
fn mpv_ipc_pause_data_as_bool(data: &Value) -> Option<bool> {
  if let Some(b) = data.as_bool() {
    return Some(b);
  }
  if let Some(n) = data.as_i64() {
    return Some(n != 0);
  }
  if let Some(n) = data.as_f64() {
    return Some(n != 0.0);
  }
  if let Some(s) = data.as_str() {
    return match s.to_ascii_lowercase().as_str() {
      "yes" | "true" | "1" => Some(true),
      "no" | "false" | "0" => Some(false),
      _ => None,
    };
  }
  None
}

/// mpv may encode `request_id` as integer, float (e.g. `1000001.0`), or string — all must match map keys (`u64`).
fn mpv_ipc_request_id_any(val: &Value) -> Option<u64> {
  let id = val.get("request_id")?;
  if let Some(u) = id.as_u64() {
    return Some(u);
  }
  if let Some(i) = id.as_i64() {
    return if i >= 0 { Some(i as u64) } else { None };
  }
  if let Some(f) = id.as_f64() {
    if f.is_finite() && f >= 0.0 && f <= u64::MAX as f64 {
      let r = f.round();
      if (r - f).abs() < 1e-6 {
        return Some(r as u64);
      }
    }
  }
  if let Some(s) = id.as_str() {
    return s.trim().parse().ok();
  }
  None
}

/// mpv JSON IPC may use `"error":"success"` or a structured error object.
fn mpv_ipc_error_is_success(val: &Value) -> bool {
  match val.get("error") {
    Some(Value::String(s)) => s == "success",
    Some(Value::Object(o)) => o.get("code").and_then(|c| c.as_i64()) == Some(0),
    None => false,
    _ => false,
  }
}

fn emit_tracks(app: &AppHandle, tracks: Vec<PlayerTrack>) {
  let _ = app.emit(
    "player2-event",
    PlayerEvent::Tracks(PlayerTracks { tracks }),
  );
}

fn request_repaint_video_traced(app: Option<&AppHandle>, video_hwnd: usize, session_id: u64, reason: &str) {
  unsafe {
    let hwnd = HWND(video_hwnd as *mut _);
    let inv = InvalidateRect(Some(hwnd), None, false).as_bool();
    // libmpv render updates are driven by `WM_MPV_RENDER`; `InvalidateRect` alone may not
    // reach our `WNDPROC` (and can result in audio-only until the next render callback).
    let pm = PostMessageW(
      Some(hwnd),
      WM_MPV_RENDER,
      WPARAM(session_id as usize),
      LPARAM(0),
    )
    .is_ok();
    append_player_debug_log(
      app,
      &format!(
        "[libmpv-render] repaint request reason={reason} session_id={session_id} video_hwnd=0x{video_hwnd:x} InvalidateRect_ok={inv} PostMessageW_ok={pm}"
      ),
    );
  }
}

fn request_repaint_video(video_hwnd: usize, session_id: u64) {
  request_repaint_video_traced(None, video_hwnd, session_id, "legacy");
}

/// WebView `getBoundingClientRect` is in logical CSS pixels; Win32 `SetWindowPos` uses physical
/// pixels derived from the owning window's DPI (matches WebView2 layout).
fn logical_px_to_physical(hwnd: HWND, n: i32) -> i32 {
  unsafe {
    let dpi = GetDpiForWindow(hwnd);
    let dpi = if dpi == 0 { 96 } else { dpi };
    (f64::from(n) * f64::from(dpi) / 96.0).round() as i32
  }
}

#[derive(Clone, Copy)]
struct DebugBounds {
  x: i32,
  y: i32,
  width: i32,
  height: i32,
}

fn log_video_bounds(stage: &str, parent_hwnd: HWND, video_hwnd: HWND, logical: DebugBounds, physical: DebugBounds) {
  unsafe {
    let dpi = GetDpiForWindow(parent_hwnd);
    let mut applied = RECT::default();
    let _ = GetWindowRect(video_hwnd, &mut applied);
    eprintln!(
      "[pitflix-player] {stage}: logical=({}, {}, {}x{}), dpi={}, physical=({}, {}, {}x{}), applied_screen_rect=({}, {}, {}, {})",
      logical.x,
      logical.y,
      logical.width,
      logical.height,
      if dpi == 0 { 96 } else { dpi },
      physical.x,
      physical.y,
      physical.width,
      physical.height,
      applied.left,
      applied.top,
      applied.right,
      applied.bottom,
    );
  }
}

fn apply_hwnd_click_through_styles(hwnd: HWND) {
  unsafe {
    let ex = GetWindowLongPtrW(hwnd, GWL_EXSTYLE);
    let _ = SetWindowLongPtrW(
      hwnd,
      GWL_EXSTYLE,
      ex | (WS_EX_TRANSPARENT.0 as isize) | (WS_EX_NOACTIVATE.0 as isize),
    );
    let style = GetWindowLongPtrW(hwnd, GWL_STYLE);
    let _ = SetWindowLongPtrW(hwnd, GWL_STYLE, style | (WS_DISABLED.0 as isize));
  }
}

/// mpv / libmpv may create **nested** child HWNDs (often after the first pause). A single
/// `EnumChildWindows` level is not enough — recurse so every descendant stays click-through.
unsafe extern "system" fn enum_click_through_child(child: HWND, _: LPARAM) -> BOOL {
  set_hwnd_click_through_recursive(child);
  BOOL(1)
}

fn set_hwnd_click_through_recursive(hwnd: HWND) {
  apply_hwnd_click_through_styles(hwnd);
  unsafe {
    let _ = EnumChildWindows(Some(hwnd), Some(enum_click_through_child), LPARAM(0));
  }
}

fn window_class_name(hwnd: HWND) -> String {
  let mut buf = [0u16; 256];
  let n = unsafe { GetClassNameW(hwnd, &mut buf) };
  if n == 0 {
    return String::new();
  }
  String::from_utf16_lossy(&buf[..n as usize])
}

/// wry registers the WebView2 container as class `WRY_WEBVIEW` (see wry `webview2/mod.rs`).
fn is_wry_webview_container(hwnd: HWND) -> bool {
  window_class_name(hwnd) == "WRY_WEBVIEW"
}

fn is_pitflix_video_embed(hwnd: HWND) -> bool {
  window_class_name(hwnd) == "PitflixVideoEmbed"
}

/// Find a `WRY_WEBVIEW` HWND anywhere under `root` (wry may not be a **direct** child of the root).
fn find_wry_webview_hwnd_recursive(root: HWND) -> Option<HWND> {
  if is_wry_webview_container(root) {
    return Some(root);
  }
  unsafe {
    let mut c = GetWindow(root, GW_CHILD).unwrap_or_default();
    while !c.0.is_null() {
      if let Some(hit) = find_wry_webview_hwnd_recursive(c) {
        return Some(hit);
      }
      c = GetWindow(c, GW_HWNDNEXT).unwrap_or_default();
    }
  }
  None
}

/// Reparent the Pitflix video surface under the WebView2 container and keep it at the **bottom** of
/// that container’s Z-order so the browser’s own HWND stays above native OpenGL (required for video
/// to show through transparent WebView pixels).
fn reparent_pitflix_video_into_wry_tree(app: Option<&AppHandle>, root: HWND, video: HWND) {
  unsafe {
    if !IsWindow(Some(root)).as_bool() || !IsWindow(Some(video)).as_bool() {
      return;
    }
    let Some(wry) = find_wry_webview_hwnd_recursive(root) else {
      append_player_debug_log(
        app,
        "[libmpv-render] reparent: WRY_WEBVIEW not found under root; leaving video as child of main HWND",
      );
      return;
    };
    if let Err(e) = SetParent(video, Some(wry)) {
      append_player_debug_log(
        app,
        &format!("[libmpv-render] reparent: SetParent -> WRY failed err={e}"),
      );
      return;
    }
    let zr = SetWindowPos(
      video,
      Some(HWND_BOTTOM),
      0,
      0,
      0,
      0,
      windows::Win32::UI::WindowsAndMessaging::SWP_NOMOVE
        | windows::Win32::UI::WindowsAndMessaging::SWP_NOSIZE
        | SWP_NOACTIVATE,
    );
    append_player_debug_log(
      app,
      &format!(
        "[libmpv-render] reparent ok video=0x{:x} now child of WRY=0x{:x} z_bottom_ok={}",
        video.0 as usize,
        wry.0 as usize,
        zr.is_ok()
      ),
    );
  }
}

fn z_order_libmpv_video_bottom(video: HWND) {
  unsafe {
    if !IsWindow(Some(video)).as_bool() {
      return;
    }
    let _ = SetWindowPos(
      video,
      Some(HWND_BOTTOM),
      0,
      0,
      0,
      0,
      windows::Win32::UI::WindowsAndMessaging::SWP_NOMOVE
        | windows::Win32::UI::WindowsAndMessaging::SWP_NOSIZE
        | SWP_NOACTIVATE,
    );
  }
}

/// How aggressively we re-apply click-through when refreshing the native stack.
///
/// - **External `mpv.exe` + `--wid`**: mpv may create extra Win32 HWNDs under the main window; we must
///   walk native siblings (except the wry WebView container) and keep them click-through.
/// - **In-process libmpv + GL**: only our `PitflixVideoEmbed` child should be touched; applying
///   `WS_EX_TRANSPARENT` recursively to unrelated main-window children can break WebView2 hit-testing
///   after repeated refreshes (intermittent “dead UI”).
#[derive(Clone, Copy)]
enum NativeOverlayRefreshScope {
  ExternalMpvChildren,
  LibMpvVideoEmbedOnly,
}

/// Apply click-through only to **direct** main-window children that are not the WebView container.
/// Using `EnumChildWindows(main_hwnd, ...)` here would also hit WebView2 descendants and make the
/// entire app non-clickable, so we walk siblings manually.
fn set_click_through_all_native_overlays(main_hwnd: HWND) {
  unsafe {
    let mut child = GetWindow(main_hwnd, GW_CHILD).unwrap_or_default();
    while !child.0.is_null() {
      if !is_wry_webview_container(child) {
        set_hwnd_click_through_recursive(child);
      }
      child = GetWindow(child, GW_HWNDNEXT).unwrap_or_default();
    }
  }
}

fn refresh_native_overlay_stack(main_hwnd: HWND, video_hwnd: usize, scope: NativeOverlayRefreshScope) {
  match scope {
    NativeOverlayRefreshScope::ExternalMpvChildren => set_click_through_all_native_overlays(main_hwnd),
    NativeOverlayRefreshScope::LibMpvVideoEmbedOnly => {
      let v = HWND(video_hwnd as *mut _);
      unsafe {
        if !IsWindow(Some(v)).as_bool() {
          return;
        }
      }
      if !is_pitflix_video_embed(v) {
        append_player_debug_log(
          None,
          &format!(
            "[libmpv-render] refresh scope=video_embed_only but hwnd class={:?} (expected PitflixVideoEmbed); skipping",
            window_class_name(v)
          ),
        );
      }
      // For libmpv, do NOT apply WS_EX_TRANSPARENT or WS_DISABLED styles.
      // Click-through is handled by WM_NCHITTEST -> HTTRANSPARENT in video_wnd_proc.
      // Applying WS_EX_TRANSPARENT breaks OpenGL rendering (causes black screen).
    }
  }
  unsafe {
    let v = HWND(video_hwnd as *mut _);
    if !IsWindow(Some(v)).as_bool() {
      return;
    }
    match scope {
      NativeOverlayRefreshScope::ExternalMpvChildren => {
        // External `mpv --wid`: keep the video subtree above the WebView; click-through styles
        // route input to the WebView.
        let _ = SetWindowPos(
          v,
          Some(HWND_TOP),
          0,
          0,
          0,
          0,
          windows::Win32::UI::WindowsAndMessaging::SWP_NOMOVE
            | windows::Win32::UI::WindowsAndMessaging::SWP_NOSIZE
            | SWP_NOACTIVATE,
        );
      }
      NativeOverlayRefreshScope::LibMpvVideoEmbedOnly => {
        if is_pitflix_video_embed(v) {
          z_order_libmpv_video_bottom(v);
        }
      }
    }
  }
}

fn embed_op_log(
  app: Option<&AppHandle>,
  op: &str,
  phase: &str,
  session_id: u64,
  parent_hwnd: usize,
  video_hwnd: usize,
) {
  unsafe {
    let p_ok = IsWindow(Some(HWND(parent_hwnd as *mut _))).as_bool();
    let v_ok = if video_hwnd == 0 {
      true
    } else {
      IsWindow(Some(HWND(video_hwnd as *mut _))).as_bool()
    };
    append_player_debug_log(
      app,
      &format!(
        "[embed-op] {phase} {op} session_id={session_id} parent_hwnd=0x{parent_hwnd:x} video_hwnd=0x{video_hwnd:x} parent_ok={p_ok} video_ok={v_ok}",
      ),
    );
  }
}

fn refresh_native_overlay_stack_traced(
  app: Option<&AppHandle>,
  session_id: u64,
  main_hwnd: HWND,
  video_hwnd: usize,
  scope: NativeOverlayRefreshScope,
) {
  let parent_hwnd = main_hwnd.0 as usize;
  let scope_tag = match scope {
    NativeOverlayRefreshScope::ExternalMpvChildren => "external_mpv_children",
    NativeOverlayRefreshScope::LibMpvVideoEmbedOnly => "libmpv_video_embed_only",
  };
  append_player_debug_log(
    app,
    &format!(
      "[embed-op] refresh_native_overlay_stack scope={scope_tag} session_id={session_id} parent_hwnd=0x{parent_hwnd:x} video_hwnd=0x{video_hwnd:x}"
    ),
  );
  embed_op_log(app, "refresh_native_overlay_stack", "before", session_id, parent_hwnd, video_hwnd);
  refresh_native_overlay_stack(main_hwnd, video_hwnd, scope);
  embed_op_log(app, "refresh_native_overlay_stack", "after", session_id, parent_hwnd, video_hwnd);
}

fn read_ipc_loop(
  app: AppHandle,
  session_id: u64,
  pipe_path: String,
  mpv_pid: u32,
  ipc_dead: Arc<AtomicBool>,
  state: Arc<Mutex<PlayerState>>,
  video_hwnd: usize,
  embedded_minimal_mode: bool,
  reader_file: std::fs::File,
  ipc_pending: Arc<Mutex<HashMap<u64, mpsc::Sender<Value>>>>,
  pause_verify: Arc<Mutex<PauseIpcVerifySnapshot>>,
) {
  // State emission coalescing for external mode
  let is_external = video_hwnd == 0; // External mode has no video_hwnd
  let last_emit = Arc::new(Mutex::new((
    std::time::Instant::now(),
    PlayerState::default(),
  )));
  
  if is_external {
    eprintln!("[ipc-loop] session_id={} is_external=true video_hwnd=0 (coalescing enabled)", session_id);
  } else {
    eprintln!("[ipc-loop] session_id={} is_external=false video_hwnd={} (no coalescing)", session_id, video_hwnd);
  }
  
  let mut reader = BufReader::new(reader_file);
  let mut line = String::new();
  loop {
    line.clear();
    match reader.read_line(&mut line) {
      Ok(0) => {
        ipc_dead.store(true, Ordering::SeqCst);
        let alive = mpv_pid_alive(mpv_pid);
        append_player_debug_log(
          Some(&app),
          &format!(
            "[ipc-read] EOF session_id={session_id} mpv_pid={mpv_pid} mpv_alive={alive:?} pipe={pipe_path}"
          ),
        );
        let _ = app.emit(
          "player-ipc-error",
          json!({
            "message": "mpv IPC disconnected (EOF)",
            "pipe": pipe_path,
            "mpv_pid": mpv_pid,
            "session_id": session_id,
            "embedded_minimal_mode": embedded_minimal_mode
          }),
        );
        break;
      }
      Ok(_) => {
        let trimmed = line.trim();
        if trimmed.is_empty() {
          continue;
        }
        if let Ok(val) = serde_json::from_str::<Value>(trimmed) {
          // Inbound debug (truncated) — updated before any heavy work.
          let inbound_short = if trimmed.len() > 2048 {
            format!("{}…", &trimmed[..2048])
          } else {
            trimmed.to_string()
          };
          if let Ok(mut snap) = pause_verify.lock() {
            snap.last_inbound_ipc_line_json = Some(inbound_short);
          }

          // Correlate FIRST so a fast `get_property` reply cannot be "stuck" behind `player-ipc` emit
          // or property-change work on this thread.
          let rid_opt = mpv_ipc_request_id_any(&val);
          if is_external {
            if let Some(rid) = rid_opt {
              if (MPV_EXTERNAL_TIME_POLL_REQ_BASE..MPV_EXTERNAL_TIME_POLL_REQ_BASE + 100_000).contains(&rid) {
                if val.get("error").and_then(|v| v.as_str()) == Some("success") {
                  if let Some(t) = val.get("data").and_then(|v| v.as_f64()) {
                    if let Ok(mut st) = state.lock() {
                      st.time_pos = t;
                      emit_state_coalesced(&app, &st, &last_emit, is_external);
                    }
                  }
                }
                continue;
              }
            }
          }
          if let Ok(mut snap) = pause_verify.lock() {
            snap.last_inbound_request_id_seen = rid_opt;
          }

          let dispatch_note = if let Some(rid) = rid_opt {
            match ipc_pending.lock() {
              Ok(mut map) => {
                let map_len = map.len();
                if let Some(tx) = map.remove(&rid) {
                  match tx.send(val.clone()) {
                    Ok(()) => {
                      format!("matched waiter request_id={rid} send ok (map_len_before={map_len})")
                    }
                    Err(e) => {
                      format!("matched waiter request_id={rid} send FAILED: {e}")
                    }
                  }
                } else {
                  format!("no waiter for request_id={rid} map_len_before={map_len}")
                }
              }
              Err(_) => "ipc_pending mutex poisoned".to_string(),
            }
          } else if val.get("request_id").is_some() {
            "request_id field present but not parseable as u64".to_string()
          } else {
            "no request_id on line".to_string()
          };

          if let Ok(mut snap) = pause_verify.lock() {
            snap.last_waiter_dispatch_result = Some(dispatch_note.clone());
          }

          // Never broadcast raw mpv IPC to the UI by default: nothing subscribes to `player-ipc`, but each emit
          // still serializes JSON across the Tauri boundary and was a major source of system-wide lag when
          // `time-pos` streams at high frequency. Opt-in for debugging only.
          if std::env::var("PITFLIX_PLAYER_IPC_DEBUG").is_ok() {
            let _ = app.emit("player-ipc", val.clone());
          }

          if val.get("event").and_then(|v| v.as_str()) == Some("property-change") {
            let name = val.get("name").and_then(|v| v.as_str()).unwrap_or_default();
            let data = val.get("data").cloned().unwrap_or(Value::Null);
            if let Ok(mut st) = state.lock() {
              match name {
                "time-pos" => st.time_pos = data.as_f64().unwrap_or(st.time_pos),
                "time-pos/full" => st.time_pos_full = data.as_f64().unwrap_or(st.time_pos_full),
                "duration" => st.duration = data.as_f64().unwrap_or(st.duration),
                "pause" => {
                  if let Some(p) = mpv_ipc_pause_data_as_bool(&data) {
                    append_player_debug_log(
                      Some(&app),
                      &format!("[ipc-loop] property-change pause → paused={p}"),
                    );
                    st.paused = p;
                  } else {
                    append_player_debug_log(
                      Some(&app),
                      &format!("[ipc-loop] property-change pause could not parse data={:?}", data),
                    );
                  }
                  st.playing = !st.paused;
                  st.loading = false;
                }
                "core-idle" => {
                  st.core_idle = data.as_bool().unwrap_or(st.core_idle);
                }
                "audio-pts/full" => {
                  st.audio_pts_full = data.as_f64().unwrap_or(st.audio_pts_full);
                }
                "mute" => st.mute = data.as_bool().unwrap_or(st.mute),
                "volume" => st.volume = data.as_f64().unwrap_or(st.volume),
                "sub-visibility" => st.sub_visible = data.as_bool().unwrap_or(st.sub_visible),
                "sid" => {
                  st.sid = data.as_i64().or_else(|| data.as_f64().map(|v| v as i64)).unwrap_or(st.sid)
                }
                "aid" => {
                  st.aid = data.as_i64().or_else(|| data.as_f64().map(|v| v as i64)).unwrap_or(st.aid)
                }
                "sub-delay" => {
                  st.sub_delay = data.as_f64().unwrap_or(st.sub_delay);
                }
                "track-list" => {
                  if let Some(arr) = data.as_array() {
                    let tracks = arr
                      .iter()
                      .map(|t| PlayerTrack {
                        id: t.get("id").and_then(|v| v.as_i64()).or_else(|| t.get("id").and_then(|v| v.as_f64()).map(|v| v as i64)),
                        track_type: t.get("type").and_then(|v| v.as_str()).map(|s| s.to_string()),
                        lang: t.get("lang").and_then(|v| v.as_str()).map(|s| s.to_string()),
                        title: t.get("title").and_then(|v| v.as_str()).map(|s| s.to_string()),
                        selected: t.get("selected").and_then(|v| v.as_bool()),
                      })
                      .collect::<Vec<_>>();
                    emit_tracks(&app, tracks);
                  }
                }
                "path" => {
                  if let Some(path) = data.as_str() {
                    let normalized = path.trim();
                    if !normalized.is_empty() {
                      append_player_debug_log(
                        Some(&app),
                        &format!("[media-path] session_id={session_id} path={normalized}"),
                      );
                      let _ = app.emit(
                        "player2-media-path-changed",
                        json!({
                          "session_id": session_id,
                          "path": normalized
                        }),
                      );
                    }
                  }
                }
                "user-data/pitflix-shortcut" => {
                  if let Some(raw) = data.as_str() {
                    let code = raw.split(':').next().unwrap_or("").trim();
                    if !code.is_empty() {
                      append_player_debug_log(
                        Some(&app),
                        &format!("[shortcut-bridge] source=ipc-property session_id={session_id} code={code}"),
                      );
                      let _ = app.emit("player2-shortcut", code);
                    }
                  }
                }
                _ => {}
              }
              emit_state_coalesced(&app, &st, &last_emit, is_external);
            }
            request_repaint_video(video_hwnd, session_id);
          }
          if let Some(ev) = val.get("event").and_then(|v| v.as_str()) {
            if ev == "end-file" || ev == "idle" {
              if let Ok(mut st) = state.lock() {
                st.ended = true;
                st.playing = false;
                st.loading = false;
                emit_state(&app, &st);
              }
              request_repaint_video(video_hwnd, session_id);
            }
          }
        }
      }
      Err(e) => {
        ipc_dead.store(true, Ordering::SeqCst);
        let alive = mpv_pid_alive(mpv_pid);
        append_player_debug_log(
          Some(&app),
          &format!(
            "[ipc-read] ERROR session_id={session_id} mpv_pid={mpv_pid} mpv_alive={alive:?} pipe={pipe_path} err={e}"
          ),
        );
        let _ = app.emit(
          "player-ipc-error",
          json!({
            "message": format!("mpv IPC read failed: {e}"),
            "pipe": pipe_path,
            "mpv_pid": mpv_pid,
            "session_id": session_id,
            "embedded_minimal_mode": embedded_minimal_mode
          }),
        );
        break;
      }
    }
  }
}

fn spawn_mpv_embedded(
  handle: AppHandle,
  session_id: u64,
  state_for_diag: Arc<Mutex<PlayerState>>,
  last_action_for_diag: Arc<Mutex<String>>,
  close_reason_for_diag: Arc<Mutex<Option<String>>>,
  last_exit_report: Arc<Mutex<Option<MpvExitReport>>>,
  exe: &PathBuf,
  hwnd: usize,
  payload: &PlayerOpen,
  no_config: bool,
  embedded_minimal_mode_for_events: bool,
) -> Result<(MpvSession, std::fs::File), String> {
  let pipe_name = format!("pitflix-mpv-{}", uuid::Uuid::new_v4());
  let client_path = format!(r"\\.\pipe\{}", pipe_name);
  // Detached-only diagnostic: launch mpv without JSON IPC to isolate app-side pipe overhead.
  let detach_no_ipc = hwnd == 0 && std::env::var("PITFLIX_NO_IPC").is_ok();
  let external = hwnd == 0;

  let mut cmd = Command::new(exe);
  if let Some(dir) = exe.parent() {
    cmd.current_dir(dir);
  }
  let exe_str = exe.to_string_lossy().to_string();
  let mut args_for_log: Vec<String> = Vec::new();

  // Keep `args_for_log` exactly in the order we pass to mpv.
  let mut add_arg = |cmd: &mut Command, args: &mut Vec<String>, s: String| {
    args.push(s.clone());
    cmd.arg(&s);
  };

  add_arg(&mut cmd, &mut args_for_log, "--no-terminal".to_string());
  
  // Use custom mpv config directory for premium UI (uosc)
  // Only skip config if explicitly requested via no_config flag
  if !no_config {
    let mut config_dir_opt = None;
    // In dev/debug, prefer source-tree config so live edits are always used.
    #[cfg(debug_assertions)]
    {
      let source_config_dir = std::path::Path::new(env!("CARGO_MANIFEST_DIR")).join("mpv-config");
      if source_config_dir.exists() {
        config_dir_opt = Some(source_config_dir);
      }
    }
    if config_dir_opt.is_none() {
      if let Some(exe_dir) = exe.parent() {
        let exe_config_dir = exe_dir.join("mpv-config");
        if exe_config_dir.exists() {
          config_dir_opt = Some(exe_config_dir);
        }
      }
    }
    if let Some(config_dir) = config_dir_opt {
      let config_path = config_dir.to_string_lossy().to_string();
      // Check for low-cost diagnostic profile via environment variable
      let use_lowcost = std::env::var("PITFLIX_MPV_LOWCOST").is_ok();
      if use_lowcost {
        eprintln!("[mpv-profile] low_cost");
        eprintln!("[Pitflix] Using LOW COST mpv profile for performance testing");
        add_arg(&mut cmd, &mut args_for_log, format!("--config-dir={}", config_path));
        add_arg(&mut cmd, &mut args_for_log, "--config=no".to_string());
        add_arg(&mut cmd, &mut args_for_log, format!("--include={}/mpv-lowcost.conf", config_path));
      } else {
        eprintln!("[mpv-profile] normal");
        eprintln!("[Pitflix] Using mpv config directory: {}", config_path);
        add_arg(&mut cmd, &mut args_for_log, format!("--config-dir={}", config_path));
      }
    } else {
      eprintln!("[Pitflix] WARNING: mpv-config directory not found near source tree or executable");
    }
  } else {
    add_arg(&mut cmd, &mut args_for_log, "--no-config".to_string());
  }
  
  add_arg(&mut cmd, &mut args_for_log, "--keep-open=no".to_string());
  add_arg(&mut cmd, &mut args_for_log, "--hwdec=auto-safe".to_string());
  // Detached mode (hwnd == 0): enable native mpv keybindings for full controls.
  // Embedded mode (hwnd != 0): disable mpv input so the app WebView handles it.
  if hwnd != 0 {
    add_arg(&mut cmd, &mut args_for_log, "--no-input-default-bindings".to_string());
    add_arg(&mut cmd, &mut args_for_log, "--input-vo-keyboard=no".to_string());
  }
  add_arg(&mut cmd, &mut args_for_log, "--keepaspect=yes".to_string());
  // mpv 0.38+: --background no longer accepts a hex color; use mode + --background-color.
  add_arg(&mut cmd, &mut args_for_log, "--background=color".to_string());
  add_arg(&mut cmd, &mut args_for_log, "--background-color=#000000".to_string());
  add_arg(&mut cmd, &mut args_for_log, "--volume-max=200".to_string());
  if detach_no_ipc {
    eprintln!("[mpv-diagnostic] IPC DISABLED - launching without --input-ipc-server (PITFLIX_NO_IPC=1, detached only)");
  } else {
    add_arg(&mut cmd, &mut args_for_log, format!("--input-ipc-server={}", pipe_name));
  }
  
  if hwnd != 0 {
    add_arg(&mut cmd, &mut args_for_log, format!("--wid={}", hwnd as isize));
  }
  cmd.stdin(Stdio::null()).stdout(Stdio::piped()).stderr(Stdio::piped());

  if let Some(s) = payload.start_seconds {
    if s > 0.5 {
      add_arg(&mut cmd, &mut args_for_log, format!("--start={}", s));
    }
  }
  // CRITICAL: Set mpv process priority to prevent system lag
  add_arg(&mut cmd, &mut args_for_log, "--priority=belownormal".to_string());
  
  args_for_log.push(payload.path.clone());
  cmd.arg(&payload.path);

  let mut child = cmd.spawn().map_err(|e| format!("Failed to start mpv: {e}"))?;
  let mpv_pid = child.id();
  
  // CRITICAL: Lower mpv process priority to prevent system-wide lag
  // This prevents mpv from starving other processes
  unsafe {
    use windows::Win32::System::Threading::{OpenProcess, SetPriorityClass, PROCESS_SET_INFORMATION, BELOW_NORMAL_PRIORITY_CLASS};
    let process_handle = OpenProcess(PROCESS_SET_INFORMATION, false, mpv_pid);
    if let Ok(handle) = process_handle {
      let _ = SetPriorityClass(handle, BELOW_NORMAL_PRIORITY_CLASS);
      eprintln!("[mpv-priority] Set mpv pid={} to BELOW_NORMAL priority to prevent system lag", mpv_pid);
    }
  }

  let launch_log = format!(
    "[mpv-launch{}] session_id={session_id} pid={mpv_pid} exe={exe_str} no_config={no_config} no_wid={} pipe={client_path} media={}\n  args={:?}",
    if hwnd == 0 { "-detached" } else { "" },
    hwnd == 0,
    payload.path,
    args_for_log
  );
  eprintln!("{}", launch_log);
  append_player_debug_log(Some(&handle), &launch_log);

  // Clone non-'static diagnostics for background threads.
  let media_path_for_diag = payload.path.clone();
  let exe_for_diag = exe_str.clone();
  let args_for_diag = args_for_log.clone();

  let stderr_tail: Arc<Mutex<VecDeque<String>>> = Arc::new(Mutex::new(VecDeque::with_capacity(200)));
  let stdout_tail: Arc<Mutex<VecDeque<String>>> = Arc::new(Mutex::new(VecDeque::with_capacity(200)));
  let app_shortcut = handle.clone();
  if let Some(stderr) = child.stderr.take() {
    let tail = Arc::clone(&stderr_tail);
    let app_shortcut = app_shortcut.clone();
    thread::spawn(move || {
      let mut r = BufReader::new(stderr);
      let mut line = String::new();
      while r.read_line(&mut line).ok().filter(|n| *n > 0).is_some() {
        let s = line.trim_end().to_string();
        if s.contains("[PITFLIX_SHORTCUT_STAGE]") {
          if let Some((_, rest)) = s.split_once("[PITFLIX_SHORTCUT_STAGE]") {
            let stage = rest.trim();
            if !stage.is_empty() {
              append_player_debug_log(Some(&app_shortcut), &format!("[shortcut-stage] source=stderr session_id={session_id} stage={stage}"));
              eprintln!("[shortcut-stage] source=stderr session_id={session_id} stage={stage}");
            }
          }
        }
        if s.contains("[PITFLIX_SHORTCUT]") {
          if let Some((_, rest)) = s.split_once("[PITFLIX_SHORTCUT]") {
            let code = rest.trim();
            if !code.is_empty() {
              append_player_debug_log(Some(&app_shortcut), &format!("[shortcut-bridge] source=stderr session_id={session_id} code={code}"));
              eprintln!("[shortcut-bridge] source=stderr session_id={session_id} code={code}");
              let _ = app_shortcut.emit("player2-shortcut", code);
            }
          }
        }
        if let Ok(mut q) = tail.lock() {
          if q.len() >= 200 {
            q.pop_front();
          }
          q.push_back(s);
        }
        line.clear();
      }
    });
  }
  if let Some(stdout) = child.stdout.take() {
    let tail = Arc::clone(&stdout_tail);
    let app_shortcut = app_shortcut.clone();
    thread::spawn(move || {
      let mut r = BufReader::new(stdout);
      let mut line = String::new();
      while r.read_line(&mut line).ok().filter(|n| *n > 0).is_some() {
        let s = line.trim_end().to_string();
        if s.contains("[PITFLIX_SHORTCUT_STAGE]") {
          if let Some((_, rest)) = s.split_once("[PITFLIX_SHORTCUT_STAGE]") {
            let stage = rest.trim();
            if !stage.is_empty() {
              append_player_debug_log(Some(&app_shortcut), &format!("[shortcut-stage] source=stdout session_id={session_id} stage={stage}"));
              eprintln!("[shortcut-stage] source=stdout session_id={session_id} stage={stage}");
            }
          }
        }
        if s.contains("[PITFLIX_SHORTCUT]") {
          if let Some((_, rest)) = s.split_once("[PITFLIX_SHORTCUT]") {
            let code = rest.trim();
            if !code.is_empty() {
              append_player_debug_log(Some(&app_shortcut), &format!("[shortcut-bridge] source=stdout session_id={session_id} code={code}"));
              eprintln!("[shortcut-bridge] source=stdout session_id={session_id} code={code}");
              let _ = app_shortcut.emit("player2-shortcut", code);
            }
          }
        }
        if let Ok(mut q) = tail.lock() {
          if q.len() >= 200 {
            q.pop_front();
          }
          q.push_back(s);
        }
        line.clear();
      }
    });
  }

  let file = connect_ipc(&client_path, &mut child).map_err(|e| format!("mpv IPC connect failed: {e}"))?;
  let write_file = file
    .try_clone()
    .map_err(|e| format!("mpv ipc clone: {e}"))?;

  static NEXT_WRITER_TOKEN: AtomicU64 = AtomicU64::new(1);
  let ipc_dead = Arc::new(AtomicBool::new(false));
  let ipc_unrecoverable = Arc::new(AtomicBool::new(false));
  let ipc_reconnecting = Arc::new(AtomicBool::new(false));
  let ipc_generation = Arc::new(AtomicU64::new(1));
  let writer_token = NEXT_WRITER_TOKEN.fetch_add(1, Ordering::SeqCst);
  let (tx, rx) = mpsc::sync_channel::<IpcWriteMsg>(128);
  let tx = Arc::new(tx);
  // Detached window: do not stream `time-pos` over observe_property (fires very often and floods the pipe + host).
  // Poll `get_property` ~1.5s instead; see read_ipc_loop early handler for MPV_EXTERNAL_TIME_POLL_REQ_BASE.
  if external && !detach_no_ipc {
    let tx_poll = Arc::clone(&tx);
    let ipc_dead_poll = Arc::clone(&ipc_dead);
    let ipc_gen_poll = Arc::clone(&ipc_generation);
    let mpv_pid_poll = mpv_pid;
    thread::spawn(move || {
      loop {
        thread::sleep(Duration::from_millis(1500));
        if ipc_dead_poll.load(Ordering::SeqCst) {
          break;
        }
        if matches!(mpv_pid_alive(mpv_pid_poll), Some(false)) {
          break;
        }
        let seq = EXTERNAL_TIME_POS_POLL_SEQ.fetch_add(1, Ordering::SeqCst);
        let rid = MPV_EXTERNAL_TIME_POLL_REQ_BASE + (seq % 90_000);
        let gen = ipc_gen_poll.load(Ordering::SeqCst);
        let msg = json!({"command":["get_property","time-pos"],"request_id": rid});
        let _ = enqueue_ipc(tx_poll.as_ref(), gen, &msg);
      }
    });
    eprintln!(
      "[ipc-external] time-pos=poll(~1.5s) high-rate observes disabled (embed still streams time-pos)"
    );
  }
  let app_for_writer = handle.clone();
  let embedded_minimal_for_writer = embedded_minimal_mode_for_events;
  let ipc_path_for_writer = client_path.clone();
  let ipc_dead_for_writer = Arc::clone(&ipc_dead);
  let ipc_unrecoverable_for_writer = Arc::clone(&ipc_unrecoverable);
  let ipc_reconnecting_for_writer = Arc::clone(&ipc_reconnecting);
  let ipc_generation_for_writer = Arc::clone(&ipc_generation);
  let mpv_pid_for_writer = mpv_pid;
  let stderr_tail_for_writer = Arc::clone(&stderr_tail);
  let stdout_tail_for_writer = Arc::clone(&stdout_tail);
  thread::spawn(move || {
    let mut w = BufWriter::new(write_file);
    let mut last_emit = Instant::now() - Duration::from_secs(10);
    while let Ok(msg) = rx.recv() {
      let n = msg.bytes.len();
      let label = msg.label;
      let line_for_log = msg.line_for_log;
      let log_success = msg.log_success;
      let msg_gen = msg.generation;
      let active_gen = ipc_generation_for_writer.load(Ordering::SeqCst);
      if msg_gen != active_gen {
        append_player_debug_log(
          None,
          &format!(
            "[ipc-writer] DROP stale session_id={session_id} mpv_pid={mpv_pid_for_writer} pipe={} writer_token={writer_token} msg_gen={msg_gen} active_gen={active_gen} label={label} line={:?}",
            ipc_path_for_writer,
            line_for_log
          ),
        );
        continue;
      }
      if ipc_unrecoverable_for_writer.load(Ordering::SeqCst) {
        append_player_debug_log(
          None,
          &format!(
            "[ipc-writer] DROP transport DEAD session_id={session_id} mpv_pid={mpv_pid_for_writer} pipe={} gen={active_gen} writer_token={writer_token} label={label} line={:?}",
            ipc_path_for_writer,
            line_for_log
          ),
        );
        continue;
      }
      let mut attempt = 0;
      loop {
        attempt += 1;
        match w.write_all(&msg.bytes).and_then(|_| w.flush()) {
          Ok(()) => {
            if log_success {
              append_player_debug_log(
                None,
                &format!(
                  "[ipc-writer] flush OK session_id={session_id} mpv_pid={mpv_pid_for_writer} pipe={} gen={active_gen} writer_token={writer_token} label={label} bytes={n} line={:?}",
                  ipc_path_for_writer,
                  line_for_log
                ),
              );
            }
            break;
          }
          Err(e) => {
            let alive = mpv_pid_alive(mpv_pid_for_writer);
            let exit_code = mpv_pid_exit_code(mpv_pid_for_writer);
            append_player_debug_log(
              None,
              &format!(
                "[ipc-writer] flush FAILED session_id={session_id} mpv_pid={mpv_pid_for_writer} mpv_alive={alive:?} exit_code={exit_code:?} pipe={} gen={active_gen} writer_token={writer_token} label={label} bytes={n} attempt={attempt} err={e} line={:?}",
                ipc_path_for_writer,
                line_for_log
              ),
            );

            // Atomic reconnect lifecycle:
            // - mark transport disconnected + stop accepting new commands
            // - reconnect ONCE (same pipe path)
            // - if reconnect succeeds: bump generation, resume acceptance
            // - if reconnect fails: stay dead until explicit reopen
            if last_emit.elapsed() > Duration::from_secs(2) {
              last_emit = Instant::now();
              let action = last_action_for_diag
                .lock()
                .ok()
                .map(|s| s.clone())
                .unwrap_or_else(|| "?".to_string());
              let tpos = state_for_diag.lock().ok().map(|s| s.time_pos).unwrap_or(0.0);
              let _ = app_for_writer.emit(
                "player-ipc-error",
                json!({
                  "message": format!("mpv IPC write failed: {e}"),
                  "pipe": ipc_path_for_writer,
                  "label": label,
                  "session_id": session_id,
                  "mpv_pid": mpv_pid_for_writer,
                  "writer_token": writer_token,
                  "generation": active_gen,
                  "mpv_alive": alive,
                  "exit_code": exit_code,
                  "last_action": action,
                  "time_pos": tpos,
                  "embedded_minimal_mode": embedded_minimal_for_writer
                }),
              );
            }
            ipc_dead_for_writer.store(true, Ordering::SeqCst);
            // If mpv is already confirmed dead, do not attempt reconnect; mark unrecoverable.
            if matches!(alive, Some(false)) {
              ipc_unrecoverable_for_writer.store(true, Ordering::SeqCst);
              let action = last_action_for_diag
                .lock()
                .ok()
                .map(|s| s.clone())
                .unwrap_or_else(|| "?".to_string());
              let tpos = state_for_diag.lock().ok().map(|s| s.time_pos).unwrap_or(0.0);
              let close_reason = close_reason_for_diag.lock().ok().and_then(|v| v.clone());
              append_player_debug_log(
                None,
                &format!(
                  "[mpv-exit] session_id={session_id} pid={mpv_pid_for_writer} exit_code={exit_code:?} last_action={action} time_pos={tpos} pipe={} writer_token={writer_token}",
                  ipc_path_for_writer
                ),
              );
              // Log stderr/stdout tails for the crash.
              let stderr_lines = stderr_tail_for_writer.lock().ok().map(|q| q.iter().cloned().collect::<Vec<_>>()).unwrap_or_default();
              let stdout_lines = stdout_tail_for_writer.lock().ok().map(|q| q.iter().cloned().collect::<Vec<_>>()).unwrap_or_default();
              let tail_take = 100usize;
              if !stderr_lines.is_empty() {
                append_player_debug_log(None, "[mpv-stderr-tail] begin");
                for l in stderr_lines.iter().rev().take(tail_take).rev() {
                  append_player_debug_log(None, &format!("[mpv-stderr-tail] {l}"));
                }
                append_player_debug_log(None, "[mpv-stderr-tail] end");
              } else if !stdout_lines.is_empty() {
                append_player_debug_log(None, "[mpv-stdout-tail] begin");
                for l in stdout_lines.iter().rev().take(tail_take).rev() {
                  append_player_debug_log(None, &format!("[mpv-stdout-tail] {l}"));
                }
                append_player_debug_log(None, "[mpv-stdout-tail] end");
              } else {
                append_player_debug_log(None, "[mpv-stderr-tail] empty");
              }

              // Persist a structured report for retrieval from the UI.
              let report = MpvExitReport {
                session_id,
                mpv_pid: mpv_pid_for_writer,
                exit_code,
                mpv_alive: alive,
                pipe: ipc_path_for_writer.clone(),
                media_path: media_path_for_diag.clone(),
                last_action: action,
                time_pos: tpos,
                close_reason,
                exe: exe_for_diag.clone(),
                args: args_for_diag.clone(),
                stderr_tail: stderr_lines.into_iter().rev().take(tail_take).collect(),
                stdout_tail: stdout_lines.into_iter().rev().take(tail_take).collect(),
                no_config,
              };
              if let Ok(mut g) = last_exit_report.lock() {
                *g = Some(report);
              }
              break;
            }
            if ipc_reconnecting_for_writer
              .compare_exchange(false, true, Ordering::SeqCst, Ordering::SeqCst)
              .is_err()
            {
              // Another reconnect already in-flight; stop writing.
              break;
            }

            append_player_debug_log(
              None,
              &format!(
                "[ipc-writer] RECONNECT start session_id={session_id} mpv_pid={mpv_pid_for_writer} pipe={} old_gen={active_gen} writer_token={writer_token}",
                ipc_path_for_writer
              ),
            );

            // Close old handle by dropping BufWriter, then attempt to re-open once.
            let reopened = (|| -> Result<std::fs::File, std::io::Error> {
              // Try a handful of times; log each OS error so we can see exact failure mode.
              let mut last_err: Option<std::io::Error> = None;
              for i in 0..10 {
                match std::fs::OpenOptions::new().read(true).write(true).open(&ipc_path_for_writer) {
                  Ok(f) => return Ok(f),
                  Err(err) => {
                    append_player_debug_log(
                      None,
                      &format!(
                        "[ipc-writer] RECONNECT open failed attempt={} session_id={session_id} pipe={} err={err}",
                        i + 1,
                        ipc_path_for_writer
                      ),
                    );
                    last_err = Some(err);
                    thread::sleep(Duration::from_millis(80));
                  }
                }
              }
              Err(last_err.unwrap_or_else(|| {
                std::io::Error::new(std::io::ErrorKind::Other, "unknown open error")
              }))
            })();

            match reopened {
              Ok(f) => {
                w = BufWriter::new(f);
                let new_gen = ipc_generation_for_writer.fetch_add(1, Ordering::SeqCst) + 1;
                ipc_dead_for_writer.store(false, Ordering::SeqCst);
                ipc_reconnecting_for_writer.store(false, Ordering::SeqCst);
                append_player_debug_log(
                  None,
                  &format!(
                    "[ipc-writer] RECONNECT ok session_id={session_id} mpv_pid={mpv_pid_for_writer} pipe={} new_gen={new_gen} writer_token={writer_token}",
                    ipc_path_for_writer
                  ),
                );
                // Do not retry the old command; it belongs to the old generation.
                break;
              }
              Err(err) => {
                ipc_reconnecting_for_writer.store(false, Ordering::SeqCst);
                ipc_unrecoverable_for_writer.store(true, Ordering::SeqCst);
                append_player_debug_log(
                  None,
                  &format!(
                    "[ipc-writer] RECONNECT failed session_id={session_id} mpv_pid={mpv_pid_for_writer} mpv_alive={:?} pipe={} err={err} -> transport DEAD",
                    mpv_pid_alive(mpv_pid_for_writer),
                    ipc_path_for_writer
                  ),
                );
                break;
              }
            }
          }
        }
        // Only one loop iteration per message; reconnect logic above breaks.
      }
    }
  });

  let observe_msgs: Vec<Value> = if external {
    vec![
      // No time-pos / audio-pts/full / time-pos/full — polled for external sessions (see poll thread above).
      json!({"command":["observe_property", 2, "duration"]}),
      json!({"command":["observe_property", 3, "pause"]}),
      json!({"command":["observe_property", 11, "core-idle"]}),
      json!({"command":["observe_property", 4, "mute"]}),
      json!({"command":["observe_property", 5, "volume"]}),
      json!({"command":["observe_property", 6, "track-list"]}),
      json!({"command":["observe_property", 7, "sid"]}),
      json!({"command":["observe_property", 8, "aid"]}),
      json!({"command":["observe_property", 9, "sub-visibility"]}),
      json!({"command":["observe_property", 10, "sub-delay"]}),
      json!({"command":["observe_property", 14, "user-data/pitflix-shortcut"]}),
      json!({"command":["observe_property", 15, "path"]}),
    ]
  } else {
    vec![
      json!({"command":["observe_property", 1, "time-pos"]}),
      json!({"command":["observe_property", 2, "duration"]}),
      json!({"command":["observe_property", 3, "pause"]}),
      json!({"command":["observe_property", 11, "core-idle"]}),
      json!({"command":["observe_property", 12, "audio-pts/full"]}),
      json!({"command":["observe_property", 13, "time-pos/full"]}),
      json!({"command":["observe_property", 4, "mute"]}),
      json!({"command":["observe_property", 5, "volume"]}),
      json!({"command":["observe_property", 6, "track-list"]}),
      json!({"command":["observe_property", 7, "sid"]}),
      json!({"command":["observe_property", 8, "aid"]}),
      json!({"command":["observe_property", 9, "sub-visibility"]}),
      json!({"command":["observe_property", 10, "sub-delay"]}),
      json!({"command":["observe_property", 14, "user-data/pitflix-shortcut"]}),
      json!({"command":["observe_property", 15, "path"]}),
    ]
  };
  for m in observe_msgs {
    let gen = ipc_generation.load(Ordering::SeqCst);
    let _ = enqueue_ipc(tx.as_ref(), gen, &m);
  }

  let ipc_pending = Arc::new(Mutex::new(HashMap::new()));
  let next_correlated_req_id = Arc::new(AtomicU64::new(IPC_CORRELATED_REQ_ID_START));
  Ok((
    MpvSession {
      child,
      tx,
      ipc_client_path: client_path,
      mpv_pid,
      stderr_tail,
      stdout_tail,
      ipc_dead,
      ipc_unrecoverable,
      ipc_reconnecting,
      ipc_generation,
      ipc_writer_token: writer_token,
      ipc_pending,
      next_correlated_req_id,
    },
    file,
  ))
}

fn connect_ipc(client_path: &str, child: &mut Child) -> std::io::Result<std::fs::File> {
  for _ in 0..200 {
    if let Ok(Some(_)) = child.try_wait() {
      return Err(std::io::Error::new(
        std::io::ErrorKind::ConnectionAborted,
        "mpv exited before IPC was ready",
      ));
    }
    match std::fs::OpenOptions::new().read(true).write(true).open(client_path) {
      Ok(f) => return Ok(f),
      Err(e) => {
        let code = e.raw_os_error();
        if matches!(code, Some(2) | Some(231)) {
          thread::sleep(Duration::from_millis(25));
          continue;
        }
        return Err(e);
      }
    }
  }
  Err(std::io::Error::new(
    std::io::ErrorKind::TimedOut,
    "Timed out connecting to mpv IPC",
  ))
}

fn find_mpv_exe(handle: &AppHandle) -> Option<PathBuf> {
  let target_triple = env!("TAURI_ENV_TARGET_TRIPLE");
  let expected = format!("mpv-{}.exe", target_triple);
  if let Ok(d) = handle.path().resource_dir() {
    let p = d.join("binaries").join(&expected);
    if p.is_file() {
      return Some(p);
    }
  }
  #[cfg(dev)]
  {
    let p = PathBuf::from(env!("CARGO_MANIFEST_DIR")).join("binaries").join(&expected);
    if p.is_file() {
      return Some(p);
    }
  }
  None
}

fn find_libmpv_dll(handle: &AppHandle) -> Option<PathBuf> {
  // Release/bundled: inside Tauri resource dir (usually `<app>/resources/binaries/libmpv-2.dll`).
  if let Ok(d) = handle.path().resource_dir() {
    let p = d.join("binaries").join("libmpv-2.dll");
    append_player_debug_log(
      Some(handle),
      &format!("[libmpv-load] trying path={}", p.to_string_lossy()),
    );
    if p.is_file() {
      // Probe-load so we can log a clear failure reason (missing dependencies, wrong arch, etc).
      match super::libmpv::LibMpv::load_at(&p) {
        Ok(_) => {
          append_player_debug_log(
            Some(handle),
            &format!("[libmpv-load] success path={}", p.to_string_lossy()),
          );
          return Some(p);
        }
        Err(err) => {
          append_player_debug_log(
            Some(handle),
            &format!("[libmpv-load] failed path={} err={}", p.to_string_lossy(), err),
          );
        }
      }
    } else {
      append_player_debug_log(
        Some(handle),
        &format!("[libmpv-load] failed path={} err=missing_file", p.to_string_lossy()),
      );
    }
  }
  #[cfg(dev)]
  {
    let p = PathBuf::from(env!("CARGO_MANIFEST_DIR"))
      .join("binaries")
      .join("libmpv-2.dll");
    append_player_debug_log(
      Some(handle),
      &format!("[libmpv-load] trying path={}", p.to_string_lossy()),
    );
    if p.is_file() {
      match super::libmpv::LibMpv::load_at(&p) {
        Ok(_) => {
          append_player_debug_log(
            Some(handle),
            &format!("[libmpv-load] success path={}", p.to_string_lossy()),
          );
          return Some(p);
        }
        Err(err) => {
          append_player_debug_log(
            Some(handle),
            &format!("[libmpv-load] failed path={} err={}", p.to_string_lossy(), err),
          );
        }
      }
    } else {
      append_player_debug_log(
        Some(handle),
        &format!("[libmpv-load] failed path={} err=missing_file", p.to_string_lossy()),
      );
    }
  }
  None
}

static REGISTER_VIDEO_CLASS: Once = Once::new();
static INPUT_WM_NCHITTEST_LOG: AtomicU64 = AtomicU64::new(0);

fn input_layer_log_nc_hit_test(hwnd: HWND) {
  let n = INPUT_WM_NCHITTEST_LOG.fetch_add(1, Ordering::Relaxed) + 1;
  // Log generously at first so we can confirm hit-testing passes through the video child to the WebView.
  if n > 40 && n % 200 != 0 {
    return;
  }
  unsafe {
    let style = GetWindowLongPtrW(hwnd, GWL_STYLE);
    let ex = GetWindowLongPtrW(hwnd, GWL_EXSTYLE);
    append_player_debug_log(
      None,
      &format!(
        "[input-layer] WM_NCHITTEST hit -> returning HTTRANSPARENT (clicks to parent/WebView) hwnd=0x{:x} style=0x{:x} exstyle=0x{:x} n={n}",
        hwnd.0 as usize,
        style as usize,
        ex as usize
      ),
    );
  }
}

fn register_video_class() {
  REGISTER_VIDEO_CLASS.call_once(|| unsafe {
    let hinstance = GetModuleHandleW(None).map_err(|_| ()).unwrap();
    let video_class = w!("PitflixVideoEmbed");
    let vc = WNDCLASSW {
      style: CS_OWNDC,
      lpfnWndProc: Some(video_wnd_proc),
      hInstance: hinstance.into(),
      lpszClassName: video_class,
      ..Default::default()
    };
    let _ = RegisterClassW(&vc);
  });
}

fn create_embed_video_child(parent: HWND) -> Result<HWND, String> {
  register_video_class();
  unsafe {
    let hinstance = GetModuleHandleW(None).map_err(|e| e.to_string())?;
    let video_class = w!("PitflixVideoEmbed");
    // Tiny initial size — **not** full client rect. Until React calls `player2_set_video_bounds`, a full-size
    // HWND sits above the WebView and blocks all clicks. Bounds sync arrives a frame later.
    let w = 4i32;
    let h = 4i32;
    embed_op_log(None, "CreateWindowExW(video child)", "before", 0, parent.0 as usize, 0);
    let video = CreateWindowExW(
      // WS_EX_NOACTIVATE prevents focus stealing. Do NOT use WS_EX_TRANSPARENT here —
      // it makes the window visually transparent and breaks OpenGL rendering (black screen).
      // Click-through is handled by WM_NCHITTEST -> HTTRANSPARENT in video_wnd_proc.
      WS_EX_NOACTIVATE,
      video_class,
      w!(""),
      // WS_CHILD | WS_VISIBLE for normal child rendering. Do NOT use WS_DISABLED —
      // it can interfere with message delivery. Click-through is via WM_NCHITTEST.
      WS_CHILD | WS_VISIBLE,
      0,
      0,
      w,
      h,
      Some(parent),
      None,
      Some(hinstance.into()),
      None,
    )
    .map_err(|e| format!("CreateWindowExW(video): {e}"))?;
    embed_op_log(None, "CreateWindowExW(video child)", "after", 0, parent.0 as usize, video.0 as usize);
    embed_op_log(None, "ShowWindow(video child)", "before", 0, parent.0 as usize, video.0 as usize);
    let _ = ShowWindow(video, windows::Win32::UI::WindowsAndMessaging::SW_SHOW);
    embed_op_log(None, "ShowWindow(video child)", "after", 0, parent.0 as usize, video.0 as usize);
    // Click-through is handled by WM_NCHITTEST -> HTTRANSPARENT in video_wnd_proc.
    // Do NOT call apply_hwnd_click_through_styles here — it adds WS_EX_TRANSPARENT which
    // breaks OpenGL rendering (causes black screen).
    // Z-order: libmpv path stacks **below** `WRY_WEBVIEW` in `refresh_native_overlay_stack`; external
    // `--wid` path uses `HWND_TOP` there.

    let style = GetWindowLongPtrW(video, GWL_STYLE);
    let ex = GetWindowLongPtrW(video, GWL_EXSTYLE);
    append_player_debug_log(
      None,
      &format!(
        "[input-layer] video child created hwnd=0x{:x} parent=0x{:x} class={} style=0x{:x} exstyle=0x{:x}",
        video.0 as usize,
        parent.0 as usize,
        window_class_name(video),
        style as usize,
        ex as usize
      ),
    );
    Ok(video)
  }
}

/// Embed host for `--wid` (external mpv). In-process libmpv rendering is disabled.
unsafe extern "system" fn video_wnd_proc(
  hwnd: HWND,
  msg: u32,
  wparam: WPARAM,
  lparam: LPARAM,
) -> LRESULT {
  unsafe {
    if msg == WM_NCHITTEST {
      input_layer_log_nc_hit_test(hwnd);
      return LRESULT(HTTRANSPARENT as isize);
    }
    if msg == WM_MPV_RENDER {
      let posted_session = wparam.0 as u64;
      let p = GetWindowLongPtrW(hwnd, windows::Win32::UI::WindowsAndMessaging::GWLP_USERDATA);
      let _ = windows_libmpv_host::on_wm_mpv_render(p as *mut _, hwnd, posted_session);
      return LRESULT(0);
    }
    if msg == windows::Win32::UI::WindowsAndMessaging::WM_NCDESTROY {
      windows_libmpv_host::reclaim_renderer_from_hwnd(hwnd);
    }
    if msg == WM_MOUSEACTIVATE {
      return LRESULT(MA_NOACTIVATE as isize);
    }
    DefWindowProcW(hwnd, msg, wparam, lparam)
  }
}
