import { useEffect } from "react";
import { useQuery, useQueryClient } from "@tanstack/react-query";
import { API_ORIGIN } from "../api/client";
import { getScanProgress } from "../api/scan";
import { useScanStore } from "../store/scanStore";

export function useScanProgressQuery() {
  return useQuery({
    queryKey: ["scanProgress"],
    queryFn: getScanProgress,
    refetchInterval: (query) => (query.state.data?.isRunning ? 1000 : false),
  });
}

/** SSE: refresh cached progress so UI stays smooth between polls. */
export function useScanStream() {
  const qc = useQueryClient();

  useEffect(() => {
    const setProgress = useScanStore.getState().setProgress;
    const setLastComplete = useScanStore.getState().setLastComplete;

    const es = new EventSource(`${API_ORIGIN}/api/scan/stream`);
    es.onmessage = (ev) => {
      try {
        const msg = JSON.parse(ev.data) as Record<string, unknown>;
        const type = String(msg.type ?? "");
        if (type === "progress") {
          setProgress({
            isRunning: true,
            total: Number(msg.total ?? 0),
            current: Number(msg.current ?? 0),
            currentFile: String(msg.file ?? ""),
            matched: Number(msg.MatchedSoFar ?? msg.matched ?? 0),
            unmatched: Number(msg.UnmatchedSoFar ?? msg.unmatched ?? 0),
            skipped: Number(msg.skipped ?? msg.SkippedSoFar ?? 0),
            percent:
              Number(msg.total ?? 0) > 0
                ? (100 * Number(msg.current ?? 0)) / Number(msg.total ?? 1)
                : 0,
          });
        } else if (type === "complete") {
          setProgress({ isRunning: false });
          setLastComplete({
            matched: Number(msg.matched ?? msg.Matched ?? 0),
            unmatched: Number(msg.unmatched ?? msg.Unmatched ?? 0),
            skipped: Number(msg.skipped ?? 0),
            empty: Boolean(msg.empty ?? false),
            message: typeof msg.message === "string" ? msg.message : undefined,
          });
        } else if (type === "cancelled") {
          setProgress({ isRunning: false });
        } else if (type === "libraryNotification") {
          const titleRaw = msg.title ?? msg.Title;
          const title = typeof titleRaw === "string" ? titleRaw.trim() : "";
          if (!title) {
            /* skip */
          } else {
            const kindRaw = msg.kind ?? msg.Kind;
            const kind = typeof kindRaw === "string" && kindRaw.trim() ? kindRaw.trim() : "movie";
            const matched = Boolean(msg.matched ?? msg.Matched);
            useScanStore.getState().pushLibraryToast({ title, kind, matched });
            void qc.invalidateQueries({ queryKey: ["stats"] });
            void qc.invalidateQueries({ queryKey: ["movies"] });
            void qc.invalidateQueries({ queryKey: ["series"] });
            void qc.invalidateQueries({ queryKey: ["unmatched"] });
          }
        }
      } catch {
        /* ignore */
      }
      void qc.invalidateQueries({ queryKey: ["scanProgress"] });
    };
    es.onerror = () => {
      es.close();
    };
    return () => es.close();
  }, [qc]);
}
