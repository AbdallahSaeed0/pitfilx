import {
  EPISODE_SUB_PICK_STORAGE_KEY,
  MAX_EPISODE_SUB_PICKS,
  SUBTITLE_PREFS_STORAGE_KEY,
} from "./playerConstants";
import type { PlayerSubtitlePrefs } from "./playerTypes";

export const DEFAULT_SUBTITLE_PREFS: PlayerSubtitlePrefs = {
  fontSize: 48,
  textColor: "#FFFFFF",
  borderColor: "#000000",
  borderSize: 2,
  backColor: "#00000000",
  shadowColor: "#00000088",
  shadowOffset: 2,
  position: 85,
  fontFamily: "Noto Naskh Arabic",
};

export function parseSubtitlePrefs(raw: string | null): PlayerSubtitlePrefs {
  if (!raw) return DEFAULT_SUBTITLE_PREFS;
  try {
    const parsed = JSON.parse(raw) as Partial<PlayerSubtitlePrefs>;
    return {
      fontSize: typeof parsed.fontSize === "number" ? parsed.fontSize : DEFAULT_SUBTITLE_PREFS.fontSize,
      textColor: typeof parsed.textColor === "string" ? parsed.textColor : DEFAULT_SUBTITLE_PREFS.textColor,
      borderColor: typeof parsed.borderColor === "string" ? parsed.borderColor : DEFAULT_SUBTITLE_PREFS.borderColor,
      borderSize: typeof parsed.borderSize === "number" ? parsed.borderSize : DEFAULT_SUBTITLE_PREFS.borderSize,
      backColor: typeof parsed.backColor === "string" ? parsed.backColor : DEFAULT_SUBTITLE_PREFS.backColor,
      shadowColor: typeof parsed.shadowColor === "string" ? parsed.shadowColor : DEFAULT_SUBTITLE_PREFS.shadowColor,
      shadowOffset: typeof parsed.shadowOffset === "number" ? parsed.shadowOffset : DEFAULT_SUBTITLE_PREFS.shadowOffset,
      position: typeof parsed.position === "number" ? parsed.position : DEFAULT_SUBTITLE_PREFS.position,
      fontFamily: typeof parsed.fontFamily === "string" ? parsed.fontFamily : DEFAULT_SUBTITLE_PREFS.fontFamily,
    };
  } catch {
    return DEFAULT_SUBTITLE_PREFS;
  }
}

export function loadSubtitlePrefs(): PlayerSubtitlePrefs {
  return parseSubtitlePrefs(
    typeof localStorage !== "undefined" ? localStorage.getItem(SUBTITLE_PREFS_STORAGE_KEY) : null,
  );
}

export function saveSubtitlePrefs(prefs: PlayerSubtitlePrefs): void {
  if (typeof localStorage !== "undefined") {
    localStorage.setItem(SUBTITLE_PREFS_STORAGE_KEY, JSON.stringify(prefs));
  }
}

export function loadEpSubPickMap(): Record<string, string> {
  if (typeof localStorage === "undefined") return {};
  try {
    const raw = localStorage.getItem(EPISODE_SUB_PICK_STORAGE_KEY);
    if (!raw) return {};
    const o = JSON.parse(raw) as Record<string, unknown>;
    const out: Record<string, string> = {};
    if (o && typeof o === "object") {
      for (const [k, v] of Object.entries(o)) {
        if (typeof v === "string" && v.length > 0) out[k] = v;
      }
    }
    return out;
  } catch {
    return {};
  }
}

export function persistEpSubPick(epKey: string, subVal: string) {
  if (typeof localStorage === "undefined" || !epKey.startsWith("ep:")) return;
  const prev = loadEpSubPickMap();
  delete prev[epKey];
  const merged: Record<string, string> = { [epKey]: subVal, ...prev };
  const keys = Object.keys(merged);
  if (keys.length <= MAX_EPISODE_SUB_PICKS) {
    localStorage.setItem(EPISODE_SUB_PICK_STORAGE_KEY, JSON.stringify(merged));
    return;
  }
  const trimmed: Record<string, string> = {};
  for (const k of keys.slice(0, MAX_EPISODE_SUB_PICKS)) {
    trimmed[k] = merged[k]!;
  }
  localStorage.setItem(EPISODE_SUB_PICK_STORAGE_KEY, JSON.stringify(trimmed));
}
