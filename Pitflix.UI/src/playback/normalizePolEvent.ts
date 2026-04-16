import type { PlaybackAppEvent, PlaybackAppEventJson } from "./playbackTypes";

export function normalizePlaybackAppEvent(raw: PlaybackAppEventJson): PlaybackAppEvent | null {
  if ("onPlay" in raw) return { type: "onPlay" };
  if ("onPause" in raw) return { type: "onPause" };
  if ("onEnded" in raw) return { type: "onEnded" };
  if ("onProgress" in raw) {
    const p = raw.onProgress;
    return {
      type: "onProgress",
      currentTime: p.currentTime,
      duration: p.duration,
      progressPct: p.progressPct,
    };
  }
  if ("onSeek" in raw) {
    const s = raw.onSeek;
    return { type: "onSeek", from: s.from, to: s.to };
  }
  if ("onBuffer" in raw) {
    return { type: "onBuffer", active: raw.onBuffer.active };
  }
  if ("onNearEnd" in raw) {
    const n = raw.onNearEnd;
    return {
      type: "onNearEnd",
      progressPct: n.progressPct,
      remainingGateSeconds: n.remainingGateSeconds,
      remainingSeconds: n.remainingSeconds,
    };
  }
  return null;
}
