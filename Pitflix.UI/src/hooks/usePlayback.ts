import { useQueryClient } from "@tanstack/react-query";
import { useCallback, useEffect } from "react";
import api from "../api/client";
import { addHistory, getHistory, historyStopped } from "../api/history";

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

function findResumeSeconds(historyRows: { filePath: string; estimatedSeconds?: number }[], filePath: string) {
  const target = normalizePath(filePath);
  let best = 0;
  for (const row of historyRows) {
    if (normalizePath(row.filePath) !== target) continue;
    const est = row.estimatedSeconds ?? 0;
    if (est > best) best = est;
  }
  return best;
}

export function usePlayback() {
  const qc = useQueryClient();

  useEffect(() => () => clearPlaybackFocusListener(), []);

  const play = useCallback(
    async (
      filePath: string,
      title: string,
      posterPath: string | null | undefined,
      mediaType: string,
      durationSeconds: number,
    ) => {
      clearPlaybackFocusListener();
      currentHistoryId = null;

      const historyRows = (await getHistory(200)) as { filePath: string; estimatedSeconds?: number }[];
      const resume = findResumeSeconds(historyRows, filePath);
      const startSeconds = resume > 60 ? resume : undefined;

      const { id } = (await addHistory({
        filePath,
        title,
        posterPath: posterPath ?? undefined,
        mediaType,
        durationSeconds,
      })) as { id: number };

      currentHistoryId = id;

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
    [qc],
  );

  return { play };
}
