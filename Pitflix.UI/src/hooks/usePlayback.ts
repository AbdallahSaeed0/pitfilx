import { isTauri } from "@tauri-apps/api/core";
import { useQueryClient } from "@tanstack/react-query";
import { useCallback, useEffect } from "react";
import { useLocation, useNavigate } from "react-router-dom";
import api from "../api/client";
import { addHistory, getHistory, historyStopped } from "../api/history";
import { getSettings } from "../api/settings";
import { playbackResumeHintsForKey } from "../playback/playbackApi";
import type { PlaybackLaunchState } from "../types/playback";
import type { PlayerReturnTo } from "../types/playback";
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
};

export function usePlayback() {
  const qc = useQueryClient();
  const navigate = useNavigate();
  const location = useLocation();

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

      const historyRows = (await getHistory(200)) as HistoryResumeFields[];
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

      const resume = Math.max(preferred, inferredResume, localCheckpoint);
      if (import.meta.env.DEV) {
        console.debug("[playback-resume]", {
          filePath: normalizePath(filePath),
          preferred,
          inferredResume,
          localCheckpoint,
          chosen: resume,
        });
      }
      const startSeconds = resume > 60 ? resume : undefined;

      const { id } = (await addHistory({
        filePath,
        title,
        posterPath: posterPath ?? undefined,
        mediaType,
        durationSeconds,
      })) as { id: number };

      currentHistoryId = id;

      const settings = await getSettings();
      const useBuiltin = isTauri() && settings.useBuiltinPlayer !== false;

      if (useBuiltin) {
        const state: PlaybackLaunchState = {
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
            scrollY: typeof window !== "undefined" ? window.scrollY : undefined,
          },
        };
        navigate("/player", { state });
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

      const onFocus = () => {
        clearPlaybackFocusListener();
        const hid = currentHistoryId;
        currentHistoryId = null;
        if (hid != null) {
          void historyStopped(hid, { stoppedAt: new Date().toISOString() }).then(() => {
            void qc.invalidateQueries({ queryKey: ["home-history"] });
            void qc.invalidateQueries({ queryKey: ["home-featured-fallback"] });
            void qc.invalidateQueries({ predicate: (q) => q.queryKey[0] === "home-section" });
            void qc.invalidateQueries({ queryKey: ["history"] });
          });
        }
      };

      focusListener = onFocus;
      window.addEventListener("focus", onFocus);

      void qc.invalidateQueries({ queryKey: ["home-history"] });
      void qc.invalidateQueries({ queryKey: ["home-featured-fallback"] });
      void qc.invalidateQueries({ predicate: (q) => q.queryKey[0] === "home-section" });
      void qc.invalidateQueries({ queryKey: ["history"] });
    },
    [qc, navigate, location.pathname, location.search, location.hash],
  );

  return { play };
}
