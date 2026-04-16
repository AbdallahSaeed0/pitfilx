import { invoke, isTauri } from "@tauri-apps/api/core";
import { listen, type UnlistenFn } from "@tauri-apps/api/event";
import { getCurrentWindow } from "@tauri-apps/api/window";
import { useQueryClient } from "@tanstack/react-query";
import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { useLocation, useNavigate } from "react-router-dom";
import { addHistory, historyStopped, postHistoryProgress, dismissHistoryEntry } from "../api/history";
import { getNextLibraryEpisode, getPreviousLibraryEpisode, resolvePlaybackByPath } from "../api/series";
import type { NextLibraryEpisode } from "../api/series";
import type { PlaybackLaunchState } from "../types/playback";
import {
  Captions,
  ChevronLeft,
  ChevronRight,
  ExternalLink,
  ListMusic,
  Maximize2,
  Minimize2,
  Minus,
  Pause as PauseIcon,
  Play,
  Plus,
  Volume2,
  VolumeX,
} from "lucide-react";
import { cn } from "../utils/cn";
import { getStatusInfo, mapPlaybackStatus } from "../utils/playbackStatus";
import { sanitizeErrorMessage } from "../utils/sanitizeError";
import { CinematicPlayerShell } from "../components/player/CinematicPlayerShell";
import { MediaHeroCard } from "../components/player/MediaHeroCard";
import { PlaybackStatusBadge } from "../components/player/PlaybackStatusBadge";
import { PlayerActionButton } from "../components/player/PlayerActionButton";
import { PlayerQuickTips } from "../components/player/PlayerQuickTips";
import { EpisodeNavigationOverlay } from "../components/player/EpisodeNavigationOverlay";
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
} from "../playback/playbackApi";
import { navigateFromPlayer } from "../utils/playerExitNavigation";
import { isNativeBackendEmbeddedLibmpv, isNativeBackendExternal } from "../utils/playerNativeBackend";

type Player2Event =
  | {
      type: "State";
      payload: {
        loading: boolean;
        playing: boolean;
        paused: boolean;
        ended: boolean;
        time_pos: number;
        duration: number;
        mute: boolean;
        volume: number;
        sub_visible: boolean;
        sid: number;
        aid: number;
        /** Present when backend sends it (external IPC health). */
        ipc_healthy?: boolean;
        sub_delay?: number;
      };
    }
  | {
      type: "Tracks";
      payload: { tracks: { id?: number; track_type?: string; lang?: string; title?: string; selected?: boolean }[] };
    }
  | { type: "Error"; payload: { message: string } };

type MpvTrack = {
  id?: number;
  type?: string;
  lang?: string;
  title?: string;
  selected?: boolean;
};

type Player2NativeState = {
  session_active: boolean;
  backend: "libmpv" | "external_mpv" | "none" | string;
  render_frame_count?: number;
  last_render_error?: string | null;
  window_thread_id?: number | null;
};

function num(v: unknown): number {
  return typeof v === "number" && Number.isFinite(v) ? v : 0;
}

function fmtTime(s: number) {
  if (!Number.isFinite(s) || s < 0) return "0:00";
  const m = Math.floor(s / 60);
  const sec = Math.floor(s % 60);
  return `${m}:${sec.toString().padStart(2, "0")}`;
}

function fmtSubDelayLabel(sec: number): string {
  if (!Number.isFinite(sec)) return "Sub delay: 0.0s";
  const sign = sec > 0 ? "+" : "";
  return `Sub delay: ${sign}${sec.toFixed(1)}s`;
}

type PlayerSubtitlePrefs = {
  fontSize: number;
  textColor: string;
  borderColor: string;
  borderSize: number;
  backColor: string;
  shadowColor: string;
  shadowOffset: number;
  position: number;
  fontFamily: string;
};

const SUBTITLE_PREFS_STORAGE_KEY = "pitflix.player.subtitlePrefs.v1";
const DEFAULT_SUBTITLE_PREFS: PlayerSubtitlePrefs = {
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

function parseSubtitlePrefs(raw: string | null): PlayerSubtitlePrefs {
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

/** Fullscreen auto-hide: idle before fading chrome (ms). Slightly longer while paused. */
const FS_HIDE_IDLE_MS = 1750;
const FS_HIDE_PAUSED_MS = 2500;

/** Appends a line to `%LOCALAPPDATA%\\Pitflix\\pitflix-player-debug.log` (or the OS app log dir). */
function playerDebugLog(line: string) {
  if (!isTauri()) return;
  void invoke("player2_debug_log", { line }).catch(() => {});
}

/** Every `player2_*` failure should surface somewhere — silent catches look like “dead buttons”. */
function logPlayer2InvokeFailure(cmd: string, err: unknown) {
  const msg = err instanceof Error ? err.message : String(err);
  console.error(`[pitflix-player] ${cmd} failed`, err);
  playerDebugLog(`PlayerPage ${cmd} failed: ${msg}`);
}

function normalizeMediaPathKey(path: string | undefined | null): string {
  if (!path) return "";
  return path.split("\\").join("/").trim().toLowerCase();
}

export function PlayerPage() {
  const navigate = useNavigate();
  const location = useLocation();
  const qc = useQueryClient();
  const state = location.state as PlaybackLaunchState | undefined;
  const currentEpisodeKey = state ? playbackEpisodeKey(state) : "none";

  const [resumeChoice, setResumeChoice] = useState<"pending" | "fromStart" | "resume" | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [loading, setLoading] = useState(true);
  const [timePos, setTimePos] = useState(0);
  const [duration, setDuration] = useState(0);
  const [paused, setPaused] = useState(false);
  const [ended, setEnded] = useState(false);
  const [mute, setMute] = useState(false);
  const [volume, setVolume] = useState(100);
  const [subVisible, setSubVisible] = useState(true);
  const [nextEp, setNextEp] = useState<NextLibraryEpisode | null | undefined>(undefined);
  const [prevEp, setPrevEp] = useState<NextLibraryEpisode | null | undefined>(undefined);
  const canonicalTargetsRef = useRef<{ episodeId: number | null; next: NextLibraryEpisode | null; prev: NextLibraryEpisode | null }>({
    episodeId: null,
    next: null,
    prev: null,
  });
  const [tracks, setTracks] = useState<MpvTrack[]>([]);
  const [sid, setSid] = useState<number | null>(null);
  const [aid, setAid] = useState<number | null>(null);
  const [subDelay, setSubDelay] = useState(0);
  const [subtitlePrefs, setSubtitlePrefs] = useState<PlayerSubtitlePrefs>(() =>
    parseSubtitlePrefs(typeof localStorage !== "undefined" ? localStorage.getItem(SUBTITLE_PREFS_STORAGE_KEY) : null),
  );
  const [externalSubFiles, setExternalSubFiles] = useState<string[]>([]);
  /** True after failed `player2_send` / dead IPC — Play must reopen the session. */
  const [sessionDead, setSessionDead] = useState(false);
  const [isFullscreen, setIsFullscreen] = useState(false);
  /** Fullscreen-only: when false, chrome is hidden (auto-hide). Windowed mode ignores this (see `controlsVisible`). */
  const [fsControlsVisible, setFsControlsVisible] = useState(true);
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
  /** Skip `openPlayer()` once when canonical state is updated from a live mpv media-path switch. */
  const skipNextOpenForCanonicalSyncRef = useRef(false);
  /** Prevent overlapping canonical sync transitions from rapid mpv path events. */
  const canonicalSyncInFlightRef = useRef(false);
  const adoptCanonicalPlaybackFromPathRef = useRef<(mediaPath: string) => void>(() => {});
  /** User pressed Back / Escape — skip post-close recovery UI and duplicate navigation. */
  const userInitiatedExitRef = useRef(false);
  /** Latest launch state for IPC handlers (avoid stale closures). */
  const launchStateRef = useRef(state);
  // Companion-only bridge: receives mpv-originated shortcut events from Rust and updates app state/route.
  // Actual media-player key ownership lives in mpv config/scripts.
  useEffect(() => {
    launchStateRef.current = state;
  }, [state]);
  // Companion-page keyboard scope (webview focused). This is NOT the source of truth for mpv controls.
  // Keep only companion behaviors here; mpv-native controls are defined under src-tauri/mpv-config.
  useEffect(() => {
    if (!state) return;
    const msg = `episode_state updated key=${currentEpisodeKey} historyId=${state.historyId} title=${state.title}`;
    console.info("[pitflix-player]", msg);
    playerDebugLog(msg);
  }, [state, currentEpisodeKey]);
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
  const lastProgressRef = useRef(0);
  const timePosRef = useRef(0);
  const durationRef = useRef(0);
  const pausedRef = useRef(false);
  const playerRootRef = useRef<HTMLDivElement>(null);
  const videoAreaRef = useRef<HTMLDivElement>(null);
  /** Overlay chrome laid on top of `videoAreaRef`; native HWND must not cover these or controls are invisible (still click-through). */
  const playerHeaderChromeRef = useRef<HTMLDivElement | null>(null);
  const playerFooterChromeRef = useRef<HTMLDivElement | null>(null);
  const lastLoggedBoundsRef = useRef<string | null>(null);
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

  useEffect(() => {
    for (const e of polPlayback.lastEvents) {
      if (e.type === "onNearEnd") {
      }
      if (e.type === "onEnded") {
        setEpisodeFinished(true);
      }
    }
  }, [polPlayback.seq, polPlayback.lastEvents]);

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
  const volumeRef = useRef(volume);
  useEffect(() => {
    volumeRef.current = volume;
  }, [volume]);

  useEffect(() => {
    const endDrag = () => {
      volumeDraggingRef.current = false;
      seekDraggingRef.current = false;
    };
    window.addEventListener("pointerup", endDrag);
    window.addEventListener("pointercancel", endDrag);
    window.addEventListener("blur", endDrag);
    return () => {
      window.removeEventListener("pointerup", endDrag);
      window.removeEventListener("pointercancel", endDrag);
      window.removeEventListener("blur", endDrag);
    };
  }, []);

  const syncVideoBounds = useCallback(() => {
    // This callback is ONLY called from embedded mode effects now
    // No need to check embedReady or isExternal here
    const el = videoAreaRef.current;
    if (!el) return;
    void (async () => {
      try {
        const videoRect = el.getBoundingClientRect();
        const headerRect = playerHeaderChromeRef.current?.getBoundingClientRect();
        const footerRect = playerFooterChromeRef.current?.getBoundingClientRect();

        let top = Math.round(videoRect.top);
        let bottom = Math.round(videoRect.bottom);
        if (headerRect && headerRect.height > 0) {
          top = Math.max(top, Math.round(headerRect.bottom));
        }
        if (footerRect && footerRect.height > 0) {
          bottom = Math.min(bottom, Math.round(footerRect.top));
        }

        const height = Math.max(1, bottom - top);
        const logicalBounds = {
          x: Math.round(videoRect.left),
          y: top,
          width: Math.round(videoRect.width),
          height,
        };
        if (logicalBounds.width <= 0 || logicalBounds.height <= 0) {
          console.debug("[pitflix-player] skip set_video_bounds until layout non-zero", logicalBounds);
          return;
        }
        const boundsKey = `${logicalBounds.x},${logicalBounds.y},${logicalBounds.width},${logicalBounds.height}`;
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
        await invoke("player2_set_video_bounds", {
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
        syncVideoBounds();
      }
    };
    run();
    const ro = new ResizeObserver(run);
    const el = videoAreaRef.current;
    if (el) ro.observe(el);
    window.addEventListener("resize", run);
    window.addEventListener("scroll", run, true);
    const vv = window.visualViewport;
    vv?.addEventListener("resize", run);
    vv?.addEventListener("scroll", run);
    document.addEventListener("fullscreenchange", run);
    // Reduced polling for external mode - only poll every 2 seconds instead of 400ms
    const poll = window.setInterval(() => {
      trackPoll();
      run();
    }, 400);
    let unlistenResize: UnlistenFn | undefined;
    let unlistenScale: UnlistenFn | undefined;
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
    return () => {
      cancelled = true;
      ro.disconnect();
      window.removeEventListener("resize", run);
      window.removeEventListener("scroll", run, true);
      vv?.removeEventListener("resize", run);
      vv?.removeEventListener("scroll", run);
      document.removeEventListener("fullscreenchange", run);
      clearInterval(poll);
      void unlistenResize?.();
      void unlistenScale?.();
    };
  }, [embedReady, syncVideoBounds]);

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
    void invoke<Player2NativeState>("player2_get_state")
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
      void invoke("player2_close").catch((e) => logPlayer2InvokeFailure("player2_close", e));
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
    if (showResumePrompt) {
      // Avoid alternate resume screen in external flow.
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
        await invoke("player2_open", {
          payload: {
            path: state.filePath,
            start_seconds: startSeconds,
          },
        });
        const ns = await invoke<Player2NativeState>("player2_get_state");
        setNativeState(ns);
        setLoading(false);
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

  useEffect(() => {
    const w = getCurrentWindow();
    let un: UnlistenFn | undefined;
    const sync = () => void w.isFullscreen().then(setIsFullscreen);
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
    };
  }, []);

  /** Centralized fullscreen auto-hide: one timer only. */
  const scheduleFullscreenHide = useCallback(() => {
    if (fsHideControlsTimerRef.current) clearTimeout(fsHideControlsTimerRef.current);
    const delay = pausedRef.current ? FS_HIDE_PAUSED_MS : FS_HIDE_IDLE_MS;
    fsHideControlsTimerRef.current = window.setTimeout(() => {
      setFsControlsVisible(false);
      fsHideControlsTimerRef.current = null;
    }, delay);
  }, []);

  const onFullscreenPointerActivity = useCallback(() => {
    if (!isFullscreen) return;
    setFsControlsVisible(true);
    scheduleFullscreenHide();
  }, [isFullscreen, scheduleFullscreenHide]);

  useEffect(() => {
    return () => {
      if (fsHideControlsTimerRef.current) {
        clearTimeout(fsHideControlsTimerRef.current);
        fsHideControlsTimerRef.current = null;
      }
    };
  }, []);

  useEffect(() => {
    if (!isFullscreen) {
      setFsControlsVisible(true);
      if (fsHideControlsTimerRef.current) {
        clearTimeout(fsHideControlsTimerRef.current);
        fsHideControlsTimerRef.current = null;
      }
    }
  }, [isFullscreen]);

  useEffect(() => {
    if (!isFullscreen || loading) return;
    setFsControlsVisible(true);
    scheduleFullscreenHide();
  }, [isFullscreen, loading, scheduleFullscreenHide]);

  useEffect(() => {
    if (!isFullscreen || !fsControlsVisible) return;
    scheduleFullscreenHide();
  }, [paused, isFullscreen, fsControlsVisible, scheduleFullscreenHide]);

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

  const flushProgressAndStopRef = useRef<(historyId: number, tPos: number, dur: number) => Promise<void>>(
    async () => {},
  );

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
            setVolume(num(s.volume));
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
          playerDebugLog(`player2-event Error: ${e.payload?.message ?? "Player error"}`);
          setError(e.payload?.message ?? "Player error");
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
          navigateFromPlayer(navigate, launch?.returnTo, true);

          if (nearFinished && launch?.historyId) {
            setEpisodeFinished(true);
            void dismissHistoryEntry(launch.historyId, true)
              .then(() => qc.invalidateQueries({ queryKey: ["history"] }))
              .catch((e) => console.error("[player] dismiss completed episode", e));
          } else if (launch?.historyId) {
            void flushProgressAndStopRef.current(launch.historyId, t, dur).catch(() => {});
            void playbackPersistProgress().catch(() => {});
          }
          return;
        }

        if (isNormalClose && durationRef.current > 0) {
          const remaining = durationRef.current - timePosRef.current;
          if (remaining <= FINISHED_THRESHOLD_SECONDS) {
            const launch = launchStateRef.current;
            setEpisodeFinished(true);
            setSessionDead(true);
            if (launch?.historyId) {
              void dismissHistoryEntry(launch.historyId, true)
                .then(() => qc.invalidateQueries({ queryKey: ["history"] }))
                .catch((e) => console.error("[player] dismiss completed episode", e));
            }
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

  const flushProgressAndStop = useCallback(async (historyId: number, tPos: number, dur: number) => {
    const launch = launchStateRef.current;
    const key = launch ? playbackEpisodeKey(launch) : "none";
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
    } catch (e) {
      console.error("[close-lag] historyStopped failed:", e);
    }
    
    const flushEnd = performance.now();
    console.log("[close-lag] progress save end, total duration:", (flushEnd - flushStart).toFixed(2), "ms");
    playerDebugLog(`persist_target done key=${key} historyId=${historyId} t=${Math.floor(tPos)} d=${Math.floor(dur)}`);
    
    historyStopHandledRef.current = true;
  }, []);

  useEffect(() => {
    flushProgressAndStopRef.current = flushProgressAndStop;
  }, [flushProgressAndStop]);

  useEffect(() => {
    historyStopHandledRef.current = false;
    userInitiatedExitRef.current = false;
    externalClosedHandledRef.current = false;
    episodeSwitchInProgressRef.current = false;
    openedHistoryIdRef.current = null;
  }, [state?.historyId]);

  useEffect(() => {
    if (!externalReady || loading) return;
    const id = window.setInterval(() => {
      void invoke<Player2NativeState>("player2_get_state")
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

  const exitAndClose = useCallback(async () => {
    userInitiatedExitRef.current = true;
    const launch = launchStateRef.current;
    playerDebugLog(
      `close_request activeKey=${launch ? playbackEpisodeKey(launch) : "none"} t=${Math.floor(timePosRef.current)} d=${Math.floor(
        durationRef.current,
      )}`,
    );
    if (launch?.historyId) {
      await flushProgressAndStop(launch.historyId, timePosRef.current, durationRef.current).catch(() => {});
    }
    void playbackPersistProgress().catch(() => {});
    void playbackCancelNextCountdown().catch(() => {});
    navigateFromPlayer(navigate, launch?.returnTo, true);
    void invoke("player2_close").catch((e) => logPlayer2InvokeFailure("player2_close", e));
  }, [navigate, flushProgressAndStop]);

  useEffect(() => {
    if (!state || resumeChoice === "pending") return;
    if (!ended) return;
    void flushProgressAndStop(state.historyId, timePosRef.current, durationRef.current);
  }, [ended, state, resumeChoice, flushProgressAndStop]);

  useEffect(() => {
    if (!state || resumeChoice === "pending") return;
    // Reduced polling frequency for external player mode (every 10 seconds instead of 4)
    // External player handles its own state, we just need occasional progress sync
    const interval = window.setInterval(() => {
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
      
      trackQueryInvalidation();
      void qc.invalidateQueries({ queryKey: ["history"] });
    }, 10000);
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
    const hid = state?.historyId;
    return () => {
      if (hid != null && !historyStopHandledRef.current) {
        const pos = Math.floor(timePosRef.current);
        void historyStopped(hid, {
          stoppedAt: new Date().toISOString(),
          positionSeconds: pos > 0 ? pos : undefined,
        });
      }
    };
  }, [state?.historyId]);

  const send = useCallback(async (cmd: unknown) => {
    try {
      await invoke("player2_send", { cmd });
    } catch (e) {
      logPlayer2InvokeFailure("player2_send", e);
      console.warn("player_send failed", e);
      playerDebugLog(`send failed: ${e instanceof Error ? e.message : String(e)} cmd=${JSON.stringify(cmd)}`);
      setSessionDead(true);
      setError(e instanceof Error ? e.message : String(e));
      throw e;
    }
  }, []);

  const setSubtitlePref = useCallback(
    <K extends keyof PlayerSubtitlePrefs>(key: K, value: PlayerSubtitlePrefs[K]) => {
      setSubtitlePrefs((prev) => ({ ...prev, [key]: value }));
    },
    [],
  );

  useEffect(() => {
    if (typeof localStorage !== "undefined") {
      localStorage.setItem(SUBTITLE_PREFS_STORAGE_KEY, JSON.stringify(subtitlePrefs));
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
        void invoke("player2_resume")
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
        await invoke("player2_pause");
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
      void send({ type: "SeekRelative", payload: sec });
    },
    [send, ended, sessionDead],
  );
  const toggleMute = useCallback(() => {
    if (ended || sessionDead) return;
    void send({ type: "SetMute", payload: !mute });
  }, [send, mute, ended, sessionDead]);
  const toggleSub = useCallback(() => {
    if (ended || sessionDead) return;
    void send({ type: "SetSubVisibility", payload: !subVisible });
  }, [send, subVisible, ended, sessionDead]);
  const setVolumePct = useCallback(
    (v: number) => {
      if (ended || sessionDead) return;
      const clamped = Math.round(Math.min(200, Math.max(0, v)));
      const prev = volumeRef.current;
      setVolume(clamped);
      void send({ type: "SetVolume", payload: clamped }).catch(() => {
        setVolume(prev);
      });
    },
    [send, ended, sessionDead],
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
      const step = e.deltaY < 0 ? 5 : -5;
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
      const step = e.deltaY < 0 ? 5 : -5;
      setVolumePct(volumeRef.current + step);
    };
    el.addEventListener("wheel", onWheel, { passive: false });
    return () => el.removeEventListener("wheel", onWheel);
  }, [embedReady, ended, sessionDead, setVolumePct]);

  const subTracks = useMemo(() => tracks.filter((t) => t.type === "sub"), [tracks]);
  const audioTracks = useMemo(() => tracks.filter((t) => t.type === "audio"), [tracks]);

  const subMenuValue = useMemo(() => {
    if (sid === null || sid < 0) return "";
    const t = subTracks.find((x) => x.id === sid);
    if (!t) return `e:${sid}`;
    const label = (t.title || t.lang || "").trim();
    for (const p of externalSubFiles) {
      const base = p.replace(/^.*[/\\]/, "");
      if (label === base || (base.length > 0 && label.endsWith(base))) {
        return `x:${encodeURIComponent(p)}`;
      }
    }
    return `e:${sid}`;
  }, [sid, subTracks, externalSubFiles]);

  const ctxLabel = useMemo(() => {
    if (!state) return "";
    if (state.mediaType === "Series" && state.season != null && state.episodeNumber != null) {
      return `S${state.season} · E${state.episodeNumber}`;
    }
    return state.mediaType === "Movie" ? "Movie" : "Episode";
  }, [state]);

  const pct = duration > 0 ? Math.min(100, (timePos / duration) * 100) : 0;
  const remaining = Math.max(0, duration - timePos);
  const nearEnd = duration > 60 && timePos > 0 && timePos >= duration * 0.92;

  const isExternalMode = isNativeBackendExternal(nativeState?.backend);
  // External session UX must remain on a single companion route/layout.
  // If backend isn't explicitly embedded, keep companion mode during startup/switch.
  const isCompanionOnlyMode = !isEmbedded || isExternalMode || backendResolving;
  const polSnap = polPlayback.snapshot;
  const polSeq = polPlayback.seq;
  const uiTimePos = isExternalMode && polSeq > 0 ? polSnap.currentTime : timePos;
  const uiDuration = isExternalMode && polSeq > 0 ? polSnap.duration : duration;
  const uiPct = isExternalMode && polSeq > 0 ? polSnap.progressPct : pct;
  const polPaused = isExternalMode && polSeq > 0 ? polSnap.phase === "paused" : paused;
  const polEnded = isExternalMode && polSeq > 0 ? polSnap.phase === "ended" : ended;
  const resumeMarkerSec =
    resumeChoice === "resume" && (resumeSeconds ?? 0) > 30 ? resumeSeconds : null;

  const navigateToEpisode = useCallback(
    async (ep: NextLibraryEpisode, title: string) => {
      if (!state) return;
      const fromKey = playbackEpisodeKey(state);
      const toKey = `ep:${ep.id}`;
      episodeSwitchInProgressRef.current = true;
      try {
        const switchMsg = `episode_switch initiated from=${fromKey} to=${toKey} historyId=${state.historyId}`;
        console.info("[pitflix-player]", switchMsg);
        playerDebugLog(switchMsg);
        await flushProgressAndStop(state.historyId, timePosRef.current, durationRef.current);
        if (isTauri()) {
          await invoke("player2_close").catch((e) => logPlayer2InvokeFailure("player2_close", e));
        }
        const { id: newId } = (await addHistory({
          filePath: ep.filePath,
          title,
          posterPath: state.posterPath ?? undefined,
          mediaType: "Series",
          durationSeconds: 0,
        })) as { id: number };
        const resolvedMsg = `episode_switch resolved newHistoryId=${newId} newKey=${toKey} title=${title}`;
        console.info("[pitflix-player]", resolvedMsg);
        playerDebugLog(resolvedMsg);
        navigate("/player", {
          replace: true,
          state: {
            historyId: newId,
            filePath: ep.filePath,
            title,
            posterPath: state.posterPath,
            mediaType: "Series",
            durationSeconds: 0,
            libraryShowId: state.libraryShowId,
            libraryEpisodeId: ep.id,
            season: ep.season,
            episodeNumber: ep.episodeNumber,
            returnTo: state.returnTo,
          },
        });
      } catch (err) {
        episodeSwitchInProgressRef.current = false;
        throw err;
      }
    },
    [state, navigate, flushProgressAndStop],
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
      canonicalSyncInFlightRef.current = true;
      try {
        const resolved = await resolvePlaybackByPath(mediaPath);
        const resolvedKey = normalizeMediaPathKey(resolved.filePath);
        if (!resolvedKey || resolvedKey === currentKey) return;
        const startMsg = `canonical_sync start from=${currentKey} to=${resolvedKey}`;
        console.info("[pitflix-player]", startMsg);
        playerDebugLog(startMsg);

        await flushProgressAndStop(state.historyId, timePosRef.current, durationRef.current);
        const created = (await addHistory({
          filePath: resolved.filePath,
          title: resolved.title,
          posterPath: resolved.posterPath ?? state.posterPath ?? undefined,
          mediaType: resolved.mediaType,
          durationSeconds: Math.max(0, Math.floor(durationRef.current)),
        })) as { id: number };

        const nextState: PlaybackLaunchState = {
          historyId: created.id,
          filePath: resolved.filePath,
          title: resolved.title,
          posterPath: resolved.posterPath ?? state.posterPath,
          mediaType: resolved.mediaType,
          durationSeconds: Math.max(0, Math.floor(durationRef.current)),
          libraryMovieId: resolved.libraryMovieId,
          libraryShowId: resolved.libraryShowId,
          libraryEpisodeId: resolved.libraryEpisodeId,
          season: resolved.season,
          episodeNumber: resolved.episodeNumber,
          returnTo: state.returnTo,
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
          title: resolved.title || state.title,
          filePath: resolved.filePath || state.filePath,
          posterPath: resolved.posterPath ?? state.posterPath,
          mediaType: "Series",
          libraryShowId: resolved.libraryShowId,
          libraryEpisodeId: resolved.libraryEpisodeId,
          season: resolved.season ?? state.season,
          episodeNumber: resolved.episodeNumber ?? state.episodeNumber,
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
    if (!state?.libraryShowId) return;
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
  }, [state, navigateToEpisode, resolveEpisodeTarget]);

  const playPrevious = useCallback(async () => {
    if (!state?.libraryShowId) return;
    const target = await resolveEpisodeTarget("previous");
    if (!target) {
      playerDebugLog(`episode_switch command=previous blocked reason=no_target from=${playbackEpisodeKey(state)}`);
      return;
    }
    playerDebugLog(`episode_switch command=previous from=${playbackEpisodeKey(state)} target=ep:${target.id}`);
    const baseTitle = state.title.split(" · ")[0] ?? state.title;
    const title = `${baseTitle} · S${target.season}E${target.episodeNumber}`;
    await navigateToEpisode(target, title);
  }, [state, navigateToEpisode, resolveEpisodeTarget]);

  // List external subtitle files - works for both modes
  useEffect(() => {
    if ((!embedReady && !externalReady) || sessionDead) return;
    void invoke<string[]>("player2_list_external_subtitle_files")
      .then((files) => setExternalSubFiles(files))
      .catch(() => setExternalSubFiles([]));
  }, [embedReady, externalReady, sessionDead, state?.filePath]);

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
            void exitAndClose();
            break;
          case "toggle-fullscreen":
            void onFullscreen();
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
  }, [state, nextEp, prevEp, navigate, onFullscreen, playNext, playPrevious, exitAndClose]);

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
          seekRel(-5);
          break;
        case "ArrowRight":
          e.preventDefault();
          e.stopPropagation();
          seekRel(5);
          break;
        case "ArrowUp":
          e.preventDefault();
          seekRel(60);
          break;
        case "ArrowDown":
          e.preventDefault();
          seekRel(-60);
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
        case "KeyS":
          e.preventDefault();
          e.stopPropagation();
          toggleSub();
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
            else {
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
    toggleMute,
    toggleSub,
    onFullscreen,
    navigate,
    nextEp,
    prevEp,
    playNext,
    playPrevious,
    exitAndClose,
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
    return (
      <div className="flex min-h-screen flex-col items-center justify-center gap-6 bg-pitflix-bg px-6">
        <h1 className="text-xl font-semibold text-white">{state.title}</h1>
        <p className="max-w-md text-center text-sm text-pitflix-muted">
          You stopped at {Math.floor((resumeSeconds ?? 0) / 60)}m — resume or start from the beginning?
        </p>
        <div className="flex flex-wrap justify-center gap-3">
          <button
            type="button"
            className="rounded-lg bg-pitflix-primary px-6 py-2.5 text-sm font-semibold text-white"
            onClick={() => setResumeChoice("resume")}
          >
            Resume
          </button>
          <button
            type="button"
            className="rounded-lg border border-pitflix-card px-6 py-2.5 text-sm text-white"
            onClick={() => setResumeChoice("fromStart")}
          >
            Start over
          </button>
          <button
            type="button"
            className="rounded-lg border border-white/20 px-4 py-2.5 text-sm text-pitflix-muted"
            onClick={() => navigateFromPlayer(navigate, state.returnTo, true)}
          >
            Cancel
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
      data-pitflix-external-shell={String(isCompanionOnlyMode)}
      className="flex min-h-screen flex-col bg-pitflix-bg outline-none"
    >
      {/* External Player Mode: Cinematic companion layout */}
      {isCompanionOnlyMode ? (
        <CinematicPlayerShell>
          <div
            className="h-1 w-full shrink-0 rounded-full bg-gradient-to-r from-violet-600 via-fuchsia-500 to-cyan-400 opacity-90 shadow-[0_0_24px_rgba(139,92,246,0.35)]"
            aria-hidden
          />
          {/* Header */}
          <header className="flex flex-wrap items-center justify-between gap-3">
            <button
              type="button"
              className="rounded-lg px-3 py-1.5 text-sm text-pitflix-text-muted ring-1 ring-white/10 transition-colors hover:bg-white/5 hover:text-pitflix-text-primary"
              onClick={() => void exitAndClose()}
            >
              ← Back
            </button>
            <div className="min-w-0 flex-1 text-center sm:order-none">
              <h1 className="truncate text-subtitle font-semibold text-pitflix-text-primary">{state.title}</h1>
              {ctxLabel ? <p className="truncate text-caption text-pitflix-text-muted">{ctxLabel}</p> : null}
            </div>
            <PlaybackStatusBadge status={playbackStatusMapped} />
          </header>

          <MediaHeroCard
            posterPath={state.posterPath}
            title={state.title}
            episode={ctxLabel}
            progress={uiPct}
            timePos={uiTimePos}
            duration={uiDuration}
            resumeFromSec={resumeMarkerSec}
          >
            {(() => {
              const live =
                !transportError &&
                (polSeq > 0 ? polSnap.phase !== "ended" && polSnap.phase !== "error" : !effectiveEnded && !effectiveSessionDead);
              return live ? (
                <PlayerActionButton
                  variant="primary"
                  onClick={() => {
                    void getCurrentWindow().setFocus().catch(() => {});
                    playerRootRef.current?.focus({ preventScroll: true });
                  }}
                >
                  <ExternalLink className="h-4 w-4" />
                  Bring mpv to front
                </PlayerActionButton>
              ) : null;
            })()}
          </MediaHeroCard>

          {/* Quick Tips */}
          <PlayerQuickTips className="mt-6" />

          {/* Transport Error (if any) */}
          {transportError && (
            <div className="mt-4 flex flex-col items-center gap-3 rounded-xl border border-pitflix-status-error/30 bg-pitflix-status-error/10 p-4 text-center">
              <p className="text-sm text-red-300">{transportError}</p>
              <div className="flex gap-2">
                <PlayerActionButton
                  variant="secondary"
                  onClick={() => setTransportError(null)}
                >
                  Dismiss
                </PlayerActionButton>
                <PlayerActionButton
                  variant="primary"
                  onClick={() => {
                    setTransportError(null);
                    setResumeOptimistic(false);
                    void invoke("player2_recover").catch((e) => {
                      logPlayer2InvokeFailure("player2_recover", e);
                      setTransportError(e instanceof Error ? e.message : String(e));
                    });
                  }}
                >
                  Reopen Player
                </PlayerActionButton>
              </div>
            </div>
          )}

          {/* Companion page stays metadata/sync only; next/previous live in mpv controls. */}
        </CinematicPlayerShell>
      ) : (
        /* Legacy Embedded Mode: Original full-screen video layout */
        <div 
          className="relative w-full flex-1 min-h-[35vh]"
          onPointerMove={() => onFullscreenPointerActivity()}
          onPointerDownCapture={() => onFullscreenPointerActivity()}
          onPointerDown={(e) => {
            onFullscreenPointerActivity();
            void getCurrentWindow().setFocus().catch(() => {});
            e.currentTarget.focus({ preventScroll: true });
          }}
        >
          <div
            ref={videoAreaRef}
            data-video-surface
            className="absolute inset-0 z-0 bg-transparent"
            onDoubleClick={(e) => {
              e.preventDefault();
              onFullscreenPointerActivity();
              void onFullscreen();
            }}
          >
            {loading ? (
              <div className="pointer-events-none absolute inset-0 z-10 flex items-center justify-center bg-black/30">
                <span className="text-sm text-pitflix-muted">Loading…</span>
              </div>
            ) : null}
            
            {/* Episode Navigation Overlay - visible over the player */}
            <EpisodeNavigationOverlay
              prevEpisode={prevEp}
              nextEpisode={nextEp}
              onPrevious={playPrevious}
              onNext={playNext}
              visible={!isFullscreen || fsControlsVisible}
            />
          </div>

          <header
            ref={playerHeaderChromeRef}
            className={cn(
              "absolute left-0 right-0 top-0 z-40 flex items-center justify-between gap-3 border-b border-white/10 bg-black/90 px-3 py-2 backdrop-blur-md transition-opacity duration-300 ease-out",
              !isFullscreen || fsControlsVisible
                ? "opacity-100"
                : "pointer-events-none opacity-0 [&_*]:pointer-events-none",
            )}
            inert={!isFullscreen || fsControlsVisible ? undefined : true}
            aria-hidden={!isFullscreen || fsControlsVisible ? undefined : true}
          >
            <button
              type="button"
              className="text-xs text-pitflix-muted hover:text-white"
              onClick={() => void exitAndClose()}
            >
              ← Close
            </button>
            <div className="min-w-0 flex-1 text-center">
              <p className="truncate text-sm font-semibold text-white">{state.title}</p>
              <p className="truncate text-[11px] text-pitflix-muted">{ctxLabel}</p>
            </div>
            <span className="w-[4.5rem] shrink-0 text-right text-[10px] text-pitflix-muted">
              {getStatusInfo(playbackStatusMapped).label}
            </span>
          </header>

          <div
            ref={playerFooterChromeRef}
            className={cn(
              "absolute bottom-0 left-0 right-0 z-50 border-t border-white/10 bg-black/95 px-2 py-1.5 backdrop-blur-md transition-opacity duration-300 ease-out",
              !isFullscreen || fsControlsVisible
                ? "opacity-100"
                : "pointer-events-none opacity-0 [&_*]:pointer-events-none",
            )}
            inert={!isFullscreen || fsControlsVisible ? undefined : true}
            aria-hidden={!isFullscreen || fsControlsVisible ? undefined : true}
          >
          <div className="mx-auto w-full max-w-4xl space-y-1.5">
            <div className="flex items-center gap-2 text-[10px] tabular-nums text-pitflix-muted">
              <span className="w-9 shrink-0">{fmtTime(timePos)}</span>
              <input
                type="range"
                min={0}
                max={100}
                step={0.1}
                value={pct}
                disabled={sessionBlocksTransport || duration <= 0}
                onPointerDown={() => {
                  seekDraggingRef.current = true;
                }}
                onInput={(e) => {
                  if (sessionBlocksTransport || duration <= 0) return;
                  const v = Number(e.currentTarget.value);
                  const t = (v / 100) * duration;
                  setTimePos(t);
                  void send({ type: "SeekAbsolute", payload: t });
                }}
                onChange={(e) => {
                  if (sessionBlocksTransport || duration <= 0) return;
                  const v = Number(e.currentTarget.value);
                  const t = (v / 100) * duration;
                  setTimePos(t);
                  void send({ type: "SeekAbsolute", payload: t });
                }}
                className="h-1 flex-1 cursor-pointer accent-pitflix-primary disabled:cursor-not-allowed disabled:opacity-40"
              />
              <span className="w-9 shrink-0 text-right">-{fmtTime(remaining)}</span>
            </div>

            {transportError ? (
              <div className="flex flex-col items-center gap-1 text-center" role="alert">
                <p className="text-[10px] text-red-300/95">{transportError}</p>
                <div className="flex flex-wrap justify-center gap-2">
                  <button
                    type="button"
                    className="rounded border border-white/20 px-2 py-0.5 text-[10px] text-pitflix-muted hover:bg-white/10"
                    onClick={() => setTransportError(null)}
                  >
                    Dismiss
                  </button>
                  <button
                    type="button"
                    className="rounded border border-white/20 px-2 py-0.5 text-[10px] text-white hover:bg-white/10"
                    disabled={isNativeBackendEmbeddedLibmpv(nativeState?.backend)}
                    onClick={() => {
                      setTransportError(null);
                      setResumeOptimistic(false);
                      void invoke("player2_recover").catch((e) => {
                        logPlayer2InvokeFailure("player2_recover", e);
                        setTransportError(e instanceof Error ? e.message : String(e));
                      });
                    }}
                  >
                    Reopen current
                  </button>
                  <button
                    type="button"
                    className="rounded border border-red-400/50 px-2 py-0.5 text-[10px] text-red-200 hover:bg-white/10"
                    onClick={() => {
                      setTransportError(null);
                      void handlePrimaryTransport();
                    }}
                  >
                    Retry
                  </button>
                </div>
              </div>
            ) : null}
            <div className="flex flex-wrap items-center justify-center gap-1">
              <button
                type="button"
                title={ended || sessionDead ? "Replay" : displayPaused ? "Play" : "Pause"}
                disabled={playbackTransportPending && !ended && !sessionDead}
                className="flex h-9 w-9 items-center justify-center rounded-full bg-pitflix-primary text-white shadow-lg hover:bg-pitflix-primary/90 disabled:opacity-50"
                onClick={() => void handlePrimaryTransport()}
              >
                {ended || sessionDead ? (
                  <Play className="ml-0.5 h-4 w-4" fill="currentColor" />
                ) : displayPaused ? (
                  <Play className="ml-0.5 h-4 w-4" fill="currentColor" />
                ) : (
                  <PauseIcon className="h-4 w-4" fill="currentColor" />
                )}
              </button>
              {state.libraryShowId && prevEp !== undefined ? (
                <button
                  type="button"
                  title="Previous episode"
                  disabled={!prevEp}
                  className="flex h-8 w-8 items-center justify-center rounded-md bg-white/10 text-white enabled:hover:bg-white/20 disabled:opacity-40"
                  onClick={() => void playPrevious()}
                >
                  <ChevronLeft className="h-4 w-4" strokeWidth={2} />
                </button>
              ) : null}
              {state.libraryShowId && nextEp !== undefined ? (
                <button
                  type="button"
                  title="Next episode"
                  disabled={!nextEp}
                  className="flex h-8 w-8 items-center justify-center rounded-md bg-white/10 text-white enabled:hover:bg-white/20 disabled:opacity-40"
                  onClick={() => void playNext()}
                >
                  <ChevronRight className="h-4 w-4" strokeWidth={2} />
                </button>
              ) : null}
              <button
                type="button"
                title={mute ? "Unmute" : "Mute"}
                className="flex h-8 w-8 items-center justify-center rounded-md bg-white/10 text-white hover:bg-white/20 disabled:opacity-40"
                disabled={sessionBlocksTransport}
                onClick={() => toggleMute()}
              >
                {mute ? <VolumeX className="h-4 w-4" /> : <Volume2 className="h-4 w-4" />}
              </button>
              <div
                ref={volumeWheelRef}
                className="flex min-w-[100px] max-w-[160px] flex-1 items-center gap-1.5 px-1"
                title="Volume — scroll to adjust"
              >
                <input
                  type="range"
                  min={0}
                  max={200}
                  step={1}
                  value={Math.round(volume)}
                  disabled={sessionBlocksTransport}
                  onPointerDown={() => {
                    volumeDraggingRef.current = true;
                  }}
                  onInput={(e) => setVolumePct(Number(e.currentTarget.value))}
                  onChange={(e) => setVolumePct(Number(e.currentTarget.value))}
                  className="h-1.5 w-full cursor-pointer accent-pitflix-primary disabled:opacity-40"
                />
              </div>

              <details className="group relative">
                <summary
                  className="flex h-8 cursor-pointer list-none items-center justify-center rounded-md bg-white/10 px-2 text-white marker:content-none hover:bg-white/20 [&::-webkit-details-marker]:hidden"
                  title="Subtitles"
                  onClick={() => onFullscreenPointerActivity()}
                >
                  <Captions className={`h-4 w-4 ${subVisible ? "text-pitflix-primary" : "opacity-60"}`} />
                </summary>
                <div className="absolute bottom-0 left-1/2 z-[60] min-w-[240px] -translate-x-1/2 rounded-lg border border-white/10 bg-black/95 p-2 shadow-xl backdrop-blur">
                  <label className="mb-2 flex cursor-pointer items-center gap-2 text-[10px] text-pitflix-muted">
                    <input
                      type="checkbox"
                      className="rounded border-white/20"
                      checked={subVisible}
                      disabled={sessionBlocksTransport}
                      onChange={() => toggleSub()}
                    />
                    Show subtitles
                  </label>
                  <label className="mb-1 block text-[9px] uppercase tracking-wide text-pitflix-muted">
                    Track
                    <select
                      className="mt-1 w-full rounded border border-white/10 bg-black/60 px-2 py-1 text-[11px] text-white"
                      value={subMenuValue}
                      disabled={sessionBlocksTransport}
                      onChange={(e) => {
                        const v = e.target.value;
                        if (v === "") void send({ type: "SetSid", payload: -1 });
                        else if (v.startsWith("x:")) {
                          const path = decodeURIComponent(v.slice(2));
                          void send({ type: "SubAddSelect", payload: path });
                        } else if (v.startsWith("e:")) {
                          void send({ type: "SetSid", payload: Number(v.slice(2)) });
                        }
                      }}
                    >
                      <option value="">Off</option>
                      {subTracks.map((t) => (
                        <option key={`s-${t.id ?? ""}`} value={`e:${t.id ?? ""}`}>
                          {t.lang || t.title || `Track ${t.id}`}
                          {t.selected ? " (current)" : ""}
                        </option>
                      ))}
                      {externalSubFiles.map((p) => {
                        const base = p.replace(/^.*[/\\]/, "");
                        return (
                          <option key={`ext-${p}`} value={`x:${encodeURIComponent(p)}`}>
                            {base} (file)
                          </option>
                        );
                      })}
                    </select>
                  </label>
                  <div className="mt-2 space-y-2 border-t border-white/10 pt-2">
                    <p className="text-[9px] uppercase tracking-wide text-pitflix-muted">Appearance (live)</p>
                    <div className="grid grid-cols-2 gap-2">
                      <label className="block text-[10px] text-pitflix-muted">
                        Size
                        <input
                          type="range"
                          min={24}
                          max={72}
                          step={1}
                          value={subtitlePrefs.fontSize}
                          onChange={(e) => setSubtitlePref("fontSize", Number(e.currentTarget.value))}
                          className="mt-1 h-1.5 w-full cursor-pointer accent-pitflix-primary"
                        />
                      </label>
                      <label className="block text-[10px] text-pitflix-muted">
                        Position
                        <input
                          type="range"
                          min={65}
                          max={95}
                          step={1}
                          value={subtitlePrefs.position}
                          onChange={(e) => setSubtitlePref("position", Number(e.currentTarget.value))}
                          className="mt-1 h-1.5 w-full cursor-pointer accent-pitflix-primary"
                        />
                      </label>
                    </div>
                    <div className="grid grid-cols-2 gap-2">
                      <label className="block text-[10px] text-pitflix-muted">
                        Text color
                        <input
                          type="color"
                          value={subtitlePrefs.textColor}
                          onChange={(e) => setSubtitlePref("textColor", e.currentTarget.value.toUpperCase())}
                          className="mt-1 h-7 w-full cursor-pointer rounded border border-white/20 bg-black/30"
                        />
                      </label>
                      <label className="block text-[10px] text-pitflix-muted">
                        Border color
                        <input
                          type="color"
                          value={subtitlePrefs.borderColor}
                          onChange={(e) => setSubtitlePref("borderColor", e.currentTarget.value.toUpperCase())}
                          className="mt-1 h-7 w-full cursor-pointer rounded border border-white/20 bg-black/30"
                        />
                      </label>
                    </div>
                    <div className="grid grid-cols-2 gap-2">
                      <label className="block text-[10px] text-pitflix-muted">
                        Back color
                        <input
                          type="color"
                          value={subtitlePrefs.backColor.slice(0, 7)}
                          onChange={(e) =>
                            setSubtitlePref(
                              "backColor",
                              `${e.currentTarget.value.toUpperCase()}${subtitlePrefs.backColor.length === 9 ? subtitlePrefs.backColor.slice(7) : "00"}`,
                            )
                          }
                          className="mt-1 h-7 w-full cursor-pointer rounded border border-white/20 bg-black/30"
                        />
                      </label>
                      <label className="block text-[10px] text-pitflix-muted">
                        Shadow color
                        <input
                          type="color"
                          value={subtitlePrefs.shadowColor.slice(0, 7)}
                          onChange={(e) =>
                            setSubtitlePref(
                              "shadowColor",
                              `${e.currentTarget.value.toUpperCase()}${subtitlePrefs.shadowColor.length === 9 ? subtitlePrefs.shadowColor.slice(7) : "88"}`,
                            )
                          }
                          className="mt-1 h-7 w-full cursor-pointer rounded border border-white/20 bg-black/30"
                        />
                      </label>
                    </div>
                    <div className="grid grid-cols-2 gap-2">
                      <label className="block text-[10px] text-pitflix-muted">
                        Border size
                        <input
                          type="range"
                          min={0}
                          max={6}
                          step={0.5}
                          value={subtitlePrefs.borderSize}
                          onChange={(e) => setSubtitlePref("borderSize", Number(e.currentTarget.value))}
                          className="mt-1 h-1.5 w-full cursor-pointer accent-pitflix-primary"
                        />
                      </label>
                      <label className="block text-[10px] text-pitflix-muted">
                        Shadow offset
                        <input
                          type="range"
                          min={0}
                          max={6}
                          step={0.5}
                          value={subtitlePrefs.shadowOffset}
                          onChange={(e) => setSubtitlePref("shadowOffset", Number(e.currentTarget.value))}
                          className="mt-1 h-1.5 w-full cursor-pointer accent-pitflix-primary"
                        />
                      </label>
                    </div>
                    <label className="block text-[10px] text-pitflix-muted">
                      Font family (Arabic-friendly)
                      <select
                        className="mt-1 w-full rounded border border-white/10 bg-black/60 px-2 py-1 text-[11px] text-white"
                        value={subtitlePrefs.fontFamily}
                        onChange={(e) => setSubtitlePref("fontFamily", e.currentTarget.value)}
                      >
                        <option value="Noto Naskh Arabic">Noto Naskh Arabic</option>
                        <option value="Noto Sans Arabic">Noto Sans Arabic</option>
                        <option value="Arial">Arial</option>
                        <option value="Segoe UI">Segoe UI</option>
                      </select>
                    </label>
                    <button
                      type="button"
                      className="w-full rounded border border-white/15 px-2 py-1 text-[10px] text-pitflix-muted hover:bg-white/10"
                      onClick={() => setSubtitlePrefs(DEFAULT_SUBTITLE_PREFS)}
                    >
                      Reset subtitle appearance
                    </button>
                  </div>
                </div>
              </details>

              {import.meta.env.DEV && embedReady ? (
                <details className="group relative">
                  <summary
                    className="flex h-8 cursor-pointer list-none items-center justify-center rounded-md bg-white/10 px-2 text-white marker:content-none hover:bg-white/20 [&::-webkit-details-marker]:hidden"
                    title="IPC diagnostics (dev)"
                    onClick={() => onFullscreenPointerActivity()}
                  >
                    <span className="text-[10px] font-semibold tracking-wide text-white/90">IPC</span>
                  </summary>
                  <div className="absolute bottom-0 left-1/2 z-[60] min-w-[220px] -translate-x-1/2 rounded-lg border border-white/10 bg-black/95 p-2 shadow-xl backdrop-blur">
                    <p className="mb-2 text-[10px] text-pitflix-muted">
                      Diagnostics: prove commands reach the live mpv IPC session.
                    </p>
                    <div className="flex flex-col gap-2">
                      <button
                        type="button"
                        disabled={isNativeBackendEmbeddedLibmpv(nativeState?.backend)}
                        className={cn(
                          "rounded-md px-2 py-1.5 text-[11px] font-semibold text-white hover:bg-white/15",
                          isNativeBackendEmbeddedLibmpv(nativeState?.backend) ? "bg-white/5 opacity-50" : "bg-white/10",
                        )}
                        onClick={() =>
                          void invoke("player2_test_ipc_osd").catch((e) => {
                            logPlayer2InvokeFailure("player2_test_ipc_osd", e);
                            setTransportError(String(e));
                          })
                        }
                      >
                        Test IPC OSD
                      </button>
                      <button
                        type="button"
                        disabled={isNativeBackendEmbeddedLibmpv(nativeState?.backend)}
                        className={cn(
                          "rounded-md px-2 py-1.5 text-[11px] font-semibold text-white hover:bg-white/15",
                          isNativeBackendEmbeddedLibmpv(nativeState?.backend) ? "bg-white/5 opacity-50" : "bg-white/10",
                        )}
                        onClick={() =>
                          void invoke("player2_test_toggle_pause").catch((e) => {
                            logPlayer2InvokeFailure("player2_test_toggle_pause", e);
                            setTransportError(String(e));
                          })
                        }
                      >
                        Test Toggle Pause
                      </button>
                      <button
                        type="button"
                        className="rounded-md bg-white/10 px-2 py-1.5 text-[11px] font-semibold text-white hover:bg-white/15"
                        onClick={() => {
                          void invoke<{
                            session_id: number;
                            mpv_pid: number;
                            exit_code?: number | null;
                            last_action: string;
                            time_pos: number;
                            pipe: string;
                            exe: string;
                            args: string[];
                            stderr_tail: string[];
                            stdout_tail: string[];
                            no_config: boolean;
                            close_reason?: string | null;
                          } | null>("player2_get_last_mpv_exit_report")
                            .then((r) => {
                              if (!r) {
                                setLastMpvCrashLog("No mpv exit report captured yet.");
                                return;
                              }
                              const tail =
                                r.stderr_tail?.length
                                  ? ["[mpv-stderr-tail]", ...r.stderr_tail].join("\n")
                                  : r.stdout_tail?.length
                                    ? ["[mpv-stdout-tail]", ...r.stdout_tail].join("\n")
                                    : "(no stderr/stdout captured)";
                              setLastMpvCrashLog(
                                [
                                  `[mpv-exit] session_id=${r.session_id} pid=${r.mpv_pid} exit_code=${r.exit_code ?? "?"} last_action=${r.last_action} time_pos=${r.time_pos.toFixed(2)}`,
                                  `[mpv-launch] exe=${r.exe}`,
                                  `args=${JSON.stringify(r.args)}`,
                                  `pipe=${r.pipe} no_config=${String(r.no_config)} close_reason=${r.close_reason ?? "—"}`,
                                  "",
                                  tail,
                                ].join("\n"),
                              );
                            })
                            .catch((e) => {
                              logPlayer2InvokeFailure("player2_get_last_mpv_exit_report", e);
                              setTransportError(e instanceof Error ? e.message : String(e));
                            });
                        }}
                      >
                        Show last mpv stderr
                      </button>
                      <button
                        type="button"
                        disabled={isNativeBackendEmbeddedLibmpv(nativeState?.backend)}
                        className={cn(
                          "rounded-md px-2 py-1.5 text-[11px] font-semibold text-white hover:bg-white/15",
                          isNativeBackendEmbeddedLibmpv(nativeState?.backend) ? "bg-white/5 opacity-50" : "bg-white/10",
                        )}
                        onClick={() => {
                          setLastMpvCrashLog(null);
                          void invoke("player2_recover_no_config").catch((e) => {
                            logPlayer2InvokeFailure("player2_recover_no_config", e);
                            setTransportError(e instanceof Error ? e.message : String(e));
                          });
                        }}
                      >
                        Recover (no-config)
                      </button>
                      <button
                        type="button"
                        className="rounded-md bg-white/10 px-2 py-1.5 text-[11px] font-semibold text-white hover:bg-white/15"
                        onClick={() => {
                          setLastMpvCrashLog(null);
                          if (!state) return;
                          void invoke("player2_open_detached_no_wid", {
                            payload: { path: state.filePath, start_seconds: effectiveStart ?? null },
                          }).catch((e) => {
                            logPlayer2InvokeFailure("player2_open_detached_no_wid", e);
                            setTransportError(e instanceof Error ? e.message : String(e));
                          });
                        }}
                      >
                        Open detached (no-wid)
                      </button>
                      <button
                        type="button"
                        className="rounded-md bg-white/10 px-2 py-1.5 text-[11px] font-semibold text-white hover:bg-white/15"
                        onClick={() => {
                          setLastMpvCrashLog(null);
                          if (!state) return;
                          void invoke("player2_open_detached", {
                            payload: { path: state.filePath, start_seconds: effectiveStart ?? null },
                          }).catch((e) => {
                            logPlayer2InvokeFailure("player2_open_detached", e);
                            setTransportError(e instanceof Error ? e.message : String(e));
                          });
                        }}
                      >
                        Open detached (supported)
                      </button>
                      <button
                        type="button"
                        className="rounded-md bg-rose-500/15 px-2 py-1.5 text-[11px] font-semibold text-white hover:bg-rose-500/20"
                        onClick={() => {
                          setLastMpvCrashLog(null);
                          if (!state) return;
                          // Minimal embedded diagnostic: no auto-recovery, no window ops after launch.
                          void invoke("player2_open_embedded_minimal_no_config", {
                            payload: { path: state.filePath, start_seconds: effectiveStart ?? null },
                          }).catch((e) => {
                            logPlayer2InvokeFailure("player2_open_embedded_minimal_no_config", e);
                            setTransportError(e instanceof Error ? e.message : String(e));
                          });
                        }}
                      >
                        Open embedded minimal (no-config)
                      </button>
                      <button
                        type="button"
                        className={cn(
                          "rounded-md px-2 py-1.5 text-[11px] font-semibold text-white hover:bg-white/15",
                          embeddedSafeMode ? "bg-amber-500/20" : "bg-white/10",
                        )}
                        onClick={() => {
                          const next = !embeddedSafeMode;
                          setEmbeddedSafeMode(next);
                          void invoke("player2_set_embedded_safe_mode", { enabled: next }).catch((e) => {
                            logPlayer2InvokeFailure("player2_set_embedded_safe_mode", e);
                            setTransportError(e instanceof Error ? e.message : String(e));
                          });
                        }}
                      >
                        Embedded safe mode: {embeddedSafeMode ? "ON" : "OFF"}
                      </button>
                    </div>
                    {lastMpvCrashLog ? (
                      <div className="mt-2 space-y-2">
                        <div className="flex items-center justify-between gap-2">
                          <p className="text-[10px] text-pitflix-muted">Last mpv crash log</p>
                          <button
                            type="button"
                            className="rounded border border-white/15 px-2 py-0.5 text-[10px] text-white/90 hover:bg-white/10"
                            onClick={() => void navigator.clipboard?.writeText(lastMpvCrashLog).catch(() => {})}
                          >
                            Copy
                          </button>
                        </div>
                        <pre className="max-h-40 overflow-auto whitespace-pre-wrap break-words rounded border border-white/10 bg-black/70 p-2 text-[9px] text-white/80">
                          {lastMpvCrashLog}
                        </pre>
                      </div>
                    ) : null}
                  </div>
                </details>
              ) : null}

              <details className="group relative">
                <summary
                  className="flex h-8 cursor-pointer list-none items-center justify-center rounded-md bg-white/10 px-2 text-white marker:content-none hover:bg-white/20 [&::-webkit-details-marker]:hidden"
                  title="Audio tracks"
                  onClick={() => onFullscreenPointerActivity()}
                >
                  <ListMusic className="h-4 w-4" />
                </summary>
                <div className="absolute bottom-0 right-0 z-[60] min-w-[220px] rounded-lg border border-white/10 bg-black/95 p-2 shadow-xl backdrop-blur">
                  <label className="block text-[9px] uppercase tracking-wide text-pitflix-muted">
                    Audio
                    <select
                      className="mt-1 w-full rounded border border-white/10 bg-black/60 px-2 py-1 text-[11px] text-white"
                      value={aid ?? ""}
                      disabled={sessionBlocksTransport}
                      onChange={(e) => {
                        const v = Number(e.target.value);
                        void send({ type: "SetAid", payload: v });
                      }}
                    >
                      {audioTracks.map((t) => (
                        <option key={`a-${t.id ?? ""}`} value={t.id ?? ""}>
                          {t.lang || t.title || `Track ${t.id}`}
                          {t.selected ? " (current)" : ""}
                        </option>
                      ))}
                    </select>
                  </label>
                </div>
              </details>

              <div className="flex items-center gap-0.5 rounded-md bg-white/5 px-1 py-0.5">
                <button
                  type="button"
                  title="Subtitle delay −0.5s"
                  disabled={sessionBlocksTransport}
                  className="flex h-7 w-7 items-center justify-center rounded text-white hover:bg-white/15 disabled:opacity-40"
                  onClick={() => void send({ type: "AddSubDelay", payload: -0.5 })}
                >
                  <Minus className="h-3.5 w-3.5" />
                </button>
                <span
                  className="min-w-[7.5rem] select-none text-center text-[10px] tabular-nums text-pitflix-muted"
                  title="Subtitle delay"
                >
                  {fmtSubDelayLabel(subDelay)}
                </span>
                <button
                  type="button"
                  title="Subtitle delay +0.5s"
                  disabled={sessionBlocksTransport}
                  className="flex h-7 w-7 items-center justify-center rounded text-white hover:bg-white/15 disabled:opacity-40"
                  onClick={() => void send({ type: "AddSubDelay", payload: 0.5 })}
                >
                  <Plus className="h-3.5 w-3.5" />
                </button>
              </div>

              <button
                type="button"
                title={isFullscreen ? "Exit fullscreen" : "Fullscreen"}
                className="flex h-8 w-8 items-center justify-center rounded-md bg-white/10 text-white hover:bg-white/20"
                onClick={() => {
                  onFullscreenPointerActivity();
                  void onFullscreen();
                }}
              >
                {isFullscreen ? <Minimize2 className="h-4 w-4" /> : <Maximize2 className="h-4 w-4" />}
              </button>
            </div>

            <p className="text-center text-[9px] text-pitflix-muted/90">
              Space · ← → seek · F fullscreen · M mute · S subs visibility · Shift+N / Shift+P episodes · Esc
            </p>
          </div>
        </div>
        </div>
      )}

      {/* Next Episode Prompt */}
      {embedReady && nearEnd && nextEp ? (
        <div className="pointer-events-none fixed inset-0 z-[60] flex items-center justify-center bg-black/50 p-6">
          <div className="pointer-events-auto max-w-md rounded-2xl border border-white/15 bg-pitflix-card/95 p-5 text-center shadow-2xl backdrop-blur">
            <p className="text-sm font-medium text-white">Almost finished</p>
            <p className="mt-2 text-xs text-pitflix-muted">
              Up next: S{nextEp.season}E{nextEp.episodeNumber}
              {nextEp.title ? ` — ${nextEp.title}` : ""}
            </p>
            <div className="mt-4 flex flex-wrap justify-center gap-2">
              <button
                type="button"
                className="rounded-lg bg-pitflix-primary px-4 py-2 text-sm font-semibold text-white"
                onClick={() => void playNext()}
              >
                Play next
              </button>
              <button
                type="button"
                className="rounded-lg border border-white/20 px-4 py-2 text-sm text-white"
                disabled={playbackTransportPending && !ended && !sessionDead}
                onClick={() => void handlePrimaryTransport()}
              >
                {ended || sessionDead ? "Play" : displayPaused ? "Resume" : "Pause"}
              </button>
            </div>
          </div>
        </div>
      ) : null}
    </div>
  );
}
