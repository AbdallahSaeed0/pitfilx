use serde::{Deserialize, Serialize};

#[derive(Debug, Clone, Deserialize)]
pub struct PlayerOpen {
  pub path: String,
  #[serde(default)]
  pub start_seconds: Option<f64>,
  /// Opt-in playback quality settings (embedded/libmpv path only). `hdr_mode`: "auto" | "true_hdr" |
  /// "tonemap_sdr". Both default to the safe/off behavior when absent, so existing callers are unaffected.
  #[serde(default)]
  pub hdr_mode: Option<String>,
  #[serde(default)]
  pub audio_passthrough: Option<bool>,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(tag = "type", content = "payload")]
pub enum PlayerCommand {
  Play,
  Pause,
  SetPaused(bool),
  /// `exact` trades speed for precision: mpv's default keyframe-snapping seek is fast but
  /// can overshoot on long-GOP footage (10-bit HEVC especially); `exact` decodes forward to
  /// land on the precise frame, at the cost of a visible pause. Callers pick per use case —
  /// e.g. coarse skip-5s wants speed, fine 1s nudges want precision.
  SeekRelative { seconds: f64, exact: bool },
  SeekAbsolute(f64),
  SetMute(bool),
  SetVolume(f64),
  SetSubVisibility(bool),
  SetSid(i64),
  SetAid(i64),
  /// Seconds; mpv `add sub-delay`.
  AddSubDelay(f64),
  /// mpv `set_property sub-font-size`.
  SetSubFontSize(f64),
  /// mpv `set_property sub-color` (`#RRGGBB` or `#RRGGBBAA`).
  SetSubColor(String),
  /// mpv `set_property sub-border-color`.
  SetSubBorderColor(String),
  /// mpv `set_property sub-border-size`.
  SetSubBorderSize(f64),
  /// mpv `set_property sub-back-color`.
  SetSubBackColor(String),
  /// mpv `set_property sub-shadow-color`.
  SetSubShadowColor(String),
  /// mpv `set_property sub-shadow-offset`.
  SetSubShadowOffset(f64),
  /// mpv `set_property sub-pos` (0-100).
  SetSubPosition(f64),
  /// mpv `set_property sub-font`.
  SetSubFont(String),
  /// Load external subtitle file and select it (`sub-add … select`).
  SubAddSelect(String),
  /// mpv `set_property speed` (0.25 – 4.0).
  SetSpeed(f64),
  Stop,
}

