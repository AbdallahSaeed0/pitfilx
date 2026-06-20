//! Windows embedded playback using **libmpv + render API (OpenGL/WGL)**.
//!
//! Phase 1: open, render, pause/resume, seek, volume.

use std::{
  path::PathBuf,
  sync::{
    atomic::{AtomicBool, AtomicU64, Ordering},
    mpsc, Arc, Mutex,
  },
  thread,
  time::Duration,
};

use tauri::{AppHandle, Emitter};

use windows::Win32::{
  Foundation::{HWND, LPARAM, RECT, WPARAM},
  System::Threading::GetCurrentThreadId,
  UI::WindowsAndMessaging::{
    GetClientRect, GetWindowLongPtrW, PostMessageW, SetWindowLongPtrW, GWLP_USERDATA, WM_DESTROY,
  },
};

use super::{
  commands::{PlayerCommand, PlayerOpen},
  events::{PlayerEvent, PlayerState},
  playback_orchestrator,
  libmpv::{
    mpv_event_property, mpv_format, MpvClient, MPV_EVENT_NONE, MPV_EVENT_PROPERTY_CHANGE,
    MPV_EVENT_SHUTDOWN,
  },
  mpv_gl_win::{
    gl_log_get_error, record_render_path_error, record_render_success_after_swap, render_path_log_summary,
    render_path_note_make_current_fail, render_path_note_skip_no_update_frame,
    render_path_note_wm_mpv_render_received, GlContext, MpvGlRenderer, MPV_RENDER_UPDATE_FRAME, WM_MPV_RENDER,
  },
  tauri_commands::append_player_debug_log,
};

pub const WM_LIBMPV_CMD: u32 = windows::Win32::UI::WindowsAndMessaging::WM_USER + 102;

static WM_MPV_RENDER_RECV_N: AtomicU64 = AtomicU64::new(0);
static WM_MPV_RENDER_NOOP: AtomicU64 = AtomicU64::new(0);

fn diag_every(n: u64, ctr: &AtomicU64) -> bool {
  let c = ctr.fetch_add(1, Ordering::Relaxed) + 1;
  c <= 8 || c % n == 0
}

/// Property deltas from the mpv event thread — applied on a dedicated thread that briefly locks `PlayerState`.
#[derive(Debug)]
enum LibMpvStateDelta {
  Pause(bool),
  TimePos(f64),
  Duration(f64),
  Volume(f64),
}

fn parse_libmpv_property_change(prop: &mpv_event_property) -> Option<LibMpvStateDelta> {
  if prop.name.is_null() {
    return None;
  }
  let name = unsafe { std::ffi::CStr::from_ptr(prop.name) }.to_string_lossy();
  let fmt = prop.format as i32;
  let data_ptr = prop.data;
  match name.as_ref() {
    "pause" => {
      if data_ptr.is_null() || fmt == mpv_format::MPV_FORMAT_NONE as i32 {
        return None;
      }
      if fmt != mpv_format::MPV_FORMAT_FLAG as i32 {
        return None;
      }
      let v = unsafe { *(data_ptr as *const i32) } != 0;
      Some(LibMpvStateDelta::Pause(v))
    }
    "time-pos" => {
      if data_ptr.is_null() || fmt == mpv_format::MPV_FORMAT_NONE as i32 {
        return None;
      }
      if fmt != mpv_format::MPV_FORMAT_DOUBLE as i32 {
        return None;
      }
      let v = unsafe { *(data_ptr as *const f64) };
      v.is_finite().then_some(LibMpvStateDelta::TimePos(v))
    }
    "duration" => {
      if data_ptr.is_null() || fmt == mpv_format::MPV_FORMAT_NONE as i32 {
        return None;
      }
      if fmt != mpv_format::MPV_FORMAT_DOUBLE as i32 {
        return None;
      }
      let v = unsafe { *(data_ptr as *const f64) };
      v.is_finite().then_some(LibMpvStateDelta::Duration(v))
    }
    "volume" => {
      if data_ptr.is_null() || fmt == mpv_format::MPV_FORMAT_NONE as i32 {
        return None;
      }
      if fmt != mpv_format::MPV_FORMAT_DOUBLE as i32 {
        return None;
      }
      let v = unsafe { *(data_ptr as *const f64) };
      v.is_finite().then_some(LibMpvStateDelta::Volume(v))
    }
    _ => None,
  }
}

fn spawn_libmpv_state_apply_thread(
  app: AppHandle,
  state: Arc<Mutex<PlayerState>>,
  rx: mpsc::Receiver<LibMpvStateDelta>,
) {
  thread::spawn(move || {
    while let Ok(d) = rx.recv() {
      let snap = {
        let mut st = match state.lock() {
          Ok(g) => g,
          Err(_) => continue,
        };
        match d {
          LibMpvStateDelta::Pause(v) => {
            st.paused = v;
            st.playing = !st.paused && !st.ended && st.duration > 0.1;
            st.loading = false;
          }
          LibMpvStateDelta::TimePos(v) => {
            st.time_pos = v;
            st.time_pos_full = v;
            st.loading = false;
          }
          LibMpvStateDelta::Duration(v) => {
            st.duration = v.max(0.0);
          }
          LibMpvStateDelta::Volume(v) => {
            st.volume = v;
          }
        }
        st.clone()
      };
      let _ = app.emit("player2-event", PlayerEvent::State(snap.clone()));
      playback_orchestrator::notify_engine_state(&app, &snap);
    }
  });
}

pub struct EmbeddedLibMpvSession {
  pub session_id: u64,
  pub parent_hwnd: usize,
  pub video_hwnd: usize,
  pub state: Arc<Mutex<PlayerState>>,
  pub cmd_tx: mpsc::Sender<PlayerCommand>,
  pub stop: Arc<AtomicBool>,
  /// Joined in `shutdown` before GL teardown — mpv handle must stay alive until this exits.
  pub event_join: Mutex<Option<thread::JoinHandle<()>>>,
  /// Win32 thread that created WGL + `mpv_render_context` (must match `WM_MPV_RENDER` handler).
  pub window_thread_id: u32,
  // Keep these alive for the session lifetime.
  pub mpv: Arc<MpvClient>,
}

pub fn create_embedded_libmpv_session(
  app: AppHandle,
  session_id: u64,
  parent_hwnd: HWND,
  video_hwnd: HWND,
  libmpv_dll: PathBuf,
  payload: PlayerOpen,
  config_dir: Option<PathBuf>,
) -> Result<EmbeddedLibMpvSession, String> {
  append_player_debug_log(
    Some(&app),
    &format!(
      "[libmpv-render] child hwnd created session_id={session_id} parent_hwnd=0x{:x} video_hwnd=0x{:x}",
      parent_hwnd.0 as usize,
      video_hwnd.0 as usize
    ),
  );

  // 1) Create mpv handle (no initialize yet)
  let mpv = Arc::new(MpvClient::create_for_render(&libmpv_dll)?);

  // 1b) Apply config-dir and Lua scripts if available (same set as external mpv.exe mode).
  if let Some(ref cdir) = config_dir {
    let s = cdir.to_string_lossy();
    // Strip \\?\ extended-length prefix so mpv can parse the path.
    let cp = if let Some(rest) = s.strip_prefix(r"\\?\UNC\") {
      format!(r"\\{}", rest)
    } else if let Some(rest) = s.strip_prefix(r"\\?\") {
      rest.to_string()
    } else {
      s.into_owned()
    };
    // Do NOT load mpv.conf — it contains `vo=gpu` and `hwdec=auto-safe` which
    // override the `vo=libmpv` / `hwdec=no` required for embedded WGL rendering
    // and cause STATUS_STACK_BUFFER_OVERRUN during mpv_initialize().
    // Scripts are loaded explicitly below so nothing is lost.
    let _ = mpv.set_option_string("config", "no");
    let _ = mpv.set_option_string("load-scripts", "yes");
    let _ = mpv.set_option_string("osc", "no");
    let _ = mpv.set_option_string("script", &format!("{cp}/scripts/uosc/main.lua"));
    let _ = mpv.set_option_string("script", &format!("{cp}/scripts/pitflix-episode-nav.lua"));
    let _ = mpv.set_option_string("script", &format!("{cp}/scripts/pitflix-player-controls.lua"));
    let _ = mpv.set_option_string("script", &format!("{cp}/scripts/pitflix-config-check.lua"));
    append_player_debug_log(
      Some(&app),
      &format!("[libmpv-scripts] config_dir={cp} scripts=uosc,pitflix-episode-nav,pitflix-player-controls,pitflix-config-check"),
    );
  } else {
    append_player_debug_log(Some(&app), "[libmpv-scripts] no config_dir — running without Lua scripts");
  }

  // 2) Create GL on the child HWND (must be done on the owning window thread in practice;
  // for Phase 1 we assume this runs on the main thread via Tauri run_on_main_thread).
  let gl = match GlContext::create(video_hwnd) {
    Ok(g) => {
      append_player_debug_log(
        Some(&app),
        "[libmpv-render] WGL context create success",
      );
      g
    }
    Err(e) => {
      append_player_debug_log(
        Some(&app),
        &format!("[libmpv-render] WGL context create fail err={e}"),
      );
      let _ = app.emit(
        "player2-event",
        PlayerEvent::Error {
          message: format!("WGL context create failed: {e}"),
        },
      );
      return Err(e);
    }
  };
  let window_thread_id = gl.window_thread_id;

  let renderer = match MpvGlRenderer::new(&mpv, gl, video_hwnd, session_id) {
    Ok(r) => {
      append_player_debug_log(Some(&app), "[libmpv-render] mpv_render_context_create success");
      r
    }
    Err(e) => {
      append_player_debug_log(
        Some(&app),
        &format!("[libmpv-render] mpv_render_context_create fail err={e}"),
      );
      let _ = app.emit(
        "player2-event",
        PlayerEvent::Error {
          message: format!("mpv_render_context_create failed: {e}"),
        },
      );
      return Err(e);
    }
  };
  let renderer = Box::new(renderer);
  let renderer_ptr = Box::into_raw(renderer);
  unsafe {
    let _ = SetWindowLongPtrW(video_hwnd, GWLP_USERDATA, renderer_ptr as isize);
  }

  // 3) Re-assert the two options that are critical for embedded WGL rendering.
  // vo=libmpv tells mpv to use the render API (our WGL path); hwdec=no forces
  // software decode so no D3D/DXVA interop is attempted.
  // Do NOT set gpu-api here — with vo=libmpv, gpu-api is for vo=gpu and causes
  // mpv to partially initialise a second GL stack during mpv_initialize(),
  // which corrupts the stack → STATUS_STACK_BUFFER_OVERRUN.
  let _ = mpv.set_option_string("vo", "libmpv");
  let _ = mpv.set_option_string("hwdec", "no");

  // 3b) Now initialize mpv core (render ctx exists).
  mpv.initialize()?;

  // 3c) Only NOW arm the render-update callback. Doing it before mpv_initialize() caused
  // WASAPI/COM init to pump the Win32 message queue mid-init, dispatching WM_MPV_RENDER
  // re-entrantly into mpv_render_context_render → STATUS_STACK_BUFFER_OVERRUN.
  unsafe {
    (*renderer_ptr).arm_update_callback();
  }

  // 4) Observe Phase-1 properties.
  mpv.observe_property(1, "pause", mpv_format::MPV_FORMAT_FLAG)?;
  mpv.observe_property(2, "time-pos", mpv_format::MPV_FORMAT_DOUBLE)?;
  mpv.observe_property(3, "duration", mpv_format::MPV_FORMAT_DOUBLE)?;
  mpv.observe_property(4, "volume", mpv_format::MPV_FORMAT_DOUBLE)?;
  // Episode nav / uOSC buttons set `user-data/pitflix-shortcut` from Lua — mirror external IPC bridge.
  mpv.observe_property(12, "user-data/pitflix-shortcut", mpv_format::MPV_FORMAT_STRING)?;
  mpv.observe_property(99, "video-params", mpv_format::MPV_FORMAT_NODE)?;
  mpv.observe_property(100, "hwdec-current", mpv_format::MPV_FORMAT_STRING)?;

  // 5) Shared state + emit initial loading.
  let state = Arc::new(Mutex::new(PlayerState {
    loading: true,
    ipc_healthy: true,
    sub_visible: true,
    sid: -1,
    aid: -1,
    ..Default::default()
  }));
  let _ = app.emit("player2-event", PlayerEvent::State(state.lock().unwrap().clone()));

  // 6) Load file (+ optional start seconds).
  mpv.command(&["loadfile", &payload.path, "replace"])?;
  if let Some(start) = payload.start_seconds {
    if start.is_finite() && start > 0.0 {
      mpv.command(&["seek", &format!("{}", start), "absolute"])?;
    }
  }

  // 7) Command channel.
  let (cmd_tx, cmd_rx) = mpsc::channel::<PlayerCommand>();
  let stop = Arc::new(AtomicBool::new(false));

  // 7b) Property updates: mpv event thread never locks `PlayerState` — avoids deadlocks with UI + emit callbacks.
  let (delta_tx, delta_rx) = mpsc::channel::<LibMpvStateDelta>();
  spawn_libmpv_state_apply_thread(app.clone(), Arc::clone(&state), delta_rx);

  // 8) mpv event loop thread (no polling render; only property-change and shutdown).
  let event_join = Mutex::new(None);
  {
    let app_ev = app.clone();
    let mpv_ev = Arc::clone(&mpv);
    let stop_ev = Arc::clone(&stop);
    let delta_tx = delta_tx;
    let handle = thread::spawn(move || {
      loop {
        if stop_ev.load(Ordering::SeqCst) {
          break;
        }
        let ev_ptr = unsafe { (mpv_ev.api.mpv_wait_event)(mpv_ev.raw_handle(), 0.1) };
        if ev_ptr.is_null() {
          continue;
        }
        let ev = unsafe { &*ev_ptr };
        if ev.event_id == MPV_EVENT_NONE {
          // allow cmd draining below
        } else if ev.event_id == MPV_EVENT_SHUTDOWN {
          break;
        } else if ev.event_id == MPV_EVENT_PROPERTY_CHANGE {
          let prop = unsafe { &*(ev.data as *const mpv_event_property) };
          if !prop.name.is_null() {
            let name = unsafe { std::ffi::CStr::from_ptr(prop.name) }.to_string_lossy();
            if name == "video-params" {
              append_player_debug_log(
                Some(&app_ev),
                &format!(
                  "[libmpv-diag] video-params changed: format={} data_ptr={:p}",
                  prop.format as i32, prop.data
                ),
              );
            } else if name == "hwdec-current" {
              let hw = if prop.data.is_null() || prop.format as i32 != mpv_format::MPV_FORMAT_STRING as i32 {
                "(unavailable)".to_string()
              } else {
                unsafe {
                  let pp = prop.data as *const *const std::ffi::c_char;
                  if pp.is_null() || (*pp).is_null() {
                    "(null)".to_string()
                  } else {
                    std::ffi::CStr::from_ptr(*pp).to_string_lossy().into_owned()
                  }
                }
              };
              append_player_debug_log(
                Some(&app_ev),
                &format!("[libmpv-diag] hwdec-current={hw}"),
              );
            } else if name == "user-data/pitflix-shortcut" {
              if prop.format as i32 == mpv_format::MPV_FORMAT_STRING as i32 && !prop.data.is_null() {
                unsafe {
                  let pp = prop.data as *const *const std::ffi::c_char;
                  if !pp.is_null() && !(*pp).is_null() {
                    let raw = std::ffi::CStr::from_ptr(*pp).to_string_lossy().into_owned();
                    let code = raw.split(':').next().unwrap_or("").trim().to_string();
                    if !code.is_empty() && code != "script_loaded" {
                      let _ = app_ev.emit("player2-shortcut", &code);
                    }
                    (mpv_ev.api.mpv_free)((*pp) as *mut std::ffi::c_void);
                  }
                }
              }
            }
          }
          if let Some(delta) = parse_libmpv_property_change(prop) {
            let _ = delta_tx.send(delta);
          }
        }

        // Drain any queued commands (non-blocking).
        while let Ok(cmd) = cmd_rx.try_recv() {
          if stop_ev.load(Ordering::SeqCst) {
            break;
          }
          match cmd {
            PlayerCommand::Play => {
              let _ = mpv_ev.set_pause(false);
            }
            PlayerCommand::Pause => {
              let _ = mpv_ev.set_pause(true);
            }
            PlayerCommand::SetPaused(v) => {
              let _ = mpv_ev.set_pause(v);
            }
            PlayerCommand::SeekRelative(sec) => {
              let _ = mpv_ev.command(&["seek", &format!("{}", sec), "relative"]);
            }
            PlayerCommand::SeekAbsolute(sec) => {
              let _ = mpv_ev.command(&["seek", &format!("{}", sec), "absolute"]);
            }
            PlayerCommand::SetVolume(v) => {
              let _ = mpv_ev.command(&["set_property", "volume", &format!("{}", v)]);
            }
            PlayerCommand::SetMute(v) => {
              let _ = mpv_ev.command(&["set_property", "mute", if v { "yes" } else { "no" }]);
            }
            PlayerCommand::SetSpeed(v) => {
              let _ = mpv_ev.command(&["set_property", "speed", &format!("{v}")]);
            }
            PlayerCommand::Stop => {
              let _ = mpv_ev.command(&["quit"]);
            }
            // Phase 1 ignores subtitle/audio track selection, sub delay etc.
            _ => {}
          }
        }
      }
      let _ = app_ev.emit(
        "player2-event",
        PlayerEvent::Error {
          message: "libmpv session ended".to_string(),
        },
      );
    });
    *event_join.lock().unwrap() = Some(handle);
  }

  unsafe {
    let mut r = RECT::default();
    let _ = GetClientRect(video_hwnd, &mut r);
    let w = (r.right - r.left).max(0);
    let h = (r.bottom - r.top).max(0);
    append_player_debug_log(
      Some(&app),
      &format!(
        "[libmpv-render] initial client_rect session_id={session_id} w={w} h={h} (video_hwnd=0x{:x})",
        video_hwnd.0 as usize
      ),
    );
  }

  // 9) Ensure first frame renders quickly.
  let _ = unsafe {
    PostMessageW(
      Some(video_hwnd),
      WM_MPV_RENDER,
      WPARAM(session_id as usize),
      LPARAM(0),
    )
  };
  append_player_debug_log(
    Some(&app),
    "[libmpv-render] repaint request: PostMessageW(WM_MPV_RENDER) after open",
  );

  Ok(EmbeddedLibMpvSession {
    session_id,
    parent_hwnd: parent_hwnd.0 as usize,
    video_hwnd: video_hwnd.0 as usize,
    state,
    cmd_tx,
    stop,
    event_join,
    window_thread_id,
    mpv,
  })
}

/// Render handler called from the video HWND WNDPROC on `WM_MPV_RENDER`.
pub unsafe fn on_wm_mpv_render(
  renderer_ptr: *mut MpvGlRenderer,
  hwnd: HWND,
  posted_session_id: u64,
) -> Result<(), String> {
  render_path_note_wm_mpv_render_received();
  let recv_n = WM_MPV_RENDER_RECV_N.fetch_add(1, Ordering::Relaxed) + 1;
  let path_hard = recv_n <= 35 || recv_n % 120 == 0;

  if path_hard {
    append_player_debug_log(
      None,
      &format!(
        "[libmpv-render-path] WM_MPV_RENDER received n={recv_n} hwnd=0x{:x} renderer_null={} posted_session_id={posted_session_id}",
        hwnd.0 as usize,
        renderer_ptr.is_null()
      ),
    );
  }

  if renderer_ptr.is_null() {
    append_player_debug_log(
      None,
      "[libmpv-render-path] WM_MPV_RENDER received renderer=null (no GL path)",
    );
    if recv_n.is_multiple_of(200) {
      render_path_log_summary(&format!("wm_recv_n={recv_n}"));
    }
    return Ok(());
  }
  let renderer = &*renderer_ptr;
  if posted_session_id != 0 && renderer.session_id != posted_session_id {
    return Ok(());
  }
  debug_assert_eq!(
    unsafe { GetCurrentThreadId() },
    renderer.window_thread_id(),
    "WM_MPV_RENDER must be handled on the window thread that owns WGL USERDATA"
  );

  unsafe {
    let mut r = RECT::default();
    if GetClientRect(hwnd, &mut r).is_err() {
      record_render_path_error("GetClientRect", "failed (cannot size viewport)");
      if recv_n.is_multiple_of(200) {
        render_path_log_summary(&format!("wm_recv_n={recv_n}"));
      }
      return Ok(());
    }
    let w = (r.right - r.left).max(0);
    let h = (r.bottom - r.top).max(0);
    if path_hard {
      append_player_debug_log(
        None,
        &format!(
          "[libmpv-render-path] video child client size w={w} h={h} hwnd=0x{:x}",
          hwnd.0 as usize
        ),
      );
    }
    if w <= 0 || h <= 0 {
      if diag_every(60, &WM_MPV_RENDER_NOOP) {
        append_player_debug_log(
          None,
          &format!(
            "[libmpv-render-path] WM_MPV_RENDER noop: zero client size w={w} h={h} hwnd=0x{:x}",
            hwnd.0 as usize
          ),
        );
      }
      if recv_n.is_multiple_of(200) {
        render_path_log_summary(&format!("wm_recv_n={recv_n}"));
      }
      return Ok(());
    }

    let gl_guard = match renderer.make_current_guard() {
      Ok(g) => g,
      Err(e) => {
        render_path_note_make_current_fail();
        record_render_path_error("wglMakeCurrent", &e);
        if recv_n.is_multiple_of(200) {
          render_path_log_summary(&format!("wm_recv_n={recv_n}"));
        }
        return Err(e);
      }
    };
    if path_hard {
      append_player_debug_log(None, "[libmpv-render-path] make_current success");
    }

    let flags = match renderer.render_context_update_flags_current() {
      Ok(f) => f,
      Err(e) => {
        record_render_path_error("mpv_render_context_update", &e);
        if recv_n.is_multiple_of(200) {
          render_path_log_summary(&format!("wm_recv_n={recv_n}"));
        }
        return Err(e);
      }
    };
    if path_hard {
      append_player_debug_log(
        None,
        &format!(
          "[libmpv-render-path] mpv_render_context_update flags=0x{flags:x} client=({w}x{h})"
        ),
      );
    }

    if flags == 0 || (flags & MPV_RENDER_UPDATE_FRAME) == 0 {
      render_path_note_skip_no_update_frame();
      if path_hard || diag_every(60, &WM_MPV_RENDER_NOOP) {
        append_player_debug_log(
          None,
          &format!(
            "[libmpv-render-path] mpv_render_context_render skipped (no MPV_RENDER_UPDATE_FRAME in flags) flags=0x{flags:x} client=({w}x{h})"
          ),
        );
      }
      if recv_n.is_multiple_of(200) {
        render_path_log_summary(&format!("wm_recv_n={recv_n}"));
      }
      drop(gl_guard);
      return Ok(());
    }

    if let Err(e) = renderer.render_frame_with_flags(flags, w, h) {
      if recv_n.is_multiple_of(200) {
        render_path_log_summary(&format!("wm_recv_n={recv_n}"));
      }
      return Err(e);
    }
    gl_log_get_error("render");

    if let Err(e) = renderer.swap_buffers_logged(&gl_guard, "wm_mpv_render") {
      record_render_path_error("SwapBuffers", &e);
      if recv_n.is_multiple_of(200) {
        render_path_log_summary(&format!("wm_recv_n={recv_n}"));
      }
      return Err(e);
    }
    gl_log_get_error("swap");
    renderer.report_swap();
    record_render_success_after_swap(hwnd, w, h);

    if recv_n.is_multiple_of(200) {
      render_path_log_summary(&format!("wm_recv_n={recv_n}"));
    }

    Ok(())
  }
}

/// Clean shutdown trigger (called from host on close).
pub fn shutdown(session: &EmbeddedLibMpvSession) {
  session.stop.store(true, Ordering::SeqCst);
  let _ = session.cmd_tx.send(PlayerCommand::Stop);
  if let Ok(mut g) = session.event_join.lock() {
    if let Some(h) = g.take() {
      let _ = h.join();
    }
  }
}

/// Clear `GWLP_USERDATA` and drop `MpvGlRenderer` on the **main/UI thread** before `mpv` is destroyed.
pub fn teardown_gl_renderer(app: &AppHandle, video_hwnd: usize) -> Result<(), String> {
  let (tx, rx) = mpsc::channel();
  let app = app.clone();
  app
    .run_on_main_thread(move || {
      unsafe {
        let hwnd = HWND(video_hwnd as *mut _);
        let p = GetWindowLongPtrW(hwnd, GWLP_USERDATA);
        if p != 0 {
          let _ = SetWindowLongPtrW(hwnd, GWLP_USERDATA, 0);
          drop(Box::from_raw(p as *mut MpvGlRenderer));
        }
      }
      let _ = tx.send(());
    })
    .map_err(|e| e.to_string())?;
  rx.recv_timeout(Duration::from_secs(3))
    .map_err(|_| "libmpv GL teardown timed out".to_string())?;
  Ok(())
}

/// If the child window is destroyed, stop the session.
pub fn maybe_stop_on_wm_destroy(session: &EmbeddedLibMpvSession, msg: u32) {
  if msg == WM_DESTROY {
    session.stop.store(true, Ordering::SeqCst);
  }
}

/// Called from the child WNDPROC on `WM_NCDESTROY` to reclaim the renderer stored in `GWLP_USERDATA`.
pub unsafe fn reclaim_renderer_from_hwnd(hwnd: HWND) {
  let p = GetWindowLongPtrW(hwnd, GWLP_USERDATA);
  if p != 0 {
    let _ = SetWindowLongPtrW(hwnd, GWLP_USERDATA, 0);
    let _ = Box::from_raw(p as *mut MpvGlRenderer);
  }
}

