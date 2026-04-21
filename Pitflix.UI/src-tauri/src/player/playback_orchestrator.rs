//! Playback Orchestration Layer (POL): unified playback state, app-level events, resume, and next-episode signals.
//!
//! The UI should prefer `playback-pol-event` + `playback_pol_*` commands over raw mpv IPC shapes.
//! Engine snapshots come from [`super::events::PlayerState`] (mpv-derived); this module normalizes them.

use std::{
  collections::HashMap,
  fs,
  io,
  sync::atomic::{AtomicU64, Ordering},
  time::{Duration, Instant},
};

use serde::{Deserialize, Serialize};
use tauri::{AppHandle, Emitter, Manager};

use super::events::PlayerState;

static POL_EVENT_SEQ: AtomicU64 = AtomicU64::new(1);

#[derive(Debug, Clone, Copy, PartialEq, Eq, Serialize, Deserialize, Default)]
#[serde(rename_all = "snake_case")]
pub enum PlaybackPhase {
  #[default]
  Idle,
  Loading,
  Playing,
  Paused,
  Buffering,
  Ended,
  Error,
}

/// Externally-tagged JSON, variant keys camelCase (e.g. `{ "onPlay": null }`, `{ "onProgress": { ... } }`).
#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub enum PlaybackAppEvent {
  OnPlay,
  OnPause,
  OnProgress {
    current_time: f64,
    duration: f64,
    progress_pct: f64,
  },
  OnEnded,
  OnSeek {
    from: f64,
    to: f64,
  },
  OnBuffer {
    active: bool,
  },
  /// Fired once per session when wall-clock `remaining_seconds` is at or below the configured gate.
  OnNearEnd {
    progress_pct: f64,
    /// Gate used (seconds remaining), for debugging / UI.
    remaining_gate_seconds: f64,
    remaining_seconds: f64,
  },
}

#[derive(Debug, Clone, Serialize, Deserialize, Default)]
#[serde(rename_all = "camelCase")]
pub struct EpisodeRef {
  pub key: String,
  #[serde(default)]
  pub title: Option<String>,
  #[serde(default)]
  pub media_path: Option<String>,
  #[serde(default)]
  pub season: Option<i32>,
  #[serde(default)]
  pub episode_number: Option<i32>,
}

#[derive(Debug, Clone, Serialize, Deserialize, Default)]
#[serde(rename_all = "camelCase")]
pub struct ResumeHints {
  pub should_offer_resume: bool,
  pub resume_seconds: f64,
  pub reason: String,
}

#[derive(Debug, Clone, Serialize, Deserialize, Default)]
#[serde(rename_all = "camelCase")]
pub struct TimelineModel {
  /// Primary scrub / display head (seconds). Today equals engine `time_pos`; reserved for preview-thumb offsets later.
  pub logical_position: f64,
  pub window_start: f64,
  pub window_end: f64,
  /// `"engine_polled"` | `"seeking"` | `"unknown"`
  pub source: String,
}

#[derive(Debug, Clone, Serialize, Deserialize, Default)]
#[serde(rename_all = "camelCase")]
pub struct TransportFlags {
  pub ipc_healthy: bool,
  pub engine_paused: bool,
  pub engine_loading: bool,
  pub engine_ended: bool,
}

#[derive(Debug, Clone, Serialize, Deserialize, Default)]
#[serde(rename_all = "camelCase")]
pub struct SkipIntroSurface {
  #[serde(default)]
  pub windows: Vec<serde_json::Value>,
}

#[derive(Debug, Clone, Serialize, Deserialize, Default)]
#[serde(rename_all = "camelCase")]
pub struct AutoplaySurface {
  pub enabled: bool,
  pub countdown_visible: bool,
  #[serde(default)]
  pub seconds_remaining: Option<u32>,
}

#[derive(Debug, Clone, Serialize, Deserialize, Default)]
#[serde(rename_all = "camelCase")]
pub struct ExtensionSurface {
  #[serde(default)]
  pub thumbnail_timeline: Option<serde_json::Value>,
  #[serde(default)]
  pub skip_intro: Option<SkipIntroSurface>,
  #[serde(default)]
  pub autoplay_next: AutoplaySurface,
}

#[derive(Debug, Clone, Serialize, Deserialize, Default)]
#[serde(rename_all = "camelCase")]
pub struct NearEndModel {
  pub armed: bool,
  pub progress_pct: f64,
}

#[derive(Debug, Clone, Serialize, Deserialize, Default)]
#[serde(rename_all = "camelCase")]
pub struct PlaybackStoreSnapshot {
  pub phase: PlaybackPhase,
  pub current_time: f64,
  pub duration: f64,
  pub progress_pct: f64,
  pub is_playing: bool,
  pub is_buffering: bool,
  #[serde(default)]
  pub current_episode: Option<EpisodeRef>,
  #[serde(default)]
  pub next_episode: Option<EpisodeRef>,
  pub timeline: TimelineModel,
  #[serde(default)]
  pub resume: Option<ResumeHints>,
  pub transport: TransportFlags,
  pub extensions: ExtensionSurface,
  pub near_end: NearEndModel,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct PlaybackPolEventPayload {
  pub seq: u64,
  pub snapshot: PlaybackStoreSnapshot,
  pub events: Vec<PlaybackAppEvent>,
}

#[derive(Debug, Clone)]
pub struct PolConfig {
  pub progress_emit_min_interval_ms: u64,
  pub resume_min_seconds: f64,
  pub resume_max_progress_pct: f64,
  /// When wall-clock time left is at or below this (seconds), treat as near-end (overlay), not % of file length.
  pub near_end_remaining_seconds: f64,
  pub seek_jump_threshold_seconds: f64,
}

impl Default for PolConfig {
  fn default() -> Self {
    Self {
      progress_emit_min_interval_ms: 1500,
      resume_min_seconds: 30.0,
      resume_max_progress_pct: 95.0,
      // TEMP QA gate for companion overlay testing; revert to ~45s after UX validation.
      near_end_remaining_seconds: 120.0,
      seek_jump_threshold_seconds: 3.0,
    }
  }
}

struct LoadedSession {
  current: EpisodeRef,
  next: Option<EpisodeRef>,
  autoplay_next_enabled: bool,
  countdown_visible: bool,
  countdown_seconds_remaining: Option<u32>,
  user_dismissed_near_end: bool,
}

#[derive(Serialize, Deserialize, Default)]
struct ResumeDiskV1 {
  positions: HashMap<String, PersistedResume>,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
struct PersistedResume {
  seconds: f64,
  #[serde(default)]
  updated_unix_ms: u128,
  /// Last known file duration from the player (seconds), for resume hints after crash.
  #[serde(default, skip_serializing_if = "Option::is_none")]
  duration_seconds: Option<f64>,
  /// Correlates with Pitflix server `WatchHistories.Id` when the webview sends it.
  #[serde(default, skip_serializing_if = "Option::is_none")]
  history_id: Option<i32>,
}

pub struct PlaybackOrchestrator {
  config: PolConfig,
  session: Option<LoadedSession>,
  last_engine: PlayerState,
  last_engine_time_pos: f64,
  last_phase: PlaybackPhase,
  last_progress_emit: Option<Instant>,
  last_buffering: bool,
  near_end_emitted: bool,
  resume_disk: ResumeDiskV1,
  resume_path: Option<std::path::PathBuf>,
  extension_thumb: Option<serde_json::Value>,
  extension_skip_intro: SkipIntroSurface,
  /// Suppresses `playback-pol-event` spam when only quiet fields (e.g. time-pos) move.
  last_pol_broadcast: Option<Instant>,
}

impl Default for PlaybackOrchestrator {
  fn default() -> Self {
    Self {
      config: PolConfig::default(),
      session: None,
      last_engine: PlayerState::default(),
      last_engine_time_pos: 0.0,
      last_phase: PlaybackPhase::Idle,
      last_progress_emit: None,
      last_buffering: false,
      near_end_emitted: false,
      resume_disk: ResumeDiskV1::default(),
      resume_path: None,
      extension_thumb: None,
      extension_skip_intro: SkipIntroSurface::default(),
      last_pol_broadcast: None,
    }
  }
}

impl PlaybackOrchestrator {
  pub fn set_app_paths(&mut self, app: &AppHandle) {
    if let Ok(dir) = app.path().app_data_dir() {
      let pol_dir = dir.join("playback-pol");
      let _ = fs::create_dir_all(&pol_dir);
      self.resume_path = Some(pol_dir.join("resume-v1.json"));
      self.load_resume_disk();
    }
  }

  pub fn resume_store_ready(&self) -> bool {
    self.resume_path.is_some()
  }

  pub fn engine_time_and_duration(&self) -> (f64, f64) {
    (self.last_engine.time_pos, self.last_engine.duration)
  }

  fn load_resume_disk(&mut self) {
    let Some(path) = &self.resume_path else {
      return;
    };
    if let Ok(bytes) = fs::read(path) {
      if let Ok(v) = serde_json::from_slice::<ResumeDiskV1>(&bytes) {
        self.resume_disk = v;
      }
    }
  }

  fn save_resume_disk(&self) -> io::Result<()> {
    let Some(path) = &self.resume_path else {
      return Ok(());
    };
    if let Some(parent) = path.parent() {
      fs::create_dir_all(parent)?;
    }
    let bytes = serde_json::to_vec_pretty(&self.resume_disk)
      .map_err(|e| io::Error::new(io::ErrorKind::Other, e))?;
    fs::write(path, bytes)
  }

  pub fn resume_hints_for_episode(&self, key: &str) -> ResumeHints {
    let Some(entry) = self.resume_disk.positions.get(key) else {
      return ResumeHints {
        should_offer_resume: false,
        resume_seconds: 0.0,
        reason: "no_saved_position".into(),
      };
    };
    self.classify_resume(entry.seconds, entry.duration_seconds)
  }

  fn classify_resume(&self, seconds: f64, duration_hint: Option<f64>) -> ResumeHints {
    if !seconds.is_finite() || seconds < self.config.resume_min_seconds {
      return ResumeHints {
        should_offer_resume: false,
        resume_seconds: seconds.max(0.0),
        reason: "below_min_seconds".into(),
      };
    }
    if let Some(d) = duration_hint {
      if d.is_finite() && d > 1.0 {
        let pct = (seconds / d) * 100.0;
        if pct >= self.config.resume_max_progress_pct {
          return ResumeHints {
            should_offer_resume: false,
            resume_seconds: seconds,
            reason: "past_max_progress_pct".into(),
          };
        }
      }
    }
    ResumeHints {
      should_offer_resume: true,
      resume_seconds: seconds,
      reason: "eligible".into(),
    }
  }

  pub fn load_episode_context(
    &mut self,
    current: EpisodeRef,
    next: Option<EpisodeRef>,
    autoplay_next: bool,
  ) -> ResumeHints {
    self.near_end_emitted = false;
    self.last_engine_time_pos = 0.0;
    let hints = {
      let ent = self.resume_disk.positions.get(&current.key);
      let disk_sec = ent.map(|p| p.seconds).unwrap_or(0.0);
      let disk_dur = ent.and_then(|p| p.duration_seconds);
      self.classify_resume(disk_sec, disk_dur)
    };
    self.session = Some(LoadedSession {
      current,
      next,
      autoplay_next_enabled: autoplay_next,
      countdown_visible: false,
      countdown_seconds_remaining: None,
      user_dismissed_near_end: false,
    });
    hints
  }

  pub fn clear_session(&mut self) {
    self.session = None;
    self.near_end_emitted = false;
    self.last_phase = PlaybackPhase::Idle;
    self.last_engine_time_pos = 0.0;
    self.last_buffering = false;
  }

  pub fn set_next_autoplay_enabled(&mut self, enabled: bool) {
    if let Some(s) = &mut self.session {
      s.autoplay_next_enabled = enabled;
    }
  }

  pub fn cancel_next_countdown(&mut self) {
    if let Some(s) = &mut self.session {
      s.countdown_visible = false;
      s.countdown_seconds_remaining = None;
      s.user_dismissed_near_end = true;
    }
  }

  pub fn show_next_countdown(&mut self, seconds: u32) {
    if let Some(s) = &mut self.session {
      s.countdown_visible = true;
      s.countdown_seconds_remaining = Some(seconds);
    }
  }

  pub fn tick_countdown(&mut self) -> Option<u32> {
    let s = self.session.as_mut()?;
    if !s.countdown_visible {
      return None;
    }
    let rem = s.countdown_seconds_remaining.unwrap_or(0);
    let next = rem.saturating_sub(1);
    s.countdown_seconds_remaining = Some(next);
    Some(next)
  }

  pub fn persist_position_for_current(&mut self, time_pos: f64, duration: f64, history_id: Option<i32>) {
    let Some(sess) = &self.session else {
      return;
    };
    let key = sess.current.key.clone();
    let now_ms = std::time::SystemTime::now()
      .duration_since(std::time::UNIX_EPOCH)
      .map(|d| d.as_millis())
      .unwrap_or(0);
    let dur_opt = duration
      .is_finite()
      .then_some(duration.max(0.0))
      .filter(|d| *d > 0.5);
    let prev = self.resume_disk.positions.get(&key).cloned();
    let duration_seconds = dur_opt.or_else(|| prev.as_ref().and_then(|p| p.duration_seconds));
    let history_id = history_id.or_else(|| prev.as_ref().and_then(|p| p.history_id));
    self.resume_disk.positions.insert(
      key,
      PersistedResume {
        seconds: time_pos.max(0.0),
        updated_unix_ms: now_ms,
        duration_seconds,
        history_id,
      },
    );
    let _ = self.save_resume_disk();
  }

  pub fn snapshot_from_last_engine(&self) -> PlaybackStoreSnapshot {
    let has_session = self.session.is_some();
    let phase = Self::derive_phase(&self.last_engine, has_session);
    let dur = self.last_engine.duration.max(0.0);
    let t = self.last_engine.time_pos.max(0.0);
    let remaining = (dur - t).max(0.0);
    let near_armed = dur >= 60.0
      && remaining <= self.config.near_end_remaining_seconds
      && remaining > 0.25;
    self.build_snapshot(&self.last_engine, phase, near_armed, true)
  }

  fn derive_phase(engine: &PlayerState, has_session: bool) -> PlaybackPhase {
    if !has_session {
      return PlaybackPhase::Idle;
    }
    if !engine.ipc_healthy {
      return PlaybackPhase::Error;
    }
    if engine.ended {
      return PlaybackPhase::Ended;
    }
    if engine.loading {
      if engine.duration < 1.0 && engine.time_pos < 1.0 {
        return PlaybackPhase::Loading;
      }
      return PlaybackPhase::Buffering;
    }
    if engine.paused {
      return PlaybackPhase::Paused;
    }
    if engine.playing {
      return PlaybackPhase::Playing;
    }
    if engine.duration > 0.5 {
      return PlaybackPhase::Paused;
    }
    PlaybackPhase::Loading
  }

  fn progress_pct(time_pos: f64, duration: f64) -> f64 {
    if !duration.is_finite() || duration <= 0.01 {
      return 0.0;
    }
    ((time_pos / duration) * 100.0).clamp(0.0, 100.0)
  }

  fn build_snapshot(
    &self,
    engine: &PlayerState,
    phase: PlaybackPhase,
    near_armed: bool,
    include_resume_refresh: bool,
  ) -> PlaybackStoreSnapshot {
    let dur = engine.duration.max(0.0);
    let t = engine.time_pos.max(0.0);
    let pct = Self::progress_pct(t, dur);
    let timeline = TimelineModel {
      logical_position: t,
      window_start: 0.0,
      window_end: dur,
      source: "engine_polled".into(),
    };
    let (current_episode, next_episode, autoplay, countdown_visible, countdown_sec) = match &self.session {
      Some(s) => (
        Some(s.current.clone()),
        s.next.clone(),
        s.autoplay_next_enabled,
        s.countdown_visible,
        s.countdown_seconds_remaining,
      ),
      None => (None, None, false, false, None),
    };
    let resume = if include_resume_refresh {
      current_episode.as_ref().map(|c| {
        let disk_sec = self
          .resume_disk
          .positions
          .get(&c.key)
          .map(|p| p.seconds)
          .unwrap_or(0.0);
        let mut h = self.classify_resume(disk_sec, Some(dur));
        if dur > 1.0 {
          let live_pct = Self::progress_pct(t, dur);
          if live_pct >= self.config.resume_max_progress_pct {
            h.should_offer_resume = false;
            h.reason = "live_past_max_pct".into();
          }
        }
        h
      })
    } else {
      None
    };
    PlaybackStoreSnapshot {
      phase,
      current_time: t,
      duration: dur,
      progress_pct: pct,
      is_playing: phase == PlaybackPhase::Playing,
      is_buffering: phase == PlaybackPhase::Buffering,
      current_episode,
      next_episode,
      timeline,
      resume,
      transport: TransportFlags {
        ipc_healthy: engine.ipc_healthy,
        engine_paused: engine.paused,
        engine_loading: engine.loading,
        engine_ended: engine.ended,
      },
      extensions: ExtensionSurface {
        thumbnail_timeline: self.extension_thumb.clone(),
        skip_intro: if self.extension_skip_intro.windows.is_empty() {
          None
        } else {
          Some(self.extension_skip_intro.clone())
        },
        autoplay_next: AutoplaySurface {
          enabled: autoplay,
          countdown_visible,
          seconds_remaining: countdown_sec,
        },
      },
      near_end: NearEndModel {
        armed: near_armed,
        progress_pct: pct,
      },
    }
  }

  /// Apply an authoritative engine snapshot; optionally emit throttled `OnProgress` and edge events.
  pub fn apply_engine(
    &mut self,
    engine: &PlayerState,
    force_progress_event: bool,
  ) -> (PlaybackStoreSnapshot, Vec<PlaybackAppEvent>) {
    self.last_engine = engine.clone();
    let has_session = self.session.is_some();
    let phase = Self::derive_phase(engine, has_session);
    let mut events = Vec::new();

    if phase != self.last_phase {
      match phase {
        PlaybackPhase::Playing if matches!(self.last_phase, PlaybackPhase::Paused | PlaybackPhase::Buffering | PlaybackPhase::Loading) => {
          events.push(PlaybackAppEvent::OnPlay);
        }
        PlaybackPhase::Paused if self.last_phase == PlaybackPhase::Playing => {
          events.push(PlaybackAppEvent::OnPause);
        }
        PlaybackPhase::Ended if self.last_phase != PlaybackPhase::Ended => {
          events.push(PlaybackAppEvent::OnEnded);
        }
        _ => {}
      }
    }
    self.last_phase = phase;

    let buffering_now = phase == PlaybackPhase::Buffering;
    if buffering_now != self.last_buffering {
      events.push(PlaybackAppEvent::OnBuffer {
        active: buffering_now,
      });
      self.last_buffering = buffering_now;
    }

    let jump = (engine.time_pos - self.last_engine_time_pos).abs();
    if self.last_engine_time_pos > 0.01 && jump >= self.config.seek_jump_threshold_seconds {
      events.push(PlaybackAppEvent::OnSeek {
        from: self.last_engine_time_pos,
        to: engine.time_pos,
      });
    }
    self.last_engine_time_pos = engine.time_pos;

    let dur = engine.duration.max(0.0);
    let t = engine.time_pos.max(0.0);
    let pct = Self::progress_pct(t, dur);

    let remaining = (dur - t).max(0.0);
    let gate = self.config.near_end_remaining_seconds;
    let near_armed = dur >= 60.0 && remaining <= gate && remaining > 0.25;
    if near_armed && !self.near_end_emitted {
      if !self.session.as_ref().map(|s| s.user_dismissed_near_end).unwrap_or(false) {
        events.push(PlaybackAppEvent::OnNearEnd {
          progress_pct: pct,
          remaining_gate_seconds: gate,
          remaining_seconds: remaining,
        });
        self.near_end_emitted = true;
      }
    }

    let mut should_progress = force_progress_event;
    if !should_progress {
      let now = Instant::now();
      let interval = std::time::Duration::from_millis(self.config.progress_emit_min_interval_ms);
      should_progress = match self.last_progress_emit {
        None => true,
        Some(prev) => now.duration_since(prev) >= interval,
      };
    }
    if should_progress && has_session && dur > 0.5 {
      events.push(PlaybackAppEvent::OnProgress {
        current_time: t,
        duration: dur,
        progress_pct: pct,
      });
      self.last_progress_emit = Some(Instant::now());
    }

    let snap = self.build_snapshot(engine, phase, near_armed, false);
    (snap, events)
  }

  pub fn set_extension_thumbnail_timeline(&mut self, value: Option<serde_json::Value>) {
    self.extension_thumb = value;
  }

  pub fn set_extension_skip_intro_windows(&mut self, windows: Vec<serde_json::Value>) {
    self.extension_skip_intro = SkipIntroSurface { windows };
  }
}

pub struct PlaybackOrchestratorState(pub std::sync::Mutex<PlaybackOrchestrator>);

impl Default for PlaybackOrchestratorState {
  fn default() -> Self {
    Self(std::sync::Mutex::new(PlaybackOrchestrator::default()))
  }
}

#[derive(Debug, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct LoadEpisodePolRequest {
  pub current: EpisodeRef,
  #[serde(default)]
  pub next: Option<EpisodeRef>,
  #[serde(default = "default_autoplay_next")]
  pub autoplay_next: bool,
}

fn default_autoplay_next() -> bool {
  true
}

/// Called whenever the native host emits a coalesced `PlayerState` to the webview (same cadence as `player2-event` State).
pub fn notify_engine_state(app: &AppHandle, engine: &PlayerState) {
  let Some(pol) = app.try_state::<PlaybackOrchestratorState>() else {
    return;
  };
  let Ok(mut g) = pol.0.lock() else {
    return;
  };
  let (snapshot, events) = g.apply_engine(engine, false);
  let significant = !events.is_empty();
  if !significant {
    const QUIET: Duration = Duration::from_millis(1000);
    if let Some(prev) = g.last_pol_broadcast {
      if prev.elapsed() < QUIET {
        return;
      }
    }
  }
  g.last_pol_broadcast = Some(Instant::now());
  let seq = POL_EVENT_SEQ.fetch_add(1, Ordering::Relaxed);
  let payload = PlaybackPolEventPayload {
    seq,
    snapshot,
    events,
  };
  let _ = app.emit("playback-pol-event", &payload);
}

/// Optional: force a progress-style tick (e.g. after seek confirm) without waiting for the throttle window.
pub fn notify_engine_state_force_progress(app: &AppHandle, engine: &PlayerState) {
  let Some(pol) = app.try_state::<PlaybackOrchestratorState>() else {
    return;
  };
  let Ok(mut g) = pol.0.lock() else {
    return;
  };
  let (snapshot, events) = g.apply_engine(engine, true);
  g.last_pol_broadcast = Some(Instant::now());
  let seq = POL_EVENT_SEQ.fetch_add(1, Ordering::Relaxed);
  let payload = PlaybackPolEventPayload {
    seq,
    snapshot,
    events,
  };
  let _ = app.emit("playback-pol-event", &payload);
}

pub fn notify_session_closed(app: &AppHandle) {
  let Some(pol) = app.try_state::<PlaybackOrchestratorState>() else {
    return;
  };
  let Ok(mut g) = pol.0.lock() else {
    return;
  };
  g.clear_session();
  let (snapshot, events) = g.apply_engine(&PlayerState::default(), true);
  g.last_pol_broadcast = Some(Instant::now());
  let seq = POL_EVENT_SEQ.fetch_add(1, Ordering::Relaxed);
  let payload = PlaybackPolEventPayload {
    seq,
    snapshot,
    events,
  };
  let _ = app.emit("playback-pol-event", &payload);
}

/// Push the latest orchestration snapshot (no engine events) — e.g. after UI-driven session changes.
pub fn emit_snapshot_manual(app: &AppHandle) {
  let Some(pol) = app.try_state::<PlaybackOrchestratorState>() else {
    return;
  };
  let Ok(mut g) = pol.0.lock() else {
    return;
  };
  let snapshot = g.snapshot_from_last_engine();
  g.last_pol_broadcast = Some(Instant::now());
  let seq = POL_EVENT_SEQ.fetch_add(1, Ordering::Relaxed);
  let payload = PlaybackPolEventPayload {
    seq,
    snapshot,
    events: Vec::new(),
  };
  let _ = app.emit("playback-pol-event", &payload);
}
