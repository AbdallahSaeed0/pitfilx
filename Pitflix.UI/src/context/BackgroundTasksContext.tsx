import { createContext, useCallback, useContext, useMemo, useRef, useState, type ReactNode } from "react";
import { useQuery, useQueryClient } from "@tanstack/react-query";
import type { AwardsCachePreloadStatus } from "../api/awards";
import {
  cancelAwardsCachePreload,
  clearAwardsCache,
  getAwardsCacheStatus,
  startAwardsCachePreload,
} from "../api/awards";
import { prefetchLibraryMetadataStream, type PrefetchProgressLine } from "../api/library";
import { cn } from "../utils/cn";

export type LibraryPrefetchUiState = {
  running: boolean;
  pct: number;
  liveLine: string;
  message: string | null;
  log: string[];
  moviesTotal: number;
  seriesTotal: number;
  moviesAlreadyCached: number;
  seriesAlreadyCached: number;
};

const initialLib: LibraryPrefetchUiState = {
  running: false,
  pct: 0,
  liveLine: "",
  message: null,
  log: [],
  moviesTotal: 0,
  seriesTotal: 0,
  moviesAlreadyCached: 0,
  seriesAlreadyCached: 0,
};

type BackgroundTasksContextValue = {
  awardsStatus: AwardsCachePreloadStatus | undefined;
  isFetchingAwardsStatus: boolean;
  libraryPrefetch: LibraryPrefetchUiState;
  /** POST preload; always refreshes status after (shows progress even when busy). */
  requestAwardsPreload: () => Promise<{ started: boolean; busy: boolean }>;
  requestAwardsClear: () => Promise<void>;
  cancelAwardsCachePreload: () => Promise<void>;
  startLibraryMetadataPrefetch: () => void;
  stopLibraryMetadataPrefetch: () => void;
};

const BackgroundTasksContext = createContext<BackgroundTasksContextValue | null>(null);

export function useBackgroundTasks(): BackgroundTasksContextValue {
  const v = useContext(BackgroundTasksContext);
  if (!v) throw new Error("useBackgroundTasks must be used within BackgroundTasksProvider");
  return v;
}

export function BackgroundTasksProvider({ children }: { children: ReactNode }) {
  const qc = useQueryClient();
  const prefetchAbortRef = useRef<AbortController | null>(null);
  const [libPrefetch, setLibPrefetch] = useState<LibraryPrefetchUiState>(initialLib);

  const awardsStatusQ = useQuery({
    queryKey: ["awards-cache-status"],
    queryFn: getAwardsCacheStatus,
    refetchInterval: (q) => (q.state.data?.running ? 1000 : false),
    staleTime: 0,
  });

  const awardsStatus = awardsStatusQ.data;

  const invalidateAwards = useCallback(() => {
    void qc.invalidateQueries({ queryKey: ["awards-cache-status"] });
  }, [qc]);

  const requestAwardsPreload = useCallback(async () => {
    const r = await startAwardsCachePreload();
    invalidateAwards();
    await qc.refetchQueries({ queryKey: ["awards-cache-status"] });
    return { started: r.started, busy: r.busy === true };
  }, [invalidateAwards, qc]);

  const requestAwardsClear = useCallback(async () => {
    await clearAwardsCache();
    invalidateAwards();
    void qc.invalidateQueries({ predicate: (q) => q.queryKey[0] === "award-edition" });
  }, [invalidateAwards, qc]);

  const cancelAwardsCachePreloadFn = useCallback(async () => {
    await cancelAwardsCachePreload();
    invalidateAwards();
    await qc.refetchQueries({ queryKey: ["awards-cache-status"] });
  }, [invalidateAwards, qc]);

  const stopLibraryMetadataPrefetch = useCallback(() => {
    prefetchAbortRef.current?.abort();
  }, []);

  const startLibraryMetadataPrefetch = useCallback(() => {
    prefetchAbortRef.current?.abort();
    const ac = new AbortController();
    prefetchAbortRef.current = ac;
    setLibPrefetch({
      ...initialLib,
      running: true,
      liveLine: "Connecting…",
    });

    let moviesTotal = 0;
    let seriesTotal = 0;
    const pushLog = (s: string) =>
      setLibPrefetch((prev) => ({ ...prev, log: [...prev.log.slice(-59), s].slice(-60) }));

    void prefetchLibraryMetadataStream(
      (ev: PrefetchProgressLine) => {
        if (ev.phase === "start") {
          moviesTotal = ev.moviesTotal;
          seriesTotal = ev.seriesTotal;
          const ms = ev.moviesAlreadyCached ?? 0;
          const ss = ev.seriesAlreadyCached ?? 0;
          setLibPrefetch((prev) => ({
            ...prev,
            moviesTotal,
            seriesTotal,
            moviesAlreadyCached: ms,
            seriesAlreadyCached: ss,
            liveLine:
              moviesTotal + seriesTotal === 0
                ? ms + ss > 0
                  ? `Nothing pending — ${ms} movies + ${ss} series already prefetched.`
                  : "Nothing to prefetch (no matched titles with TMDB ids)."
                : `Starting: ${moviesTotal} movies, ${seriesTotal} series pending (${ms} movies + ${ss} series already cached).`,
          }));
          return;
        }
        if (ev.phase === "movie") {
          const tot = moviesTotal + seriesTotal;
          const pct = tot > 0 ? Math.min(100, (ev.index / tot) * 100) : 0;
          const st = `${ev.ok ? "OK" : "Failed"} — ${ev.title ?? `#${ev.libraryId}`}`;
          setLibPrefetch((prev) => ({
            ...prev,
            pct,
            liveLine: `Movie ${ev.index}/${ev.itemTotal}: ${st}`,
          }));
          pushLog(`Movie ${ev.index}/${ev.itemTotal}: ${ev.title ?? ev.libraryId} — ${ev.ok ? "OK" : ev.error ?? "fail"}`);
          return;
        }
        if (ev.phase === "series") {
          const tot = moviesTotal + seriesTotal;
          const pct =
            tot > 0 ? Math.min(100, ((moviesTotal + ev.index) / tot) * 100) : 0;
          const st = `${ev.ok ? "OK" : "Failed"} — ${ev.title ?? `#${ev.libraryId}`}`;
          setLibPrefetch((prev) => ({
            ...prev,
            pct,
            liveLine: `Series ${ev.index}/${ev.itemTotal}: ${st}`,
          }));
          pushLog(
            `Series ${ev.index}/${ev.itemTotal}: ${ev.title ?? ev.libraryId} — ${ev.ok ? "OK" : ev.error ?? "fail"}`,
          );
          return;
        }
        if (ev.phase === "done") {
          const nErr = ev.errors?.length ?? 0;
          setLibPrefetch((prev) => ({
            ...prev,
            pct: 100,
            liveLine: "",
            message: `Finished: ${ev.moviesOk} movies, ${ev.seriesOk} series cached.${nErr > 0 ? ` ${nErr} title(s) had errors.` : ""}`,
          }));
          void qc.invalidateQueries({ queryKey: ["movie"] });
          void qc.invalidateQueries({ queryKey: ["show"] });
          void qc.invalidateQueries({ queryKey: ["movies"] });
          void qc.invalidateQueries({ queryKey: ["series"] });
        }
      },
      { signal: ac.signal },
    )
      .catch((err: unknown) => {
        if (err instanceof Error && err.name === "AbortError") {
          setLibPrefetch((prev) => ({
            ...prev,
            running: false,
            message: "Pre-download cancelled.",
            liveLine: "",
          }));
          return;
        }
        setLibPrefetch((prev) => ({
          ...prev,
          running: false,
          message: err instanceof Error ? err.message : "Pre-download failed.",
          liveLine: "",
        }));
      })
      .finally(() => {
        prefetchAbortRef.current = null;
        setLibPrefetch((prev) => ({ ...prev, running: false }));
      });
  }, [qc]);

  const value = useMemo<BackgroundTasksContextValue>(
    () => ({
      awardsStatus,
      isFetchingAwardsStatus: awardsStatusQ.isFetching,
      libraryPrefetch: libPrefetch,
      requestAwardsPreload,
      requestAwardsClear,
      cancelAwardsCachePreload: cancelAwardsCachePreloadFn,
      startLibraryMetadataPrefetch,
      stopLibraryMetadataPrefetch,
    }),
    [
      awardsStatus,
      awardsStatusQ.isFetching,
      libPrefetch,
      requestAwardsPreload,
      requestAwardsClear,
      cancelAwardsCachePreloadFn,
      startLibraryMetadataPrefetch,
      stopLibraryMetadataPrefetch,
    ],
  );

  const showDock = awardsStatus?.running || libPrefetch.running;

  return (
    <BackgroundTasksContext.Provider value={value}>
      {children}
      {showDock ? (
        <GlobalBackgroundProgressDock
          awardsStatus={awardsStatus}
          libraryPrefetch={libPrefetch}
          onStopAwards={cancelAwardsCachePreloadFn}
          onStopLibrary={stopLibraryMetadataPrefetch}
        />
      ) : null}
    </BackgroundTasksContext.Provider>
  );
}

function GlobalBackgroundProgressDock({
  awardsStatus,
  libraryPrefetch,
  onStopAwards,
  onStopLibrary,
}: {
  awardsStatus: AwardsCachePreloadStatus | undefined;
  libraryPrefetch: LibraryPrefetchUiState;
  onStopAwards: () => void | Promise<void>;
  onStopLibrary: () => void;
}) {
  const awardsActive = awardsStatus?.running;
  const awardsPct =
    awardsStatus && awardsStatus.totalNominees > 0
      ? Math.min(100, (awardsStatus.processedNominees / awardsStatus.totalNominees) * 100)
      : 0;

  return (
    <div
      className="pointer-events-auto fixed bottom-3 left-3 right-3 z-[100] flex max-h-[min(40vh,320px)] flex-col gap-2 sm:left-auto sm:right-4 sm:w-[min(100vw-2rem,420px)]"
      role="status"
      aria-live="polite"
    >
      {awardsActive && (
        <div className="overflow-hidden rounded-xl border border-amber-500/35 bg-pitflix-bg/95 px-3 py-2.5 shadow-[0_12px_40px_rgba(0,0,0,0.55)] backdrop-blur-md">
          <div className="flex items-start justify-between gap-2">
            <div className="min-w-0 flex-1">
              <p className="text-[10px] font-semibold uppercase tracking-wide text-amber-200/90">
                Awards cache (running)
              </p>
              <p className="mt-1 text-[11px] text-pitflix-subtle">
                {awardsStatus?.phase} · {awardsStatus?.processedNominees ?? 0} / {awardsStatus?.totalNominees ?? 0}{" "}
                nominees · rows {awardsStatus?.successCount ?? 0} ok / failed {awardsStatus?.failedCount ?? 0}
              </p>
              {awardsStatus?.awardId ? (
                <p className="mt-0.5 truncate text-[10px] text-pitflix-muted">
                  {awardsStatus.awardId} · {awardsStatus.year}
                  {awardsStatus.categoryId ? ` · ${awardsStatus.categoryId}` : ""}
                </p>
              ) : null}
              {awardsStatus?.lastError ? (
                <p className="mt-1 text-[10px] text-rose-200/90">{awardsStatus.lastError}</p>
              ) : null}
            </div>
            <button
              type="button"
              className="shrink-0 rounded-md border border-white/15 px-2 py-0.5 text-[10px] text-pitflix-muted hover:bg-white/5"
              onClick={() => void onStopAwards()}
            >
              Stop
            </button>
          </div>
          {awardsActive && awardsStatus && awardsStatus.totalNominees > 0 ? (
            <div className="mt-2 h-1.5 w-full overflow-hidden rounded-full bg-zinc-800">
              <div
                className="h-full rounded-full bg-amber-500 transition-[width] duration-300"
                style={{ width: `${Math.round(awardsPct)}%` }}
              />
            </div>
          ) : null}
        </div>
      )}

      {libraryPrefetch.running && (
        <div className="overflow-hidden rounded-xl border border-emerald-600/35 bg-pitflix-bg/95 px-3 py-2.5 shadow-[0_12px_40px_rgba(0,0,0,0.55)] backdrop-blur-md">
          <div className="flex items-start justify-between gap-2">
            <div className="min-w-0 flex-1">
              <p className="text-[10px] font-semibold uppercase tracking-wide text-emerald-200/90">
                Library metadata (downloading)
              </p>
              <p className={cn("mt-1 text-[11px] text-pitflix-subtle", !libraryPrefetch.liveLine && "text-pitflix-muted")}>
                {libraryPrefetch.liveLine || "Starting…"}
              </p>
              {libraryPrefetch.moviesAlreadyCached + libraryPrefetch.seriesAlreadyCached > 0 ? (
                <p className="mt-0.5 text-[10px] text-pitflix-muted">
                  Already cached (skipped): {libraryPrefetch.moviesAlreadyCached} movies,{" "}
                  {libraryPrefetch.seriesAlreadyCached} series
                </p>
              ) : null}
            </div>
            {libraryPrefetch.running ? (
              <button
                type="button"
                className="shrink-0 rounded-md border border-white/15 px-2 py-0.5 text-[10px] text-pitflix-muted hover:bg-white/5"
                onClick={onStopLibrary}
              >
                Stop
              </button>
            ) : null}
          </div>
          {libraryPrefetch.running ? (
            <div className="mt-2 h-1.5 w-full overflow-hidden rounded-full bg-zinc-800">
              <div
                className="h-full rounded-full bg-emerald-600 transition-[width] duration-200"
                style={{ width: `${Math.round(libraryPrefetch.pct)}%` }}
              />
            </div>
          ) : null}
        </div>
      )}
    </div>
  );
}
