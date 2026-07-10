import type { PlayerSeekBarColor, PlayerSeekBarPrefs, PlayerSeekBarThickness } from "./playerLayoutTypes";

export type SeekBarVisualStyle = {
  trackPx: number;
  hoverTrackPx: number;
  thumbPx: number;
  fillBackground: string;
  fillShadow: string;
  miniFillBackground: string;
};

const THICKNESS: Record<PlayerSeekBarThickness, { track: number; hover: number; thumb: number }> = {
  thin: { track: 2, hover: 4, thumb: 10 },
  default: { track: 3, hover: 6, thumb: 14 },
  thick: { track: 5, hover: 9, thumb: 18 },
};

const COLORS: Record<PlayerSeekBarColor, { fill: string; shadow: string; mini: string }> = {
  violet: {
    fill: "linear-gradient(90deg, #5b21b6 0%, #7c3aed 100%)",
    shadow: "0 0 10px rgba(124,58,237,0.55)",
    mini: "#7c3aed",
  },
  emerald: {
    fill: "linear-gradient(90deg, #059669 0%, #34d399 100%)",
    shadow: "0 0 10px rgba(52,211,153,0.45)",
    mini: "#34d399",
  },
  white: {
    fill: "linear-gradient(90deg, rgba(255,255,255,0.75) 0%, #ffffff 100%)",
    shadow: "0 0 10px rgba(255,255,255,0.25)",
    mini: "#ffffff",
  },
};

export function getSeekBarVisualStyle(prefs: PlayerSeekBarPrefs): SeekBarVisualStyle {
  const t = THICKNESS[prefs.thickness] ?? THICKNESS.default;
  const c = COLORS[prefs.color] ?? COLORS.violet;
  return {
    trackPx: t.track,
    hoverTrackPx: t.hover,
    thumbPx: t.thumb,
    fillBackground: c.fill,
    fillShadow: c.shadow,
    miniFillBackground: c.mini,
  };
}

export function parseSeekBarThickness(v: unknown): PlayerSeekBarThickness {
  return v === "thin" || v === "thick" ? v : "default";
}

export function parseSeekBarColor(v: unknown): PlayerSeekBarColor {
  return v === "emerald" || v === "white" ? v : "violet";
}
