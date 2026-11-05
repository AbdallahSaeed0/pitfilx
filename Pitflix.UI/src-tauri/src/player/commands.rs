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
    SeekRelative {
        seconds: f64,
        exact: bool,
    },
    SeekAbsolute(f64),
    SetMute(bool),
    SetVolume(f64),
    /// mpv `volume-gain` (dB, separate from `volume`) — used for the audio fade-in when playback
    /// starts, so the user's volume setting is never touched. 0 = neutral.
    SetVolumeGain(f64),
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
    /// Re-send the audio/subtitle track list. It's otherwise sent once, when playback first starts —
    /// a page that attached to an already-running session (earlyOpen.ts) may have missed it.
    RefreshTracks,
    /// Load external subtitle file WITHOUT selecting it (`sub-add … auto`) — used to bring a file in
    /// as the secondary subtitle; the UI then finds it in the track list and sends `SetSecondarySid`.
    SubAdd(String),
    /// mpv `secondary-sid` (dual subtitles: shown together with `sid`, at the top). Negative = off.
    SetSecondarySid(i64),
    /// mpv `set_property speed` (0.25 – 4.0).
    SetSpeed(f64),
    /// A-B loop: mpv `ab-loop-a` / `ab-loop-b` (seconds; `None` clears that point). mpv loops
    /// between them on its own once both are set.
    SetAbLoop { a: Option<f64>, b: Option<f64> },
    Stop,
}
