import { useEffect } from "react";
import { useQuery, useQueryClient } from "@tanstack/react-query";
import { API_ORIGIN } from "../api/client";
import { getScanProgress } from "../api/scan";
import { useScanStore } from "../store/scanStore";
import { pushNotification } from "../store/notificationsStore";

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

    let es: EventSource | null = null;
    let reconnectTimeout: ReturnType<typeof setTimeout> | null = null;
    let reconnectAttempts = 0;
    const MAX_RECONNECT_ATTEMPTS = 10;

    const connect = () => {
      if (es) {
        es.close();
      }

      es = new EventSource(`${API_ORIGIN}/api/scan/stream`);
      
      es.onopen = () => {
        reconnectAttempts = 0;
      };

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
              matched: Number(
                msg.matchedSoFar ?? msg.MatchedSoFar ?? msg.matched ?? 0,
              ),
              unmatched: Number(
                msg.unmatchedSoFar ?? msg.UnmatchedSoFar ?? msg.unmatched ?? 0,
              ),
              skipped: Number(msg.skipped ?? msg.SkippedSoFar ?? 0),
              percent:
                Number(msg.total ?? 0) > 0
                  ? (100 * Number(msg.current ?? 0)) / Number(msg.total ?? 1)
                  : 0,
            });
          } else if (type === "complete") {
            setProgress({ isRunning: false });
            const completedMatched = Number(msg.matched ?? msg.Matched ?? 0);
            const completedUnmatched = Number(msg.unmatched ?? msg.Unmatched ?? 0);
            setLastComplete({
              matched: completedMatched,
              unmatched: completedUnmatched,
              skipped: Number(msg.skipped ?? 0),
              empty: Boolean(msg.empty ?? false),
              message: typeof msg.message === "string" ? msg.message : undefined,
            });
            if (completedMatched > 0 || completedUnmatched > 0) {
              pushNotification({
                kind: "scan",
                title: "Library scan finished",
                message: `${completedMatched} matched · ${completedUnmatched} unmatched`,
              });
            }
            // Refresh the library so newly matched/unmatched files appear immediately
            if (completedMatched > 0 || completedUnmatched > 0) {
              void qc.invalidateQueries({ queryKey: ["movies"] });
              void qc.invalidateQueries({ queryKey: ["series"] });
              void qc.invalidateQueries({ queryKey: ["unmatched"] });
              void qc.invalidateQueries({ queryKey: ["stats"] });
              void qc.invalidateQueries({ queryKey: ["home-movies"] });
              void qc.invalidateQueries({ queryKey: ["home-series"] });
              // A scan can drop new episodes onto an already-finished show — refresh Up Next so it resurfaces.
              void qc.invalidateQueries({ queryKey: ["home-watching-currently"] });
              // Broad (no id) invalidation matches every cached ["movie", id]/["show", id] detail
              // query — without this, a show/movie detail page already open (or cached) keeps
              // showing its pre-sync episode list until its own staleTime expires.
              void qc.invalidateQueries({ queryKey: ["movie"] });
              void qc.invalidateQueries({ queryKey: ["show"] });
            }
          } else if (type === "libraryUpdated") {
            // Lightweight broadcast from auto-scan when new files are indexed (no toast shown)
            void qc.invalidateQueries({ queryKey: ["movies"] });
            void qc.invalidateQueries({ queryKey: ["series"] });
            void qc.invalidateQueries({ queryKey: ["unmatched"] });
            void qc.invalidateQueries({ queryKey: ["stats"] });
            void qc.invalidateQueries({ queryKey: ["home-movies"] });
            void qc.invalidateQueries({ queryKey: ["home-series"] });
            void qc.invalidateQueries({ queryKey: ["home-watching-currently"] });
            void qc.invalidateQueries({ queryKey: ["movie"] });
            void qc.invalidateQueries({ queryKey: ["show"] });
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
              const libraryIdRaw = msg.libraryId ?? msg.LibraryId;
              const libraryId = typeof libraryIdRaw === "number" ? libraryIdRaw : undefined;
              const seasonRaw = msg.season ?? msg.Season;
              const season = typeof seasonRaw === "number" ? seasonRaw : undefined;
              useScanStore.getState().pushLibraryToast({ title, kind, matched });
              // Deep-link straight to the matched item; unmatched files go to the review queue.
              // `libraryId` only arrives from a rebuilt API, so when it's missing fall back to the
              // library page pre-filtered to the title — still one click to the thing, and it works
              // against an older API build. Episode titles carry a " · S04E02" suffix; strip it so
              // the search matches the show.
              const baseTitle = title.split(" · ")[0].trim();
              const href = !matched
                ? "/unmatched"
                : kind === "episode"
                  ? libraryId != null
                    ? season != null
                      ? `/series/${libraryId}/season/${season}`
                      : `/series/${libraryId}`
                    : `/series?q=${encodeURIComponent(baseTitle)}`
                  : kind === "movie"
                    ? libraryId != null
                      ? `/movie/${libraryId}`
                      : `/movies?q=${encodeURIComponent(baseTitle)}`
                    : undefined;
              pushNotification({
                kind: matched ? "matched" : "unmatched",
                title,
                message: matched
                  ? `Matched to your library${kind ? ` · ${kind}` : ""}`
                  : "Couldn't be matched automatically",
                href,
              });
              void qc.invalidateQueries({ queryKey: ["stats"] });
              void qc.invalidateQueries({ queryKey: ["movies"] });
              void qc.invalidateQueries({ queryKey: ["series"] });
              void qc.invalidateQueries({ queryKey: ["unmatched"] });
              void qc.invalidateQueries({ queryKey: ["home-watching-currently"] });
              if (libraryId != null) {
                void qc.invalidateQueries({ queryKey: [kind === "movie" ? "movie" : "show", libraryId] });
              }
            }
          }
        } catch {
          /* ignore */
        }
        void qc.invalidateQueries({ queryKey: ["scanProgress"] });
      };

      es.onerror = () => {
        es?.close();
        
        // Exponential backoff reconnection
        if (reconnectAttempts < MAX_RECONNECT_ATTEMPTS) {
          reconnectAttempts++;
          const delay = Math.min(1000 * Math.pow(2, reconnectAttempts - 1), 30000);
          reconnectTimeout = setTimeout(() => {
            connect();
          }, delay);
        }
      };
    };

    connect();

    return () => {
      if (reconnectTimeout) {
        clearTimeout(reconnectTimeout);
      }
      es?.close();
    };
  }, [qc]);
}
