export const PLAYER_PLAYLIST_PIN_KEY = "pitflix.player.playlist.pinned.v1";
export const SUBTITLE_PREFS_STORAGE_KEY = "pitflix.player.subtitlePrefs.v1";
export const PLAYER_LAYOUT_PREFS_STORAGE_KEY = "pitflix.player.layoutPrefs.v1";
export const PLAYER_VOLUME_STORAGE_KEY = "pitflix.player.lastVolume.v1";

/** Last volume the user set (0–200). Used as the default for every new playback session. */
export function loadPlayerVolume(): number {
  if (typeof localStorage === "undefined") return 100;
  try {
    const raw = localStorage.getItem(PLAYER_VOLUME_STORAGE_KEY);
    if (raw == null) return 100;
    const n = Number(raw);
    if (!Number.isFinite(n)) return 100;
    return Math.min(200, Math.max(0, Math.round(n)));
  } catch {
    return 100;
  }
}
export const EPISODE_SUB_PICK_STORAGE_KEY = "pitflix.player.episodeSubtitlePick.v1";
export const MAX_EPISODE_SUB_PICKS = 200;

/** Kill switch for the intro/outro skip button — fingerprint-sourced segments have shown
 *  wrong skip windows even at confidence >= 0.75 (energy-envelope correlation getting fooled
 *  by similar speech rhythm across unrelated scenes, not just low-confidence heuristic
 *  guesses). Fetch/derivation logic stays active (cheap, useful for diagnosis); only the UI is
 *  suppressed. Flip back to false once fingerprinting is more discriminating. */
export const SKIP_OVERLAY_DISABLED = false;

/** Fullscreen auto-hide: idle before fading chrome (ms). Slightly longer while paused. */
export const FS_HIDE_IDLE_MS = 800;
export const FS_HIDE_PAUSED_MS = 1500;

/** Watch-history API heartbeat (playback tracking). */
export const HISTORY_PROGRESS_HEARTBEAT_MS = 5000;
/** Coalesce rapid seeks / scrub drags before POST /history/…/progress. */
export const SEEK_PROGRESS_FLUSH_DEBOUNCE_MS = 400;
/** Volume nudge for mouse wheel and Arrow Up/Down (matches footer slider / `SetVolume` steps). */
export const VOLUME_WHEEL_STEP = 5;

export const PLAYER_SKIP_SECONDS_STORAGE_KEY = "pitflix.player.skipSeconds.v1";
export const PLAYER_SKIP_SECONDS_MIN = 1;
export const PLAYER_SKIP_SECONDS_MAX = 120;

/** Seek-skip button step (back/forward), user-configurable via right-click on the buttons. */
export function loadPlayerSkipSeconds(): number {
  if (typeof localStorage === "undefined") return 5;
  try {
    const raw = localStorage.getItem(PLAYER_SKIP_SECONDS_STORAGE_KEY);
    if (raw == null) return 5;
    const n = Number(raw);
    if (!Number.isFinite(n)) return 5;
    return Math.min(PLAYER_SKIP_SECONDS_MAX, Math.max(PLAYER_SKIP_SECONDS_MIN, Math.round(n)));
  } catch {
    return 5;
  }
}
