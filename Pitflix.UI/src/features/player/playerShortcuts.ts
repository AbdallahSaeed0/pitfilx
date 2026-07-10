export type PlayerShortcutRow = {
  label: string;
  keys: string;
};

export type PlayerShortcutSection = {
  title: string;
  rows: PlayerShortcutRow[];
};

/** Keyboard shortcuts for the embedded libmpv player (shown in the title/info popup). */
export const EMBEDDED_PLAYER_SHORTCUT_SECTIONS: PlayerShortcutSection[] = [
  {
    title: "Playback",
    rows: [
      { label: "Play / Pause", keys: "Space" },
      { label: "Seek ±5 seconds", keys: "← →" },
      { label: "Seek ±1 second", keys: "⇧← ⇧→" },
      { label: "Volume up / down", keys: "↑ ↓" },
      { label: "Mute", keys: "M" },
      { label: "Fullscreen", keys: "F" },
      { label: "Open menu (screenshot, clip, …)", keys: "Right-click" },
      { label: "Exit fullscreen / close player", keys: "Esc" },
    ],
  },
  {
    title: "Episodes",
    rows: [
      { label: "Next episode", keys: "⇧N" },
      { label: "Previous episode", keys: "⇧P" },
    ],
  },
  {
    title: "Subtitles",
    rows: [
      { label: "Toggle subtitles", keys: "S" },
      { label: "Search subtitles", keys: "⇧S" },
      { label: "Subtitle delay −0.1s", keys: "Z" },
      { label: "Subtitle delay +0.1s", keys: "X" },
      { label: "Move subtitles up", keys: "Alt ↑" },
      { label: "Move subtitles down", keys: "Alt ↓" },
      { label: "Subtitle size larger / smaller", keys: "Ctrl ↑ / Ctrl ↓" },
      { label: "Strong outline", keys: "Ctrl B" },
      { label: "Style: White", keys: "Ctrl 1" },
      { label: "Style: Warm", keys: "Ctrl 2" },
      { label: "Style: Cyan", keys: "Ctrl 3" },
      { label: "Style: Arabic high contrast", keys: "Ctrl 4" },
      { label: "Generate Arabic subtitle", keys: "Ctrl G" },
    ],
  },
];
