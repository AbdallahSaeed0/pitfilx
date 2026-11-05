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
    time::Duration,
};

use serde_json::Value;

use tauri::{AppHandle, Emitter, Manager, State};

use windows::core::BOOL;
use windows::Win32::{
    Foundation::{HWND, LPARAM, RECT},
    UI::HiDpi::GetDpiForWindow,
    UI::Shell::{DefSubclassProc, RemoveWindowSubclass, SetWindowSubclass},
    UI::WindowsAndMessaging::{
        EnumChildWindows, GetClassNameW, GetClientRect, GetWindowLongW, SetWindowLongW,
        SetWindowPos, GWL_EXSTYLE, HTTRANSPARENT, HWND_BOTTOM, SWP_NOACTIVATE,
        SWP_NOCOPYBITS, SWP_SHOWWINDOW, WM_NCHITTEST, WS_EX_TRANSPARENT,
    },
};

use super::commands::{PlayerCommand, PlayerOpen};
use super::events::{PlayerEvent, PlayerState, PlayerTrack, PlayerTracks};
use super::input_bridge::{
    install_main_input_bridge, uninstall_main_input_bridge, update_video_hit_rect,
};
use super::libmpv::{
    mpv_event_log_message, mpv_event_property, mpv_format, MpvClient, MPV_EVENT_LOG_MESSAGE,
    MPV_EVENT_NONE, MPV_EVENT_PLAYBACK_RESTART, MPV_EVENT_PROPERTY_CHANGE, MPV_EVENT_SHUTDOWN,
};
use super::quality_enhancement::{
    apply_audio_passthrough_options, apply_tonemap_sdr_options, apply_true_hdr_options,
    check_hdr_capability,
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
    /// The file path passed to `loadfile` at open time — lets other commands (e.g. device
    /// delete) tell whether this session is holding a given file open without an IPC round trip.
    pub current_path: String,
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

/// Loads libmpv (118 MB) a few seconds after launch on a background thread, so the first Play of a
/// session doesn't pay the cold DLL load (it used to be loaded lazily by that Play). Only the DLL is
/// loaded — identical to what the first Play did anyway, and it stays resident (SHARED_LIBMPV).
/// A throwaway headless core was tried here (2026-10-08) and every real session afterwards shut
/// itself down right after mpv_initialize, so don't create/destroy cores in here.
pub fn prewarm_libmpv(app: AppHandle) {
    thread::spawn(move || {
        thread::sleep(Duration::from_secs(4));
        let Some(dll) = find_libmpv_dll(&app) else { return };
        let started = std::time::Instant::now();
        let ok = super::libmpv::preload_shared_libmpv(&dll).is_ok();
        append_player_debug_log(
            Some(&app),
            &format!("[libmpv-prewarm] dll {} in {} ms", if ok { "loaded" } else { "failed" }, started.elapsed().as_millis()),
        );
    });
}

// A pre-initialized ("warm") core was tried again on 2026-10-10: the first session using it shut
// down 25 ms in, as did several early-opened sessions (9 self-shutdowns that day vs 0 on days without
// these experiments). Cores are only ever created inside player2_libmpv_open, from the player page.

/// Session-independent options (everything set before initialize except `start`, the HDR mode and
/// audio passthrough).
fn apply_base_options(mpv: &MpvClient, main_hwnd_i64: i64) -> Result<(), String> {
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
    Ok(())
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
            track_type: t
                .get("type")
                .and_then(|v| v.as_str())
                .map(|s| s.to_string()),
            lang: t
                .get("lang")
                .and_then(|v| v.as_str())
                .map(|s| s.to_string()),
            title: t
                .get("title")
                .and_then(|v| v.as_str())
                .map(|s| s.to_string()),
            selected: t.get("selected").and_then(|v| v.as_bool()),
            external_filename: t
                .get("external-filename")
                .and_then(|v| v.as_str())
                .map(|s| s.to_string()),
        })
        .collect();
    let _ = app.emit(
        "player2-event",
        PlayerEvent::Tracks(PlayerTracks { tracks }),
    );
}

/// Gain (dB) audio starts at when a file opens; ramped to 0 once playback runs. Was -45 dB over
/// 1.2 s, paired with the (since removed) intro card — it kept the first ~half second near-silent,
/// so opening felt ~2 s long. Now just enough to avoid a click when sound starts.
const AUDIO_FADE_START_DB: f64 = -24.0;
const AUDIO_FADE_MS: u64 = 200;
const AUDIO_FADE_STEPS: u64 = 8;

/// Ramps `volume-gain` from AUDIO_FADE_START_DB to 0 dB (linear in dB ≈ perceptually even) on a
/// short-lived thread. Always lands on exactly 0 so audio can never stay quiet.
fn start_audio_fade_in(mpv: Arc<MpvClient>) {
    thread::spawn(move || {
        let step = Duration::from_millis(AUDIO_FADE_MS / AUDIO_FADE_STEPS);
        for i in 1..AUDIO_FADE_STEPS {
            let t = i as f64 / AUDIO_FADE_STEPS as f64;
            let db = AUDIO_FADE_START_DB * (1.0 - t);
            if mpv.command(&["set", "volume-gain", &format!("{db:.2}")]).is_err() {
                break; // session closed
            }
            thread::sleep(step);
        }
        let _ = mpv.command(&["set", "volume-gain", "0"]);
    });
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
    let name = unsafe { std::ffi::CStr::from_ptr(prop.name) }
        .to_string_lossy()
        .into_owned();
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
    close_session_blocking(&app, true)?;

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

    // Opt-in playback quality features (HDR + audio passthrough) — additive only, off by
    // default. See `quality_enhancement.rs`. Does not alter the base options.
    let hdr_mode = payload.hdr_mode.as_deref().unwrap_or("auto");
    let wants_true_hdr = hdr_mode == "true_hdr" && check_hdr_capability().true_hdr_available;
    let wants_passthrough = payload.audio_passthrough.unwrap_or(false);
    let start = payload.start_seconds.filter(|s| s.is_finite() && *s > 0.0);

    // Create + configure mpv handle (Harbor-style options).
    let mpv = MpvClient::create_minimal(&dll)?;
    // mpv's own warnings/errors go to the player debug log — subscribed before initialize so a core
    // that dies during startup leaves its reason behind (not just "shut down on its own").
    let _ = mpv.request_log_messages("warn");
    apply_base_options(&mpv, main_hwnd_i64)?;
    if let Some(s) = start {
        mpv.set_option_string("start", &format!("{s}"))?;
    }
    if wants_true_hdr {
        apply_true_hdr_options(|k, v| mpv.set_option_string(k, v))?;
    } else {
        apply_tonemap_sdr_options(|k, v| mpv.set_option_string(k, v))?;
    }
    if wants_passthrough {
        apply_audio_passthrough_options(|k, v| mpv.set_option_string(k, v))?;
    }
    mpv.initialize()?;
    append_player_debug_log(Some(&app), "[libmpv-session] mpv_initialize ok");

    // Audio Passthrough needs verbose messages to confirm `audio-spdif` engaged (PASSTHROUGH/PCM
    // badge, see quality_enhancement.rs); warnings are subscribed before initialize (above).
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
    // Dual subtitles: best-effort — older libmpv builds without the property just never report it.
    let _ = mpv.observe_property(11, "secondary-sid", mpv_format::MPV_FORMAT_INT64);

    // Audio fade-in: start quiet (volume-gain, separate from the user's `volume`) and ramp up once
    // playback actually starts — see start_audio_fade_in. Set before loadfile so the first audio
    // frames are already quiet; the UI's intro overlay crossfades the picture at the same time.
    let _ = mpv.command(&["set", "volume-gain", &format!("{AUDIO_FADE_START_DB}")]);

    // Resuming: start at the keyframe before the resume point instead of decoding forward to the
    // exact frame (mpv.conf has hr-seek=yes, no framedrop) — on long-GOP HEVC that forward decode
    // was most of the ~0.8 s between mpv being ready and the first frame. Set here, after
    // mpv_initialize loaded the config, and back to "yes" once playback starts (time-pos handler);
    // every user seek passes an explicit exact/keyframes flag, so only this first jump changes.
    let resuming = payload.start_seconds.is_some_and(|s| s.is_finite() && s > 0.0);
    if resuming {
        let _ = mpv.command(&["set", "hr-seek", "no"]);
    }

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
    let _ = app.emit(
        "player2-event",
        PlayerEvent::State(player_state.lock().unwrap().clone()),
    );

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
                        // Exiting this loop drops cmd_rx, so every later player2_libmpv_send fails
                        // with "sending on a closed channel" — log it, or that error is all that's
                        // left to explain why the session died.
                        if !stop_ev.load(Ordering::SeqCst) {
                            append_player_debug_log(
                                Some(&app_ev),
                                &format!(
                                    "[libmpv-session] session_id={session_id} mpv core shut down on its own (not via close)"
                                ),
                            );
                        }
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
                                            // Undo the keyframe-only start used for resuming.
                                            let _ = mpv_ev.command(&["set", "hr-seek", "yes"]);
                                            fetch_and_emit_tracks(&mpv_ev, &app_ev);
                                            start_audio_fade_in(Arc::clone(&mpv_ev));
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
                                    // "no" doesn't convert to INT64, so a value-less change means off.
                                    "secondary-sid" => {
                                        st.secondary_sid = if d.have_int { d.int_v } else { -1 };
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
                    } else if ev.event_id == MPV_EVENT_PLAYBACK_RESTART {
                        // Seek landed: read the real position now rather than waiting for the next
                        // time-pos change, so the skip readout can show exactly where mpv ended up.
                        let landed = mpv_ev.get_property_double("time-pos").ok();
                        let snap = {
                            let mut st = match state_ev.lock() {
                                Ok(g) => g,
                                Err(_) => continue,
                            };
                            if let Some(t) = landed {
                                st.time_pos = t;
                                st.time_pos_full = t;
                            }
                            st.seek_seq = st.seek_seq.wrapping_add(1);
                            st.clone()
                        };
                        let _ = app_ev.emit("player2-event", PlayerEvent::State(snap));
                    } else if ev.event_id == MPV_EVENT_LOG_MESSAGE {
                        let msg = unsafe { &*(ev.data as *const mpv_event_log_message) };
                        if !msg.text.is_null() {
                            let text = unsafe { CStr::from_ptr(msg.text) }.to_string_lossy();
                            let level = if msg.level.is_null() { String::new() } else { unsafe { CStr::from_ptr(msg.level) }.to_string_lossy().into_owned() };
                            if matches!(level.as_str(), "warn" | "error" | "fatal") {
                                let prefix = if msg.prefix.is_null() { String::new() } else { unsafe { CStr::from_ptr(msg.prefix) }.to_string_lossy().into_owned() };
                                append_player_debug_log(
                                    Some(&app_ev),
                                    &format!("[mpv/{level}] session_id={session_id} {prefix}: {}", text.trim_end()),
                                );
                            }
                            // Audio Passthrough: confirm `audio-spdif` actually engaged (PASSTHROUGH/PCM badge).
                            if !passthrough_confirmed && text.contains("audio-spdif") {
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
                            let _ = mpv_ev.command(&[
                                "seek",
                                &format!("{seconds}"),
                                "relative",
                                precision,
                            ]);
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
                        PlayerCommand::SetAbLoop { a, b } => {
                            let fmt = |v: Option<f64>| v.map_or_else(|| "no".to_string(), |s| format!("{s}"));
                            let _ = mpv_ev.command(&["set", "ab-loop-a", &fmt(a)]);
                            let _ = mpv_ev.command(&["set", "ab-loop-b", &fmt(b)]);
                        }
                        PlayerCommand::SetSubVisibility(v) => {
                            let _ = mpv_ev.command(&[
                                "set",
                                "sub-visibility",
                                if v { "yes" } else { "no" },
                            ]);
                        }
                        PlayerCommand::SetSid(id) => {
                            let val = if id < 0 {
                                "no".to_string()
                            } else {
                                id.to_string()
                            };
                            let _ = mpv_ev.command(&["set", "sid", &val]);
                        }
                        PlayerCommand::SetAid(id) => {
                            let val = if id < 0 {
                                "no".to_string()
                            } else {
                                id.to_string()
                            };
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
                            // The track list is otherwise only fetched once at startup.
                            fetch_and_emit_tracks(&mpv_ev, &app_ev);
                        }
                        PlayerCommand::SubAdd(path) => {
                            let _ = mpv_ev.command(&["sub-add", &path, "auto"]);
                            fetch_and_emit_tracks(&mpv_ev, &app_ev);
                        }
                        PlayerCommand::RefreshTracks => {
                            fetch_and_emit_tracks(&mpv_ev, &app_ev);
                        }
                        PlayerCommand::SetVolumeGain(db) => {
                            let _ = mpv_ev.command(&["set", "volume-gain", &format!("{db}")]);
                        }
                        PlayerCommand::SetSecondarySid(id) => {
                            let val = if id < 0 {
                                "no".to_string()
                            } else {
                                id.to_string()
                            };
                            let _ = mpv_ev.command(&["set", "secondary-sid", &val]);
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
        current_path: payload.path.clone(),
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
    // A closed channel means the event/command thread already exited (mpv core shut down) while
    // the session is still registered. The frontend matches on this exact text to reopen the file
    // automatically, so keep it in sync with LIBMPV_SESSION_ENDED in PlayerPage.tsx.
    session
        .cmd_tx
        .send(cmd)
        .map_err(|_| "libmpv session ended unexpectedly".to_string())
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
    // Accepted for signature parity with player2_set_video_bounds (the frontend calls whichever
    // command name p2cmd() routes to with the same argument set) — this backend path has no
    // overlay-restack step to skip, so it's unused here.
    #[allow(unused_variables)] skip_overlay_refresh: bool,
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

/// Held from the moment a session is taken out of its slot until mpv has fully exited and released
/// the file, so `release_any_player_lock_on_paths` (device move/delete) can still wait for "really
/// closed" now that teardown no longer holds the session lock.
pub static TEARDOWN_GATE: std::sync::Mutex<()> = std::sync::Mutex::new(());

/// Closing the player. Async so it runs on a worker thread: the old synchronous command ran on the
/// main UI thread and held it through mpv's whole teardown — including destroying the video window
/// embedded in the main window, whose messages need that same (blocked) thread — so the app froze
/// for ~2-3 s on every close (the shrink-back animation and the page behind it stopped drawing).
#[tauri::command]
pub async fn player2_libmpv_close(app: AppHandle) -> Result<(), String> {
    let a = app.clone();
    tauri::async_runtime::spawn_blocking(move || close_session_blocking(&a, false))
        .await
        .map_err(|e| e.to_string())?
}

/// Tears down the current session. `on_main_thread`: the caller is already on the UI thread (open,
/// app exit), so window-hook removal runs inline instead of being dispatched and awaited.
pub fn close_session_blocking(app: &AppHandle, on_main_thread: bool) -> Result<(), String> {
    let _teardown = TEARDOWN_GATE.lock().map_err(|_| "teardown gate poisoned")?;
    // Take the session out and release the host lock right away — a new open must never wait on
    // (or deadlock with) this teardown.
    let session = {
        let state: State<'_, LibMpvHostState> = app.state();
        let mut guard = state.0.lock().map_err(|_| "libmpv host poisoned")?;
        guard.take()
    };
    let Some(session) = session else {
        return Ok(());
    };
    let video_hwnd = *session.video_hwnd.lock().unwrap();
    session.stop.store(true, Ordering::SeqCst);

    // Window subclass / input-bridge removal must happen on the UI thread that owns the windows.
    // Done FIRST (and waited for) so it can't land after the next open has installed its own bridge.
    let main_hwnd = app.get_webview_window("main").and_then(|m| m.hwnd().ok()).map(|h| h.0 as isize);
    let unhook = move || unsafe {
        if let Some(vh) = video_hwnd {
            let _ = RemoveWindowSubclass(HWND(vh as *mut _), Some(mpv_subclass_proc), HARBOR_MPV_SUBCLASS_ID);
        }
        if let Some(mh) = main_hwnd {
            uninstall_main_input_bridge(HWND(mh as *mut _));
        }
    };
    if on_main_thread {
        unhook();
    } else {
        let (tx, rx) = mpsc::channel();
        if app
            .run_on_main_thread(move || {
                unhook();
                let _ = tx.send(());
            })
            .is_ok()
        {
            // Bounded: never let a busy UI thread stall the teardown indefinitely.
            let _ = rx.recv_timeout(Duration::from_secs(1));
        }
    }

    // Send quit to mpv so it tears down its own child window cleanly, then stop the event loop.
    let _ = session.mpv.command(&["quit"]);
    if let Ok(mut g) = session.event_join.lock() {
        if let Some(h) = g.take() {
            let _ = h.join();
        }
    }
    // Dropping (with Arc<MpvClient>) triggers mpv_terminate_destroy, releasing the file handle —
    // still inside TEARDOWN_GATE, so nothing observes "closed" before teardown genuinely finished.
    drop(session);
    Ok(())
}

// Silence unused warning for the c_int re-export above (kept for FFI parity).
#[allow(dead_code)]
const _UNUSED_FFI: c_int = 0;
