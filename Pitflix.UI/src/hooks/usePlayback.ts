import { isTauri, invoke } from "@tauri-apps/api/core";
import { useQueryClient } from "@tanstack/react-query";
import { useAppPrefsStore } from "../store/appPrefsStore";
import { useCallback, useEffect } from "react";
import { useLocation, useNavigate } from "react-router-dom";
import api from "../api/client";
import { addHistory, getHistory, historyStopped } from "../api/history";
import { getSettings } from "../api/settings";
import { playbackResumeHintsForKey } from "../playback/playbackApi";
import { normalizePlayerEngine, usesPlayerPage } from "../playback/playerEngine";
import type { LiveChannelEntry, PlaybackLaunchState, PlayerReturnTo } from "../types/playback";
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
  /** Full ordered list of live IPTV channels — populates the in-player channel playlist. */
  liveChannels?: LiveChannelEntry[];
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

      // getHistory/addHistory/getSettings don't depend on each other's results — fire them
      // concurrently instead of one after another to shave latency off every play() call.
      const historyPromise = getHistory(200, { includeSuppressed: true, lite: true }) as Promise<
        HistoryResumeFields[]
      >;
      const addHistoryPromise = addHistory({
        filePath,
        title,
        posterPath: posterPath ?? undefined,
        mediaType,
        durationSeconds,
        ...(context.suppressContinueWatching === true ? { suppressContinueWatching: true } : {}),
      }) as Promise<{ id: number }>;
      const settingsPromise = getSettings();

      const preferred = Number.isFinite(preferredResumeSeconds ?? NaN) ? Math.max(0, preferredResumeSeconds ?? 0) : 0;

      // When the caller already knows where to resume (the "Resume from X:XX" modal, or an
      // explicit Start Over), skip waiting on history/resume-hint lookups entirely — they'd
      // only be used to derive a value we're about to override anyway.
      let resume = preferred;
      if (preferred <= 0) {
        const resumeHintsPromise =
          isTauri()
            ? playbackResumeHintsForKey(
                context.libraryEpisodeId != null && context.libraryEpisodeId > 0
                  ? `ep:${context.libraryEpisodeId}`
                  : `file:${normalizePath(filePath)}`,
              ).catch(() => null)
            : Promise.resolve(null);

        const [historyRows, hints] = await Promise.all([historyPromise, resumeHintsPromise]);
        perfLog("history+resumeHints:done");
        const inferredResume = findResumeSeconds(historyRows, filePath);
        const localCheckpoint =
          hints?.shouldOfferResume && Number.isFinite(hints.resumeSeconds)
            ? Math.floor(Math.max(0, hints.resumeSeconds))
            : 0;
        // Priority: local disk checkpoint (most recent stop) > server inferred.
        resume = localCheckpoint > 0 ? localCheckpoint : inferredResume;
        if (import.meta.env.DEV) {
          console.debug("[playback-resume]", {
            filePath: normalizePath(filePath),
            preferred,
            inferredResume,
            localCheckpoint,
            chosen: resume,
          });
        }
      } else {
        perfLog("resume:preferred-fast-path");
      }
      // 10 s threshold: ignore near-zero positions (file just opened, no real progress),
      // but always honour explicit seeks even if they land under 1 minute.
      const startSeconds = resume > 10 ? resume : undefined;

      const { id } = await addHistoryPromise;

      currentHistoryId = id;
      perfLog("addHistory:done");

      const settings = await settingsPromise;
      perfLog("getSettings:done");
      const useBuiltin = isTauri() && settings.useBuiltinPlayer !== false;

      // Player-engine preference (Settings → Playback):
      //   libmpv-embedded — video inside the app (PlayerPage + libmpv)
      //   external-mpv    — detached mpv window + PlayerPage companion (episodes, shortcuts)
      const rawEngine =
        (typeof localStorage !== "undefined" && localStorage.getItem("pitflix-player-engine")) || "";
      const playerEngine = normalizePlayerEngine(rawEngine);
      const useLibMpv = playerEngine === "libmpv-embedded";
      const usePlayerPage = usesPlayerPage(playerEngine);
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

      if (useBuiltin && usePlayerPage) {
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
          ...(context.liveChannels?.length ? { liveChannels: context.liveChannels } : {}),
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
