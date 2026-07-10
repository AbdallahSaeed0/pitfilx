import axios from "axios";
import { Link } from "react-router-dom";
import { Wrench } from "lucide-react";
import { cleanupLibrary, cleanupMissingFiles, refreshLibraryArtwork } from "../../api/library";
import { clearImageCache } from "../../api/maintenance";
import { runTrailerIngestion } from "../../api/homeDiscover";
import { queueRatingsLibraryBackfill, queueRatingsStaleSweep } from "../../api/ratings";
import { startScan } from "../../api/scan";
import type { SettingsPageModel } from "./useSettingsPageModel";

type Props = { model: SettingsPageModel };

export function SettingsMaintenanceTab({ model }: Props) {
  const {
    data,
    scanBusy,
    setScanBusy,
    setScanMessage,
    scanMessage,
    qc,
    formatScanOrApiError,
    artworkBusy,
    setArtworkBusy,
    setArtworkMessage,
    artworkMessage,
    trailerIngestionBusy,
    setTrailerIngestionBusy,
    setTrailerIngestionMsg,
    trailerIngestionMsg,
    setMaintMessage,
    maintMessage,
    requestAwardsPreload,
    setAwardsClearConfirmOpen,
    awardsStatus,
    ratingsMaintKey,
    setRatingsMaintKey,
    ratingsBackfillBusy,
    setRatingsBackfillBusy,
    setRatingsMaintMsg,
    startWatchingRatingsQueue,
    refetchRatingsQueue,
    ratingsMaintMsg,
    ratingsStaleBusy,
    setRatingsStaleBusy,
    ratingsQueueWatching,
    ratingsQueueStatus,
    ratingsQueueFetched,
    ratingsQueueFetching,
    cleanupBusy,
    setCleanupBusy,
    setCleanupMessage,
    cleanupMessage,
    setRemoveOpen,
    setRemoveQuery,
    setRemoveBrowseKind,
    setSearchHits,
    setResetDbInfoOpen,
    libraryPrefetch,
    startLibraryMetadataPrefetch,
    stopLibraryMetadataPrefetch,
  } = model;

  return (
<section
            id="settings-maintenance"
            className="rounded-2xl border border-white/[0.09] bg-pitflix-surface/50 p-6 shadow-xl shadow-black/30 backdrop-blur-sm"
          >
            <h2 className="mb-4 flex items-center gap-2 border-b border-white/[0.09] pb-4 text-[15px] font-bold tracking-tight text-white">
              <Wrench className="h-4 w-4 text-rose-400" strokeWidth={2} />
              Maintenance
            </h2>
            <div className="grid grid-cols-2 gap-3">
              <button
                type="button"
                disabled={scanBusy}
                className="h-10 rounded-xl bg-pitflix-primary text-xs font-semibold text-white shadow-sm shadow-pitflix-primary/30 transition-all hover:bg-pitflix-light hover:shadow-pitflix-primary/40 disabled:opacity-50"
                onClick={() => {
                  setScanMessage(null);
                  if ((data?.libraryPaths ?? []).length === 0) {
                    setScanMessage("Add at least one library folder before scanning.");
                    return;
                  }
                  setScanBusy(true);
                  void startScan({ folders: [] })
                    .then(() => {
                      setScanMessage("Scan started. New files will be added; files already matched are skipped.");
                      void qc.invalidateQueries({ queryKey: ["scanProgress"] });
                    })
                    .catch((err) => {
                      console.error("Scan failed:", err);
                      setScanMessage(formatScanOrApiError(err));
                    })
                    .finally(() => setScanBusy(false));
                }}
              >
                🔄 Scan Library
              </button>
              <button
                type="button"
                disabled={artworkBusy}
                className="h-10 rounded-xl border border-pitflix-primary/40 bg-pitflix-bg text-xs font-medium text-white transition-all hover:border-pitflix-primary/60 hover:bg-pitflix-primary/15 disabled:opacity-50"
                onClick={() => {
                  setArtworkMessage(null);
                  setArtworkBusy(true);
                  void refreshLibraryArtwork()
                    .then((r) => {
                      setArtworkMessage(
                        `Artwork: ${r.movies} movies, ${r.shows} series${r.failures > 0 ? ` (${r.failures} issues)` : ""}.`,
                      );
                      void qc.invalidateQueries({ queryKey: ["movies"] });
                      void qc.invalidateQueries({ queryKey: ["series"] });
                      void qc.invalidateQueries({ queryKey: ["home-movies"] });
                      void qc.invalidateQueries({ queryKey: ["home-series"] });
                      void qc.invalidateQueries({ queryKey: ["history"] });
                      void qc.invalidateQueries({ queryKey: ["home-history"] });
                      void qc.invalidateQueries({ queryKey: ["home-top-rated"] });
                      void qc.invalidateQueries({ queryKey: ["home-arabic"] });
                      void qc.invalidateQueries({ queryKey: ["home-binge"] });
                      void qc.invalidateQueries({ queryKey: ["home-movie-night"] });
                      void qc.invalidateQueries({ queryKey: ["home-layout"] });
                      void qc.invalidateQueries({ queryKey: ["home-featured-fallback"] });
                      void qc.invalidateQueries({ predicate: (q) => q.queryKey[0] === "home-section" });
                    })
                    .catch(() => setArtworkMessage("Refresh failed."))
                    .finally(() => setArtworkBusy(false));
                }}
              >
                🎨 Refresh Artwork
              </button>
              <div className="col-span-2 rounded-xl border border-blue-500/20 bg-blue-950/20 px-4 py-3.5">
                <p className="mb-1.5 text-[10px] font-semibold uppercase tracking-wide text-pitflix-muted">
                  Trailers
                </p>
                <p className="mb-2 text-[11px] leading-snug text-pitflix-muted">
                  Ingestion runs automatically on a schedule while the API is running. Use the button below when you
                  want an immediate refresh.
                </p>
                <button
                  type="button"
                  disabled={trailerIngestionBusy}
                  className="w-full rounded-xl border border-blue-500/35 bg-pitflix-bg py-2 text-xs font-medium text-blue-100 transition-all hover:border-blue-500/55 hover:bg-blue-500/15 disabled:opacity-50"
                  onClick={() => {
                    setTrailerIngestionMsg(null);
                    setTrailerIngestionBusy(true);
                    void runTrailerIngestion()
                      .then(() => {
                        setTrailerIngestionMsg("Trailer ingestion started. Check Trailers page in a moment.");
                        void qc.invalidateQueries({
                          predicate: (q) => q.queryKey[0] === "trailers" || q.queryKey[0] === "home",
                        });
                      })
                      .catch((err) => {
                        setTrailerIngestionMsg(formatScanOrApiError(err));
                      })
                      .finally(() => setTrailerIngestionBusy(false));
                  }}
                >
                  {trailerIngestionBusy ? "Ingesting…" : "🎬 Run Trailer Ingestion"}
                </button>
                {trailerIngestionMsg ? (
                  <p className="mt-2 text-[11px] leading-snug text-blue-100">{trailerIngestionMsg}</p>
                ) : null}
              </div>
              <div className="col-span-2 rounded-xl border border-amber-500/25 bg-amber-950/15 px-4 py-3.5">
                <p className="mb-1.5 text-[10px] font-semibold uppercase tracking-wide text-pitflix-muted">
                  Awards data cache
                </p>
                <p className="mb-2 text-[11px] leading-snug text-pitflix-muted">
                  <strong className="text-white">Update cache</strong> downloads only missing editions — already-cached
                  ceremonies are skipped instantly so the run is fast after the first download.{" "}
                  <strong className="text-white">Clear Awards Cache</strong> wipes everything so the next update
                  re-downloads all editions from scratch. Runs need a valid TMDB key and show progress in the panel below.
                </p>
                <div className="flex flex-wrap gap-2">
                  <button
                    type="button"
                    className="h-9 rounded-xl border border-amber-500/40 bg-pitflix-bg px-3 text-xs font-medium text-amber-100 transition-all hover:border-amber-500/60 hover:bg-amber-500/12"
                    onClick={() => {
                      setMaintMessage(null);
                      void requestAwardsPreload()
                        .then((r) => {
                          setMaintMessage(
                            r.started
                              ? "Awards cache update started — watch the bottom progress panel."
                              : "An update is already running — progress is in the bottom panel.",
                          );
                        })
                        .catch((err) => setMaintMessage(formatScanOrApiError(err)));
                    }}
                  >
                    Update awards cache
                  </button>
                  <button
                    type="button"
                    className="h-9 rounded-xl border border-zinc-600/50 bg-pitflix-bg px-3 text-xs font-medium text-zinc-200 transition-all hover:bg-zinc-800/80"
                    onClick={() => {
                      setMaintMessage(null);
                      setAwardsClearConfirmOpen(true);
                    }}
                  >
                    Clear Awards Cache
                  </button>
                </div>
                {awardsStatus ? (
                  <div className="mt-2 space-y-1 rounded-md border border-white/5 bg-black/20 px-2 py-1.5 text-[10px] text-pitflix-subtle">
                    <p>
                      <span className="text-pitflix-muted">Phase:</span> {awardsStatus.phase}
                      {awardsStatus.running ? " (running)" : ""}
                    </p>
                    <p>
                      <span className="text-pitflix-muted">Progress:</span> {awardsStatus.processedNominees} /{" "}
                      {awardsStatus.totalNominees} nominees
                      {awardsStatus.skippedNominees > 0
                        ? ` (${awardsStatus.skippedNominees} already cached, skipped)`
                        : ""}
                    </p>
                    <p>
                      <span className="text-pitflix-muted">Rows written:</span> {awardsStatus.successCount} ·{" "}
                      <span className="text-pitflix-muted">Failed (nominees):</span> {awardsStatus.failedCount}
                    </p>
                    <p>
                      <span className="text-pitflix-muted">DB rows:</span> {awardsStatus.cachedRowCount}
                    </p>
                    {awardsStatus.awardId ? (
                      <p>
                        <span className="text-pitflix-muted">Current:</span> {awardsStatus.awardId} · {awardsStatus.year}{" "}
                        {awardsStatus.categoryId ? ` · ${awardsStatus.categoryId}` : ""}
                      </p>
                    ) : null}
                    {awardsStatus.lastCompletedAt ? (
                      <p>
                        <span className="text-pitflix-muted">Last updated:</span>{" "}
                        {new Date(awardsStatus.lastCompletedAt).toLocaleString()}
                      </p>
                    ) : null}
                    {awardsStatus.lastError ? (
                      <p className="text-rose-200/90">Last error: {awardsStatus.lastError}</p>
                    ) : null}
                  </div>
                ) : null}
              </div>
              <div className="col-span-2 rounded-xl border border-violet-500/20 bg-violet-950/20 px-4 py-3.5">
                <p className="mb-1.5 text-[10px] font-semibold uppercase tracking-wide text-pitflix-muted">
                  Ratings (persisted)
                </p>
                <p className="mb-2 text-[10px] leading-snug text-pitflix-subtle">
                  Enrichment runs in the API background (~32 titles per burst). Ratings on movie pages update as each
                  title is processed — stay on this panel to watch progress.
                </p>
                <input
                  type="password"
                  autoComplete="off"
                  placeholder="Server maintenance key (only if configured in appsettings)"
                  value={ratingsMaintKey}
                  onChange={(e) => setRatingsMaintKey(e.target.value)}
                  className="mb-2 w-full rounded-md border border-white/10 bg-black/30 px-2 py-1.5 text-[11px] text-white placeholder:text-pitflix-muted"
                />
                <div className="grid grid-cols-2 gap-2">
                  <button
                    type="button"
                    disabled={ratingsBackfillBusy}
                    className="h-10 rounded-xl border border-violet-400/35 bg-pitflix-bg text-xs font-medium text-violet-100 transition-all hover:border-violet-400/55 hover:bg-violet-500/15 disabled:opacity-50"
                    onClick={() => {
                      setRatingsMaintMsg(null);
                      setRatingsBackfillBusy(true);
                      void queueRatingsLibraryBackfill({
                        limit: 500,
                        maintenanceKey: ratingsMaintKey.trim() || undefined,
                      })
                        .then((r) => {
                          startWatchingRatingsQueue();
                          setRatingsMaintMsg(
                            `Queued ${r.accepted} jobs (${r.movies} movies + ${r.shows} series, cap ${r.cap}).`,
                          );
                          void qc.invalidateQueries({
                            predicate: (q) => q.queryKey[0] === "ratings-display",
                          });
                          refetchRatingsQueue();
                        })
                        .catch((err) => {
                          if (axios.isAxiosError(err) && err.response?.status === 401) {
                            setRatingsMaintMsg("Unauthorized — add the server ratings maintenance key if one is set.");
                          } else {
                            setRatingsMaintMsg(formatScanOrApiError(err));
                          }
                        })
                        .finally(() => setRatingsBackfillBusy(false));
                    }}
                  >
                    {ratingsBackfillBusy ? "Queuing…" : "📊 Queue library ratings"}
                  </button>
                  <button
                    type="button"
                    disabled={ratingsStaleBusy}
                    className="h-10 rounded-xl border border-violet-400/25 bg-pitflix-bg text-xs font-medium text-violet-100/95 transition-all hover:border-violet-400/45 hover:bg-violet-500/12 disabled:opacity-50"
                    onClick={() => {
                      setRatingsMaintMsg(null);
                      setRatingsStaleBusy(true);
                      void queueRatingsStaleSweep(ratingsMaintKey.trim() || undefined)
                        .then((r) => {
                          startWatchingRatingsQueue();
                          setRatingsMaintMsg(
                            r.queued === "stale_sweep"
                              ? "Stale ratings refresh queued."
                              : "Request sent.",
                          );
                          void qc.invalidateQueries({
                            predicate: (q) => q.queryKey[0] === "ratings-display",
                          });
                          refetchRatingsQueue();
                        })
                        .catch((err) => {
                          if (axios.isAxiosError(err) && err.response?.status === 401) {
                            setRatingsMaintMsg("Unauthorized — add the server ratings maintenance key if one is set.");
                          } else {
                            setRatingsMaintMsg(formatScanOrApiError(err));
                          }
                        })
                        .finally(() => setRatingsStaleBusy(false));
                    }}
                  >
                    {ratingsStaleBusy ? "Queuing…" : "♻️ Queue stale refresh"}
                  </button>
                </div>
                {ratingsMaintMsg ? (
                  <p className="mt-2 text-[11px] leading-snug text-pitflix-subtle">{ratingsMaintMsg}</p>
                ) : null}
                {ratingsQueueWatching && ratingsQueueStatus ? (
                  <div className="mt-3 space-y-2 rounded-md border border-violet-400/20 bg-black/25 px-2.5 py-2">
                    <div className="flex flex-wrap items-center justify-between gap-2 text-[11px]">
                      <span className="text-violet-100/95">
                        {ratingsQueueStatus.isProcessing ? "Processing…" : "Idle"}
                        {ratingsQueueStatus.queueDepth > 0
                          ? ` · ${ratingsQueueStatus.queueDepth} queued`
                          : ratingsQueueStatus.active
                            ? ""
                            : " · queue empty"}
                      </span>
                      <span className="tabular-nums text-pitflix-subtle">
                        {ratingsQueueStatus.processedTotal.toLocaleString()} processed (session)
                      </span>
                    </div>
                    {ratingsQueueStatus.coverage.total > 0 ? (
                      <>
                        <div className="h-1.5 overflow-hidden rounded-full bg-white/10">
                          <div
                            className="h-full rounded-full bg-violet-400/80 transition-[width] duration-500"
                            style={{
                              width: `${Math.min(
                                100,
                                (ratingsQueueStatus.coverage.withImdb / ratingsQueueStatus.coverage.total) * 100,
                              )}%`,
                            }}
                          />
                        </div>
                        <p className="text-[10px] leading-snug text-pitflix-subtle">
                          Library snapshots: {ratingsQueueStatus.coverage.withImdb} with IMDb,{" "}
                          {ratingsQueueStatus.coverage.withRottenTomatoes} with Rotten Tomatoes,{" "}
                          {ratingsQueueStatus.coverage.tmdbOnly} TMDB-only
                          {ratingsQueueStatus.coverage.hasImdbIdButNoImdbScore > 0
                            ? ` · ${ratingsQueueStatus.coverage.hasImdbIdButNoImdbScore} waiting for IMDb`
                            : ""}
                        </p>
                      </>
                    ) : (
                      <p className="text-[10px] text-pitflix-subtle">No snapshots yet — open a title to seed ratings.</p>
                    )}
                    {ratingsQueueStatus.lastError ? (
                      <p className="text-[10px] text-rose-200/90">Last error: {ratingsQueueStatus.lastError}</p>
                    ) : null}
                    {!ratingsQueueStatus.active && ratingsQueueStatus.queueDepth === 0 && !ratingsQueueStatus.isProcessing ? (
                      <p className="text-[10px] text-emerald-200/90">Background queue finished for now. Progress is also shown in the floating panel.</p>
                    ) : (
                      <p className="text-[10px] text-pitflix-subtle">
                        MDBList free tier is ~1,000 requests/day — large libraries finish over multiple sessions.
                      </p>
                    )}
                  </div>
                ) : ratingsQueueWatching && ratingsQueueFetched && ratingsQueueStatus == null ? (
                  <p className="mt-2 text-[11px] text-amber-200/95">
                    Queue status unavailable — restart Pitflix.API (<code className="text-[10px]">dotnet run</code> in
                    Pitflix.API) so the new endpoint loads, then try again.
                  </p>
                ) : ratingsQueueWatching && ratingsQueueFetching ? (
                  <p className="mt-2 text-[11px] text-pitflix-subtle">Loading queue status…</p>
                ) : null}
              </div>
              <button
                type="button"
                disabled={cleanupBusy}
                className="h-10 rounded-xl border border-white/[0.08] bg-pitflix-bg text-xs font-medium text-white transition-all hover:border-pitflix-primary/40 disabled:opacity-50"
                onClick={() => {
                  setCleanupMessage(null);
                  setCleanupBusy(true);
                  void cleanupLibrary()
                    .then((r) => {
                      setCleanupMessage(
                        `Removed ${r.removedShows} shows, ${r.removedMovies} movies, ${r.removedEpisodes} episodes.`,
                      );
                      void qc.invalidateQueries({ queryKey: ["stats"] });
                      void qc.invalidateQueries({ queryKey: ["settings"] });
                      void qc.invalidateQueries({ queryKey: ["movies"] });
                      void qc.invalidateQueries({ queryKey: ["series"] });
                      void qc.invalidateQueries({ queryKey: ["home-history"] });
                      void qc.invalidateQueries({ queryKey: ["home-top-rated"] });
                      void qc.invalidateQueries({ queryKey: ["home-arabic"] });
                      void qc.invalidateQueries({ queryKey: ["home-binge"] });
                      void qc.invalidateQueries({ queryKey: ["home-movie-night"] });
                      void qc.invalidateQueries({ queryKey: ["home-layout"] });
                      void qc.invalidateQueries({ queryKey: ["home-featured-fallback"] });
                      void qc.invalidateQueries({ predicate: (q) => q.queryKey[0] === "home-section" });
                    })
                    .catch(() => setCleanupMessage("Cleanup failed."))
                    .finally(() => setCleanupBusy(false));
                }}
              >
                🧹 Clean Up
              </button>
              <button
                type="button"
                disabled={cleanupBusy}
                className="h-10 rounded-xl border border-amber-500/35 bg-pitflix-bg text-xs font-medium text-amber-200 transition-all hover:bg-amber-500/10 disabled:opacity-50"
                onClick={() => {
                  setCleanupMessage(null);
                  setCleanupBusy(true);
                  void cleanupMissingFiles()
                    .then((r) => {
                      setCleanupMessage(r.message || 
                        `Cleaned up ${r.removedEpisodes} episodes, ${r.removedMovies} movies, ${r.removedShows} shows with missing files.`
                      );
                      void qc.invalidateQueries({ queryKey: ["stats"] });
                      void qc.invalidateQueries({ queryKey: ["settings"] });
                      void qc.invalidateQueries({ queryKey: ["movies"] });
                      void qc.invalidateQueries({ queryKey: ["series"] });
                      void qc.invalidateQueries({ queryKey: ["show"] });
                      void qc.invalidateQueries({ queryKey: ["movie"] });
                      void qc.invalidateQueries({ queryKey: ["home-history"] });
                      void qc.invalidateQueries({ queryKey: ["home-top-rated"] });
                      void qc.invalidateQueries({ queryKey: ["home-arabic"] });
                      void qc.invalidateQueries({ queryKey: ["home-binge"] });
                      void qc.invalidateQueries({ queryKey: ["home-movie-night"] });
                      void qc.invalidateQueries({ queryKey: ["home-layout"] });
                      void qc.invalidateQueries({ queryKey: ["home-featured-fallback"] });
                      void qc.invalidateQueries({ predicate: (q) => q.queryKey[0] === "home-section" });
                    })
                    .catch(() => setCleanupMessage("Cleanup of missing files failed."))
                    .finally(() => setCleanupBusy(false));
                }}
              >
                🗂️ Clean Missing Files
              </button>
              <Link
                to="/duplicates"
                className="flex h-10 items-center justify-center rounded-xl border border-amber-500/30 bg-pitflix-bg px-4 text-xs font-medium text-amber-100 transition-all hover:bg-amber-500/10"
              >
                🔍 Find Duplicates
              </Link>
              <button
                type="button"
                className="h-10 rounded-xl border border-red-500/35 bg-pitflix-bg text-xs font-medium text-red-200 transition-all hover:bg-red-500/10"
                onClick={() => {
                  setRemoveOpen(true);
                  setRemoveQuery("");
                  setRemoveBrowseKind(null);
                  setSearchHits(null);
                }}
              >
                🗑️ Remove Title
              </button>
              <button
                type="button"
                className="h-10 rounded-xl border border-white/[0.08] bg-pitflix-bg text-xs text-white transition-all hover:border-pitflix-primary/40"
                onClick={() => {
                  setMaintMessage(null);
                  void clearImageCache()
                    .then((r) => setMaintMessage(r.message))
                    .catch(() => setMaintMessage("Cache clear failed."));
                }}
              >
                💾 Clear Cache
              </button>
              <button
                type="button"
                className="h-10 rounded-xl border border-amber-500/30 bg-pitflix-bg text-xs text-amber-100 transition-all hover:bg-amber-500/10"
                onClick={() => setResetDbInfoOpen(true)}
              >
                🔁 Reset DB
              </button>
              <div className="col-span-2 flex flex-col gap-2.5 rounded-xl border border-emerald-500/15 bg-emerald-950/10 px-4 py-3">
                <p className="text-[11px] leading-snug text-pitflix-muted">
                  Only downloads metadata for titles that have never completed a prefetch (empty{" "}
                  <span className="font-mono text-[10px]">MetadataRefreshedAt</span> in the library DB). Titles already
                  prefetched are skipped and shown as counts. Progress stays in the floating panel at the bottom if you
                  navigate away.
                </p>
                <div className="flex gap-2">
                  <button
                    type="button"
                    disabled={libraryPrefetch.running}
                    className="h-10 min-w-0 flex-1 rounded-xl border border-emerald-600/35 bg-pitflix-bg text-xs font-medium text-emerald-100 transition-all hover:border-emerald-600/55 hover:bg-emerald-600/12 disabled:opacity-50"
                    onClick={() => startLibraryMetadataPrefetch()}
                  >
                    {libraryPrefetch.running
                      ? "Downloading metadata…"
                      : "📥 Pre-download metadata (pending titles only)"}
                  </button>
                  {libraryPrefetch.running ? (
                    <button
                      type="button"
                      className="h-10 shrink-0 rounded-xl border border-zinc-600/70 px-3 text-xs font-medium text-zinc-200 transition-all hover:bg-zinc-800"
                      onClick={() => stopLibraryMetadataPrefetch()}
                    >
                      Stop
                    </button>
                  ) : null}
                </div>
                {libraryPrefetch.running ? (
                  <div className="rounded-lg border border-pitflix-card/60 bg-pitflix-bg/80 p-2">
                    <div className="h-1.5 w-full overflow-hidden rounded-full bg-zinc-800">
                      <div
                        className="h-full rounded-full bg-emerald-600 transition-[width] duration-200"
                        style={{ width: `${Math.round(libraryPrefetch.pct)}%` }}
                      />
                    </div>
                    {libraryPrefetch.liveLine ? (
                      <p className="mt-2 text-[11px] leading-snug text-pitflix-muted">{libraryPrefetch.liveLine}</p>
                    ) : null}
                    {libraryPrefetch.log.length > 0 ? (
                      <div className="mt-2 max-h-28 overflow-y-auto rounded border border-pitflix-card/40 bg-black/20 px-2 py-1 font-mono text-[10px] text-zinc-400">
                        {libraryPrefetch.log.slice(-12).map((line, i) => (
                          <div key={`${libraryPrefetch.log.length}-${i}`} className="truncate">
                            {line}
                          </div>
                        ))}
                      </div>
                    ) : null}
                  </div>
                ) : null}
              </div>
            </div>
            <p className="mt-2 text-[10px] leading-relaxed text-pitflix-subtle">
              Scan Library looks for new video files in your saved folders; items you already matched are skipped. While
              Pitflix is open, the API also re-scans about once per hour to pick up additions automatically.
            </p>
            {scanMessage ? <p className="mt-2 text-[11px] text-pitflix-muted">{scanMessage}</p> : null}
            {artworkMessage ? <p className="mt-2 text-[11px] text-pitflix-muted">{artworkMessage}</p> : null}
            {libraryPrefetch.message ? (
              <p className="mt-2 text-[11px] text-pitflix-muted">{libraryPrefetch.message}</p>
            ) : null}
            {cleanupMessage ? <p className="mt-2 text-[11px] text-pitflix-muted">{cleanupMessage}</p> : null}
            {maintMessage ? <p className="mt-2 text-[11px] text-pitflix-muted">{maintMessage}</p> : null}
          </section>
  );
}
