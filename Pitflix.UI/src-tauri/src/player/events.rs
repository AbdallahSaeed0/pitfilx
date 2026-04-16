use serde::Serialize;

#[derive(Debug, Clone, Serialize)]
#[serde(tag = "type", content = "payload")]
pub enum PlayerEvent {
  State(PlayerState),
  Tracks(PlayerTracks),
  Error { message: String },
}

/// Last correlated pause/resume IPC verification (external mpv — `get_property` is authoritative).
#[derive(Debug, Clone, Serialize, Default)]
pub struct PauseIpcVerifySnapshot {
  /// Exact JSON sent for last pause attempt: `["set_property","pause", true]`.
  pub last_pause_command_sent_json: Option<String>,
  /// Exact JSON sent for last resume attempt: `["set_property","pause", false]`.
  pub last_resume_command_sent_json: Option<String>,
  pub last_get_property_pause_request_id: Option<u64>,
  /// Full JSON line of the `get_property` `pause` reply (authoritative).
  pub last_get_property_pause_reply_json: Option<String>,
  /// Parsed `data` from the `get_property` `pause` reply used to commit state.
  pub last_confirmed_paused: Option<bool>,
  pub last_error: Option<String>,
  /// Last raw inbound JSON line from mpv IPC (truncated).
  pub last_inbound_ipc_line_json: Option<String>,
  pub last_inbound_request_id_seen: Option<u64>,
  /// Result of last `request_id` waiter dispatch attempt in the read loop.
  pub last_waiter_dispatch_result: Option<String>,
}

/// Snapshot from the native Windows host for debugging (IPC mirror vs libmpv property query).
#[derive(Debug, Clone, Serialize)]
pub struct Player2NativeState {
  pub session_active: bool,
  /// `libmpv` (embedded) | `external_mpv` (detached) | `none` (idle)
  pub backend: String,
  /// Monotonic id assigned when a native session opens (debug).
  pub session_id: Option<u64>,
  pub video_hwnd: Option<u64>,
  /// Mutex copy: updated by external mpv’s IPC reader; **not** updated for libmpv (often stale).
  pub ipc_mirror: Option<PlayerState>,
  /// `mpv_get_property("pause")` when using libmpv — authoritative for whether core is paused.
  pub libmpv_pause_property: Option<bool>,
  pub libmpv_property_error: Option<String>,
  pub pause_verification: Option<PauseIpcVerifySnapshot>,
  /// Successful `SwapBuffers` after a completed libmpv GL frame (in-process render path).
  #[serde(default)]
  pub render_frame_count: u64,
  /// Last render-path failure (`glGetError`, `mpv_render_context_render`, `SwapBuffers`, etc.).
  #[serde(default)]
  pub last_render_error: Option<String>,
  /// Win32 thread id that created the video child / WGL context (libmpv embedded only).
  #[serde(default)]
  pub window_thread_id: Option<u32>,
}

#[derive(Debug, Clone, Serialize)]
pub struct PlayerState {
  pub loading: bool,
  pub playing: bool,
  pub paused: bool,
  /// mpv `core-idle` (true when playback is idle / not actively playing).
  pub core_idle: bool,
  pub ended: bool,
  /// False after a failed pause/resume confirm until session is recovered or reopened.
  pub ipc_healthy: bool,
  pub time_pos: f64,
  /// mpv `time-pos/full` (more precise time-pos; used as fallback resume detector).
  pub time_pos_full: f64,
  /// mpv `audio-pts/full` (preferred short-window resume detector).
  pub audio_pts_full: f64,
  pub duration: f64,
  pub mute: bool,
  pub volume: f64,
  pub sub_visible: bool,
  pub sid: i64,
  pub aid: i64,
  /// Seconds; mpv `sub-delay` (display sync offset).
  pub sub_delay: f64,
}

impl Default for PlayerState {
  fn default() -> Self {
    Self {
      loading: false,
      playing: false,
      paused: false,
      core_idle: false,
      ended: false,
      ipc_healthy: true,
      time_pos: 0.0,
      time_pos_full: 0.0,
      audio_pts_full: 0.0,
      duration: 0.0,
      mute: false,
      volume: 0.0,
      sub_visible: true,
      sid: -1,
      aid: -1,
      sub_delay: 0.0,
    }
  }
}

#[derive(Debug, Clone, Serialize, Default)]
pub struct PlayerTracks {
  pub tracks: Vec<PlayerTrack>,
}

#[derive(Debug, Clone, Serialize, Default)]
pub struct PlayerTrack {
  pub id: Option<i64>,
  pub track_type: Option<String>,
  pub lang: Option<String>,
  pub title: Option<String>,
  pub selected: Option<bool>,
}

