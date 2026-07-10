import { invoke, isTauri } from "@tauri-apps/api/core";
import { listen, type UnlistenFn } from "@tauri-apps/api/event";
import { save } from "@tauri-apps/plugin-dialog";
import { getCurrentWindow } from "@tauri-apps/api/window";
import { LogicalSize } from "@tauri-apps/api/dpi";
import { useQuery, useQueryClient } from "@tanstack/react-query";
import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { useLocation, useNavigate } from "react-router-dom";
import { addHistory, getHistory, historyStopped, postHistoryProgress, dismissHistoryEntry } from "../api/history";
import { trustedResumeHeadFromRow, type HistoryResumeFields } from "../utils/trustedResume";
import { getNextLibraryEpisode, getPreviousLibraryEpisode, getShow, getShowSeason, resolvePlaybackByPath } from "../api/series";
import type { NextLibraryEpisode } from "../api/series";
import type { PlaybackLaunchState } from "../types/playback";
import { RotateCcw, Play } from "lucide-react";
import { pickReturnToAfterLibraryNavigation } from "../utils/playbackReturnTo";
import { mapPlaybackStatus } from "../utils/playbackStatus";
import { sanitizeErrorMessage } from "../utils/sanitizeError";
import { pitflixConfirm } from "../utils/pitflixDialog";
import { type ActiveSkipSegment } from "../components/player/SkipSegmentOverlay";
import { getEpisodeSkip, type EpisodeSkipResult } from "../api/skip";
import { 
  startRuntimeMonitor, 
  stopRuntimeMonitor, 
  trackPoll, 
  trackProgressSave, 
  trackQueryInvalidation, 
  trackRerender,
  trackIpcEvent 
} from "../utils/runtimeMonitor";
import { useShallow } from "zustand/react/shallow";
import { usePlaybackPolStore } from "../playback/playbackStore";
import {
  playbackEpisodeKey,
  playbackLoadEpisodeContext,
  playbackPersistProgress,
  playbackCancelNextCountdown,
  playbackGetSnapshot,
  playbackResumeHintsForKey,
} from "../playback/playbackApi";
import { navigateFromPlayer, restoreAppWindowFromFullscreen } from "../utils/playerExitNavigation";
import { isNativeBackendEmbeddedLibmpv, isNativeBackendExternal } from "../utils/playerNativeBackend";
import { PlayerCompanionView } from "../features/player/PlayerCompanionView";
import type { CompanionEpisodeRow } from "../features/player/PlayerCompanionEpisodeList";
import { PlayerEmbeddedView } from "../features/player/PlayerEmbeddedView";
import { PlayerContextMenu } from "../features/player/PlayerContextMenu";
import { PlayerClipExportModal } from "../features/player/PlayerClipExportModal";
import { fmtTimeForFilename, resolvePlayerExportSubtitleBurn, resolveSubtitleMenuValue, safePlayerExportFileName } from "../features/player/playerExport";
import {
  bytesToSeekHoverUrl,
  clearSeekHoverCache,
  getSeekHoverCached,
  HOVER_PREVIEW_STEP_SEC,
  seekHoverPreviewSecond,
  setSeekHoverCached,
} from "../utils/seekHoverThumbCache";
import { SubtitleDrawer } from "../components/SubtitleDrawer";
import {
  FS_HIDE_IDLE_MS,
  FS_HIDE_PAUSED_MS,
  HISTORY_PROGRESS_HEARTBEAT_MS,
  PLAYER_PLAYLIST_PIN_KEY,
  PLAYER_SKIP_SECONDS_STORAGE_KEY,
  PLAYER_VOLUME_STORAGE_KEY,
  loadPlayerSkipSeconds,
  loadPlayerVolume,
  SEEK_PROGRESS_FLUSH_DEBOUNCE_MS,
  VOLUME_WHEEL_STEP,
} from "../features/player/playerConstants";
import { logPlayer2InvokeFailure, playerDebugLog } from "../features/player/playerDebug";
import {
  fileDisplayTitle,
  fmtTime,
  isPlayableSibling,
  normalizeMediaPathKey,
  num,
  parentDirectory,
} from "../features/player/playerFormat";
import { recordDeviceLastPlayedFromPlayer } from "../features/device/deviceUtils";
import { usePlayerLayoutPrefs } from "../hooks/usePlayerLayoutPrefs";
import {
  loadEpSubPickMap,
  loadSubtitlePrefs,
  persistEpSubPick,
  saveSubtitlePrefs,
} from "../features/player/playerStorage";
import type {
  DeviceFsEntry,
  MpvTrack,
  Player2Event,
  Player2NativeState,
  PlayerSubtitlePrefs,
} from "../features/player/playerTypes";

/** Resume head for a local file path (history rows + POL disk checkpoint). */
async function resolveResumeSecondsForPath(filePath: string): Promise<number | undefined> {
  const norm = (p: string) => p.trim().replace(/\\/g, "/").toLowerCase();
  const target = norm(filePath);

  // These two lookups don't depend on each other — run them concurrently instead of one after
  // another, since this runs on the critical path of every episode/file switch.
  const historyPromise = (getHistory(200, { includeSuppressed: true, lite: true }) as Promise<HistoryResumeFields[]>).catch(
    () => [] as HistoryResumeFields[],
  );
  const hintsPromise = isTauri()
    ? playbackResumeHintsForKey(`file:${target}`).catch(() => null)
    : Promise.resolve(null);

  const [rows, hints] = await Promise.all([historyPromise, hintsPromise]);

  let inferred = 0;
  for (const row of rows) {
    if (norm(row.filePath ?? "") !== target) continue;
    const head = trustedResumeHeadFromRow(row);
    if (head > inferred) inferred = head;
  }
  const localCheckpoint =
    hints?.shouldOfferResume && Number.isFinite(hints.resumeSeconds) ? Math.floor(Math.max(0, hints.resumeSeconds)) : 0;
  const resume = localCheckpoint > 0 ? localCheckpoint : inferred;
  return resume > 10 ? resume : undefined;
}

function isDevicePlaybackSession(launch: PlaybackLaunchState): boolean {
  return launch.suppressContinueWatching === true || launch.returnTo?.pathname === "/my-device";
}

// Module-scope (not component-scope) tracking for the playlist-open window widen/shrink.
// This mirrors OS-level window state, which persists independent of React's component
// lifecycle — component-scoped refs reset on every remount (Fast Refresh in dev, or any
// future remount) while the real OS window stays exactly as wide as it was left, so a reset
// ref would blindly add another +340 on top of an already-widened window on the next open,
// compounding forever. A module-level singleton survives remounts and stays in sync with
// the one real window for the lifetime of the app session.
let windowWidenedForPlaylist = false;
// Width/height when the playlist is CLOSED — the source of truth for both open (base+340) and
// close (base) math. Seeded once from a live measurement, then never re-measured: `outerSize()`
// on this window consistently echoes back ~16 logical px more than whatever was just requested
// via `setSize()` (an invisible resize-border quirk), and feeding that echo back into the next
// command was compounding the overshoot into unbounded growth on every open/close cycle.
let playlistBaseWindowWidth: number | null = null;
let playlistBaseWindowHeight: number | null = null;
let playlistResizeChain: Promise<void> = Promise.resolve();

export function PlayerPage() {
  const navigate = useNavigate();
  const location = useLocation();
  const qc = useQueryClient();
  const state = location.state as PlaybackLaunchState | undefined;
  const currentEpisodeKey = state ? playbackEpisodeKey(state) : "none";
  // When the user picked the "libmpv-embedded" engine in Settings, route every
  // player2_* invoke through the libmpv-backed Tauri commands. Same payloads.
  const useLibMpv = state?.useLibMpv === true;
  /** Map external-mpv command names to their libmpv equivalents when libmpv engine is selected. */
  const p2cmd = (name: string): string => {
    if (!useLibMpv) return name;
    switch (name) {
      case "player2_open": return "player2_libmpv_open";
      case "player2_close": return "player2_libmpv_close";
      case "player2_send": return "player2_libmpv_send";
      case "player2_set_video_bounds": return "player2_libmpv_set_bounds";
      default: return name;
    }
  };
  // Kick off the one-off ffmpeg keyframe scan for hover/poster previews.
  // Disk-cached on the first visit; subsequent opens are instant.
  useEffect(() => {
    if (!isTauri() || !state?.filePath) return;
    invoke("thumb_note_current", { filePath: state.filePath }).catch(() => {});
  }, [state?.filePath]);

  // While libmpv is the active engine, force <html>/<body> transparent so WebView2
  // composites the mpv child HWND behind it. Restore on unmount.
  useEffect(() => {
    if (!useLibMpv) return;
    const prevHtmlBg = document.documentElement.style.background;
    const prevBodyBg = document.body.style.background;
    document.documentElement.style.background = "transparent";
    document.body.style.background = "transparent";
    return () => {
      document.documentElement.style.background = prevHtmlBg;
      document.body.style.background = prevBodyBg;
    };
  }, [useLibMpv]);

  /** `player2_get_state` doesn't exist for libmpv. Return a synthetic snapshot so
   *  the page renders the embedded layout (video frame div, no "Bring to front"). */
  const getNativeState = async (): Promise<Player2NativeState> => {
    if (useLibMpv) {
      return {
        session_active: true,
        ipc_dead: false,
        backend: "libmpv",
        session_id: 1,
        video_hwnd: null,
        ipc_mirror: null,
        libmpv_pause_property: null,
        libmpv_property_error: null,
        pause_verification: null,
        render_frame_count: 0,
        last_render_error: null,
        window_thread_id: null,
      } as unknown as Player2NativeState;
    }
    return invoke<Player2NativeState>("player2_get_state");
  };
  /** Pause/resume go through the generic PlayerCommand channel for libmpv. */
  const p2pause = async (): Promise<void> => {
    if (useLibMpv) {
      await invoke("player2_libmpv_send", { cmd: { type: "SetPaused", payload: true } });
    } else {
      await invoke("player2_pause");
    }
  };
  const p2resume = async (): Promise<void> => {
    if (useLibMpv) {
      await invoke("player2_libmpv_send", { cmd: { type: "SetPaused", payload: false } });
    } else {
      await invoke("player2_resume");
    }
  };

  const [resumeChoice, setResumeChoice] = useState<"pending" | "fromStart" | "resume" | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [loading, setLoading] = useState(true);
  /** True for a brief grace period after `loading` flips false, bridging the gap
   *  between player2_open resolving and mpv actually painting its first frame into
   *  the (transparent, OS-desktop-revealing) video surface. */
  const [videoSettling, setVideoSettling] = useState(true);
  const [letterboxInsets, setLetterboxInsets] = useState({
    top: 0,
    left: 0,
    right: 0,
    bottom: 0,
  });
  const [timePos, setTimePos] = useState(0);
  const [duration, setDuration] = useState(0);
  const [paused, setPaused] = useState(false);
  const [ended, setEnded] = useState(false);
  const [mute, setMute] = useState(false);
  const [volume, setVolume] = useState(loadPlayerVolume);
  const [playbackSpeed, setPlaybackSpeedState] = useState(1);
  const playbackSpeedRef = useRef(playbackSpeed);
  useEffect(() => {
    playbackSpeedRef.current = playbackSpeed;
  }, [playbackSpeed]);
  const [skipSeconds, setSkipSecondsState] = useState(loadPlayerSkipSeconds);
  const setSkipSeconds = useCallback((n: number) => {
    setSkipSecondsState(n);
    try {
      localStorage.setItem(PLAYER_SKIP_SECONDS_STORAGE_KEY, String(n));
    } catch {
      /* ignore */
    }
  }, []);
  const [volumeHudVisible, setVolumeHudVisible] = useState(false);
  const volumeHudTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  const [subVisible, setSubVisible] = useState(true);
  const [nextEp, setNextEp] = useState<NextLibraryEpisode | null | undefined>(undefined);
  const [prevEp, setPrevEp] = useState<NextLibraryEpisode | null | undefined>(undefined);
  const [skipData, setSkipData] = useState<EpisodeSkipResult | null>(null);
  /** Once dismissed (manually or via auto-hide timeout), a segment stays hidden for the rest
   *  of this viewing of this episode — reset whenever skipData is refetched for a new episode. */
  const skipDismissedRef = useRef<{ intro: boolean; outro: boolean }>({ intro: false, outro: false });
  const canonicalTargetsRef = useRef<{ episodeId: number | null; next: NextLibraryEpisode | null; prev: NextLibraryEpisode | null }>({
    episodeId: null,
    next: null,
    prev: null,
  });
  const [tracks, setTracks] = useState<MpvTrack[]>([]);
  const [sid, setSid] = useState<number | null>(null);
  const [aid, setAid] = useState<number | null>(null);
  const [subDelay, setSubDelay] = useState(0);
  const [subtitlePrefs, setSubtitlePrefs] = useState<PlayerSubtitlePrefs>(() => loadSubtitlePrefs());
  const { layoutPrefs } = usePlayerLayoutPrefs();
  const [externalSubFiles, setExternalSubFiles] = useState<string[]>([]);
  const [arabicSubtitleGenerating, setArabicSubtitleGenerating] = useState(false);
  const [arabicSubtitleProgress, setArabicSubtitleProgress] = useState<{ current: number; total: number } | null>(null);
  const [arabicSubtitleError, setArabicSubtitleError] = useState<string | null>(null);
  const [folderPlaylistPinned, setFolderPlaylistPinned] = useState<boolean>(() => {
    try {
      return localStorage.getItem(PLAYER_PLAYLIST_PIN_KEY) === "true";
    } catch {
      return false;
    }
  });
  const [folderPlaylistOpen, setFolderPlaylistOpen] = useState<boolean>(() => {
    try {
      // Always open the playlist panel on load for live TV sessions.
      if (state?.liveChannels?.length) return true;
      return localStorage.getItem(PLAYER_PLAYLIST_PIN_KEY) === "true";
    } catch {
      return false;
    }
  });
  const [folderPlaylistEntries, setFolderPlaylistEntries] = useState<DeviceFsEntry[]>([]);
  const [folderPlaylistBusy, setFolderPlaylistBusy] = useState(false);
  /** True after failed `player2_send` / dead IPC — Play must reopen the session. */
  const [sessionDead, setSessionDead] = useState(false);
  // Seek-bar hover preview state. `dataUrl` is the JPEG payload returned by
  // the Tauri `thumb_at` command (cached on disk after the first scan).
  const [seekHover, setSeekHover] = useState<{
    pixelX: number;
    seconds: number;
    dataUrl: string | null;
    /** True while a new bucket's frame is still loading — keeps the last
     *  frame on screen (dimmed) instead of flashing to a blank box. */
    loading: boolean;
  } | null>(null);
  const seekHoverFetchSeqRef = useRef(0);
  const seekHoverDebounceRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  const seekHoverDebounceSecondRef = useRef<number | null>(null);
  const seekHoverPrefetchingRef = useRef(new Set<string>());

  const storeHoverThumbBytes = useCallback((filePath: string, previewSecond: number, bytes: ArrayBuffer) => {
    if (getSeekHoverCached(filePath, previewSecond)) return;
    const url = bytesToSeekHoverUrl(bytes);
    if (!url) return;
    setSeekHoverCached(filePath, previewSecond, url);
  }, []);

  const prefetchHoverThumb = useCallback(
    (filePath: string, second: number) => {
      if (!isTauri() || second < 0) return;
      if (getSeekHoverCached(filePath, second)) return;
      const key = `${filePath}|${second}`;
      if (seekHoverPrefetchingRef.current.has(key)) return;
      seekHoverPrefetchingRef.current.add(key);
      void invoke<ArrayBuffer>("thumb_at_quick", { filePath, seconds: second })
        .then((bytes) => {
          storeHoverThumbBytes(filePath, second, bytes);
        })
        .catch(() => {})
        .finally(() => {
          seekHoverPrefetchingRef.current.delete(key);
        });
    },
    [storeHoverThumbBytes],
  );

  const prefetchHoverNeighbors = useCallback(
    (filePath: string, previewSecond: number) => {
      for (const delta of [HOVER_PREVIEW_STEP_SEC, HOVER_PREVIEW_STEP_SEC * 2]) {
        prefetchHoverThumb(filePath, previewSecond - delta);
        prefetchHoverThumb(filePath, previewSecond + delta);
      }
    },
    [prefetchHoverThumb],
  );

  const scheduleHoverThumb = useCallback(
    (filePath: string, seconds: number) => {
      if (!isTauri()) return;
      const previewSecond = seekHoverPreviewSecond(seconds);

      const cached = getSeekHoverCached(filePath, previewSecond);
      if (cached) {
        if (seekHoverDebounceRef.current) {
          clearTimeout(seekHoverDebounceRef.current);
          seekHoverDebounceRef.current = null;
        }
        seekHoverDebounceSecondRef.current = null;
        setSeekHover((prev) => (prev ? { ...prev, dataUrl: cached, loading: false } : prev));
        prefetchHoverNeighbors(filePath, previewSecond);
        return;
      }

      // Dedupe against in-flight quick lookups (shared with prefetchHoverThumb):
      // a fast sweep re-enters this bucket many times per second before the
      // first lookup resolves, and firing a fresh invoke each time backed up
      // the IPC channel with stale requests for positions already scrolled past.
      const quickKey = `${filePath}|${previewSecond}`;
      if (!seekHoverPrefetchingRef.current.has(quickKey)) {
        seekHoverPrefetchingRef.current.add(quickKey);
        void invoke<ArrayBuffer>("thumb_at_quick", { filePath, seconds: previewSecond })
          .then((bytes) => {
            storeHoverThumbBytes(filePath, previewSecond, bytes);
            const url = getSeekHoverCached(filePath, previewSecond);
            if (!url) return;
            setSeekHover((prev) => {
              if (!prev || seekHoverPreviewSecond(prev.seconds) !== previewSecond) return prev;
              return { ...prev, dataUrl: url, loading: true };
            });
          })
          .catch(() => {})
          .finally(() => {
            seekHoverPrefetchingRef.current.delete(quickKey);
          });
      }

      // Only (re)start the accurate-frame debounce when the target bucket
      // actually changed — restarting it on every pointermove within the same
      // bucket kept deferring the accurate fetch for as long as the mouse moved.
      if (seekHoverDebounceSecondRef.current === previewSecond && seekHoverDebounceRef.current) {
        return;
      }
      seekHoverDebounceSecondRef.current = previewSecond;
      if (seekHoverDebounceRef.current) clearTimeout(seekHoverDebounceRef.current);
      seekHoverDebounceRef.current = setTimeout(() => {
        const seq = ++seekHoverFetchSeqRef.current;
        void invoke<ArrayBuffer>("thumb_at", { filePath, seconds: previewSecond })
          .then((bytes) => {
            if (seq !== seekHoverFetchSeqRef.current) return;
            storeHoverThumbBytes(filePath, previewSecond, bytes);
            const url = getSeekHoverCached(filePath, previewSecond);
            if (!url) return;
            setSeekHover((prev) => {
              if (!prev || seekHoverPreviewSecond(prev.seconds) !== previewSecond) return prev;
              return { ...prev, dataUrl: url, loading: false };
            });
            prefetchHoverNeighbors(filePath, previewSecond);
          })
          .catch(() => {
            if (seq === seekHoverFetchSeqRef.current) {
              setSeekHover((prev) => (prev ? { ...prev, loading: false } : prev));
            }
          });
      }, 8);
    },
    [prefetchHoverNeighbors, storeHoverThumbBytes],
  );

  useEffect(() => {
    return () => {
      if (seekHoverDebounceRef.current) {
        clearTimeout(seekHoverDebounceRef.current);
        seekHoverDebounceRef.current = null;
      }
      seekHoverDebounceSecondRef.current = null;
      clearSeekHoverCache();
      seekHoverPrefetchingRef.current.clear();
    };
  }, []);

  useEffect(() => {
    seekHoverDebounceSecondRef.current = null;
    clearSeekHoverCache();
    seekHoverPrefetchingRef.current.clear();
  }, [state?.filePath]);
  const [episodeInfoOpen, setEpisodeInfoOpen] = useState(false);
  const [playerContextMenu, setPlayerContextMenu] = useState<{ x: number; y: number } | null>(null);
  const [clipExportOpen, setClipExportOpen] = useState(false);
  const [playerExportBusy, setPlayerExportBusy] = useState<string | null>(null);
  /** When true, the subtitles popup shows font/color/border controls; when false,
   *  it shows just the track selector + actions. Toggled by the settings button. */
  const [subAppearanceOpen, setSubAppearanceOpen] = useState(false);
  const [subtitleSearchOpen, setSubtitleSearchOpen] = useState(false);
  const pausedForSubtitleSearchRef = useRef(false);
  // Click-outside dismissal for every <details> popup in the player chrome.
  useEffect(() => {
    const handler = (e: MouseEvent) => {
      const target = e.target as Node | null;
      const opens = document.querySelectorAll<HTMLDetailsElement>("details[open]");
      opens.forEach((d) => {
        if (target && !d.contains(target)) d.open = false;
      });
    };
    document.addEventListener("pointerdown", handler);
    return () => document.removeEventListener("pointerdown", handler);
  }, []);
  const [isFullscreen, setIsFullscreen] = useState(false);
  const [isMaximized, setIsMaximized] = useState(false);
  const [alwaysOnTop, setAlwaysOnTop] = useState(false);
  const toggleAlwaysOnTop = useCallback(() => {
    if (!isTauri()) return;
    setAlwaysOnTop((prev) => {
      const next = !prev;
      void getCurrentWindow()
        .setAlwaysOnTop(next)
        .then(() => {
          lastAppliedBoundsRef.current = null;
          window.setTimeout(() => {
            window.dispatchEvent(new Event("__pitflix_resync_bounds"));
          }, 80);
        })
        .catch(() => {});
      return next;
    });
  }, []);
  /** Mirror for syncVideoBounds (a memoized callback that doesn't re-run on state changes). */
  const isFullscreenRef = useRef(false);
  useEffect(() => { isFullscreenRef.current = isFullscreen; }, [isFullscreen]);
  // Re-sync mpv child bounds whenever fullscreen or chrome visibility changes.
  useEffect(() => {
    const id = window.setTimeout(() => {
      // syncVideoBounds is defined below; access by ref pattern via callback.
      window.dispatchEvent(new Event("__pitflix_resync_bounds"));
    }, 16);
    return () => window.clearTimeout(id);
  }, [isFullscreen]);
  /** When false, the overlay chrome (header/footer) is hidden after idle — applies in both windowed and fullscreen mode. */
  const [fsControlsVisible, setFsControlsVisible] = useState(true);
  const fsControlsVisibleRef = useRef(true);
  useEffect(() => {
    fsControlsVisibleRef.current = fsControlsVisible;
    window.dispatchEvent(new Event("__pitflix_resync_bounds"));
  }, [fsControlsVisible]);
  // Tracked separately because syncVideoBounds (a memoized callback) reads via ref.
  // The update effect lives below `currentFolderForPlaylist`'s declaration.
  const playlistVisibleRef = useRef(false);
  /** Matches PlayerEmbeddedFolderPlaylist's `w-[340px]` aside width. */
  const PLAYLIST_PANEL_WIDTH = 340;
  /** Single centralized fullscreen idle timer (do not duplicate hide logic elsewhere). */
  const fsHideControlsTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  /** True after user requests resume until backend `State` confirms `paused===false`. */
  const [resumeOptimistic, setResumeOptimistic] = useState(false);
  /** Track if episode finished (vs just closed early) */
  const [episodeFinished, setEpisodeFinished] = useState(false);
  const FINISHED_THRESHOLD_SECONDS = 30;
  /** One-shot close handling per session */
  const closedSessionsRef = useRef<Set<number>>(new Set());
  /** Guard intentional episode switches from close/watchdog auto-navigation. */
  const episodeSwitchInProgressRef = useRef(false);
  /** Block stale close/EOF events from auto-advancing after a manual playlist jump. */
  const suppressAutoAdvanceUntilRef = useRef(0);
  const autoAdvanceIssuedForRef = useRef<number | null>(null);
  const tryAutoAdvanceOnEndRef = useRef<() => Promise<boolean>>(async () => false);
  /** Skip `openPlayer()` once when canonical state is updated from a live mpv media-path switch. */
  const skipNextOpenForCanonicalSyncRef = useRef(false);
  /** Prevent overlapping canonical sync transitions from rapid mpv path events. */
  const canonicalSyncInFlightRef = useRef(false);
  const adoptCanonicalPlaybackFromPathRef = useRef<(mediaPath: string) => void>(() => {});
  /** User pressed Back / Escape — skip post-close recovery UI and duplicate navigation. */
  const userInitiatedExitRef = useRef(false);
  /** External mpv: leaving `/player` to browse should not call `historyStopped` (playback continues). */
  const skipHistoryStopOnPlayerUnmountRef = useRef(false);
  const subtitlePickAppliedForEpKeyRef = useRef<string | null>(null);
  const volumePersistTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  const volumeHydratedForHistoryRef = useRef<number | null>(null);
  /** Latest launch state for IPC handlers (avoid stale closures). */
  const launchStateRef = useRef(state);
  // Companion-only bridge: receives mpv-originated shortcut events from Rust and updates app state/route.
  // Actual media-player key ownership lives in mpv config/scripts.
  useEffect(() => {
    launchStateRef.current = state;
  }, [state]);

  /** My Device "last played" — updated when leaving the player (any exit path). */
  useEffect(() => {
    return () => {
      const launch = launchStateRef.current;
      if (!launch?.filePath) return;
      recordDeviceLastPlayedFromPlayer(launch.filePath, {
        suppressContinueWatching: launch.suppressContinueWatching,
        returnToPathname: launch.returnTo?.pathname,
      });
    };
  }, []);

  useEffect(() => {
    historyIdRef.current = state?.historyId ?? null;
  }, [state?.historyId]);

  useEffect(() => {
    sessionDeadRef.current = sessionDead;
  }, [sessionDead]);

  useEffect(() => {
    endedRef.current = ended;
  }, [ended]);
  // Companion-page keyboard scope (webview focused). This is NOT the source of truth for mpv controls.
  // Keep only companion behaviors here; mpv-native controls are defined under src-tauri/mpv-config.
  useEffect(() => {
    if (!state) return;
    const msg = `episode_state updated key=${currentEpisodeKey} historyId=${state.historyId} title=${state.title}`;
    console.info("[pitflix-player]", msg);
    playerDebugLog(msg);
  }, [state, currentEpisodeKey]);

  const currentFolderForPlaylist = useMemo(() => {
    if (!state?.filePath) return "";
    if (state.liveChannels?.length) return "__live__";
    return parentDirectory(state.filePath);
  }, [state?.filePath, state?.liveChannels]);

  const folderSiblingIndex = useMemo(() => {
    if (!state?.filePath || folderPlaylistEntries.length === 0) return -1;
    const key = normalizeMediaPathKey(state.filePath);
    return folderPlaylistEntries.findIndex((e) => normalizeMediaPathKey(e.path) === key);
  }, [state?.filePath, folderPlaylistEntries]);

  const prevSibling = useMemo(
    () => (folderSiblingIndex > 0 ? folderPlaylistEntries[folderSiblingIndex - 1]! : null),
    [folderPlaylistEntries, folderSiblingIndex],
  );

  const nextSibling = useMemo(() => {
    if (folderSiblingIndex < 0) return null;
    if (folderSiblingIndex >= folderPlaylistEntries.length - 1) return null;
    return folderPlaylistEntries[folderSiblingIndex + 1]!;
  }, [folderPlaylistEntries, folderSiblingIndex]);

  const hasFolderNav = !state?.libraryShowId && folderPlaylistEntries.length > 1;

  useEffect(() => {
    const dir = currentFolderForPlaylist;
    if (!dir) {
      setFolderPlaylistEntries([]);
      return;
    }
    // Live TV — use the channel list from router state directly (no filesystem scan needed).
    if (dir === "__live__" && state?.liveChannels?.length) {
      setFolderPlaylistEntries(
        state.liveChannels.map((ch) => ({
          name: ch.name,
          path: ch.streamUrl,
          is_directory: false,
          media_kind: "video",
          logoUrl: ch.logoUrl ?? null,
        })),
      );
      return;
    }
    if (!isTauri()) return;
    setFolderPlaylistBusy(true);
    invoke<DeviceFsEntry[]>("device_read_dir", { path: dir })
      .then((rows) => setFolderPlaylistEntries((rows ?? []).filter(isPlayableSibling)))
      .catch(() => setFolderPlaylistEntries([]))
      .finally(() => setFolderPlaylistBusy(false));
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [currentFolderForPlaylist]);

  useEffect(() => {
    if (!folderPlaylistPinned) return;
    setFolderPlaylistOpen(true);
  }, [folderPlaylistPinned]);
  // Mirror playlist visibility to a ref + force a video bounds resync so mpv
  // child shrinks to make space for the in-app aside (libmpv embed mode).
  useEffect(() => {
    const next = Boolean(currentFolderForPlaylist && (folderPlaylistOpen || folderPlaylistPinned));
    playlistVisibleRef.current = next;
    // Burst-fire over a few frames — layout reflow when the playlist aside appears
    // or the window resizes doesn't always settle in a single tick.
    const burstResync = () => {
      let n = 0;
      const fire = () => {
        window.dispatchEvent(new Event("__pitflix_resync_bounds"));
        n += 1;
        if (n < 4) requestAnimationFrame(fire);
      };
      requestAnimationFrame(fire);
    };
    // Close the (deprecated) popout window if it was opened by a previous version.
    if (isTauri()) void invoke("playlist_window_close").catch(() => {});
    // Widen the actual window when the playlist opens (instead of just squeezing the video
    // into the existing width) so opening the playlist doesn't shrink the video. Skipped when
    // maximized/fullscreen — the window already fills the screen there, so squeezing is fine.
    if (isTauri()) {
      const task = async () => {
        try {
          const w = getCurrentWindow();
          const [fullscreen, maximized] = await Promise.all([w.isFullscreen(), w.isMaximized()]);
          if (fullscreen || maximized) {
            // Can't reason about a size we don't control — drop tracking and re-seed
            // from a fresh measurement next time this becomes relevant.
            playlistBaseWindowWidth = null;
            playlistBaseWindowHeight = null;
            windowWidenedForPlaylist = false;
            return;
          }
          if (next === windowWidenedForPlaylist) return;
          // Seed the closed-state base from a live measurement only the first time — every call
          // afterward trusts our own last-commanded values instead of re-reading outerSize(),
          // since that read-back is what was feeding the ~16px-per-call overshoot into a runaway loop.
          if (playlistBaseWindowWidth == null || playlistBaseWindowHeight == null) {
            const scale = await w.scaleFactor();
            const size = (await w.outerSize()).toLogical(scale);
            // If we're seeding while opening, the live measurement (pre-widen) IS the closed-state base.
            playlistBaseWindowWidth = size.width;
            playlistBaseWindowHeight = size.height;
          }
          const width = next ? playlistBaseWindowWidth + PLAYLIST_PANEL_WIDTH : playlistBaseWindowWidth;
          windowWidenedForPlaylist = next;
          await w.setSize(new LogicalSize(width, playlistBaseWindowHeight));
        } catch {
          /* ignore */
        } finally {
          // Only resync bounds once the window resize has actually landed — firing this
          // before setSize() resolves sends mpv an intermediate, mismatched rect (the aside
          // has already appeared in the DOM but the window hasn't widened to compensate yet,
          // or vice versa), which is what produced the brief "video frame jumps size" flash.
          burstResync();
        }
      };
      // Chain onto any in-flight resize (module-scoped, so it also serializes across remounts)
      // so rapid toggles can't race each other's reads.
      playlistResizeChain = playlistResizeChain.then(task, task);
    } else {
      burstResync();
    }
  }, [currentFolderForPlaylist, folderPlaylistOpen, folderPlaylistPinned]);
  /** Throttle state updates in external mode to reduce rerender churn */
  const lastStateUpdateTimeRef = useRef<number>(0);
  const STATE_UPDATE_THROTTLE_MS = 1000; // Only update UI once per second in external mode

  /** Playback button / status: optimistic playing immediately on resume tap. */
  const displayPaused = paused && !resumeOptimistic;

  // Track component rerenders
  useEffect(() => {
    trackRerender();
  });

  /** Set after `historyStopped` was sent for the current row (episode switch / ended flush / explicit). */
  const historyStopHandledRef = useRef(false);
  /** After server row is stop-finalized — blocks late `/progress` and redundant checkpoints. */
  const historyServerFinalizedRef = useRef(false);
  const historyIdRef = useRef<number | null>(null);
  const lastProgressRef = useRef(0);
  const seekProgressFlushTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  const sessionDeadRef = useRef(false);
  const endedRef = useRef(false);
  const timePosRef = useRef(0);
  const durationRef = useRef(0);
  const pausedRef = useRef(false);
  const playerRootRef = useRef<HTMLDivElement>(null);
  const videoAreaRef = useRef<HTMLDivElement>(null);
  /** Overlay chrome laid on top of `videoAreaRef`; native HWND must not cover these or controls are invisible (still click-through). */
  const playerHeaderChromeRef = useRef<HTMLDivElement | null>(null);
  const playerFooterChromeRef = useRef<HTMLDivElement | null>(null);
  const lastLoggedBoundsRef = useRef<string | null>(null);
  const lastAppliedBoundsRef = useRef<string | null>(null);
  const boundsSyncTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  const lastLoggedEventPausedRef = useRef<boolean | null>(null);
  const volumeWheelRef = useRef<HTMLDivElement>(null);
  /** Blocks overlapping pause/resume invokes until the current one finishes (ref + state for UI). */
  const playbackTransportPendingRef = useRef(false);
  const [playbackTransportPending, setPlaybackTransportPending] = useState(false);
  /** Inline transport errors (does not use full-page `error` — that is for fatal/session failures). */
  const [transportError, setTransportError] = useState<string | null>(null);
  const [lastMpvCrashLog, setLastMpvCrashLog] = useState<string | null>(null);
  const [embeddedSafeMode, setEmbeddedSafeMode] = useState(false);
  const [nativeState, setNativeState] = useState<Player2NativeState | null>(null);
  const nativeStateRef = useRef<Player2NativeState | null>(null);
  /** Prevent repeated `player2_open` loops for the same history row during rerenders/transitions. */
  const openedHistoryIdRef = useRef<number | null>(null);
  const autoRecoverAttemptedRef = useRef<number | null>(null);
  const externalClosedHandledRef = useRef(false);
  
  // Keep ref in sync with state for use in closures
  useEffect(() => {
    nativeStateRef.current = nativeState;
  }, [nativeState]);
  
  // CRITICAL: Determine player mode and ready state
  // We need to know the backend before we can determine which lifecycle to run
  const isExternal = isNativeBackendExternal(nativeState?.backend);
  const isEmbedded = isNativeBackendEmbeddedLibmpv(nativeState?.backend);
  const backendKnown = nativeState != null;
  
  // embedReady: ONLY true for embedded libmpv mode with known backend
  // External player mode should NOT run embedded lifecycle (bounds sync, etc)
  const embedReady = Boolean(
    state && isTauri() && resumeChoice !== "pending" && resumeChoice !== null && backendKnown && isEmbedded,
  );
  
  // externalReady: ONLY true for external mode with known backend
  const externalReady = Boolean(
    state && isTauri() && resumeChoice !== "pending" && resumeChoice !== null && backendKnown && isExternal,
  );

  const companionShowQ = useQuery({
    queryKey: ["show", state?.libraryShowId],
    queryFn: () => getShow(state!.libraryShowId!),
    enabled: externalReady && !!state?.libraryShowId,
    staleTime: 10 * 60_000,
  });

  const companionSeasonQ = useQuery({
    queryKey: ["show-season", state?.libraryShowId, state?.season],
    queryFn: () => getShowSeason(state!.libraryShowId!, state!.season!),
    enabled: externalReady && !!state?.libraryShowId && state.season != null,
    staleTime: 10 * 60_000,
  });
  
  // backendResolving: true while we're waiting to know which mode to render
  const backendResolving = Boolean(
    state && isTauri() && resumeChoice !== "pending" && resumeChoice !== null && !backendKnown
  );

  const polPlayback = usePlaybackPolStore(
    useShallow((s) => ({
      seq: s.seq,
      snapshot: s.snapshot,
      lastEvents: s.lastNormalizedEvents,
    })),
  );

  // Only log on backend changes to avoid spam
  useEffect(() => {
    if (backendResolving) {
      console.log("[lifecycle] backend resolution in progress...");
    } else if (backendKnown) {
      console.log("[lifecycle] backend resolved - embedReady:", embedReady, "externalReady:", externalReady, "backend:", nativeState?.backend);
      if (externalReady) {
        console.log("[lifecycle] external companion render start");
      }
    }
  }, [nativeState?.backend, backendResolving]);

  useEffect(() => {
    if (!externalReady || !state || resumeChoice === "pending" || resumeChoice === null) return;
    void playbackLoadEpisodeContext({
      current: {
        key: playbackEpisodeKey(state),
        title: state.title,
        mediaPath: state.filePath,
        season: state.season ?? undefined,
        episodeNumber: state.episodeNumber ?? undefined,
      },
      next: nextEp
        ? {
            key: `ep:${nextEp.id}`,
            title: nextEp.title ?? undefined,
            mediaPath: nextEp.filePath,
            season: nextEp.season,
            episodeNumber: nextEp.episodeNumber,
          }
        : undefined,
      autoplayNext: true,
    }).catch(() => {});
  }, [externalReady, state, resumeChoice, nextEp]);

  // Focus window when either mode is ready
  useEffect(() => {
    if (!embedReady && !externalReady) return;
    console.log("[lifecycle] focus effect running - embedReady:", embedReady, "externalReady:", externalReady);
    void getCurrentWindow().setFocus().catch(() => {});
    playerRootRef.current?.focus({ preventScroll: true });
  }, [embedReady, externalReady]);

  // Runtime monitoring ONLY for external mode (to track IPC churn)
  useEffect(() => {
    if (!externalReady) return;
    console.log("[lifecycle] starting runtime monitor for external mode");
    startRuntimeMonitor();
    
    return () => {
      console.log("[lifecycle] stopping runtime monitor");
      stopRuntimeMonitor();
    };
  }, [externalReady]);

  /** While true, ignore volume from player2-event so libmpv poll does not fight the slider. */
  const volumeDraggingRef = useRef(false);
  /** Same for seek scrubber. */
  const seekDraggingRef = useRef(false);
  /** True while the pointer is over the seek bar (hover preview / scrub). */
  const seekBarHoveringRef = useRef(false);
  const volumeRef = useRef(volume);
  useEffect(() => {
    volumeRef.current = volume;
  }, [volume]);

  /**
   * Writes the CURRENT volume to localStorage right away, bypassing the
   * 400ms debounce used for routine persistence further down.  Without this,
   * changing volume and then quickly switching episodes (playlist) or
   * closing the player — both of which happen well within 400ms — cancels
   * the pending debounced save before it ever runs (its cleanup just clears
   * the timer), so the new volume is never persisted and the player falls
   * back to the default (100%) on the next open.  Call this at the start of
   * any navigation/close path.
   */
  const flushVolumePersist = useCallback(() => {
    if (typeof localStorage === "undefined") return;
    if (volumePersistTimerRef.current) {
      clearTimeout(volumePersistTimerRef.current);
      volumePersistTimerRef.current = null;
    }
    try {
      localStorage.setItem(PLAYER_VOLUME_STORAGE_KEY, String(Math.round(volumeRef.current)));
    } catch {
      /* ignore */
    }
  }, []);

  /** Snap `timePosRef` / `durationRef` from native host mirror or POL before persisting (avoids stale UI-throttled values). */
  const refreshPlayheadIntoRefs = useCallback(async () => {
    if (!isTauri()) return;
    // libmpv path: the State event handler already keeps timePosRef/durationRef
    // current. Neither `player2_get_state` (external IPC mirror) nor the POL
    // snapshot has real data for this backend, and they would clobber the real
    // position with 0 → the close path then persists position 0 to the server.
    if (useLibMpv) return;
    let mirrorTimeSet = false;
    try {
      const ns = await getNativeState();
      if (ns.session_active && ns.ipc_mirror) {
        const m = ns.ipc_mirror;
        const tf = typeof m.time_pos_full === "number" && Number.isFinite(m.time_pos_full) ? m.time_pos_full : Number.NaN;
        const tp = num(m.time_pos);
        const t = Number.isFinite(tf) && tf > 0 ? tf : tp;
        if (Number.isFinite(t) && t >= 0) {
          timePosRef.current = t;
          mirrorTimeSet = true;
        }
        const d = num(m.duration);
        if (d > 0) {
          durationRef.current = d;
        }
      }
    } catch {
      /* Host snapshot optional during teardown. */
    }
    if (mirrorTimeSet) return;
    try {
      const snap = await playbackGetSnapshot();
      // Don't overwrite a known-good position with a 0 from an idle POL — that
      // poisons `flushProgressAndStop` and persists position 0 to the server.
      if (Number.isFinite(snap.currentTime) && snap.currentTime > 0) {
        timePosRef.current = snap.currentTime;
      }
      if (Number.isFinite(snap.duration) && snap.duration > 0) {
        durationRef.current = snap.duration;
      }
    } catch {
      /* POL optional when idle. */
    }
  }, [useLibMpv]);

  const flushHistoryProgressNow = useCallback(async () => {
    const hid = historyIdRef.current;
    if (hid == null) return;
    if (historyServerFinalizedRef.current) return;
    if (sessionDeadRef.current || endedRef.current) return;
    await refreshPlayheadIntoRefs();
    const pos = Math.floor(timePosRef.current);
    const dur = durationRef.current;
    if (pos < 0) return;
    lastProgressRef.current = pos;
    trackProgressSave();
    void postHistoryProgress(hid, {
      positionSeconds: pos,
      durationSeconds: dur > 0 ? Math.floor(dur) : undefined,
      markWatching: true,
    });
    void playbackPersistProgress({ historyId: hid }).catch(() => {});
    trackQueryInvalidation();
    void qc.invalidateQueries({ queryKey: ["history"] });
  }, [qc, refreshPlayheadIntoRefs]);

  const scheduleSeekProgressFlush = useCallback(() => {
    if (seekProgressFlushTimerRef.current) {
      clearTimeout(seekProgressFlushTimerRef.current);
    }
    seekProgressFlushTimerRef.current = window.setTimeout(() => {
      seekProgressFlushTimerRef.current = null;
      void flushHistoryProgressNow().catch(() => {});
    }, SEEK_PROGRESS_FLUSH_DEBOUNCE_MS);
  }, [flushHistoryProgressNow]);

  /** Progress checkpoint without ending the watch row — used when leaving `/player` while external mpv keeps playing. */
  const checkpointWatchProgressNoStop = useCallback(async () => {
    if (historyServerFinalizedRef.current) return;
    await refreshPlayheadIntoRefs();
    const hid = historyIdRef.current;
    if (hid == null) return;
    if (sessionDeadRef.current || endedRef.current) return;
    const pos = Math.floor(timePosRef.current);
    const dur = durationRef.current;
    if (pos < 0) return;
    lastProgressRef.current = pos;
    trackProgressSave();
    void postHistoryProgress(hid, {
      positionSeconds: pos,
      durationSeconds: dur > 0 ? Math.floor(dur) : undefined,
      markWatching: true,
    });
    void playbackPersistProgress({ historyId: hid }).catch(() => {});
    trackQueryInvalidation();
    void qc.invalidateQueries({ queryKey: ["history"] });
  }, [qc, refreshPlayheadIntoRefs]);

  const browseWhilePlaying = useCallback(async () => {
    if (!isTauri()) return;
    if (!isNativeBackendExternal(nativeStateRef.current?.backend)) return;
    skipHistoryStopOnPlayerUnmountRef.current = true;
    await checkpointWatchProgressNoStop();
    await restoreAppWindowFromFullscreen();
    const rt = launchStateRef.current?.returnTo;
    if (rt?.pathname) {
      navigate({ pathname: rt.pathname, search: rt.search ?? "", hash: rt.hash ?? "" });
    } else {
      navigate("/");
    }
  }, [navigate, checkpointWatchProgressNoStop]);

  useEffect(() => {
    return () => {
      if (seekProgressFlushTimerRef.current) {
        clearTimeout(seekProgressFlushTimerRef.current);
        seekProgressFlushTimerRef.current = null;
      }
    };
  }, []);

  useEffect(() => {
    for (const e of polPlayback.lastEvents) {
      if (e.type === "onNearEnd") {
      }
      if (e.type === "onSeek") {
        scheduleSeekProgressFlush();
      }
      if (e.type === "onEnded") {
        setEpisodeFinished(true);
        setEnded(true);
        void tryAutoAdvanceOnEndRef.current();
      }
    }
  }, [polPlayback.seq, polPlayback.lastEvents, scheduleSeekProgressFlush]);

  useEffect(() => {
    const endDrag = () => {
      const wasSeekDrag = seekDraggingRef.current;
      volumeDraggingRef.current = false;
      seekDraggingRef.current = false;
      if (wasSeekDrag) {
        scheduleSeekProgressFlush();
      }
    };
    window.addEventListener("pointerup", endDrag);
    window.addEventListener("pointercancel", endDrag);
    window.addEventListener("blur", endDrag);
    return () => {
      window.removeEventListener("pointerup", endDrag);
      window.removeEventListener("pointercancel", endDrag);
      window.removeEventListener("blur", endDrag);
    };
  }, [scheduleSeekProgressFlush]);

  const syncVideoBounds = useCallback(() => {
    const el = videoAreaRef.current;
    if (!el) return;
    void (async () => {
      try {
        const videoRect = el.getBoundingClientRect();
        const isFullscreenNow = isFullscreenRef.current;

        let top = Math.round(videoRect.top);
        let bottom = Math.round(videoRect.bottom);
        let left = Math.round(videoRect.left);
        let right = Math.round(videoRect.right);

        if (isFullscreenNow) {
          top = 0;
          left = 0;
          right = window.innerWidth;
          bottom = window.innerHeight;
        }
        // Header/footer are now absolute overlays drawn on top of the video
        // surface (not docked, layout-affecting bars), so the video area's
        // own rect already represents the full bounds mpv should fill.
        // Hand mpv the FULL available rect — don't pre-shrink it to a
        // guessed aspect ratio here.  This used to call fitAspectVideoRect()
        // with a hardcoded VIDEO_ASPECT = 16/9, which double-letterboxed any
        // content that wasn't exactly 16:9 (most movies aren't): the JS layer
        // shrank the native rect assuming the wrong aspect, and then mpv's
        // own --keepaspect rendering letterboxed AGAIN inside that already-
        // wrong rect using the real video dimensions, producing extra,
        // mismatched empty margins ("video doesn't fill the side").  mpv
        // already letterboxes/pillarboxes correctly using the actual loaded
        // video's real aspect ratio, so there's nothing for this layer to
        // compute — just give it the real container bounds.
        setLetterboxInsets({ top: 0, left: 0, right: 0, bottom: 0 });

        const height = Math.max(1, bottom - top);
        const width = Math.max(1, right - left);
        const logicalBounds = {
          x: left,
          y: top,
          width,
          height,
        };
        if (logicalBounds.width <= 0 || logicalBounds.height <= 0) {
          console.debug("[pitflix-player] skip set_video_bounds until layout non-zero", logicalBounds);
          return;
        }
        const boundsKey = `${logicalBounds.x},${logicalBounds.y},${logicalBounds.width},${logicalBounds.height}`;
        if (lastAppliedBoundsRef.current === boundsKey) {
          return;
        }
        lastAppliedBoundsRef.current = boundsKey;
        if (lastLoggedBoundsRef.current !== boundsKey) {
          lastLoggedBoundsRef.current = boundsKey;
          console.debug("[pitflix-player] logical bounds", {
            logicalBounds,
            viewport: {
              width: window.innerWidth,
              height: window.innerHeight,
            },
          });
        }
        // Logical CSS px; Rust converts with GetDpiForWindow(parent) to match WebView2.
        await invoke(p2cmd("player2_set_video_bounds"), {
          x: logicalBounds.x,
          y: logicalBounds.y,
          width: logicalBounds.width,
          height: logicalBounds.height,
        });
      } catch (e) {
        logPlayer2InvokeFailure("player2_set_video_bounds", e);
      }
    })();
  }, [embedReady]);

  const scheduleSyncVideoBounds = useCallback(() => {
    if (boundsSyncTimerRef.current) {
      clearTimeout(boundsSyncTimerRef.current);
    }
    boundsSyncTimerRef.current = window.setTimeout(() => {
      boundsSyncTimerRef.current = null;
      syncVideoBounds();
    }, 96);
  }, [syncVideoBounds]);

  /** Keep the native video HWND aligned with the video strip (DPI conversion is done in Rust). 
   * ONLY runs in embedded mode - external mode has no video surface to sync.
   */
  useEffect(() => {
    if (!embedReady) return;
    console.log("[lifecycle] bounds sync effect starting (embedded mode only)");
    let cancelled = false;
    const run = () => {
      if (!cancelled) {
        trackPoll();
        scheduleSyncVideoBounds();
      }
    };
    run();
    const ro = new ResizeObserver(run);
    const el = videoAreaRef.current;
    if (el) ro.observe(el);
    const headerEl = playerHeaderChromeRef.current;
    const footerEl = playerFooterChromeRef.current;
    if (headerEl) ro.observe(headerEl);
    if (footerEl) ro.observe(footerEl);
    window.addEventListener("resize", run);
    window.addEventListener("scroll", run, true);
    const vv = window.visualViewport;
    vv?.addEventListener("resize", run);
    vv?.addEventListener("scroll", run);
    document.addEventListener("fullscreenchange", run);
    window.addEventListener("__pitflix_resync_bounds", run);
    const poll = window.setInterval(() => {
      trackPoll();
      run();
    }, 1000);
    let unlistenResize: UnlistenFn | undefined;
    let unlistenScale: UnlistenFn | undefined;
    let unlistenMove: UnlistenFn | undefined;
    void getCurrentWindow()
      .onResized(run)
      .then((u) => {
        unlistenResize = u;
      })
      .catch(() => {});
    void getCurrentWindow()
      .onScaleChanged(run)
      .then((u) => {
        unlistenScale = u;
      })
      .catch(() => {});
    // A pure window move (no resize) leaves the video area's rect relative to the WebView
    // unchanged, so syncVideoBounds' dedup check would otherwise skip re-sending it — but the
    // native video surface's on-screen position is computed from the window's absolute screen
    // position at invoke time, so it visually lags behind (looks like it's "stuck" where the
    // window used to be, e.g. peeking out from under the playlist) until something else forces
    // a resync. Drop the dedup key so the next sync always re-sends.
    void getCurrentWindow()
      .onMoved(() => {
        lastAppliedBoundsRef.current = null;
        // Bypass the debounce here: run() -> scheduleSyncVideoBounds() waits 96ms and restarts
        // on every call, so a continuous drag (which fires onMoved on every OS move tick) kept
        // resetting the timer and never actually repositioning the native surface until the
        // drag stopped — it visibly lagged behind, then snapped into place. A window move is a
        // single cheap native call, not a relayout storm, so it doesn't need debouncing.
        syncVideoBounds();
      })
      .then((u) => {
        unlistenMove = u;
      })
      .catch(() => {});
    return () => {
      cancelled = true;
      ro.disconnect();
      window.removeEventListener("resize", run);
      window.removeEventListener("scroll", run, true);
      vv?.removeEventListener("resize", run);
      vv?.removeEventListener("scroll", run);
      document.removeEventListener("fullscreenchange", run);
      window.removeEventListener("__pitflix_resync_bounds", run);
      clearInterval(poll);
      if (boundsSyncTimerRef.current) {
        clearTimeout(boundsSyncTimerRef.current);
        boundsSyncTimerRef.current = null;
      }
      void unlistenResize?.();
      void unlistenScale?.();
      void unlistenMove?.();
    };
  }, [embedReady, scheduleSyncVideoBounds]);

  useEffect(() => {
    if (!embedReady) return;
    lastAppliedBoundsRef.current = null;
    // Immediate, not debounced: this effect only fires on a handful of
    // deliberate, discrete UI actions (opening/closing the playlist,
    // switching files, toggling fullscreen) — not a rapid-fire event like
    // window drag-resize, where scheduleSyncVideoBounds's 96ms debounce
    // earns its keep.  Going through that debounce here left a perceptible
    // window where the playlist panel had already opened (shrinking the
    // video column in CSS) but the native mpv window hadn't been resized
    // yet — looking like the playlist briefly opened "on top of" the video
    // instead of beside it.
    syncVideoBounds();
    // A single synchronous call captures whatever the DOM measures on THIS tick, but
    // switching files while the playlist stays open/pinned (picking the next item from
    // the folder playlist) can involve a couple of follow-up reflows — the playlist's
    // active-row auto-scroll, the new title re-wrapping the header — that land a frame
    // or two later. If one of those lands after our one-shot measurement, the dedup key
    // in syncVideoBounds locks onto a stale (too-wide) rect and the native video surface
    // never gets corrected until something else forces a resync (e.g. toggling the
    // playlist closed and open again). Burst a couple of follow-up frames, same as
    // burstResync() below does for the playlist open/close case, so a late reflow can't
    // stick.
    let raf1 = 0;
    let raf2 = 0;
    raf1 = requestAnimationFrame(() => {
      lastAppliedBoundsRef.current = null;
      syncVideoBounds();
      raf2 = requestAnimationFrame(() => {
        lastAppliedBoundsRef.current = null;
        syncVideoBounds();
      });
    });
    return () => {
      cancelAnimationFrame(raf1);
      cancelAnimationFrame(raf2);
    };
  }, [
    embedReady,
    state?.filePath,
    folderPlaylistOpen,
    folderPlaylistPinned,
    isFullscreen,
    syncVideoBounds,
  ]);

  /** POL store can be cold until the first snapshot; warm it whenever external companion is active. */
  useEffect(() => {
    if (!externalReady) return;
    void playbackGetSnapshot().catch(() => {});
  }, [externalReady]);

  // Backend detector - runs FIRST to determine mode, before other effects
  // This must run as soon as state is available, not wait for embedReady/externalReady
  // Only depends on resumeChoice to avoid rerunning when state object reference changes
  useEffect(() => {
    if (!state || !isTauri() || resumeChoice === "pending" || resumeChoice === null) return;
    console.log("[lifecycle] backend detector effect triggered - resumeChoice:", resumeChoice);
    let alive = true;
    void getNativeState()
      .then((s) => {
        if (!alive) return;
        console.log("[lifecycle] backend state detected:", s.backend);
        setNativeState(s);
      })
      .catch((e) => {
        logPlayer2InvokeFailure("player2_get_state", e);
      });
    return () => {
      alive = false;
    };
  }, [state?.historyId, resumeChoice]);

  /** Always tear down the native embed on leave so HWNDs / Z-order cannot strand above the WebView. */
  useEffect(() => {
    return () => {
      if (!isTauri()) return;
      // In external mode, unmount/remount churn during route-state replacements can happen in dev/runtime transitions.
      // Closing external mpv here causes launch/kill loops. Let explicit close paths own external shutdown.
      if (!isNativeBackendEmbeddedLibmpv(nativeStateRef.current?.backend)) return;
      void invoke(p2cmd("player2_close")).catch((e) => logPlayer2InvokeFailure("player2_close", e));
    };
  }, []);

  useEffect(() => {
    timePosRef.current = timePos;
  }, [timePos]);
  useEffect(() => {
    durationRef.current = duration;
  }, [duration]);
  useEffect(() => {
    pausedRef.current = paused;
  }, [paused]);

  useEffect(() => {
    if (loading) {
      setVideoSettling(true);
      return;
    }
    const t = window.setTimeout(() => setVideoSettling(false), 450);
    return () => window.clearTimeout(t);
  }, [loading]);

  const resumeSeconds = state?.resumeSeconds;
  const showResumePrompt = resumeSeconds != null && resumeSeconds > 60;

  useEffect(() => {
    if (!state) {
      setError("Player session context is missing.");
      setLoading(false);
      return;
    }
    if (!isTauri()) {
      setError("Built-in player is only available in the Pitflix desktop app.");
      setLoading(false);
      return;
    }
    if (resumeSeconds != null && resumeSeconds > 10) {
      // Auto-resume for episode / folder-playlist switches (no prompt unless > 60 s).
      setResumeChoice("resume");
    } else {
      setResumeChoice("fromStart");
    }
  }, [state, navigate, showResumePrompt]);

  const effectiveStart = useMemo(() => {
    if (!state) return undefined;
    if (resumeChoice === "resume" && resumeSeconds != null) return resumeSeconds;
    return undefined;
  }, [state, resumeChoice, resumeSeconds]);

  const openPlayerWithStart = useCallback(
    async (startSeconds: number | null) => {
      if (!state) return;
      console.log("[lifecycle] openPlayerWithStart called - startSeconds:", startSeconds);
      setLoading(true);
      setError(null);
      setEnded(false);
      setSessionDead(false);
      try {
        await invoke(p2cmd("player2_open"), {
          payload: {
            path: state.filePath,
            start_seconds: startSeconds,
          },
        });
        const ns = await getNativeState();
        setNativeState(ns);
        setLoading(false);
        episodeSwitchInProgressRef.current = false;
        setPlaybackSpeedState(1);
        const savedVol = loadPlayerVolume();
        if (Math.abs(savedVol - volumeRef.current) >= 1) {
          setVolume(savedVol);
        }
        void invoke(p2cmd("player2_send"), { cmd: { type: "SetVolume", payload: savedVol } }).catch(() => {});
        const ext = isNativeBackendExternal(ns.backend);
        if (ext) {
          syncVideoBounds();
        } else {
          queueMicrotask(() => {
            syncVideoBounds();
            let n = 0;
            const burst = () => {
              syncVideoBounds();
              n += 1;
              if (n < 36) requestAnimationFrame(burst);
            };
            requestAnimationFrame(burst);
          });
        }
      } catch (e) {
        logPlayer2InvokeFailure("player2_open", e);
        setError(e instanceof Error ? e.message : String(e));
        setLoading(false);
        setSessionDead(true);
      }
    },
    [state, syncVideoBounds],
  );

  const openPlayer = useCallback(async () => {
    await openPlayerWithStart(effectiveStart ?? null);
  }, [openPlayerWithStart, effectiveStart]);

  const onFullscreen = useCallback(async () => {
    try {
      const w = getCurrentWindow();
      if (await w.isMaximized()) {
        await w.unmaximize();
      }
      const f = await w.isFullscreen();
      await w.setFullscreen(!f);
      await w.setFocus().catch(() => {});
      window.dispatchEvent(new Event("resize"));
      for (let i = 0; i < 20; i++) {
        await new Promise<void>((r) => {
          requestAnimationFrame(() => r());
        });
        syncVideoBounds();
      }
    } catch {
      setError("Failed to toggle fullscreen.");
    }
  }, [syncVideoBounds]);

  const onToggleMaximize = useCallback(async () => {
    try {
      const w = getCurrentWindow();
      if (await w.isFullscreen()) {
        await w.setFullscreen(false);
      }
      await w.toggleMaximize();
      await w.setFocus().catch(() => {});
      window.dispatchEvent(new Event("resize"));
      window.dispatchEvent(new Event("__pitflix_resync_bounds"));
      for (let i = 0; i < 12; i++) {
        await new Promise<void>((r) => {
          requestAnimationFrame(() => r());
        });
        syncVideoBounds();
      }
    } catch (e) {
      console.error("[pitflix-player] toggleMaximize failed", e);
      setError("Failed to toggle maximize.");
    }
  }, [syncVideoBounds]);

  useEffect(() => {
    const w = getCurrentWindow();
    let un: UnlistenFn | undefined;
    const sync = () => {
      void w.isFullscreen().then(setIsFullscreen);
      void w.isMaximized().then(setIsMaximized);
    };
    sync();
    void w
      .onResized(() => sync())
      .then((u) => {
        un = u;
      })
      .catch(() => {});
    const id = window.setInterval(sync, 800);
    return () => {
      clearInterval(id);
      void un?.();
      void restoreAppWindowFromFullscreen();
    };
  }, []);

  /** Centralized fullscreen auto-hide: one timer only. */
  const scheduleFullscreenHide = useCallback(() => {
    if (fsHideControlsTimerRef.current) clearTimeout(fsHideControlsTimerRef.current);
    const delay = pausedRef.current ? FS_HIDE_PAUSED_MS : FS_HIDE_IDLE_MS;
    fsHideControlsTimerRef.current = window.setTimeout(() => {
      if (seekDraggingRef.current || volumeDraggingRef.current || seekBarHoveringRef.current) {
        scheduleFullscreenHide();
        return;
      }
      setFsControlsVisible(false);
      fsHideControlsTimerRef.current = null;
    }, delay);
  }, []);

  const onFullscreenPointerActivity = useCallback(() => {
    setFsControlsVisible(true);
    scheduleFullscreenHide();
  }, [scheduleFullscreenHide]);

  useEffect(() => {
    return () => {
      if (fsHideControlsTimerRef.current) {
        clearTimeout(fsHideControlsTimerRef.current);
        fsHideControlsTimerRef.current = null;
      }
    };
  }, []);

  useEffect(() => {
    if (loading) return;
    setFsControlsVisible(true);
    scheduleFullscreenHide();
  }, [loading, scheduleFullscreenHide]);

  const screenPointToViewport = useCallback((screenX: number, screenY: number) => {
    const borderX = Math.max(0, (window.outerWidth - window.innerWidth) / 2);
    const borderY = Math.max(0, window.outerHeight - window.innerHeight);
    return {
      x: screenX - window.screenX - borderX,
      y: screenY - window.screenY - borderY,
    };
  }, []);

  const openPlayerContextMenu = useCallback((clientX: number, clientY: number) => {
    setFsControlsVisible(true);
    scheduleFullscreenHide();
    setPlayerContextMenu({ x: clientX, y: clientY });
  }, [scheduleFullscreenHide]);

  const closePlayerContextMenu = useCallback(() => {
    setPlayerContextMenu(null);
  }, []);

  const openPlayerContextMenuRef = useRef(openPlayerContextMenu);
  useEffect(() => {
    openPlayerContextMenuRef.current = openPlayerContextMenu;
  }, [openPlayerContextMenu]);

  useEffect(() => {
    let un: UnlistenFn | undefined;
    void listen<{ x: number; y: number }>("player2-video-contextmenu", (event) => {
      const { x, y } = event.payload;
      const pt = screenPointToViewport(x, y);
      // This native hook exists because WebView2 often never sees contextmenu/right-click
      // events over the embedded video's native pixels, so the Rust side fires it for ANY
      // right-click anywhere in the whole app window (see input_bridge.rs) — including over
      // DOM controls like playlist rows that already own and correctly open their own menu.
      // Back off here if the point actually lands on one of those, so we don't stack both.
      const el = document.elementFromPoint(pt.x, pt.y);
      const owned = el instanceof Element && el.closest('[data-own-context-menu="true"]') != null;
      console.info(`[pitflix-player] [ctxmenu:native-hook] pt=${pt.x},${pt.y} el=${el?.tagName}${owned ? " OWNED->skip" : " ->open-main"}`);
      if (owned) return;
      openPlayerContextMenuRef.current(pt.x, pt.y);
    }).then((u) => {
      un = u;
    });
    return () => {
      void un?.();
    };
  }, [screenPointToViewport]);

  useEffect(() => {
    // Capture-phase listeners on `document` fire before ANY React handler anywhere in the tree
    // (including the DOM-side opt-out fix on the outer player wrapper), so controls that own
    // their own right-click menu (playlist rows, previously the seek buttons) need to be
    // exempted here too, or this unconditionally opens the main menu on top of theirs.
    const ownsContextMenu = (target: EventTarget | null) =>
      target instanceof Element && target.closest('[data-own-context-menu="true"]') != null;
    const openFromClientPoint = (clientX: number, clientY: number) => {
      openPlayerContextMenu(clientX, clientY);
    };
    const onContextMenu = (e: MouseEvent) => {
      const owned = ownsContextMenu(e.target);
      console.info(`[pitflix-player] [ctxmenu:document-contextmenu] target=${(e.target as HTMLElement)?.tagName}${owned ? " OWNED->skip" : " ->open-main"}`);
      if (owned) return;
      e.preventDefault();
      openFromClientPoint(e.clientX, e.clientY);
    };
    const onPointerDown = (e: PointerEvent) => {
      if (e.button !== 2) return;
      const owned = ownsContextMenu(e.target);
      console.info(`[pitflix-player] [ctxmenu:document-pointerdown] target=${(e.target as HTMLElement)?.tagName}${owned ? " OWNED->skip" : " ->open-main"}`);
      if (owned) return;
      e.preventDefault();
      openFromClientPoint(e.clientX, e.clientY);
    };
    const onMouseDown = (e: MouseEvent) => {
      if (e.button !== 2) return;
      const owned = ownsContextMenu(e.target);
      console.info(`[pitflix-player] [ctxmenu:document-mousedown] target=${(e.target as HTMLElement)?.tagName}${owned ? " OWNED->skip" : " ->open-main"}`);
      if (owned) return;
      e.preventDefault();
      openFromClientPoint(e.clientX, e.clientY);
    };
    document.addEventListener("contextmenu", onContextMenu, true);
    document.addEventListener("pointerdown", onPointerDown, true);
    document.addEventListener("mousedown", onMouseDown, true);
    return () => {
      document.removeEventListener("contextmenu", onContextMenu, true);
      document.removeEventListener("pointerdown", onPointerDown, true);
      document.removeEventListener("mousedown", onMouseDown, true);
    };
  }, [openPlayerContextMenu]);

  useEffect(() => {
    if (!fsControlsVisible) return;
    scheduleFullscreenHide();
  }, [paused, fsControlsVisible, scheduleFullscreenHide]);

  useEffect(() => {
    if (!state || resumeChoice === "pending" || resumeChoice === null) return;
    if (openedHistoryIdRef.current === state.historyId) return;
    openedHistoryIdRef.current = state.historyId;
    if (skipNextOpenForCanonicalSyncRef.current) {
      skipNextOpenForCanonicalSyncRef.current = false;
      return;
    }
    void openPlayer();
  }, [state, resumeChoice, openPlayer]);

  const flushProgressAndStopRef = useRef<(historyId: number) => Promise<void>>(async () => {});

  useEffect(() => {
    if (!state) return;

    let un2: UnlistenFn | undefined;
    let unErr: UnlistenFn | undefined;
    let unResumeErr: UnlistenFn | undefined;
    let unVideoHover: UnlistenFn | undefined;
    let unVideoDown: UnlistenFn | undefined;
    let unPathChanged: UnlistenFn | undefined;
    void (async () => {
      un2 = await listen<Player2Event>("player2-event", (event) => {
        const e = event.payload;
        trackIpcEvent(e?.type || "unknown");
        if (e?.type === "State") {
          const s = e.payload;
          
          // THROTTLE: In external mode, only update UI state once per second
          // External mpv handles its own UI, we just need occasional progress sync
          // Use ref to avoid stale closure
          const isExternal = isNativeBackendExternal(nativeStateRef.current?.backend);
          
          // Always allow immediate updates for critical state changes
          const isCriticalChange = 
            s.paused !== pausedRef.current || 
            s.ended !== ended ||
            s.loading !== loading;
          
          if (isExternal && !isCriticalChange) {
            const now = Date.now();
            const timeSinceLastUpdate = now - lastStateUpdateTimeRef.current;
            
            if (timeSinceLastUpdate < STATE_UPDATE_THROTTLE_MS) {
              // Skip ALL state updates, just update refs for next sync
              timePosRef.current = num(s.time_pos);
              durationRef.current = num(s.duration);
              pausedRef.current = Boolean(s.paused);
              return; // CRITICAL: Return here to skip ALL setState calls below
            }
            
            lastStateUpdateTimeRef.current = now;
          }
          
          // Update refs for next comparison
          timePosRef.current = num(s.time_pos);
          durationRef.current = num(s.duration);
          pausedRef.current = Boolean(s.paused);
          
          if (lastLoggedEventPausedRef.current !== s.paused) {
            lastLoggedEventPausedRef.current = s.paused;
            playerDebugLog(
              `player2-event State: paused=${s.paused} loading=${s.loading} ended=${s.ended} time_pos=${s.time_pos}`,
            );
          }
          setLoading(Boolean(s.loading));
          setPaused(Boolean(s.paused));
          if (!s.paused) {
            setResumeOptimistic(false);
          }
          setEnded(Boolean(s.ended));
          if (!seekDraggingRef.current) {
            setTimePos(num(s.time_pos));
          }
          setDuration(num(s.duration));
          setMute(Boolean(s.mute));
          if (!volumeDraggingRef.current) {
            if (volumeHydratedForHistoryRef.current === historyIdRef.current) {
              setVolume(num(s.volume));
            }
          }
          setSubVisible(Boolean(s.sub_visible));
          setSid(typeof s.sid === "number" ? s.sid : null);
          setAid(typeof s.aid === "number" ? s.aid : null);
          if (typeof s.sub_delay === "number" && Number.isFinite(s.sub_delay)) {
            setSubDelay(s.sub_delay);
          }
          if (!s.loading) {
            setSessionDead(false);
          }
        }
        if (e?.type === "Tracks") {
          const tracks = e.payload?.tracks ?? [];
          setTracks(
            tracks.map((t) => ({
              id: t.id,
              type: t.track_type,
              lang: t.lang,
              title: t.title,
              selected: t.selected,
            })),
          );
        }
        if (e?.type === "Error") {
          const msg = e.payload?.message ?? "Player error";
          const lower = msg.toLowerCase();
          if (lower.includes("session ended")) {
            if (episodeSwitchInProgressRef.current || Date.now() < suppressAutoAdvanceUntilRef.current) {
              return;
            }
            setEnded(true);
            void tryAutoAdvanceOnEndRef.current().then((advanced) => {
              if (!advanced) setSessionDead(true);
            });
            return;
          }
          playerDebugLog(`player2-event Error: ${msg}`);
          setError(msg);
        }
      });

      unErr = await listen<{
        message?: string;
        session_id?: number;
        mpv_alive?: boolean | null;
        exit_code?: number | null;
        embedded_minimal_mode?: boolean;
      }>("player-ipc-error", (event) => {
        const sid = typeof event.payload?.session_id === "number" ? event.payload.session_id : null;

        if (sid != null && closedSessionsRef.current.has(sid)) {
          return;
        }

        const rawMsg = event.payload?.message ?? "Player communication error";
        const sanitized = sanitizeErrorMessage(rawMsg);
        const msgLower = rawMsg.toLowerCase();
        const isNormalClose =
          msgLower.includes("eof")
          || msgLower.includes("disconnected")
          || msgLower.includes("ipc disconnected");
        const backend = nativeStateRef.current?.backend ?? "";
        const isExternalPlayback = isNativeBackendExternal(backend);

        if (userInitiatedExitRef.current) {
          if (sid != null) closedSessionsRef.current.add(sid);
          return;
        }

        if (sid != null) {
          closedSessionsRef.current.add(sid);
        }

        // External companion: normal shutdown → leave immediately (no “session dead / reopen” trap),
        // then persist history/POL in the background.
        if (isExternalPlayback && isNormalClose) {
          if (episodeSwitchInProgressRef.current) {
            return;
          }
          const launch = launchStateRef.current;
          const dur = durationRef.current;
          const t = timePosRef.current;
          const remaining = dur > t ? dur - t : 0;
          const nearFinished = dur > 0 && remaining <= FINISHED_THRESHOLD_SECONDS;

          externalClosedHandledRef.current = true;
          console.info("[pitflix-player] external close detected via player-ipc-error", rawMsg);
          playerDebugLog(
            `close_detected reason="${rawMsg}" key=${launch ? playbackEpisodeKey(launch) : "none"} t=${Math.floor(t)} d=${Math.floor(
              dur,
            )}`,
          );

          if (nearFinished && launch?.historyId) {
            setEpisodeFinished(true);
            void dismissHistoryEntry(launch.historyId, true)
              .then(() => qc.invalidateQueries({ queryKey: ["history"] }))
              .catch((e) => console.error("[player] dismiss completed episode", e));
            navigateFromPlayer(navigate, launch?.returnTo, true);
            return;
          }

          if (launch?.historyId) {
            historyStopHandledRef.current = true;
            void flushProgressAndStopRef.current(launch.historyId).catch(() => {});
            void playbackPersistProgress({ historyId: launch.historyId }).catch(() => {});
          }

          navigateFromPlayer(navigate, launch?.returnTo, true);
          return;
        }

        if (isNormalClose && durationRef.current > 0) {
          if (Date.now() < suppressAutoAdvanceUntilRef.current) {
            return;
          }
          const remaining = durationRef.current - timePosRef.current;
          if (remaining <= FINISHED_THRESHOLD_SECONDS) {
            const launch = launchStateRef.current;
            setEpisodeFinished(true);
            setEnded(true);
            void tryAutoAdvanceOnEndRef.current().then((advanced) => {
              if (advanced) return;
              setSessionDead(true);
              if (launch?.historyId) {
                void dismissHistoryEntry(launch.historyId, true)
                  .then(() => qc.invalidateQueries({ queryKey: ["history"] }))
                  .catch((e) => console.error("[player] dismiss completed episode", e));
              }
            });
            return;
          }
        }

        if (!isNormalClose) {
          setTransportError(sanitized);
        } else {
          setSessionDead(true);
        }

        const mpvAlive = typeof event.payload?.mpv_alive === "boolean" ? event.payload.mpv_alive : null;
        const embeddedMinimal = Boolean(event.payload?.embedded_minimal_mode);
        if (
          !embeddedMinimal &&
          !isExternalPlayback &&
          sid != null &&
          mpvAlive === false &&
          autoRecoverAttemptedRef.current !== sid
        ) {
          autoRecoverAttemptedRef.current = sid;
          void invoke("player2_recover").catch((e) => {
            logPlayer2InvokeFailure("player2_recover", e);
            setTransportError(e instanceof Error ? e.message : String(e));
          });
        }
      });
      unResumeErr = await listen<{ message?: string }>("player2-error", (event) => {
        const rawMsg = event.payload?.message ?? "Playback failed";
        setResumeOptimistic(false);
        setTransportError(sanitizeErrorMessage(rawMsg));
      });
      unVideoHover = await listen("player2-video-hover", () => {
        onFullscreenPointerActivity();
      });
      unVideoDown = await listen("player2-video-pointerdown", () => {
        onFullscreenPointerActivity();
      });
      unPathChanged = await listen<{ session_id?: number; path?: string }>("player2-media-path-changed", (event) => {
        const mediaPath = event.payload?.path;
        if (!mediaPath) return;
        adoptCanonicalPlaybackFromPathRef.current(mediaPath);
      });
    })();

    return () => {
      void un2?.();
      void unErr?.();
      void unResumeErr?.();
      void unVideoHover?.();
      void unVideoDown?.();
      void unPathChanged?.();
    };
  }, [state, resumeChoice, onFullscreenPointerActivity, navigate, qc]);

  const flushProgressAndStop = useCallback(async (historyId: number) => {
    if (historyServerFinalizedRef.current) {
      historyStopHandledRef.current = true;
      return;
    }
    await refreshPlayheadIntoRefs();
    const tPos = timePosRef.current;
    const dur = durationRef.current;
    const launch = launchStateRef.current;
    const key = launch ? playbackEpisodeKey(launch) : "none";
    // Stray cleanup flush before playback started would otherwise persist t=0
    // AND set historyServerFinalizedRef=true, which then blocks the real close
    // flush. Bail out when nothing meaningful has been observed yet.
    if (tPos <= 0 && dur <= 0) {
      playerDebugLog(`persist_target skipped key=${key} historyId=${historyId} (no playback observed yet)`);
      return;
    }
    playerDebugLog(`persist_target start key=${key} historyId=${historyId} t=${Math.floor(tPos)} d=${Math.floor(dur)}`);
    const flushStart = performance.now();
    console.log("[close-lag] progress save start");

    const pos = Math.floor(tPos);
    if (pos > 0) {
      try {
        const progressStart = performance.now();
        await postHistoryProgress(historyId, {
          positionSeconds: pos,
          durationSeconds: dur > 0 ? Math.floor(dur) : undefined,
          markWatching: true,
        });
        const progressEnd = performance.now();
        console.log("[close-lag] postHistoryProgress completed in", (progressEnd - progressStart).toFixed(2), "ms");
      } catch (e) {
        console.error("[close-lag] postHistoryProgress failed:", e);
      }
    }
    try {
      const stoppedStart = performance.now();
      await historyStopped(historyId, {
        stoppedAt: new Date().toISOString(),
        positionSeconds: pos > 0 ? pos : undefined,
      });
      const stoppedEnd = performance.now();
      console.log("[close-lag] historyStopped completed in", (stoppedEnd - stoppedStart).toFixed(2), "ms");
      historyServerFinalizedRef.current = true;
    } catch (e) {
      console.error("[close-lag] historyStopped failed:", e);
    }
    
    const flushEnd = performance.now();
    console.log("[close-lag] progress save end, total duration:", (flushEnd - flushStart).toFixed(2), "ms");
    playerDebugLog(`persist_target done key=${key} historyId=${historyId} t=${Math.floor(tPos)} d=${Math.floor(dur)}`);
    
    historyStopHandledRef.current = true;
  }, [refreshPlayheadIntoRefs]);

  useEffect(() => {
    flushProgressAndStopRef.current = flushProgressAndStop;
  }, [flushProgressAndStop]);

  useEffect(() => {
    historyStopHandledRef.current = false;
    historyServerFinalizedRef.current = false;
    userInitiatedExitRef.current = false;
    externalClosedHandledRef.current = false;
    autoAdvanceIssuedForRef.current = null;
    openedHistoryIdRef.current = null;
    skipHistoryStopOnPlayerUnmountRef.current = false;
    subtitlePickAppliedForEpKeyRef.current = null;
    volumeHydratedForHistoryRef.current = null;
  }, [state?.historyId]);

  useEffect(() => {
    if (!externalReady || loading) return;
    const id = window.setInterval(() => {
      void getNativeState()
        .then((s) => {
          setNativeState(s);
          // Fallback: if no explicit IPC-close event arrives but external session is gone,
          // leave /player immediately instead of marooning on companion UI.
          if (!s.session_active && !externalClosedHandledRef.current && !episodeSwitchInProgressRef.current) {
            externalClosedHandledRef.current = true;
            console.info("[pitflix-player] external session inactive; navigating away from /player");
            navigateFromPlayer(navigate, launchStateRef.current?.returnTo, true);
          }
        })
        .catch(() => {});
    }, 1000);
    return () => window.clearInterval(id);
  }, [externalReady, loading, navigate]);

  const exitAndClose = useCallback(() => {
    void (async () => {
      // Backend only auto-marks a title "watched" when playback stopped within the last 2
      // seconds of the file (see IsPlaybackCompleted). Closing at 98-99% — someone skipped
      // the last few seconds of credits — falls just short of that, so ask before leaving
      // instead of silently leaving it "in progress" forever.
      let markWatchedOnClose = false;
      if (!endedRef.current && durationRef.current > 0) {
        await refreshPlayheadIntoRefs();
        const dur = durationRef.current;
        const pos = timePosRef.current;
        const pctNow = dur > 0 ? (pos / dur) * 100 : 0;
        const nearEndButNotAuto = pos < dur - 2 && pctNow >= 95;
        if (nearEndButNotAuto) {
          markWatchedOnClose = await pitflixConfirm("You're near the end — mark this as watched?");
        }
      }

      userInitiatedExitRef.current = true;
      skipHistoryStopOnPlayerUnmountRef.current = false;
      flushVolumePersist();
      const launch = launchStateRef.current;
      playerDebugLog(
        `close_request activeKey=${launch ? playbackEpisodeKey(launch) : "none"} t=${Math.floor(timePosRef.current)} d=${Math.floor(
          durationRef.current,
        )}`,
      );
      // Mark as handled up front so the unmount-cleanup effect doesn't fire a second, duplicate
      // flush once navigation below unmounts this page — the save below still happens, it just
      // no longer blocks the navigate-away (which was the cause of the empty-screen pause on close).
      historyStopHandledRef.current = true;
      if (launch?.historyId) {
        if (markWatchedOnClose) {
          // Explicit position=duration call, issued directly (not through flushProgressAndStop,
          // which re-reads the real native playhead via refreshPlayheadIntoRefs and would
          // overwrite this back to the actual, sub-threshold position).
          const dur = Math.floor(durationRef.current);
          void postHistoryProgress(launch.historyId, {
            positionSeconds: dur,
            durationSeconds: dur,
            markWatching: true,
          })
            .then(() => historyStopped(launch.historyId, { stoppedAt: new Date().toISOString(), positionSeconds: dur }))
            .then(() => {
              historyServerFinalizedRef.current = true;
              // We navigate away immediately below (before this write lands), so if Home is
              // already mounted its "always refetch on mount" can race ahead of the completion
              // write and cache the still-"in progress" row — leaving it stuck in Continue
              // Watching. Invalidate once the write actually lands so the next look is correct.
              void qc.invalidateQueries({ queryKey: ["home-history"] });
              void qc.invalidateQueries({ queryKey: ["home-watching-currently"] });
              void qc.invalidateQueries({ queryKey: ["watch-stats"] });
              void qc.invalidateQueries({ queryKey: ["stats"] });
              if (launch.libraryMovieId != null) {
                void qc.invalidateQueries({ queryKey: ["movie", launch.libraryMovieId] });
                void qc.invalidateQueries({ queryKey: ["movies"] });
              }
              if (launch.libraryShowId != null) {
                void qc.invalidateQueries({ queryKey: ["show", launch.libraryShowId] });
                void qc.invalidateQueries({ queryKey: ["series"] });
              }
            })
            .catch(() => {});
        } else {
          void flushProgressAndStop(launch.historyId).catch(() => {});
        }
      }
      if (launch?.filePath) {
        recordDeviceLastPlayedFromPlayer(launch.filePath, {
          suppressContinueWatching: launch.suppressContinueWatching,
          returnToPathname: launch.returnTo?.pathname,
        });
      }
      void playbackPersistProgress({ historyId: launch?.historyId ?? undefined }).catch(() => {});
      void playbackCancelNextCountdown().catch(() => {});
      navigateFromPlayer(navigate, launch?.returnTo, true);
      void invoke(p2cmd("player2_close")).catch((e) => logPlayer2InvokeFailure("player2_close", e));
    })();
  }, [navigate, flushProgressAndStop, flushVolumePersist, refreshPlayheadIntoRefs]);

  useEffect(() => {
    if (!state || resumeChoice === "pending") return;
    if (!ended) return;
    void flushProgressAndStop(state.historyId);
  }, [ended, state, resumeChoice, flushProgressAndStop]);

  useEffect(() => {
    if (!state || resumeChoice === "pending") return;
    const interval = window.setInterval(() => {
      if (historyServerFinalizedRef.current) return;
      const pos = Math.floor(timePosRef.current);
      const dur = durationRef.current;
      if (pos <= 0 || pos === lastProgressRef.current) return;
      lastProgressRef.current = pos;

      trackProgressSave();
      void postHistoryProgress(state.historyId, {
        positionSeconds: pos,
        durationSeconds: dur > 0 ? Math.floor(dur) : undefined,
        markWatching: true,
      });
      void playbackPersistProgress({ historyId: state.historyId }).catch(() => {});

      trackQueryInvalidation();
      void qc.invalidateQueries({ queryKey: ["history"] });
    }, HISTORY_PROGRESS_HEARTBEAT_MS);
    return () => window.clearInterval(interval);
  }, [state, qc, resumeChoice]);

  useEffect(() => {
    if (!state?.libraryShowId || state.libraryEpisodeId == null) {
      canonicalTargetsRef.current = { episodeId: null, next: null, prev: null };
      setNextEp(undefined);
      setPrevEp(undefined);
      return;
    }
    const episodeId = state.libraryEpisodeId;
    void Promise.all([
      getNextLibraryEpisode(state.libraryShowId, episodeId),
      getPreviousLibraryEpisode(state.libraryShowId, episodeId),
    ]).then(([n, p]) => {
      canonicalTargetsRef.current = {
        episodeId,
        next: n.next ?? null,
        prev: p.previous ?? null,
      };
      setNextEp(n.next);
      setPrevEp(p.previous);
    });
  }, [state?.libraryShowId, state?.libraryEpisodeId]);

  useEffect(() => {
    skipDismissedRef.current = { intro: false, outro: false };
    if (state?.libraryEpisodeId == null) {
      setSkipData(null);
      return;
    }
    let cancelled = false;
    void getEpisodeSkip(state.libraryEpisodeId)
      .then((res) => {
        if (!cancelled) setSkipData(res);
      })
      .catch(() => {
        if (!cancelled) setSkipData(null);
      });
    return () => {
      cancelled = true;
    };
  }, [state?.libraryEpisodeId]);

  const activeSkipSegment: ActiveSkipSegment | null = (() => {
    if (!skipData) return null;
    const { intro, outro } = skipData;
    // Heuristic-sourced segments (confidence 0.3, a fixed-offset guess with no real signal
    // from this file) are too unreliable to surface — especially for unscripted/documentary
    // content where intro/outro placement varies episode to episode. False positives (skipping
    // into real content) are worse than false negatives, so these stay computed/stored but
    // hidden from the UI until a higher-confidence source (chapter/AniSkip/fingerprint) exists.
    if (outro && outro.source !== "heuristic" && !skipDismissedRef.current.outro &&
        timePos >= outro.start && timePos < outro.end) {
      return { kind: "outro", segment: outro };
    }
    if (intro && intro.source !== "heuristic" && !skipDismissedRef.current.intro &&
        timePos >= intro.start && timePos < intro.end) {
      return { kind: "intro", segment: intro };
    }
    return null;
  })();

  useEffect(() => {
    const hid = state?.historyId;
    return () => {
      if (hid == null || historyStopHandledRef.current) return;
      if (skipHistoryStopOnPlayerUnmountRef.current && isNativeBackendExternal(nativeStateRef.current?.backend)) {
        skipHistoryStopOnPlayerUnmountRef.current = false;
        void checkpointWatchProgressNoStop().catch(() => {});
        return;
      }
      void flushProgressAndStopRef.current(hid).catch(() => {});
    };
  }, [state?.historyId, checkpointWatchProgressNoStop]);

  useEffect(() => {
    const hid = state?.historyId;
    if (hid == null) return;
    const onPageHide = () => {
      if (historyStopHandledRef.current) return;
      void flushProgressAndStopRef.current(hid).catch(() => {});
    };
    window.addEventListener("pagehide", onPageHide);
    return () => window.removeEventListener("pagehide", onPageHide);
  }, [state?.historyId]);

  const send = useCallback(async (cmd: unknown) => {
    try {
      await invoke(p2cmd("player2_send"), { cmd });
    } catch (e) {
      logPlayer2InvokeFailure("player2_send", e);
      console.warn("player_send failed", e);
      playerDebugLog(`send failed: ${e instanceof Error ? e.message : String(e)} cmd=${JSON.stringify(cmd)}`);
      setSessionDead(true);
      setError(e instanceof Error ? e.message : String(e));
      throw e;
    }
  }, []);

  const dismissActiveSkipSegment = useCallback(() => {
    if (!activeSkipSegment) return;
    skipDismissedRef.current[activeSkipSegment.kind] = true;
  }, [activeSkipSegment]);

  const skipActiveSegment = useCallback(() => {
    if (!activeSkipSegment) return;
    skipDismissedRef.current[activeSkipSegment.kind] = true;
    void send({ type: "SeekAbsolute", payload: activeSkipSegment.segment.end });
  }, [activeSkipSegment, send]);

  const setSubtitlePref = useCallback(
    <K extends keyof PlayerSubtitlePrefs>(key: K, value: PlayerSubtitlePrefs[K]) => {
      setSubtitlePrefs((prev) => ({ ...prev, [key]: value }));
    },
    [],
  );

  const applySubStylePreset = useCallback((preset: "white" | "warm" | "cyan" | "arabic") => {
    const presets: Record<
      typeof preset,
      Pick<PlayerSubtitlePrefs, "textColor" | "borderColor" | "borderSize">
    > = {
      white: { textColor: "#FFFFFFFF", borderColor: "#000000D0", borderSize: 2 },
      warm: { textColor: "#FFE7B0FF", borderColor: "#000000D0", borderSize: 2 },
      cyan: { textColor: "#9FE8FFFF", borderColor: "#000000D0", borderSize: 2 },
      arabic: { textColor: "#FFF4E0FF", borderColor: "#000000F0", borderSize: 2.6 },
    };
    setSubtitlePrefs((prev) => ({ ...prev, ...presets[preset] }));
  }, []);

  useEffect(() => {
    if (typeof localStorage !== "undefined") {
      saveSubtitlePrefs(subtitlePrefs);
    }
    const applySubtitlePrefs = async () => {
      if ((!embedReady && !externalReady) || sessionDead) return;
      try {
        await send({ type: "SetSubFontSize", payload: subtitlePrefs.fontSize });
        await send({ type: "SetSubColor", payload: subtitlePrefs.textColor });
        await send({ type: "SetSubBorderColor", payload: subtitlePrefs.borderColor });
        await send({ type: "SetSubBorderSize", payload: subtitlePrefs.borderSize });
        await send({ type: "SetSubBackColor", payload: subtitlePrefs.backColor });
        await send({ type: "SetSubShadowColor", payload: subtitlePrefs.shadowColor });
        await send({ type: "SetSubShadowOffset", payload: subtitlePrefs.shadowOffset });
        await send({ type: "SetSubPosition", payload: subtitlePrefs.position });
        if (subtitlePrefs.fontFamily.trim().length > 0) {
          await send({ type: "SetSubFont", payload: subtitlePrefs.fontFamily.trim() });
        }
      } catch {
        // `send` already surfaces transport failures.
      }
    };
    void applySubtitlePrefs();
  }, [subtitlePrefs, embedReady, externalReady, sessionDead, send]);

  // Nudge subtitles up while the controls bar is visible so it doesn't sit under/behind it,
  // then restore the user's saved position once the bar auto-hides again.
  useEffect(() => {
    if ((!embedReady && !externalReady) || sessionDead) return;
    const raisedPosition = Math.max(40, subtitlePrefs.position - 15);
    const target = fsControlsVisible ? raisedPosition : subtitlePrefs.position;
    void send({ type: "SetSubPosition", payload: target }).catch(() => {
      // `send` already surfaces transport failures.
    });
  }, [fsControlsVisible, subtitlePrefs.position, embedReady, externalReady, sessionDead, send]);

  const runConfirmedPlayback = useCallback(
    async (kind: "pause" | "resume") => {
      if (!state || ended || sessionDead) return;
      if (playbackTransportPendingRef.current) {
        playerDebugLog(`transport: ${kind} ignored (pending)`);
        return;
      }
      if (kind === "pause" && paused) return;
      if (kind === "resume") {
        if (!paused) return;
        if (resumeOptimistic) return;
      }

      playbackTransportPendingRef.current = true;
      if (kind === "pause") {
        setPlaybackTransportPending(true);
      }
      setTransportError(null);
      if (kind === "resume") {
        setResumeOptimistic(true);
        playerDebugLog(
          `transport: resume_cmd_sent_ui_ms=${Math.round(performance.now())} (optimistic playing until State or error)`,
        );
      }
      playerDebugLog(`transport: ${kind} invoke (UI paused=${paused} ended=${ended})`);
      const t0 = performance.now();
      if (kind === "resume") {
        void p2resume()
          .then(() => {
            playerDebugLog(
              `transport: resume invoke_returned_ms=${Math.round(performance.now() - t0)} (enqueued; confirm via player2-event)`,
            );
            void getCurrentWindow().setFocus().catch(() => {});
            syncVideoBounds();
          })
          .catch((e) => {
            logPlayer2InvokeFailure("player2_resume", e);
            const msg = e instanceof Error ? e.message : String(e);
            setTransportError(sanitizeErrorMessage(msg));
            setResumeOptimistic(false);
            playerDebugLog(`transport: resume failed after ${Math.round(performance.now() - t0)}ms: ${msg}`);
          })
          .finally(() => {
            playbackTransportPendingRef.current = false;
            setPlaybackTransportPending(false);
          });
        return;
      }
      try {
        await p2pause();
        playerDebugLog(
          `transport: pause invoke_returned_ms=${Math.round(performance.now() - t0)} total_since_sent=${Math.round(performance.now() - t0)}`,
        );
        void getCurrentWindow().setFocus().catch(() => {});
        syncVideoBounds();
      } catch (e) {
        logPlayer2InvokeFailure("player2_pause", e);
        const msg = e instanceof Error ? e.message : String(e);
        setTransportError(sanitizeErrorMessage(msg));
        playerDebugLog(`transport: pause failed after ${Math.round(performance.now() - t0)}ms: ${msg}`);
      } finally {
        playbackTransportPendingRef.current = false;
        setPlaybackTransportPending(false);
      }
    },
    [state, ended, sessionDead, paused, resumeOptimistic, syncVideoBounds],
  );

  const handlePrimaryTransport = useCallback(async () => {
    if (!state) return;
    if (ended) {
      await openPlayerWithStart(0);
      return;
    }
    if (sessionDead) {
      const t = timePosRef.current;
      await openPlayerWithStart(t > 0.5 ? t : null);
      return;
    }
    if (displayPaused) {
      await runConfirmedPlayback("resume");
    } else {
      await runConfirmedPlayback("pause");
    }
  }, [state, ended, sessionDead, displayPaused, openPlayerWithStart, runConfirmedPlayback]);

  const seekRel = useCallback(
    (sec: number) => {
      if (ended || sessionDead) return;
      // Fine 1s nudges (Shift+Arrow) stay frame-exact; coarser skips (5s buttons/arrows) use
      // fast keyframe seeking so they feel responsive.
      const exact = Math.abs(sec) <= 1;
      void send({ type: "SeekRelative", payload: { seconds: sec, exact } });
      scheduleSeekProgressFlush();
    },
    [send, ended, sessionDead, scheduleSeekProgressFlush],
  );

  const seekToAbsolute = useCallback(
    (seconds: number) => {
      if (ended || sessionDead) return;
      const dur = durationRef.current;
      const t = dur > 0 ? Math.max(0, Math.min(dur, seconds)) : Math.max(0, seconds);
      timePosRef.current = t;
      setTimePos(t);
      void send({ type: "SeekAbsolute", payload: t });
      scheduleSeekProgressFlush();
    },
    [send, ended, sessionDead, scheduleSeekProgressFlush],
  );
  const bumpVolumeHud = useCallback(() => {
    setVolumeHudVisible(true);
    if (volumeHudTimerRef.current) clearTimeout(volumeHudTimerRef.current);
    volumeHudTimerRef.current = window.setTimeout(() => {
      volumeHudTimerRef.current = null;
      setVolumeHudVisible(false);
    }, 1600);
  }, []);
  const toggleMute = useCallback(() => {
    if (ended || sessionDead) return;
    bumpVolumeHud();
    void send({ type: "SetMute", payload: !mute });
  }, [send, mute, ended, sessionDead, bumpVolumeHud]);
  const setPlaybackSpeed = useCallback(
    (speed: number) => {
      if (ended || sessionDead) return;
      const clamped = Math.min(4, Math.max(0.25, speed));
      setPlaybackSpeedState(clamped);
      void send({ type: "SetSpeed", payload: clamped }).catch(() => {});
    },
    [ended, sessionDead, send],
  );
  const toggleSub = useCallback(() => {
    if (ended || sessionDead) return;
    void send({ type: "SetSubVisibility", payload: !subVisible });
  }, [send, subVisible, ended, sessionDead]);

  const subtitleDrawerTitle = useMemo(() => {
    if (!state) return "";
    if (state.libraryEpisodeId != null && state.season != null && state.episodeNumber != null) {
      const show = state.seriesName?.trim() || state.title;
      return `${show} S${state.season}E${state.episodeNumber}`;
    }
    return state.title;
  }, [state]);

  const subtitleDrawerMode: "movie" | "episode" =
    state?.libraryEpisodeId != null ? "episode" : "movie";

  const closeSubtitleSearch = useCallback(() => {
    setSubtitleSearchOpen(false);
    if (pausedForSubtitleSearchRef.current) {
      pausedForSubtitleSearchRef.current = false;
      void send({ type: "SetPaused", payload: false });
    }
  }, [send]);

  const openSubtitleSearch = useCallback(() => {
    if (ended || sessionDead || !state?.filePath) return;
    if (!displayPaused) {
      pausedForSubtitleSearchRef.current = true;
      void send({ type: "SetPaused", payload: true });
    } else {
      pausedForSubtitleSearchRef.current = false;
    }
    setSubtitleSearchOpen(true);
  }, [ended, sessionDead, state?.filePath, displayPaused, send]);

  const onSubtitleDownloadedInPlayer = useCallback(
    (savedPath: string) => {
      const launch = launchStateRef.current;
      if (launch && launch.libraryEpisodeId != null && launch.libraryEpisodeId > 0) {
        persistEpSubPick(playbackEpisodeKey(launch), `x:${encodeURIComponent(savedPath)}`);
      }
      void send({ type: "SubAddSelect", payload: savedPath });
      window.setTimeout(() => closeSubtitleSearch(), 1200);
    },
    [send, closeSubtitleSearch],
  );
  
  // Arabic Subtitle Generation Handler
  const generateArabicSubtitle = useCallback(async () => {
    if (!state?.filePath) {
      setArabicSubtitleError("No video file path available");
      return;
    }
    
    setArabicSubtitleGenerating(true);
    setArabicSubtitleProgress(null);
    setArabicSubtitleError(null);

    const unlisten = await listen<{ current: number; total: number }>("arabic-subtitle-progress", (event) => {
      setArabicSubtitleProgress(event.payload);
    });
    
    try {
      const outputPath = await invoke<string>("generate_arabic_subtitle", {
        videoPath: state.filePath,
      });
      
      await send({ type: "SubAddSelect", payload: outputPath });
      
      setTimeout(() => {
        setArabicSubtitleGenerating(false);
        setArabicSubtitleProgress(null);
      }, 500);
    } catch (err) {
      const errorMsg = err instanceof Error ? err.message : String(err);
      setArabicSubtitleError(errorMsg);
      setArabicSubtitleGenerating(false);
      setArabicSubtitleProgress(null);
    } finally {
      unlisten();
    }
  }, [state?.filePath, send]);

  const setVolumePct = useCallback(
    (v: number, opts?: { silent?: boolean }) => {
      if (ended || sessionDead) return;
      const clamped = Math.round(Math.min(200, Math.max(0, v)));
      const prev = volumeRef.current;
      setVolume(clamped);
      if (!opts?.silent) bumpVolumeHud();
      void send({ type: "SetVolume", payload: clamped }).catch(() => {
        setVolume(prev);
      });
    },
    [send, ended, sessionDead, bumpVolumeHud],
  );

  /** React `onWheel` is passive; useCapture + non-passive so volume scroll does not scroll the page. */
  useEffect(() => {
    const el = volumeWheelRef.current;
    if (!el) return;
    const blocks = ended || sessionDead;
    const onWheel = (e: WheelEvent) => {
      if (blocks) return;
      e.preventDefault();
      e.stopPropagation();
      const step = e.deltaY < 0 ? VOLUME_WHEEL_STEP : -VOLUME_WHEEL_STEP;
      setVolumePct(volumeRef.current + step);
    };
    el.addEventListener("wheel", onWheel, { passive: false });
    return () => el.removeEventListener("wheel", onWheel);
  }, [embedReady, ended, sessionDead, setVolumePct]);

  /** Volume wheel over the main video region (same behavior as footer slider). */
  useEffect(() => {
    const el = videoAreaRef.current;
    if (!el) return;
    const blocks = ended || sessionDead;
    const onWheel = (e: WheelEvent) => {
      if (blocks) return;
      e.preventDefault();
      e.stopPropagation();
      const step = e.deltaY < 0 ? VOLUME_WHEEL_STEP : -VOLUME_WHEEL_STEP;
      setVolumePct(volumeRef.current + step);
    };
    el.addEventListener("wheel", onWheel, { passive: false });
    return () => el.removeEventListener("wheel", onWheel);
  }, [embedReady, ended, sessionDead, setVolumePct]);

  useEffect(() => {
    setTracks([]);
  }, [state?.filePath]);

  const subTracks = useMemo(
    () => tracks.filter((t) => t.type === "sub" || t.type === "subtitle"),
    [tracks],
  );
  const audioTracks = useMemo(() => tracks.filter((t) => t.type === "audio"), [tracks]);

  const subMenuValue = useMemo(
    () => resolveSubtitleMenuValue(sid, subTracks, externalSubFiles),
    [sid, subTracks, externalSubFiles],
  );

  const takeScreenshot = useCallback(async () => {
    if (!isTauri() || !state?.filePath) return;
    const pos = Math.max(0, timePosRef.current);
    const outputPath = await save({
      defaultPath: safePlayerExportFileName(state.title, fmtTimeForFilename(pos), "png"),
      filters: [{ name: "PNG image", extensions: ["png"] }],
    });
    if (!outputPath) return;
    setPlayerExportBusy("Saving screenshot…");
    try {
      const subtitles = resolvePlayerExportSubtitleBurn({
        subVisible,
        sid,
        subDelay,
        subMenuValue,
        subTracks,
        externalSubFiles,
      });
      await invoke("player2_export_screenshot", {
        sourcePath: state.filePath,
        timeSeconds: pos,
        outputPath,
        subtitles,
      });
    } catch (e) {
      window.alert(e instanceof Error ? e.message : String(e));
    } finally {
      setPlayerExportBusy(null);
    }
  }, [state?.filePath, state?.title, subVisible, sid, subDelay, subMenuValue, subTracks, externalSubFiles]);

  const openClipExport = useCallback(() => {
    setClipExportOpen(true);
  }, []);

  useEffect(() => {
    if ((!embedReady && !externalReady) || sessionDead || !state) return;
    const epKey = playbackEpisodeKey(state);
    if (!epKey.startsWith("ep:")) return;
    const saved = loadEpSubPickMap()[epKey];
    if (!saved) return;
    if (subtitlePickAppliedForEpKeyRef.current === epKey) return;
    if (subTracks.length === 0 && externalSubFiles.length === 0) return;
    const matchExt = (val: string) =>
      val.startsWith("x:") && externalSubFiles.some((p) => `x:${encodeURIComponent(p)}` === val);
    const matchEmb = (val: string) =>
      val.startsWith("e:") && subTracks.some((t) => t.id != null && `e:${t.id}` === val);
    const ok = saved === "" || matchEmb(saved) || matchExt(saved);
    if (!ok) return;
    subtitlePickAppliedForEpKeyRef.current = epKey;
    void (async () => {
      try {
        if (saved === "") await send({ type: "SetSid", payload: -1 });
        else if (saved.startsWith("x:")) {
          const path = decodeURIComponent(saved.slice(2));
          await send({ type: "SubAddSelect", payload: path });
        } else if (saved.startsWith("e:")) {
          await send({ type: "SetSid", payload: Number(saved.slice(2)) });
        }
      } catch {
        /* send() already surfaced transport failures */
      }
    })();
  }, [embedReady, externalReady, sessionDead, state, subTracks, externalSubFiles, send]);

  useEffect(() => {
    if (typeof localStorage === "undefined") return;
    if (!embedReady && !externalReady) return;
    if (sessionDead) return;
    if (volumePersistTimerRef.current) clearTimeout(volumePersistTimerRef.current);
    volumePersistTimerRef.current = window.setTimeout(() => {
      volumePersistTimerRef.current = null;
      try {
        localStorage.setItem(PLAYER_VOLUME_STORAGE_KEY, String(Math.round(volume)));
      } catch {
        /* ignore */
      }
    }, 400);
    return () => {
      if (volumePersistTimerRef.current) {
        clearTimeout(volumePersistTimerRef.current);
        volumePersistTimerRef.current = null;
      }
    };
  }, [volume, embedReady, externalReady, sessionDead]);

  useEffect(() => {
    if (!embedReady && !externalReady) return;
    if (sessionDead || !state) return;
    if (volumeHydratedForHistoryRef.current === state.historyId) return;
    volumeHydratedForHistoryRef.current = state.historyId;
    const parsed = loadPlayerVolume();
    const cur = volumeRef.current;
    if (Math.abs(parsed - cur) >= 1) {
      setVolumePct(parsed, { silent: true });
    }
  }, [embedReady, externalReady, sessionDead, state?.historyId, setVolumePct]);

  const ctxLabel = useMemo(() => {
    if (!state) return "";
    if (state.mediaType === "Series" && state.season != null && state.episodeNumber != null) {
      return `S${state.season} · E${state.episodeNumber}`;
    }
    return state.mediaType === "Movie" ? "Movie" : "Episode";
  }, [state]);

  const pct = duration > 0 ? Math.min(100, (timePos / duration) * 100) : 0;
  const remaining = Math.max(0, duration - timePos);

  const isExternalMode = isNativeBackendExternal(nativeState?.backend);
  // External mpv: cinematic companion (banner, episodes, shortcuts). Embedded libmpv: full video chrome.
  const isCompanionOnlyMode = isExternalMode;
  const polSnap = polPlayback.snapshot;
  const polSeq = polPlayback.seq;
  const uiTimePos = isExternalMode && polSeq > 0 ? polSnap.currentTime : timePos;
  const uiDuration = isExternalMode && polSeq > 0 ? polSnap.duration : duration;
  const uiPct = isExternalMode && polSeq > 0 ? polSnap.progressPct : pct;
  const polPaused = isExternalMode && polSeq > 0 ? polSnap.phase === "paused" : paused;
  const polEnded = isExternalMode && polSeq > 0 ? polSnap.phase === "ended" : ended;
  const resumeMarkerSec =
    resumeChoice === "resume" && (resumeSeconds ?? 0) > 30 ? resumeSeconds : null;

  const companionShowRecord = companionShowQ.data?.show as {
    title?: string;
    selectedBackdropPath?: string | null;
    backdropLocalPath?: string | null;
  } | undefined;
  const companionBackdropPath =
    companionShowRecord?.selectedBackdropPath ??
    companionShowRecord?.backdropLocalPath ??
    null;
  const companionSeriesTitle =
    state?.seriesName?.trim() ||
    companionShowRecord?.title?.trim() ||
    state?.title?.split(" · ")[0]?.trim() ||
    state?.title ||
    "Now playing";
  const companionSeasonEpisodes = useMemo((): CompanionEpisodeRow[] => {
    const eps = (companionSeasonQ.data?.episodes ?? []) as Array<{
      id: number;
      episodeNumber: number;
      title?: string | null;
      filePath: string;
      stillLocalPath?: string | null;
    }>;
    return eps.map((e) => ({
      id: e.id,
      episodeNumber: e.episodeNumber,
      title: e.title,
      filePath: e.filePath,
      stillLocalPath: e.stillLocalPath,
    }));
  }, [companionSeasonQ.data?.episodes]);
  const companionSeasonName = (companionSeasonQ.data?.seasonName as string | undefined) ?? null;
  const companionEpisodeTitle = useMemo(() => {
    if (!state) return null;
    const current = companionSeasonEpisodes.find((e) => e.id === state.libraryEpisodeId);
    if (current?.title) return current.title;
    const parts = state.title.split(" · ");
    if (parts.length > 1) return parts.slice(1).join(" · ").trim() || null;
    return state.mediaType === "Series" ? null : state.title;
  }, [state, companionSeasonEpisodes]);

  const navigateToEpisode = useCallback(
    async (ep: NextLibraryEpisode, title: string) => {
      if (!state) return;
      const fromKey = playbackEpisodeKey(state);
      const toKey = `ep:${ep.id}`;
      episodeSwitchInProgressRef.current = true;
      suppressAutoAdvanceUntilRef.current = Date.now() + 4000;
      try {
        const switchMsg = `episode_switch initiated from=${fromKey} to=${toKey} historyId=${state.historyId}`;
        console.info("[pitflix-player]", switchMsg);
        playerDebugLog(switchMsg);
        // Saving the outgoing episode's progress doesn't need to block starting the next one —
        // mark it handled (so the unmount-cleanup effect below doesn't duplicate it) and let it
        // finish in the background instead of stalling the switch on two network round-trips.
        historyStopHandledRef.current = true;
        void flushProgressAndStop(state.historyId).catch(() => {});
        const closePromise = isTauri()
          ? invoke(p2cmd("player2_close")).catch((e) => logPlayer2InvokeFailure("player2_close", e))
          : Promise.resolve();
        const addHistoryPromise = addHistory({
          filePath: ep.filePath,
          title,
          posterPath: state.posterPath ?? undefined,
          mediaType: "Series",
          durationSeconds: 0,
        }) as Promise<{ id: number }>;
        const resumePromise = resolveResumeSecondsForPath(ep.filePath);
        const [, { id: newId }, resumeForTarget] = await Promise.all([closePromise, addHistoryPromise, resumePromise]);
        const resolvedMsg = `episode_switch resolved newHistoryId=${newId} newKey=${toKey} title=${title} resumeSeconds=${resumeForTarget ?? 0}`;
        console.info("[pitflix-player]", resolvedMsg);
        playerDebugLog(resolvedMsg);
        navigate("/player", {
          replace: true,
          state: {
            historyId: newId,
            filePath: ep.filePath,
            resumeSeconds: resumeForTarget,
            title,
            posterPath: state.posterPath,
            mediaType: "Series",
            durationSeconds: 0,
            libraryShowId: state.libraryShowId,
            libraryEpisodeId: ep.id,
            season: ep.season,
            episodeNumber: ep.episodeNumber,
            seriesName: state.seriesName ?? state.title.split(" · ")[0],
            returnTo: pickReturnToAfterLibraryNavigation(
              state.returnTo,
              "Series",
              undefined,
              state.libraryShowId,
              ep.season,
            ),
            ...(state.useLibMpv ? { useLibMpv: true } : {}),
          },
        });
      } catch (err) {
        episodeSwitchInProgressRef.current = false;
        throw err;
      }
    },
    [state, navigate, flushProgressAndStop],
  );

  const onSelectCompanionEpisode = useCallback(
    (ep: CompanionEpisodeRow) => {
      if (!state || state.season == null) return;
      void navigateToEpisode(
        {
          id: ep.id,
          filePath: ep.filePath,
          season: state.season,
          episodeNumber: ep.episodeNumber,
          title: ep.title ?? null,
        },
        ep.title ?? state.title ?? "Episode",
      );
    },
    [navigateToEpisode, state],
  );

  const navigateToSiblingFile = useCallback(
    async (entry: DeviceFsEntry) => {
      if (!state) return;
      if (!entry?.path || entry.path === state.filePath) return;
      const fromKey = normalizeMediaPathKey(state.filePath);
      const toKey = normalizeMediaPathKey(entry.path);
      episodeSwitchInProgressRef.current = true;
      suppressAutoAdvanceUntilRef.current = Date.now() + 4000;
      flushVolumePersist();
      try {
        const switchMsg = `folder_playlist_switch initiated from=${fromKey} to=${toKey} historyId=${state.historyId}`;
        console.info("[pitflix-player]", switchMsg);
        playerDebugLog(switchMsg);
        historyStopHandledRef.current = true;
        void flushProgressAndStop(state.historyId).catch(() => {});
        const title = fileDisplayTitle(entry.name);
        const suppressCw = isDevicePlaybackSession(state);
        const closePromise = isTauri()
          ? invoke(p2cmd("player2_close")).catch((e) => logPlayer2InvokeFailure("player2_close", e))
          : Promise.resolve();
        const addHistoryPromise = addHistory({
          filePath: entry.path,
          title,
          posterPath: state.posterPath ?? undefined,
          mediaType: state.mediaType,
          durationSeconds: 0,
          ...(suppressCw ? { suppressContinueWatching: true } : {}),
        }) as Promise<{ id: number }>;
        const resumePromise = resolveResumeSecondsForPath(entry.path);
        const [, { id: newId }, resumeForTarget] = await Promise.all([closePromise, addHistoryPromise, resumePromise]);
        const resolvedMsg = `folder_playlist_switch resolved newHistoryId=${newId} newKey=${toKey} title=${title} resumeSeconds=${resumeForTarget ?? 0}`;
        console.info("[pitflix-player]", resolvedMsg);
        playerDebugLog(resolvedMsg);
        navigate("/player", {
          replace: true,
          state: {
            historyId: newId,
            filePath: entry.path,
            resumeSeconds: resumeForTarget,
            title,
            posterPath: state.posterPath,
            mediaType: state.mediaType,
            durationSeconds: 0,
            returnTo: state.returnTo,
            ...(suppressCw ? { suppressContinueWatching: true } : {}),
            ...(state.useLibMpv ? { useLibMpv: true } : {}),
            ...(state.liveChannels?.length ? { liveChannels: state.liveChannels } : {}),
          },
        });
        void qc.invalidateQueries({ queryKey: ["home-history"] });
        void qc.invalidateQueries({ queryKey: ["history"] });
        recordDeviceLastPlayedFromPlayer(entry.path, {
          suppressContinueWatching: suppressCw,
          returnToPathname: state.returnTo?.pathname,
        });
        if (!folderPlaylistPinned) {
          setFolderPlaylistOpen(false);
        }
      } catch (err) {
        episodeSwitchInProgressRef.current = false;
        throw err;
      }
    },
    [state, navigate, flushProgressAndStop, folderPlaylistPinned, qc, flushVolumePersist],
  );

  const resolveEpisodeTarget = useCallback(
    async (direction: "next" | "previous"): Promise<NextLibraryEpisode | null> => {
      if (!state?.libraryShowId || state.libraryEpisodeId == null) return null;
      const precomputed =
        canonicalTargetsRef.current.episodeId === state.libraryEpisodeId
          ? direction === "next"
            ? canonicalTargetsRef.current.next
            : canonicalTargetsRef.current.prev
          : null;
      if (precomputed) return precomputed;
      if (direction === "next") {
        if (nextEp !== undefined) return nextEp ?? null;
        const r = await getNextLibraryEpisode(state.libraryShowId, state.libraryEpisodeId);
        canonicalTargetsRef.current = {
          episodeId: state.libraryEpisodeId,
          next: r.next ?? null,
          prev: canonicalTargetsRef.current.episodeId === state.libraryEpisodeId ? canonicalTargetsRef.current.prev : null,
        };
        setNextEp(r.next);
        return r.next;
      }
      if (prevEp !== undefined) return prevEp ?? null;
      const r = await getPreviousLibraryEpisode(state.libraryShowId, state.libraryEpisodeId);
      canonicalTargetsRef.current = {
        episodeId: state.libraryEpisodeId,
        next: canonicalTargetsRef.current.episodeId === state.libraryEpisodeId ? canonicalTargetsRef.current.next : null,
        prev: r.previous ?? null,
      };
      setPrevEp(r.previous);
      return r.previous;
    },
    [state, nextEp, prevEp],
  );

  const adoptCanonicalPlaybackFromPath = useCallback(
    async (mediaPath: string) => {
      if (!state || canonicalSyncInFlightRef.current) return;
      const incomingKey = normalizeMediaPathKey(mediaPath);
      const currentKey = normalizeMediaPathKey(state.filePath);
      if (!incomingKey || incomingKey === currentKey) return;
      if (!episodeSwitchInProgressRef.current && state.libraryEpisodeId != null) {
        const expectedNext = normalizeMediaPathKey(canonicalTargetsRef.current.next?.filePath);
        const expectedPrev = normalizeMediaPathKey(canonicalTargetsRef.current.prev?.filePath);
        if (incomingKey !== expectedNext && incomingKey !== expectedPrev) {
          return;
        }
      }
      episodeSwitchInProgressRef.current = true;
      suppressAutoAdvanceUntilRef.current = Date.now() + 4000;
      canonicalSyncInFlightRef.current = true;
      try {
        const resolved = await resolvePlaybackByPath(mediaPath);
        const resolvedKey = normalizeMediaPathKey(resolved.filePath);
        if (!resolvedKey || resolvedKey === currentKey) return;
        const startMsg = `canonical_sync start from=${currentKey} to=${resolvedKey}`;
        console.info("[pitflix-player]", startMsg);
        playerDebugLog(startMsg);

        historyStopHandledRef.current = true;
        void flushProgressAndStop(state.historyId).catch(() => {});
        // Keep whatever title the switch that got us here already set (raw filename for a
        // folder-playlist pick, "Title · SxEy" for library next/prev) — this canonical sync only
        // exists to attach library ids once mpv confirms the actual loaded path, not to swap in
        // TMDB's episode name. That title also lands in WatchHistory.Title, which is what
        // Continue Watching displays, so this keeps that consistent too.
        const created = (await addHistory({
          filePath: resolved.filePath,
          title: state.title,
          posterPath: resolved.posterPath ?? state.posterPath ?? undefined,
          mediaType: resolved.mediaType,
          durationSeconds: Math.max(0, Math.floor(durationRef.current)),
        })) as { id: number };

        const nextState: PlaybackLaunchState = {
          historyId: created.id,
          filePath: resolved.filePath,
          title: state.title,
          posterPath: resolved.posterPath ?? state.posterPath,
          mediaType: resolved.mediaType,
          durationSeconds: Math.max(0, Math.floor(durationRef.current)),
          libraryMovieId: resolved.libraryMovieId,
          libraryShowId: resolved.libraryShowId,
          libraryEpisodeId: resolved.libraryEpisodeId,
          season: resolved.season,
          episodeNumber: resolved.episodeNumber,
          returnTo: pickReturnToAfterLibraryNavigation(
            state.returnTo,
            resolved.mediaType,
            resolved.libraryMovieId,
            resolved.libraryShowId,
            resolved.season,
          ),
        };

        skipNextOpenForCanonicalSyncRef.current = true;
        navigate("/player", {
          replace: true,
          state: nextState,
        });
        const doneMsg = `canonical_sync done newKey=${resolvedKey} newHistoryId=${created.id}`;
        console.info("[pitflix-player]", doneMsg);
        playerDebugLog(doneMsg);
      } catch (err) {
        playerDebugLog(`canonical_sync failed path=${mediaPath} err=${err instanceof Error ? err.message : String(err)}`);
      } finally {
        canonicalSyncInFlightRef.current = false;
        episodeSwitchInProgressRef.current = false;
      }
    },
    [state, navigate, flushProgressAndStop],
  );

  useEffect(() => {
    adoptCanonicalPlaybackFromPathRef.current = (mediaPath: string) => {
      void adoptCanonicalPlaybackFromPath(mediaPath);
    };
  }, [adoptCanonicalPlaybackFromPath]);

  useEffect(() => {
    if (!state) return;
    if (canonicalSyncInFlightRef.current) return;
    if (state.mediaType !== "Series") return;
    if (state.libraryShowId && state.libraryEpisodeId) return;
    canonicalSyncInFlightRef.current = true;
    const upgradeFromFileOnly = async () => {
      try {
        const resolved = await resolvePlaybackByPath(state.filePath);
        if (resolved.mediaType !== "Series" || !resolved.libraryShowId || !resolved.libraryEpisodeId) return;
        const upgraded: PlaybackLaunchState = {
          ...state,
          // Keep the filename-based title this launch already has — this upgrade only exists to
          // attach library ids/season/episode (for Up Next, next/prev nav, etc.), not to swap in
          // TMDB's "nice" episode name. Folder-playlist switches deliberately show the file name.
          title: state.title,
          filePath: resolved.filePath || state.filePath,
          posterPath: resolved.posterPath ?? state.posterPath,
          mediaType: "Series",
          libraryShowId: resolved.libraryShowId,
          libraryEpisodeId: resolved.libraryEpisodeId,
          season: resolved.season ?? state.season,
          episodeNumber: resolved.episodeNumber ?? state.episodeNumber,
          returnTo: pickReturnToAfterLibraryNavigation(
            state.returnTo,
            "Series",
            undefined,
            resolved.libraryShowId,
            resolved.season ?? state.season,
          ),
        };
        skipNextOpenForCanonicalSyncRef.current = true;
        navigate("/player", { replace: true, state: upgraded });
        playerDebugLog(
          `canonical_sync file_only_upgrade key=${normalizeMediaPathKey(state.filePath)} -> ep:${resolved.libraryEpisodeId}`,
        );
      } catch {
        // Endpoint may be unavailable during startup; path-sync listener will retry on path changes.
      } finally {
        canonicalSyncInFlightRef.current = false;
      }
    };
    void upgradeFromFileOnly();
  }, [state, navigate]);

  const playNext = useCallback(async () => {
    if (state?.libraryShowId) {
      const target = await resolveEpisodeTarget("next");
      if (!target) {
        playerDebugLog(`episode_switch command=next blocked reason=no_target from=${playbackEpisodeKey(state)}`);
        return;
      }
      playerDebugLog(`episode_switch command=next from=${playbackEpisodeKey(state)} target=ep:${target.id}`);
      void playbackCancelNextCountdown().catch(() => {});
      const baseTitle = state.title.split(" · ")[0] ?? state.title;
      const title = `${baseTitle} · S${target.season}E${target.episodeNumber}`;
      await navigateToEpisode(target, title);
      return;
    }
    if (nextSibling) {
      await navigateToSiblingFile(nextSibling);
    }
  }, [state, navigateToEpisode, resolveEpisodeTarget, nextSibling, navigateToSiblingFile]);

  const playPrevious = useCallback(async () => {
    if (state?.libraryShowId) {
      const target = await resolveEpisodeTarget("previous");
      if (!target) {
        playerDebugLog(`episode_switch command=previous blocked reason=no_target from=${playbackEpisodeKey(state)}`);
        return;
      }
      playerDebugLog(`episode_switch command=previous from=${playbackEpisodeKey(state)} target=ep:${target.id}`);
      const baseTitle = state.title.split(" · ")[0] ?? state.title;
      const title = `${baseTitle} · S${target.season}E${target.episodeNumber}`;
      await navigateToEpisode(target, title);
      return;
    }
    if (prevSibling) {
      await navigateToSiblingFile(prevSibling);
    }
  }, [state, navigateToEpisode, resolveEpisodeTarget, prevSibling, navigateToSiblingFile]);

  const tryAutoAdvanceOnEnd = useCallback(async (): Promise<boolean> => {
    if (!state || episodeSwitchInProgressRef.current) return false;
    if (Date.now() < suppressAutoAdvanceUntilRef.current) return false;
    if (autoAdvanceIssuedForRef.current === state.historyId) return false;

    let hasNext = false;
    if (state.libraryShowId) {
      const target = await resolveEpisodeTarget("next");
      hasNext = Boolean(target);
    } else {
      hasNext = Boolean(nextSibling);
    }

    if (!hasNext) return false;

    autoAdvanceIssuedForRef.current = state.historyId;
    playerDebugLog(
      `autoplay_next historyId=${state.historyId} key=${playbackEpisodeKey(state)}`,
    );
    await playNext();
    return true;
  }, [state, nextSibling, resolveEpisodeTarget, playNext]);

  useEffect(() => {
    tryAutoAdvanceOnEndRef.current = tryAutoAdvanceOnEnd;
  }, [tryAutoAdvanceOnEnd]);

  useEffect(() => {
    if (!ended || !state || resumeChoice === "pending" || resumeChoice === null) return;
    void tryAutoAdvanceOnEnd();
  }, [ended, state, resumeChoice, tryAutoAdvanceOnEnd]);

  // List external subtitle files — embedded engine uses folder scan; external mpv uses native host.
  useEffect(() => {
    if ((!embedReady && !externalReady) || sessionDead || !state?.filePath) return;
    let cancelled = false;
    const loadExternalSubs = async () => {
      if (useLibMpv) {
        const dir = parentDirectory(state.filePath);
        if (!dir) {
          if (!cancelled) setExternalSubFiles([]);
          return;
        }
        try {
          const rows = await invoke<DeviceFsEntry[]>("device_read_dir", { path: dir });
          if (cancelled) return;
          const subs = (rows ?? [])
            .filter((e) => !e.is_directory && /\.(srt|ass|ssa|vtt)$/i.test(e.name))
            .map((e) => e.path)
            .sort();
          setExternalSubFiles(subs);
        } catch {
          if (!cancelled) setExternalSubFiles([]);
        }
        return;
      }
      try {
        const files = await invoke<string[]>("player2_list_external_subtitle_files");
        if (!cancelled) setExternalSubFiles(files);
      } catch {
        if (!cancelled) setExternalSubFiles([]);
      }
    };
    void loadExternalSubs();
    return () => {
      cancelled = true;
    };
  }, [embedReady, externalReady, sessionDead, state?.filePath, useLibMpv]);

  useEffect(() => {
    if (!state) return;
    let un: UnlistenFn | undefined;
    console.info("[pitflix-player] player2-shortcut listener mounted");
    void (async () => {
      un = await listen<string>("player2-shortcut", (event) => {
        playerDebugLog(
          `shortcut_bridge received=${event.payload} currentKey=${state ? playbackEpisodeKey(state) : "none"} next=${
            nextEp ? `ep:${nextEp.id}` : "none"
          } prev=${prevEp ? `ep:${prevEp.id}` : "none"}`,
        );
        if (import.meta.env.DEV) {
          console.info("[pitflix-player] player2-shortcut", event.payload);
        }
        switch (event.payload) {
          case "next":
            void playNext();
            break;
          case "previous":
            void playPrevious();
            break;
          case "escape":
            if (isNativeBackendExternal(nativeStateRef.current?.backend ?? "")) {
              void browseWhilePlaying();
            } else {
              void exitAndClose();
            }
            break;
          case "toggle-fullscreen":
            void onFullscreen();
            break;
          case "generate_arabic_subtitle":
            void generateArabicSubtitle();
            break;
          default:
            break;
        }
      });
    })();
    return () => {
      console.info("[pitflix-player] player2-shortcut listener unmounted");
      void un?.();
    };
  }, [state, nextEp, prevEp, navigate, onFullscreen, playNext, playPrevious, exitAndClose, browseWhilePlaying]);

  useEffect(() => {
    console.info("[pitflix-player] web keydown handler mounted (capture)");
    const onKey = (e: KeyboardEvent) => {
      if (e.target instanceof HTMLInputElement || e.target instanceof HTMLTextAreaElement) return;
      if (e.target instanceof HTMLSelectElement) return;
      if (
        e.code === "Escape" ||
        e.code === "KeyS" ||
        e.code === "KeyN" ||
        e.code === "KeyP" ||
        e.code === "KeyF" ||
        e.code === "Space"
      ) {
        const tag = e.target instanceof HTMLElement ? e.target.tagName : "unknown";
        const msg = `${new Date().toLocaleTimeString()} ${e.code}${e.shiftKey ? "+Shift" : ""} target=${tag}`;
        if (import.meta.env.DEV) {
          console.info("[pitflix-player] keydown", msg);
        }
      }
      switch (e.code) {
        case "Space":
          if (e.repeat) return;
          // If focus is on a control `<button>`, skip: keydown would toggle once and the browser's
          // Space-to-activate would synthesize a click → second toggle (pause/play cancel out).
          if (e.target instanceof Element && e.target.closest("button")) {
            return;
          }
          e.preventDefault();
          e.stopPropagation();
          void handlePrimaryTransport();
          break;
        case "ArrowLeft":
          e.preventDefault();
          e.stopPropagation();
          seekRel(e.shiftKey ? -1 : -skipSeconds);
          break;
        case "ArrowRight":
          e.preventDefault();
          e.stopPropagation();
          seekRel(e.shiftKey ? 1 : skipSeconds);
          break;
        case "ArrowUp":
          if (e.altKey && !e.ctrlKey && !e.shiftKey) {
            e.preventDefault();
            e.stopPropagation();
            setSubtitlePrefs((prev) => ({
              ...prev,
              position: Math.max(50, Math.min(100, prev.position - 2)),
            }));
            break;
          }
          if (e.ctrlKey && !e.altKey && !e.shiftKey) {
            e.preventDefault();
            e.stopPropagation();
            setSubtitlePrefs((prev) => ({
              ...prev,
              fontSize: Math.max(24, Math.min(90, prev.fontSize + 2)),
            }));
            break;
          }
          e.preventDefault();
          e.stopPropagation();
          setVolumePct(volumeRef.current + VOLUME_WHEEL_STEP);
          break;
        case "ArrowDown":
          if (e.altKey && !e.ctrlKey && !e.shiftKey) {
            e.preventDefault();
            e.stopPropagation();
            setSubtitlePrefs((prev) => ({
              ...prev,
              position: Math.max(50, Math.min(100, prev.position + 2)),
            }));
            break;
          }
          if (e.ctrlKey && !e.altKey && !e.shiftKey) {
            e.preventDefault();
            e.stopPropagation();
            setSubtitlePrefs((prev) => ({
              ...prev,
              fontSize: Math.max(24, Math.min(90, prev.fontSize - 2)),
            }));
            break;
          }
          e.preventDefault();
          e.stopPropagation();
          setVolumePct(volumeRef.current - VOLUME_WHEEL_STEP);
          break;
        case "KeyF":
          e.preventDefault();
          e.stopPropagation();
          void onFullscreen();
          break;
        case "KeyM":
          e.preventDefault();
          e.stopPropagation();
          toggleMute();
          break;
        case "Equal":
        case "NumpadAdd":
          e.preventDefault();
          e.stopPropagation();
          setPlaybackSpeed(playbackSpeedRef.current + 0.25);
          break;
        case "Minus":
        case "NumpadSubtract":
          e.preventDefault();
          e.stopPropagation();
          setPlaybackSpeed(playbackSpeedRef.current - 0.25);
          break;
        case "KeyS":
          e.preventDefault();
          e.stopPropagation();
          if (e.shiftKey) {
            openSubtitleSearch();
          } else {
            toggleSub();
          }
          break;
        case "KeyB":
          if (!e.ctrlKey || e.shiftKey || e.altKey) break;
          e.preventDefault();
          e.stopPropagation();
          setSubtitlePref("borderColor", "#000000");
          setSubtitlePref("borderSize", 3);
          break;
        case "KeyZ":
          if (e.ctrlKey || e.altKey || e.shiftKey) break;
          e.preventDefault();
          e.stopPropagation();
          void send({ type: "AddSubDelay", payload: -0.1 });
          break;
        case "KeyX":
          if (e.ctrlKey || e.altKey || e.shiftKey) break;
          e.preventDefault();
          e.stopPropagation();
          void send({ type: "AddSubDelay", payload: 0.1 });
          break;
        case "KeyG":
          if (!e.ctrlKey || e.shiftKey || e.altKey) break;
          e.preventDefault();
          e.stopPropagation();
          void generateArabicSubtitle();
          break;
        case "Digit1":
          if (!e.ctrlKey || e.shiftKey || e.altKey) break;
          e.preventDefault();
          e.stopPropagation();
          applySubStylePreset("white");
          break;
        case "Digit2":
          if (!e.ctrlKey || e.shiftKey || e.altKey) break;
          e.preventDefault();
          e.stopPropagation();
          applySubStylePreset("warm");
          break;
        case "Digit3":
          if (!e.ctrlKey || e.shiftKey || e.altKey) break;
          e.preventDefault();
          e.stopPropagation();
          applySubStylePreset("cyan");
          break;
        case "Digit4":
          if (!e.ctrlKey || e.shiftKey || e.altKey) break;
          e.preventDefault();
          e.stopPropagation();
          applySubStylePreset("arabic");
          break;
        case "KeyL":
          if (e.ctrlKey || e.altKey || e.metaKey) break;
          if (!currentFolderForPlaylist) break;
          e.preventDefault();
          e.stopPropagation();
          setFolderPlaylistOpen((v) => !v);
          break;
        case "KeyN":
          if (!e.shiftKey) break;
          e.preventDefault();
          e.stopPropagation();
          void playNext();
          break;
        case "KeyP":
          if (!e.shiftKey) break;
          e.preventDefault();
          e.stopPropagation();
          void playPrevious();
          break;
        case "Escape":
          e.preventDefault();
          void (async () => {
            const w = getCurrentWindow();
            if (await w.isFullscreen()) await w.setFullscreen(false);
            else if (isNativeBackendExternal(nativeStateRef.current?.backend ?? "")) {
              void browseWhilePlaying();
            } else {
              void exitAndClose();
            }
          })();
          break;
        default:
          break;
      }
    };
    document.addEventListener("keydown", onKey, true);
    return () => {
      console.info("[pitflix-player] web keydown handler unmounted");
      document.removeEventListener("keydown", onKey, true);
    };
  }, [
    handlePrimaryTransport,
    seekRel,
    skipSeconds,
    setVolumePct,
    setPlaybackSpeed,
    toggleMute,
    toggleSub,
    openSubtitleSearch,
    onFullscreen,
    navigate,
    nextEp,
    prevEp,
    playNext,
    playPrevious,
    exitAndClose,
    browseWhilePlaying,
    setSubtitlePref,
    applySubStylePreset,
    send,
    generateArabicSubtitle,
    currentFolderForPlaylist,
    setFolderPlaylistOpen,
  ]);

  if (!state) {
    return (
      <div className="flex min-h-screen flex-col items-center justify-center gap-4 bg-pitflix-bg px-6 text-center">
        <p className="text-sm text-red-300">Player session context is missing.</p>
        <button
          type="button"
          className="rounded-lg bg-pitflix-card px-4 py-2 text-sm text-white"
          onClick={() => navigate(-1)}
        >
          Back
        </button>
      </div>
    );
  }

  // Show lightweight loading skeleton while backend is being resolved
  // This prevents mounting the wrong mode first
  if (backendResolving) {
    return (
      <div className="flex min-h-screen flex-col items-center justify-center gap-4 bg-pitflix-bg px-6">
        <div className="h-8 w-8 animate-spin rounded-full border-2 border-pitflix-accent-primary border-t-transparent"></div>
        <p className="text-sm text-pitflix-text-muted">Loading player...</p>
      </div>
    );
  }

  if (error) {
    return (
      <div className="flex min-h-screen flex-col items-center justify-center gap-4 bg-pitflix-bg px-6 text-center">
        <p className="text-sm text-red-300">{error}</p>
        <button
          type="button"
          className="rounded-lg bg-pitflix-card px-4 py-2 text-sm text-white"
          onClick={() => navigateFromPlayer(navigate, state?.returnTo, true)}
        >
          Back
        </button>
      </div>
    );
  }

  if (resumeChoice === "pending" && showResumePrompt) {
    const resumeMmss = fmtTime(resumeSeconds ?? 0);
    const watchedSec = resumeSeconds ?? 0;
    const durSec = state.durationSeconds || 0;
    const pctWatched = durSec > 0 ? Math.min(100, Math.round((watchedSec / durSec) * 100)) : null;
    return (
      <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/85 px-6">
        <div className="w-[min(640px,92vw)] rounded-2xl border border-white/10 bg-[#0f0f12]/95 p-8 shadow-2xl">
          <p className="mb-2 text-[11px] font-semibold uppercase tracking-[0.18em] text-white/55">
            Pick up where you left off
          </p>
          <h1 className="mb-2 text-3xl font-bold text-white">{state.title}</h1>
          {pctWatched != null ? (
            <>
              <p className="mb-3 text-sm text-pitflix-muted">
                {resumeMmss} of {fmtTime(durSec)} watched ({pctWatched}%).
              </p>
              <div className="mb-6 h-1.5 w-full overflow-hidden rounded-full bg-white/10">
                <div
                  className="h-full rounded-full bg-pitflix-primary"
                  style={{ width: `${pctWatched}%` }}
                />
              </div>
            </>
          ) : (
            <p className="mb-6 text-sm text-pitflix-muted">
              You stopped at {resumeMmss}.
            </p>
          )}
          <div className="flex flex-wrap items-center gap-3">
            <button
              type="button"
              className="flex flex-1 items-center justify-center gap-2 rounded-full bg-gradient-to-r from-amber-300 to-orange-400 px-6 py-3 text-base font-semibold text-black shadow-lg transition-colors hover:from-amber-200 hover:to-orange-300"
              onClick={() => setResumeChoice("resume")}
              autoFocus
            >
              <Play className="h-4 w-4" fill="currentColor" />
              Resume from {resumeMmss}
            </button>
            <button
              type="button"
              className="flex items-center justify-center gap-2 rounded-full border border-white/15 bg-white/[0.04] px-6 py-3 text-base font-semibold text-white transition-colors hover:bg-white/[0.08]"
              onClick={() => setResumeChoice("fromStart")}
            >
              <RotateCcw className="h-4 w-4" />
              Start Over
            </button>
          </div>
          <button
            type="button"
            className="mx-auto mt-4 block text-[11px] text-pitflix-muted hover:text-white"
            onClick={() => navigateFromPlayer(navigate, state.returnTo, true)}
          >
            ✕ Cancel
          </button>
        </div>
      </div>
    );
  }

  /** External player mode: always show controls, no fullscreen chrome behavior */
  const sessionBlocksTransport = ended || sessionDead;
  const effectiveEnded = ended || episodeFinished;
  const effectiveSessionDead = sessionDead && !episodeFinished;
  const playbackStatusMapped =
    isCompanionOnlyMode && polSeq > 0
      ? mapPlaybackStatus(
          polSnap.phase === "loading" || polSnap.phase === "buffering",
          polPaused,
          polEnded,
          effectiveSessionDead,
          transportError,
        )
      : mapPlaybackStatus(loading, paused, effectiveEnded, effectiveSessionDead, transportError);

  return (
    <div
      ref={playerRootRef}
      tabIndex={-1}
      data-pitflix-player="PlayerPage"
      data-pitflix-route="/player"
      data-pitflix-native-backend={nativeState?.backend ?? ""}
      data-pitflix-pol-seq={String(polSeq)}
      data-pitflix-external-shell={String(isExternalMode)}
      className={`flex h-screen min-h-0 flex-col overflow-hidden outline-none ${useLibMpv && !videoSettling ? "bg-transparent" : "bg-pitflix-bg"}`}
      onContextMenu={(e) => {
        const owned = Boolean((e.target as HTMLElement)?.closest?.('[data-own-context-menu="true"]'));
        console.info(`[pitflix-player] [ctxmenu:root-contextmenu] target=${(e.target as HTMLElement)?.tagName}${owned ? " OWNED->skip" : " ->open-main"}`);
        if (owned) return;
        e.preventDefault();
        openPlayerContextMenu(e.clientX, e.clientY);
      }}
      onPointerDownCapture={(e) => {
        if (e.button === 2) {
          const owned = Boolean((e.target as HTMLElement)?.closest?.('[data-own-context-menu="true"]'));
          console.info(`[pitflix-player] [ctxmenu:root-pointerdowncapture] target=${(e.target as HTMLElement)?.tagName}${owned ? " OWNED->skip" : " ->open-main"}`);
          if (owned) return;
          e.preventDefault();
          openPlayerContextMenu(e.clientX, e.clientY);
        }
      }}
      onMouseDownCapture={(e) => {
        if (e.button === 2) {
          const owned = Boolean((e.target as HTMLElement)?.closest?.('[data-own-context-menu="true"]'));
          console.info(`[pitflix-player] [ctxmenu:root-mousedowncapture] target=${(e.target as HTMLElement)?.tagName}${owned ? " OWNED->skip" : " ->open-main"}`);
          if (owned) return;
          e.preventDefault();
          openPlayerContextMenu(e.clientX, e.clientY);
        }
      }}
    >
      {isCompanionOnlyMode ? (
        <PlayerCompanionView
          state={state}
          ctxLabel={ctxLabel}
          seriesDisplayTitle={companionSeriesTitle}
          episodeTitle={companionEpisodeTitle}
          backdropPath={companionBackdropPath}
          uiPct={uiPct}
          uiTimePos={uiTimePos}
          uiDuration={uiDuration}
          resumeMarkerSec={resumeMarkerSec}
          seasonEpisodes={companionSeasonEpisodes}
          seasonEpisodesLoading={companionSeasonQ.isLoading}
          seasonName={companionSeasonName}
          prevEp={prevEp}
          nextEp={nextEp}
          playPrevious={playPrevious}
          playNext={playNext}
          onSelectEpisode={onSelectCompanionEpisode}
          playbackStatusMapped={playbackStatusMapped}
          polSeq={polSeq}
          polSnap={polSnap}
          effectiveEnded={effectiveEnded}
          effectiveSessionDead={effectiveSessionDead}
          transportError={transportError}
          setTransportError={setTransportError}
          setResumeOptimistic={setResumeOptimistic}
          nativeState={nativeState}
          nativeStateRef={nativeStateRef}
          playerRootRef={playerRootRef}
          browseWhilePlaying={browseWhilePlaying}
          exitAndClose={exitAndClose}
          generateArabicSubtitle={generateArabicSubtitle}
          arabicSubtitleGenerating={arabicSubtitleGenerating}
          arabicSubtitleProgress={arabicSubtitleProgress}
          arabicSubtitleError={arabicSubtitleError}
          playbackSpeed={playbackSpeed}
          setPlaybackSpeed={setPlaybackSpeed}
          skipSeconds={skipSeconds}
        />
      ) : (
        <PlayerEmbeddedView
          state={state}
          videoAreaRef={videoAreaRef}
          playerHeaderChromeRef={playerHeaderChromeRef}
          playerFooterChromeRef={playerFooterChromeRef}
          volumeWheelRef={volumeWheelRef}
          seekDraggingRef={seekDraggingRef}
          volumeDraggingRef={volumeDraggingRef}
          seekBarHoveringRef={seekBarHoveringRef}
          seekHoverDebounceRef={seekHoverDebounceRef}
          launchStateRef={launchStateRef}
          isFullscreen={isFullscreen}
          isMaximized={isMaximized}
          onToggleMaximize={onToggleMaximize}
          fsControlsVisible={fsControlsVisible}
          onFullscreenPointerActivity={onFullscreenPointerActivity}
          onPlayerRightClick={openPlayerContextMenu}
          onFullscreen={onFullscreen}
          videoSettling={videoSettling}
          letterboxInsets={letterboxInsets}
          loading={loading}
          useLibMpv={useLibMpv}
          embedReady={embedReady}
          prevEp={prevEp}
          nextEp={nextEp}
          prevSibling={prevSibling}
          nextSibling={nextSibling}
          hasFolderNav={hasFolderNav}
          playPrevious={playPrevious}
          playNext={playNext}
          activeSkipSegment={activeSkipSegment}
          skipActiveSegment={skipActiveSegment}
          dismissActiveSkipSegment={dismissActiveSkipSegment}
          currentFolderForPlaylist={currentFolderForPlaylist}
          folderPlaylistOpen={folderPlaylistOpen}
          folderPlaylistPinned={folderPlaylistPinned}
          folderPlaylistBusy={folderPlaylistBusy}
          folderPlaylistEntries={folderPlaylistEntries}
          setFolderPlaylistEntries={setFolderPlaylistEntries}
          setFolderPlaylistOpen={setFolderPlaylistOpen}
          setFolderPlaylistPinned={setFolderPlaylistPinned}
          navigateToSiblingFile={navigateToSiblingFile}
          sessionBlocksTransport={sessionBlocksTransport}
          timePos={isExternalMode && polSeq > 0 ? uiTimePos : timePos}
          duration={isExternalMode && polSeq > 0 ? uiDuration : duration}
          pct={isExternalMode && polSeq > 0 ? uiPct : pct}
          remaining={
            isExternalMode && polSeq > 0
              ? Math.max(0, uiDuration - uiTimePos)
              : remaining
          }
          ended={isExternalMode && polSeq > 0 ? polEnded : ended}
          sessionDead={sessionDead}
          displayPaused={isExternalMode && polSeq > 0 ? polPaused : displayPaused}
          playbackTransportPending={playbackTransportPending}
          transportError={transportError}
          setTransportError={setTransportError}
          setResumeOptimistic={setResumeOptimistic}
          handlePrimaryTransport={handlePrimaryTransport}
          seekRel={seekRel}
          send={send}
          setTimePos={setTimePos}
          seekToAbsolute={seekToAbsolute}
          uiTimePos={uiTimePos}
          uiDuration={uiDuration}
          seekHover={seekHover}
          setSeekHover={setSeekHover}
          scheduleHoverThumb={scheduleHoverThumb}
          subVisible={subVisible}
          subTracks={subTracks}
          externalSubFiles={externalSubFiles}
          subMenuValue={subMenuValue}
          toggleSub={toggleSub}
          subAppearanceOpen={subAppearanceOpen}
          setSubAppearanceOpen={setSubAppearanceOpen}
          subtitlePrefs={subtitlePrefs}
          setSubtitlePref={setSubtitlePref}
          setSubtitlePrefs={setSubtitlePrefs}
          subDelay={subDelay}
          generateArabicSubtitle={generateArabicSubtitle}
          arabicSubtitleGenerating={arabicSubtitleGenerating}
          arabicSubtitleError={arabicSubtitleError}
          onOpenSubtitleSearch={openSubtitleSearch}
          volume={volume}
          mute={mute}
          toggleMute={toggleMute}
          setVolumePct={setVolumePct}
          volumeHudVisible={volumeHudVisible}
          playbackSpeed={playbackSpeed}
          setPlaybackSpeed={setPlaybackSpeed}
          skipSeconds={skipSeconds}
          aid={aid}
          audioTracks={audioTracks}
          alwaysOnTop={alwaysOnTop}
          toggleAlwaysOnTop={toggleAlwaysOnTop}
          layoutPrefs={layoutPrefs}
          nativeState={nativeState}
          embeddedSafeMode={embeddedSafeMode}
          setEmbeddedSafeMode={setEmbeddedSafeMode}
          lastMpvCrashLog={lastMpvCrashLog}
          setLastMpvCrashLog={setLastMpvCrashLog}
          effectiveStart={effectiveStart}
          episodeInfoOpen={episodeInfoOpen}
          setEpisodeInfoOpen={setEpisodeInfoOpen}
          exitAndClose={isExternalMode ? browseWhilePlaying : exitAndClose}
        />
      )}
      {state?.filePath ? (
        <SubtitleDrawer
          open={subtitleSearchOpen}
          onClose={closeSubtitleSearch}
          title={subtitleDrawerTitle}
          mode={subtitleDrawerMode}
          movieId={state.libraryMovieId}
          episodeId={state.libraryEpisodeId}
          episodeSeason={state.season}
          episodeNumber={state.episodeNumber}
          videoFilePath={state.filePath}
          onSubtitleDownloaded={onSubtitleDownloadedInPlayer}
        />
      ) : null}
      {playerContextMenu ? (
        <PlayerContextMenu
          x={playerContextMenu.x}
          y={playerContextMenu.y}
          title={state.title}
          onClose={closePlayerContextMenu}
          displayPaused={isExternalMode && polSeq > 0 ? polPaused : displayPaused}
          ended={isExternalMode && polSeq > 0 ? polEnded : ended}
          sessionDead={sessionDead}
          subVisible={subVisible}
          playbackSpeed={playbackSpeed}
          skipSeconds={skipSeconds}
          onSetSkipSeconds={setSkipSeconds}
          alwaysOnTop={alwaysOnTop}
          isFullscreen={isFullscreen}
          hasPlaylist={Boolean(currentFolderForPlaylist)}
          playlistCount={folderPlaylistEntries.length}
          hasNext={Boolean(state.libraryShowId ? nextEp : nextSibling)}
          hasPrev={Boolean(state.libraryShowId ? prevEp : prevSibling)}
          hasEpisodeDetails={Boolean(state.libraryShowId || state.libraryMovieId)}
          audioTracks={audioTracks}
          activeAid={aid}
          onPlayPause={() => void handlePrimaryTransport()}
          onToggleSubtitles={toggleSub}
          onSearchSubtitles={openSubtitleSearch}
          onOpenPlaylist={() => setFolderPlaylistOpen(true)}
          onSetSpeed={setPlaybackSpeed}
          onSetAudioTrack={(id) => void send({ type: "SetAid", payload: id })}
          onToggleAlwaysOnTop={toggleAlwaysOnTop}
          onToggleFullscreen={() => void onFullscreen()}
          onNext={() => void playNext()}
          onPrevious={() => void playPrevious()}
          onOpenEpisodeDetails={() => setEpisodeInfoOpen(true)}
          onScreenshot={() => void takeScreenshot()}
          onSaveClip={openClipExport}
          onClosePlayer={() => void exitAndClose()}
        />
      ) : null}
      {playerExportBusy ? (
        <div className="pointer-events-none fixed bottom-8 left-1/2 z-[140] -translate-x-1/2 rounded-full border border-white/10 bg-black/80 px-4 py-2 text-sm text-white shadow-lg backdrop-blur-sm">
          {playerExportBusy}
        </div>
      ) : null}
      {clipExportOpen && state?.filePath ? (
        <PlayerClipExportModal
          open={clipExportOpen}
          onClose={() => setClipExportOpen(false)}
          title={state.title}
          filePath={state.filePath}
          currentSeconds={isExternalMode && polSeq > 0 ? uiTimePos : timePos}
          durationSeconds={isExternalMode && polSeq > 0 ? uiDuration : duration}
          subVisible={subVisible}
          sid={sid}
          subDelay={subDelay}
          subMenuValue={subMenuValue}
          subTracks={subTracks}
          externalSubFiles={externalSubFiles}
          onExportBusyChange={setPlayerExportBusy}
        />
      ) : null}
    </div>
  );
}
