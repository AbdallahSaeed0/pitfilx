import { isTauri, invoke } from "@tauri-apps/api/core";
import { getCurrentWindow } from "@tauri-apps/api/window";
import { useQueryClient } from "@tanstack/react-query";
import { useAppPrefsStore } from "../store/appPrefsStore";
import { useCallback, useEffect } from "react";
import { useLocation, useNavigate } from "react-router-dom";
import api from "../api/client";
import { addHistory, getHistory, historyStopped } from "../api/history";
import { getSettings } from "../api/settings";
import { playbackResumeHintsForKey } from "../playback/playbackApi";
import { playMedia } from "../api/player";
import type { PlaybackLaunchState, PlayerReturnTo } from "../types/playback";
import { trustedResumeHeadFromRow, type HistoryResumeFields } from "../utils/trustedResume";

let currentHistoryId: number | null = null;
let focusListener: (() => void) | null = null;

function clearPlaybackFocusListener() {
  if (focusListener) {
    window.removeEventListener("focus", focusListener);
    focusListener = null;
  }
}

function normalizePath(p: string) {
  return p.trim().replace(/\\/g, "/").toLowerCase();
}

/**
 * Timestamped checkpoint logging for diagnosing play-button-to-first-frame
 * latency. Routes through the existing `player2_debug_log` Tauri command so
 * the lines land in the `tauri dev` terminal (eprintln on the Rust side)
 * instead of the browser devtools console, which the user doesn't watch.
 */
let perfLogStart = 0;
function perfLog(label: string) {
  if (!isTauri()) return;
  const now = performance.now();
  if (label === "play:start") perfLogStart = now;
  const elapsed = (now - perfLogStart).toFixed(0);
  void invoke("player2_debug_log", { line: `[perf] +${elapsed}ms ${label}` }).catch(() => {});
}

function findResumeSeconds(historyRows: HistoryResumeFields[], filePath: string) {
  const target = normalizePath(filePath);
  let best = 0;
  for (const row of historyRows) {
    if (normalizePath(row.filePath ?? "") !== target) continue;
    const head = trustedResumeHeadFromRow(row);
    if (head > best) best = head;
  }
  return best;
}

export type PlayContext = {
  libraryMovieId?: number;
  libraryShowId?: number;
  libraryEpisodeId?: number;
  season?: number;
  episodeNumber?: number;
  returnTo?: PlayerReturnTo;
  /** Omit from Continue watching strip; playback still resumes using full history fetch. */
  suppressContinueWatching?: boolean;
};

export function usePlayback() {
  const qc = useQueryClient();
  const navigate = useNavigate();
  const location = useLocation();
  const playerMode = useAppPrefsStore((s) => s.playerMode);

  useEffect(() => () => clearPlaybackFocusListener(), []);

  const play = useCallback(
    async (
      filePath: string,
      title: string,
      posterPath: string | null | undefined,
      mediaType: string,
      durationSeconds: number,
      context: PlayContext = {},
      preferredResumeSeconds?: number,
    ) => {
      clearPlaybackFocusListener();
      currentHistoryId = null;
      perfLog("play:start");

      const historyRows = (await getHistory(200, { includeSuppressed: true, lite: true })) as HistoryResumeFields[];
      perfLog("getHistory:done");
      const inferredResume = findResumeSeconds(historyRows, filePath);
      const preferred = Number.isFinite(preferredResumeSeconds ?? NaN) ? Math.max(0, preferredResumeSeconds ?? 0) : 0;

      let localCheckpoint = 0;
      if (isTauri()) {
        const key =
          context.libraryEpisodeId != null && context.libraryEpisodeId > 0
            ? `ep:${context.libraryEpisodeId}`
            : `file:${normalizePath(filePath)}`;
        try {
          const hints = await playbackResumeHintsForKey(key);
          if (hints.shouldOfferResume && Number.isFinite(hints.resumeSeconds)) {
            localCheckpoint = Math.floor(Math.max(0, hints.resumeSeconds));
          }
        } catch {
          /* POL / disk optional */
        }
      }
      perfLog("resumeHints:done");

      // Priority: explicit caller override > local disk checkpoint (most recent stop) > server inferred.
      // Do NOT take Math.max — that would ignore intentional rewinds by always picking the highest position.
      const resume = preferred > 0 ? preferred : localCheckpoint > 0 ? localCheckpoint : inferredResume;
      if (import.meta.env.DEV) {
        console.debug("[playback-resume]", {
          filePath: normalizePath(filePath),
          preferred,
          inferredResume,
          localCheckpoint,
          chosen: resume,
        });
      }
      // 10 s threshold: ignore near-zero positions (file just opened, no real progress),
      // but always honour explicit seeks even if they land under 1 minute.
      const startSeconds = resume > 10 ? resume : undefined;

      const { id } = (await addHistory({
        filePath,
        title,
        posterPath: posterPath ?? undefined,
        mediaType,
        durationSeconds,
        ...(context.suppressContinueWatching === true ? { suppressContinueWatching: true } : {}),
      })) as { id: number };

      currentHistoryId = id;
      perfLog("addHistory:done");

      const settings = await getSettings();
      perfLog("getSettings:done");
      const useBuiltin = isTauri() && settings.useBuiltinPlayer !== false;

      // Player-engine preference: localStorage-backed, default "pitflix".
      // "pitflix"  → /api/player/play → PitflixPlayer (the new desktop window)
      // "embedded" → skip the API and navigate straight to PlayerPage
      // The setting is read each play so toggling in Settings takes effect
      // instantly without a reload.
      // Two supported engines: in-app libmpv (default) and the external mpv-with-scripts window.
      // Stale localStorage values from earlier builds (pitflix2 / embedded) map to libmpv-embedded.
      const rawEngine =
        (typeof localStorage !== "undefined" && localStorage.getItem("pitflix-player-engine")) || "";
      const playerEngine =
        rawEngine === "pitflix" ? "pitflix" : "libmpv-embedded";
      const forceEmbedded = playerEngine === "libmpv-embedded";
      const useLibMpv = playerEngine === "libmpv-embedded";
      const captureScrollForReturn = (): Pick<PlayerReturnTo, "scrollY" | "mainScrollTop"> => {
        if (typeof window === "undefined" || typeof document === "undefined") return {};
        const main = document.querySelector("main");
        const mainScrollTop =
          main instanceof HTMLElement && Number.isFinite(main.scrollTop) ? main.scrollTop : undefined;
        return {
          scrollY: window.scrollY,
          mainScrollTop,
        };
      };

      // ── New backend player service ──────────────────────────────────────────
      // Try the ASP.NET player microservice first. addHistory() was already
      // called above so the history row exists before this attempt.
      // On any failure, fall through to the existing Tauri / external paths.
      // SKIPPED entirely when the user has chosen the embedded engine in
      // Settings (forceEmbedded), so they can test the React PlayerPage
      // directly without needing to stop Pitflix.API.
      if (!forceEmbedded) try {
        perfLog("playMedia:start");
        await playMedia({
          filePath,
          mediaId: context.libraryMovieId ?? context.libraryShowId ?? 0,
          episodeId: context.libraryEpisodeId,
          startPosition: startSeconds ?? 0,
          player: playerEngine,   // "pitflix" | "pitflix2" → backend picks the companion exe
        });
        perfLog("playMedia:done (backend StartAsync returned — PitflixPlayer attach/mpv spawn happens next, outside this timeline)");
        // Minimize the Tauri shell so the companion window is visible.
        // Mirrors what player3_open does on the Rust side.
        if (isTauri()) void getCurrentWindow().minimize();

        void qc.invalidateQueries({ queryKey: ["home-history"] });
        void qc.invalidateQueries({ queryKey: ["home-featured-fallback"] });
        void qc.invalidateQueries({ predicate: (q) => q.queryKey[0] === "home-section" });
        void qc.invalidateQueries({ queryKey: ["history"] });

        // Refresh-on-close: Pitflix.API's PlayerService writes the user's
        // final position into WatchHistory via SaveProgressToHistoryAsync the
        // moment mpv exits (PitflixPlayer being closed → mpv exits → backend
        // hook fires).  That means by the time the user is back in the React
        // app, the DB already has the up-to-date resume position — but React
        // Query is still serving the cached row from before they pressed
        // Play.  Without this, "Continue Watching" shows the OLD minute
        // until the user manually refreshes the page (the user's reported
        // bug).  Hook into the window-focus event: when the Tauri app
        // regains focus (which happens automatically when PitflixPlayer's
        // window closes), invalidate every history-dependent query.  No
        // historyStopped() call needed — backend has already persisted the
        // final position.
        clearPlaybackFocusListener();
        const refreshOnReturn = () => {
          clearPlaybackFocusListener();
          // Restore the Tauri window when the companion closes and focus returns.
          if (isTauri()) {
            void getCurrentWindow().unminimize();
            void getCurrentWindow().setFocus();
          }
          // PitflixPlayer's OnClosed calls /api/player/save-progress-now
          // SYNCHRONOUSLY before its window closes — so by the time Tauri's
          // main window regains focus and this listener fires, the WatchHistory
          // row is already updated.  Use refetchQueries (which fires the
          // network request immediately, even if no observers) instead of
          // invalidateQueries (which just marks stale + observers re-fetch
          // later) so Continue Watching snaps to the new minute the moment
          // PitflixPlayer's window closes — sub-second update.
          void qc.refetchQueries({ queryKey: ["home-history"] });
          void qc.refetchQueries({ queryKey: ["home-watching-currently"] });
          void qc.refetchQueries({ queryKey: ["home-featured-fallback"] });
          void qc.refetchQueries({ predicate: (q) => q.queryKey[0] === "home-section" });
          void qc.refetchQueries({ queryKey: ["history"] });
        };
        focusListener = refreshOnReturn;
        window.addEventListener("focus", refreshOnReturn);
        return;
      } catch {
        // new player service not available or failed — fall through to existing invoke() path
      }
      // ── End new player service ───────────────────────────────────────────────

      if (useBuiltin) {
        const scrollCapture = captureScrollForReturn();
        const launchState: PlaybackLaunchState = {
          historyId: id,
          filePath,
          title,
          posterPath: posterPath ?? null,
          mediaType,
          durationSeconds,
          resumeSeconds: startSeconds,
          libraryMovieId: context.libraryMovieId,
          libraryShowId: context.libraryShowId,
          libraryEpisodeId: context.libraryEpisodeId,
          season: context.season,
          episodeNumber: context.episodeNumber,
          returnTo: context.returnTo ?? {
            pathname: location.pathname,
            search: location.search || undefined,
            hash: location.hash || undefined,
            ...scrollCapture,
          },
          ...(context.suppressContinueWatching === true ? { suppressContinueWatching: true } : {}),
          ...(useLibMpv ? { useLibMpv: true } : {}),
        };
        if (playerMode === "remote") {
          navigate("/player-remote", { state: launchState });
        } else {
          navigate("/player", { state: launchState });
        }
        void qc.invalidateQueries({ queryKey: ["home-history"] });
        void qc.invalidateQueries({ queryKey: ["home-featured-fallback"] });
        void qc.invalidateQueries({ predicate: (q) => q.queryKey[0] === "home-section" });
        void qc.invalidateQueries({ queryKey: ["history"] });
        return;
      }

      await api.post("/play", {
        filePath,
        startSeconds,
        title,
        posterPath: posterPath ?? null,
        mediaType,
        durationSeconds,
        skipHistoryAdd: true,
      });
      // PitflixPlayer launches itself via the backend's PlayerService — no
      // openPlayerWindow() call needed on the legacy /play path either.

      const onFocus = () => {
        clearPlaybackFocusListener();
        const hid = currentHistoryId;
        currentHistoryId = null;
        if (hid != null) {
          // Try to read actual playhead from POL IPC mirror before finalising the row so we
          // record a real position rather than just wall-clock session time.
          void (async () => {
            let positionSeconds: number | undefined;
            if (isTauri()) {
              try {
                const { playbackGetSnapshot } = await import("../playback/playbackApi");
                const snap = await playbackGetSnapshot();
                if (Number.isFinite(snap.currentTime) && snap.currentTime > 0) {
                  positionSeconds = Math.floor(snap.currentTime);
                }
              } catch {
                /* POL may be idle — fall back to session-time estimation */
              }
            }
            await historyStopped(hid, {
              stoppedAt: new Date().toISOString(),
              ...(positionSeconds != null ? { positionSeconds } : {}),
            });
            void qc.invalidateQueries({ queryKey: ["home-history"] });
            void qc.invalidateQueries({ queryKey: ["home-watching-currently"] });
            void qc.invalidateQueries({ queryKey: ["home-featured-fallback"] });
            void qc.invalidateQueries({ predicate: (q) => q.queryKey[0] === "home-section" });
            void qc.invalidateQueries({ queryKey: ["history"] });
          })();
        }
      };

      focusListener = onFocus;
      window.addEventListener("focus", onFocus);

      void qc.invalidateQueries({ queryKey: ["home-history"] });
      void qc.invalidateQueries({ queryKey: ["home-featured-fallback"] });
      void qc.invalidateQueries({ predicate: (q) => q.queryKey[0] === "home-section" });
      void qc.invalidateQueries({ queryKey: ["history"] });
    },
    [qc, navigate, location.pathname, location.search, location.hash, playerMode],
  );

  return { play };
}
