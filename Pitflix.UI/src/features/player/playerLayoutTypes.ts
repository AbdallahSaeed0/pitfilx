export type PlayerLayoutZone = "left" | "center" | "right";

export type PlayerControlSize = "compact" | "default" | "large";

export type PlayerLayoutControlId =
  | "prev"
  | "next"
  | "seekBack"
  | "playPause"
  | "seekForward"
  | "subtitles"
  | "volume"
  | "speed"
  | "devtools"
  | "audio"
  | "subDelay";

export type PlayerSeekBarThickness = "thin" | "default" | "thick";

export type PlayerSeekBarColor = "violet" | "emerald" | "white";

export type PlayerSeekBarPrefs = {
  visible: boolean;
  thickness: PlayerSeekBarThickness;
  color: PlayerSeekBarColor;
  thumbVisible: boolean;
  hoverPreviewVisible: boolean;
  currentTimeVisible: boolean;
  remainingTimeVisible: boolean;
  timeLabelSize: PlayerControlSize;
};

export type PlayerLayoutEditorSelectionId =
  | PlayerLayoutControlId
  | "seekBar"
  | "timeCurrent"
  | "timeRemaining";

export type PlayerLayoutPrefs = {
  controlSize: PlayerControlSize;
  /** Per-button scale multiplier (e.g. 0.85 = 85%). Falls back to 1 when unset. */
  controlScales: Partial<Record<PlayerLayoutControlId, number>>;
  controlSizes: Partial<Record<PlayerLayoutControlId, PlayerControlSize>>;
  zones: Record<PlayerLayoutControlId, PlayerLayoutZone>;
  visible: Record<PlayerLayoutControlId, boolean>;
  order: PlayerLayoutControlId[];
  seekBar: PlayerSeekBarPrefs;
};

export const PLAYER_LAYOUT_CONTROL_ORDER: PlayerLayoutControlId[] = [
  "volume",
  "prev",
  "seekBack",
  "playPause",
  "seekForward",
  "next",
  "subtitles",
  "speed",
  "audio",
  "subDelay",
  "devtools",
];

export const PLAYER_LAYOUT_CONTROL_LABELS: Record<PlayerLayoutControlId, string> = {
  prev: "Skip previous",
  next: "Skip next",
  seekBack: "Rewind 5 seconds",
  playPause: "Play / Pause",
  seekForward: "Forward 5 seconds",
  subtitles: "Subtitles (CC)",
  volume: "Volume",
  speed: "Playback speed",
  devtools: "Developer tools",
  audio: "Audio tracks",
  subDelay: "Subtitle delay",
};

export const PLAYER_LAYOUT_SELECTION_LABELS: Record<PlayerLayoutEditorSelectionId, string> = {
  ...PLAYER_LAYOUT_CONTROL_LABELS,
  seekBar: "Seek bar",
  timeCurrent: "Current time",
  timeRemaining: "Remaining time",
};

export const DEFAULT_SEEK_BAR_PREFS: PlayerSeekBarPrefs = {
  visible: true,
  thickness: "default",
  color: "violet",
  thumbVisible: true,
  hoverPreviewVisible: true,
  currentTimeVisible: true,
  remainingTimeVisible: true,
  timeLabelSize: "default",
};

export const DEFAULT_PLAYER_LAYOUT_PREFS: PlayerLayoutPrefs = {
  controlSize: "default",
  controlScales: {},
  controlSizes: {},
  zones: {
    volume: "left",
    prev: "center",
    seekBack: "center",
    playPause: "center",
    seekForward: "center",
    next: "center",
    subtitles: "right",
    speed: "right",
    devtools: "right",
    audio: "right",
    subDelay: "right",
  },
  visible: {
    prev: true,
    next: true,
    seekBack: true,
    playPause: true,
    seekForward: true,
    subtitles: true,
    volume: true,
    speed: true,
    devtools: true,
    audio: true,
    subDelay: true,
  },
  order: [...PLAYER_LAYOUT_CONTROL_ORDER],
  seekBar: { ...DEFAULT_SEEK_BAR_PREFS },
};

export function isLayoutControlId(id: PlayerLayoutEditorSelectionId): id is PlayerLayoutControlId {
  return id !== "seekBar" && id !== "timeCurrent" && id !== "timeRemaining";
}

/** @deprecated Legacy group alignment — used only when migrating saved prefs. */
export type PlayerControlAlignment = PlayerLayoutZone;
