//! Harbor-style embedded libmpv on Windows.
//!
//! Approach (mirrors `harborstremio/harbor/src-tauri/src/mpv.rs`):
//!   1. Set `wid` = main Tauri window HWND.
//!   2. Use `vo=gpu`, `gpu-api=d3d11`, `force-window=immediate`.
//!   3. mpv creates its own native child HWND under the main window and renders into it.
//!   4. We enumerate children of the main HWND to find mpv's child (class `mpv`),
//!      and `SetWindowPos` it to match the React video frame.
//!
//! NOT used: `mpv_render_context_*`, OpenGL/WGL, `vo=libmpv`. Those produced
//! `STATUS_STACK_BUFFER_OVERRUN` due to re-entrant `WM_MPV_RENDER` dispatch.

use std::{
  ffi::{c_int, CStr},
  path::PathBuf,
  sync::{
    atomic::{AtomicBool, AtomicU64, Ordering},
    mpsc, Arc, Mutex,
  },
  thread,
};

use serde_json::Value;

use tauri::{AppHandle, Emitter, Manager, State};

use windows::core::BOOL;
use windows::Win32::{
  Foundation::{HWND, LPARAM, RECT},
  UI::HiDpi::GetDpiForWindow,
  UI::Shell::{DefSubclassProc, RemoveWindowSubclass, SetWindowSubclass},
  UI::WindowsAndMessaging::{
    EnumChildWindows, GetClassNameW, GetClientRect, GetWindowLongW, SetWindowLongW, SetWindowPos,
    GWL_EXSTYLE, HTTRANSPARENT, HWND_BOTTOM, SWP_NOACTIVATE, SWP_NOCOPYBITS, SWP_SHOWWINDOW, WM_NCHITTEST,
    WS_EX_TRANSPARENT,
  },
};

use super::commands::{PlayerCommand, PlayerOpen};
use super::events::{PlayerEvent, PlayerState, PlayerTrack, PlayerTracks};
use super::libmpv::{
  mpv_event_log_message, mpv_event_property, mpv_format, MpvClient, MPV_EVENT_LOG_MESSAGE,
  MPV_EVENT_NONE, MPV_EVENT_PROPERTY_CHANGE, MPV_EVENT_SHUTDOWN,
};
use super::quality_enhancement::{
  apply_audio_passthrough_options, apply_tonemap_sdr_options, apply_true_hdr_options,
  check_hdr_capability,
};
use super::input_bridge::{
  install_main_input_bridge, uninstall_main_input_bridge, update_video_hit_rect,
};
use super::tauri_commands::append_player_debug_log;

pub struct LibMpvSession {
  pub session_id: u64,
  pub parent_hwnd: usize,
  pub state: Arc<Mutex<PlayerState>>,
  pub cmd_tx: mpsc::Sender<PlayerCommand>,
  pub stop: Arc<AtomicBool>,
  pub event_join: Mutex<Option<thread::JoinHandle<()>>>,
  pub mpv: Arc<MpvClient>,
  /// Cached HWND of mpv's auto-created video child, set after `position_embedded_mpv_child`
  /// finds it via `EnumChildWindows`.
  pub video_hwnd: Arc<Mutex<Option<usize>>>,
}

pub struct LibMpvHostState(pub Mutex<Option<LibMpvSession>>);

impl Default for LibMpvHostState {
  fn default() -> Self {
    Self(Mutex::new(None))
  }
}

const HARBOR_MPV_SUBCLASS_ID: usize = 0xA1B2_C3D4;

/// Subclass procedure that makes mpv's native child window transparent to NC hit-testing,
/// so WebView2 controls layered on top still receive mouse events.
unsafe extern "system" fn mpv_subclass_proc(
  hwnd: HWND,
  msg: u32,
  wparam: windows::Win32::Foundation::WPARAM,
  lparam: windows::Win32::Foundation::LPARAM,
  _id: usize,
  _data: usize,
) -> windows::Win32::Foundation::LRESULT {
  if msg == WM_NCHITTEST {
    return windows::Win32::Foundation::LRESULT(HTTRANSPARENT as isize);
  }
  DefSubclassProc(hwnd, msg, wparam, lparam)
}

static SESSION_COUNTER: AtomicU64 = AtomicU64::new(1);

fn logical_px_to_physical(hwnd: HWND, n: i32) -> i32 {
  unsafe {
    let dpi = GetDpiForWindow(hwnd);
    let dpi = if dpi == 0 { 96 } else { dpi };
    (f64::from(n) * f64::from(dpi) / 96.0).round() as i32
  }
}

fn find_libmpv_dll(app: &AppHandle) -> Option<PathBuf> {
  let mut candidates: Vec<PathBuf> = Vec::new();
  #[cfg(dev)]
  {
    candidates.push(
      PathBuf::from(env!("CARGO_MANIFEST_DIR"))
        .join("binaries")
        .join("libmpv-2.dll"),
    );
  }
  if let Ok(d) = app.path().resource_dir() {
    candidates.push(d.join("binaries").join("libmpv-2.dll"));
    candidates.push(d.join("libmpv-2.dll"));
  }
  if let Ok(exe) = std::env::current_exe() {
    if let Some(parent) = exe.parent() {
      candidates.push(parent.join("binaries").join("libmpv-2.dll"));
      candidates.push(parent.join("libmpv-2.dll"));
    }
  }
  candidates.into_iter().find(|p| p.is_file())
}

struct Delta {
  name: String,
  num: f64,
  flag: bool,
  int_v: i64,
  have_num: bool,
  have_flag: bool,
  have_int: bool,
}

fn emit_tracks_from_json(app: &AppHandle, json_str: &str) {
  let Ok(val) = serde_json::from_str::<Value>(json_str) else {
    return;
  };
  let Some(arr) = val.as_array() else {
    return;
  };
  let tracks: Vec<PlayerTrack> = arr
    .iter()
    .map(|t| PlayerTrack {
      id: t
        .get("id")
        .and_then(|v| v.as_i64())
        .or_else(|| t.get("id").and_then(|v| v.as_f64()).map(|v| v as i64)),
      track_type: t.get("type").and_then(|v| v.as_str()).map(|s| s.to_string()),
      lang: t.get("lang").and_then(|v| v.as_str()).map(|s| s.to_string()),
      title: t.get("title").and_then(|v| v.as_str()).map(|s| s.to_string()),
      selected: t.get("selected").and_then(|v| v.as_bool()),
    })
    .collect();
  let _ = app.emit("player2-event", PlayerEvent::Tracks(PlayerTracks { tracks }));
}

fn fetch_and_emit_tracks(mpv: &MpvClient, app: &AppHandle) {
  let Ok(json_str) = mpv.get_property_string("track-list") else {
    return;
  };
  emit_tracks_from_json(app, &json_str);
}

fn parse_state_delta(prop: &mpv_event_property) -> Option<Delta> {
  if prop.name.is_null() {
    return None;
  }
  let name = unsafe { std::ffi::CStr::from_ptr(prop.name) }.to_string_lossy().into_owned();
  let fmt = prop.format as i32;
  let data_ptr = prop.data;
  let mut d = Delta {
    name,
    num: 0.0,
    flag: false,
    int_v: 0,
    have_num: false,
    have_flag: false,
    have_int: false,
  };
  if !data_ptr.is_null() {
    if fmt == mpv_format::MPV_FORMAT_DOUBLE as i32 {
      d.num = unsafe { *(data_ptr as *const f64) };
      d.have_num = true;
    } else if fmt == mpv_format::MPV_FORMAT_FLAG as i32 {
      d.flag = unsafe { *(data_ptr as *const i32) } != 0;
      d.have_flag = true;
    } else if fmt == mpv_format::MPV_FORMAT_INT64 as i32 {
      d.int_v = unsafe { *(data_ptr as *const i64) };
      d.have_int = true;
    }
  }
  Some(d)
}

#[tauri::command]
pub fn player2_libmpv_open(
  app: AppHandle,
  state: State<'_, LibMpvHostState>,
  payload: PlayerOpen,
) -> Result<(), String> {
  // Close any prior session first.
  player2_libmpv_close(app.clone(), state.clone())?;

  let dll = find_libmpv_dll(&app)
    .ok_or_else(|| "libmpv-2.dll not found next to app binaries.".to_string())?;
  let main = app
    .get_webview_window("main")
    .ok_or_else(|| "Main window not found".to_string())?;
  let main_hwnd = main.hwnd().map_err(|e| e.to_string())?;
  let main_hwnd_i64 = main_hwnd.0 as isize as i64;

  let session_id = SESSION_COUNTER.fetch_add(1, Ordering::SeqCst);

  append_player_debug_log(
    Some(&app),
    &format!(
      "[libmpv-session] open: main_hwnd=0x{:x} session_id={session_id} path={}",
      main_hwnd_i64, payload.path
    ),
  );

  // Create + configure mpv handle (Harbor-style options).
  let mpv = MpvClient::create_minimal(&dll)?;
  mpv.set_option_string("terminal", "no")?;
  mpv.set_option_string("msg-level", "all=warn")?;
  mpv.set_option_string("input-default-bindings", "no")?;
  mpv.set_option_string("input-vo-keyboard", "no")?;
  mpv.set_option_string("input-cursor", "no")?;
  mpv.set_option_string("osc", "no")?;
  mpv.set_option_string("osd-level", "0")?;
  // Letterbox / pillarbox with black unused areas, not stretched (keepaspect
  // =no) or cropped (panscan=1.0) — both were tried and rejected (distortion,
  // then cropped-off picture).  Black bars are the correct, undistorted
  // fallback whenever the window's aspect doesn't match the video's.
  mpv.set_option_string("keepaspect", "yes")?;
  mpv.set_option_string("background", "color")?;
  mpv.set_option_string("background-color", "#000000")?;
  mpv.set_option_string("volume-max", "200")?;
  mpv.set_option_string("force-window", "immediate")?;
  mpv.set_option_string("hwdec", "auto")?;
  mpv.set_option_string("vo", "gpu")?;
  mpv.set_option_string("gpu-api", "d3d11")?;
  mpv.set_option_string("target-colorspace-hint", "yes")?;
  // Stay on the last frame at EOF so React can auto-advance without a black screen.
  mpv.set_option_string("keep-open", "yes")?;
  mpv.set_option_string("keep-open-pause", "yes")?;
  // wid = main Tauri window HWND.
  mpv.set_option_string("wid", &main_hwnd_i64.to_string())?;
  if let Some(s) = payload.start_seconds {
    if s.is_finite() && s > 0.0 {
      mpv.set_option_string("start", &format!("{s}"))?;
    }
  }

  // Opt-in playback quality features (HDR + audio passthrough) — additive only, off by
  // default. See `quality_enhancement.rs`. Does not alter any option set above.
  let hdr_mode = payload.hdr_mode.as_deref().unwrap_or("auto");
  if hdr_mode == "true_hdr" && check_hdr_capability().true_hdr_available {
    apply_true_hdr_options(|k, v| mpv.set_option_string(k, v))?;
  } else {
    apply_tonemap_sdr_options(|k, v| mpv.set_option_string(k, v))?;
  }
  if payload.audio_passthrough.unwrap_or(false) {
    apply_audio_passthrough_options(|k, v| mpv.set_option_string(k, v))?;
  }

  mpv.initialize()?;
  append_player_debug_log(Some(&app), "[libmpv-session] mpv_initialize ok");

  // Only subscribe to mpv's log when passthrough is requested — this is how the frontend
  // badge (PASSTHROUGH vs PCM) confirms it actually engaged. See quality_enhancement.rs.
  if payload.audio_passthrough.unwrap_or(false) {
    let _ = mpv.request_log_messages("v");
  }

  // Observe transport state.
  mpv.observe_property(1, "pause", mpv_format::MPV_FORMAT_FLAG)?;
  mpv.observe_property(2, "time-pos", mpv_format::MPV_FORMAT_DOUBLE)?;
  mpv.observe_property(3, "duration", mpv_format::MPV_FORMAT_DOUBLE)?;
  mpv.observe_property(4, "volume", mpv_format::MPV_FORMAT_DOUBLE)?;
  mpv.observe_property(5, "mute", mpv_format::MPV_FORMAT_FLAG)?;
  mpv.observe_property(6, "sub-visibility", mpv_format::MPV_FORMAT_FLAG)?;
  mpv.observe_property(7, "sid", mpv_format::MPV_FORMAT_INT64)?;
  mpv.observe_property(8, "aid", mpv_format::MPV_FORMAT_INT64)?;
  mpv.observe_property(9, "sub-delay", mpv_format::MPV_FORMAT_DOUBLE)?;
  mpv.observe_property(10, "eof-reached", mpv_format::MPV_FORMAT_FLAG)?;

  // Load the file.
  mpv.command(&["loadfile", &payload.path, "replace"])?;

  let mpv = Arc::new(mpv);
  let player_state = Arc::new(Mutex::new(PlayerState {
    loading: true,
    ipc_healthy: true,
    sub_visible: true,
    sid: -1,
    aid: -1,
    ..Default::default()
  }));
  let _ = app.emit("player2-event", PlayerEvent::State(player_state.lock().unwrap().clone()));

  let (cmd_tx, cmd_rx) = mpsc::channel::<PlayerCommand>();
  let stop = Arc::new(AtomicBool::new(false));
  let video_hwnd = Arc::new(Mutex::new(None::<usize>));

  // Event + command loop.
  let event_join = {
    let app_ev = app.clone();
    let mpv_ev = Arc::clone(&mpv);
    let stop_ev = Arc::clone(&stop);
    let state_ev = Arc::clone(&player_state);
    let mut tracks_fetched = false;
    let mut passthrough_confirmed = false;
    thread::spawn(move || {
      loop {
        if stop_ev.load(Ordering::SeqCst) {
          break;
        }
        let ev_ptr = unsafe { (mpv_ev.api_arc().mpv_wait_event)(mpv_ev.raw_handle(), 0.1) };
        if !ev_ptr.is_null() {
          let ev = unsafe { &*ev_ptr };
          if ev.event_id == MPV_EVENT_SHUTDOWN {
            break;
          } else if ev.event_id == MPV_EVENT_PROPERTY_CHANGE {
            let prop = unsafe { &*(ev.data as *const mpv_event_property) };
            if let Some(d) = parse_state_delta(prop) {
              let snap = {
                let mut st = match state_ev.lock() {
                  Ok(g) => g,
                  Err(_) => continue,
                };
                match d.name.as_str() {
                  "pause" if d.have_flag => {
                    st.paused = d.flag;
                    st.playing = !st.paused && !st.ended && st.duration > 0.1;
                    st.loading = false;
                  }
                  "time-pos" if d.have_num => {
                    st.time_pos = d.num;
                    st.time_pos_full = d.num;
                    st.loading = false;
                    if d.num > 0.05 && !tracks_fetched {
                      tracks_fetched = true;
                      fetch_and_emit_tracks(&mpv_ev, &app_ev);
                    }
                  }
                  "duration" if d.have_num => {
                    st.duration = d.num.max(0.0);
                  }
                  "volume" if d.have_num => {
                    st.volume = d.num;
                  }
                  "mute" if d.have_flag => {
                    st.mute = d.flag;
                  }
                  "sub-visibility" if d.have_flag => {
                    st.sub_visible = d.flag;
                  }
                  "sid" if d.have_int => {
                    st.sid = d.int_v;
                  }
                  "aid" if d.have_int => {
                    st.aid = d.int_v;
                  }
                  "sub-delay" if d.have_num => {
                    st.sub_delay = d.num;
                  }
                  "eof-reached" if d.have_flag && d.flag => {
                    st.ended = true;
                    st.paused = true;
                    st.playing = false;
                    st.loading = false;
                  }
                  _ => {}
                }
                st.clone()
              };
              let _ = app_ev.emit("player2-event", PlayerEvent::State(snap));
            }
          } else if ev.event_id == MPV_EVENT_LOG_MESSAGE && !passthrough_confirmed {
            // Only subscribed when Audio Passthrough is on (see mpv_request_log_messages call
            // above) — confirms `audio-spdif` actually engaged, for the PASSTHROUGH/PCM badge.
            let msg = unsafe { &*(ev.data as *const mpv_event_log_message) };
            if !msg.text.is_null() {
              let text = unsafe { CStr::from_ptr(msg.text) }.to_string_lossy();
              if text.contains("audio-spdif") {
                passthrough_confirmed = true;
                let _ = app_ev.emit(
                  "player2-event",
                  PlayerEvent::AudioPassthroughStatus { active: true },
                );
              }
            }
          } else if ev.event_id != MPV_EVENT_NONE {
            // ignored
          }
        }

        // Drain commands.
        while let Ok(cmd) = cmd_rx.try_recv() {
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
            PlayerCommand::SeekRelative { seconds, exact } => {
              // "exact" forces a precise decode-to-position seek instead of mpv's
              // default keyframe-snapping, which on long-GOP 10-bit HEVC rips can
              // overshoot a "5 second" nudge by several seconds. Caller decides.
              let precision = if exact { "exact" } else { "keyframes" };
              let _ = mpv_ev.command(&["seek", &format!("{seconds}"), "relative", precision]);
            }
            PlayerCommand::SeekAbsolute(s) => {
              let _ = mpv_ev.command(&["seek", &format!("{s}"), "absolute", "exact"]);
            }
            PlayerCommand::SetVolume(v) => {
              let _ = mpv_ev.command(&["set", "volume", &format!("{v}")]);
            }
            PlayerCommand::SetMute(v) => {
              let _ = mpv_ev.command(&["set", "mute", if v { "yes" } else { "no" }]);
            }
            PlayerCommand::SetSpeed(v) => {
              let _ = mpv_ev.command(&["set", "speed", &format!("{v}")]);
            }
            PlayerCommand::SetSubVisibility(v) => {
              let _ = mpv_ev.command(&["set", "sub-visibility", if v { "yes" } else { "no" }]);
            }
            PlayerCommand::SetSid(id) => {
              let val = if id < 0 { "no".to_string() } else { id.to_string() };
              let _ = mpv_ev.command(&["set", "sid", &val]);
            }
            PlayerCommand::SetAid(id) => {
              let val = if id < 0 { "no".to_string() } else { id.to_string() };
              let _ = mpv_ev.command(&["set", "aid", &val]);
            }
            PlayerCommand::AddSubDelay(s) => {
              let _ = mpv_ev.command(&["add", "sub-delay", &format!("{s}")]);
            }
            PlayerCommand::SetSubFontSize(v) => {
              let _ = mpv_ev.command(&["set", "sub-font-size", &format!("{v}")]);
            }
            PlayerCommand::SetSubColor(c) => {
              let _ = mpv_ev.command(&["set", "sub-color", &c]);
            }
            PlayerCommand::SetSubBorderColor(c) => {
              let _ = mpv_ev.command(&["set", "sub-border-color", &c]);
            }
            PlayerCommand::SetSubBorderSize(v) => {
              let _ = mpv_ev.command(&["set", "sub-border-size", &format!("{v}")]);
            }
            PlayerCommand::SetSubBackColor(c) => {
              let _ = mpv_ev.command(&["set", "sub-back-color", &c]);
            }
            PlayerCommand::SetSubShadowColor(c) => {
              let _ = mpv_ev.command(&["set", "sub-shadow-color", &c]);
            }
            PlayerCommand::SetSubShadowOffset(v) => {
              let _ = mpv_ev.command(&["set", "sub-shadow-offset", &format!("{v}")]);
            }
            PlayerCommand::SetSubPosition(v) => {
              let _ = mpv_ev.command(&["set", "sub-pos", &format!("{v}")]);
            }
            PlayerCommand::SetSubFont(f) => {
              let _ = mpv_ev.command(&["set", "sub-font", &f]);
            }
            PlayerCommand::SubAddSelect(path) => {
              let _ = mpv_ev.command(&["sub-add", &path, "select"]);
            }
            PlayerCommand::Stop => {
              let _ = mpv_ev.command(&["quit"]);
            }
          }
        }
      }
    })
  };

  let session = LibMpvSession {
    session_id,
    parent_hwnd: main_hwnd.0 as usize,
    state: player_state,
    cmd_tx,
    stop,
    event_join: Mutex::new(Some(event_join)),
    mpv,
    video_hwnd,
  };
  *state.0.lock().map_err(|_| "libmpv host poisoned")? = Some(session);

  install_main_input_bridge(app.clone(), main_hwnd);

  Ok(())
}

#[tauri::command]
pub fn player2_libmpv_send(
  state: State<'_, LibMpvHostState>,
  cmd: PlayerCommand,
) -> Result<(), String> {
  let g = state.0.lock().map_err(|_| "libmpv host poisoned")?;
  let Some(session) = g.as_ref() else {
    return Err("No active libmpv session".to_string());
  };
  session.cmd_tx.send(cmd).map_err(|e| e.to_string())
}

/// Find mpv's auto-created child window under the main HWND. mpv assigns class
/// `mpv` (sometimes empty with a title containing the app name).
fn enumerate_mpv_child(parent: HWND) -> Option<HWND> {
  struct EnumState {
    found: Option<HWND>,
  }
  let mut st = EnumState { found: None };
  let ptr = &mut st as *mut EnumState;
  unsafe extern "system" fn cb(hwnd: HWND, lparam: LPARAM) -> BOOL {
    let mut class_buf = [0u16; 256];
    let n = GetClassNameW(hwnd, &mut class_buf);
    let class = String::from_utf16_lossy(&class_buf[..n as usize]);
    if class == "mpv" || class.starts_with("mpv ") {
      let s = lparam.0 as *mut EnumState;
      (*s).found = Some(hwnd);
      return BOOL(0);
    }
    BOOL(1)
  }
  unsafe {
    let _ = EnumChildWindows(Some(parent), Some(cb), LPARAM(ptr as isize));
  }
  st.found
}

#[tauri::command]
pub fn player2_libmpv_set_bounds(
  app: AppHandle,
  state: State<'_, LibMpvHostState>,
  x: i32,
  y: i32,
  width: i32,
  height: i32,
) -> Result<(), String> {
  if width <= 0 || height <= 0 {
    return Ok(());
  }
  let parent_hwnd_usize = {
    let g = state.0.lock().map_err(|_| "libmpv host poisoned")?;
    let Some(session) = g.as_ref() else {
      return Ok(());
    };
    session.parent_hwnd
  };
  let cached_video_hwnd = {
    let g = state.0.lock().map_err(|_| "libmpv host poisoned")?;
    g.as_ref().and_then(|s| *s.video_hwnd.lock().unwrap())
  };

  // Run all Win32 window operations on the UI thread (parent affinity).
  let app_clone = app.clone();
  let state_arc: Arc<Mutex<Option<LibMpvSession>>> = {
    // We don't have the State<> here cheaply; instead clone the inner Arc via app.state.
    let s: State<'_, LibMpvHostState> = app.state();
    // SAFETY: LibMpvHostState stores a Mutex; reuse its address via raw pointer wrap.
    // Tauri State<> can't be sent across threads, so capture by closure on main thread.
    let _ = s;
    Arc::new(Mutex::new(None))
  };
  let _ = state_arc; // unused (we use the per-thread State on main below)

  // Dispatch all Win32 calls to the main thread.
  app
    .run_on_main_thread(move || {
      let parent_hwnd = HWND(parent_hwnd_usize as *mut _);
      let (mut x, mut y, mut w, mut h) = (
        logical_px_to_physical(parent_hwnd, x),
        logical_px_to_physical(parent_hwnd, y),
        logical_px_to_physical(parent_hwnd, width),
        logical_px_to_physical(parent_hwnd, height),
      );
      // Clamp to parent client rect.
      unsafe {
        let mut rc = RECT::default();
        if GetClientRect(parent_hwnd, &mut rc).is_ok() {
          let cw = rc.right.max(1);
          let ch = rc.bottom.max(1);
          if x < 0 {
            w += x;
            x = 0;
          }
          if y < 0 {
            h += y;
            y = 0;
          }
          if x + w > cw {
            w = cw - x;
          }
          if y + h > ch {
            h = ch - y;
          }
        }
      }
      if w <= 0 || h <= 0 {
        return;
      }
      let video_hwnd = match cached_video_hwnd {
        Some(h) => HWND(h as *mut _),
        None => match enumerate_mpv_child(parent_hwnd) {
          Some(hh) => {
            append_player_debug_log(
              Some(&app_clone),
              &format!("[libmpv-session] found mpv child hwnd=0x{:x}", hh.0 as usize),
            );
            // Cache + subclass + transparent NC hit-testing.
            let s: State<'_, LibMpvHostState> = app_clone.state();
            if let Ok(g) = s.0.lock() {
              if let Some(sess) = g.as_ref() {
                *sess.video_hwnd.lock().unwrap() = Some(hh.0 as usize);
              }
            }
            unsafe {
              let cur_ex = GetWindowLongW(hh, GWL_EXSTYLE);
              let want_ex = cur_ex | WS_EX_TRANSPARENT.0 as i32;
              if cur_ex != want_ex {
                SetWindowLongW(hh, GWL_EXSTYLE, want_ex);
              }
              let _ = SetWindowSubclass(
                hh,
                Some(mpv_subclass_proc),
                HARBOR_MPV_SUBCLASS_ID,
                0,
              );
            }
            hh
          }
          None => {
            append_player_debug_log(
              Some(&app_clone),
              "[libmpv-session] set_bounds: mpv child not yet present — will retry on next bounds call",
            );
            return;
          }
        },
      };
      unsafe {
        let _ = SetWindowPos(
          video_hwnd,
          Some(HWND_BOTTOM),
          x,
          y,
          w,
          h,
          SWP_NOACTIVATE | SWP_SHOWWINDOW | SWP_NOCOPYBITS,
        );
        let _ = windows::Win32::Graphics::Gdi::InvalidateRect(Some(video_hwnd), None, false);
      }
      update_video_hit_rect(parent_hwnd, x, y, w, h);
      // Throttled log so we see at least one confirmation per session without spamming.
      static SEEN_FIRST: std::sync::atomic::AtomicBool = std::sync::atomic::AtomicBool::new(false);
      if !SEEN_FIRST.swap(true, std::sync::atomic::Ordering::SeqCst) {
        append_player_debug_log(
          Some(&app_clone),
          &format!(
            "[libmpv-session] set_bounds applied hwnd=0x{:x} x={x} y={y} w={w} h={h} (HWND_TOP)",
            video_hwnd.0 as usize
          ),
        );
      }
    })
    .map_err(|e| e.to_string())?;
  Ok(())
}

#[tauri::command]
pub fn player2_libmpv_close(
  app: AppHandle,
  state: State<'_, LibMpvHostState>,
) -> Result<(), String> {
  let session_opt = {
    let mut g = state.0.lock().map_err(|_| "libmpv host poisoned")?;
    g.take()
  };
  let Some(session) = session_opt else {
    return Ok(());
  };
  let video_hwnd = *session.video_hwnd.lock().unwrap();
  session.stop.store(true, Ordering::SeqCst);
  // Send quit to mpv so it tears down its own child window cleanly.
  let _ = session.mpv.command(&["quit"]);
  if let Ok(mut g) = session.event_join.lock() {
    if let Some(h) = g.take() {
      let _ = h.join();
    }
  }
  if let Some(vh) = video_hwnd {
    let _ = app.run_on_main_thread(move || unsafe {
      let hwnd = HWND(vh as *mut _);
      let _ = RemoveWindowSubclass(hwnd, Some(mpv_subclass_proc), HARBOR_MPV_SUBCLASS_ID);
    });
  }
  if let Some(main) = app.get_webview_window("main") {
    if let Ok(main_hwnd) = main.hwnd() {
      uninstall_main_input_bridge(main_hwnd);
    }
  }
  // Dropping `session` (with Arc<MpvClient>) triggers mpv_terminate_destroy.
  drop(session);
  Ok(())
}

// Silence unused warning for the c_int re-export above (kept for FFI parity).
#[allow(dead_code)]
const _UNUSED_FFI: c_int = 0;
