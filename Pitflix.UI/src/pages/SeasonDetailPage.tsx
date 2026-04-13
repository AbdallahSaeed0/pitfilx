import { useQuery, useQueryClient } from "@tanstack/react-query";
import { useCallback, useMemo, useState } from "react";
import { Link, useNavigate, useParams } from "react-router-dom";
import { setEpisodeWatchStatus } from "../api/episodes";
import { rematchEpisodeFromFile } from "../api/library";
import { getShowSeason } from "../api/series";
import { PickTmdbTitleModal } from "../components/PickTmdbTitleModal";
import { SubtitleDrawer } from "../components/SubtitleDrawer";
import { usePlayback } from "../hooks/usePlayback";
import { MediaImage } from "../components/ui/MediaImage";
import { Spinner } from "../components/ui/Spinner";
import { toPosterSrc } from "../utils/posterSrc";
import { pitflixConfirm } from "../utils/pitflixDialog";

type EpisodeRow = {
  id: number;
  season: number;
  episodeNumber: number;
  title?: string | null;
  filePath: string;
  subtitlePath?: string | null;
  watchStatus?: string;
  stillLocalPath?: string | null;
  tmdbVoteAverage?: number | null;
};

export function SeasonDetailPage() {
  const { id, seasonNumber: seasonStr } = useParams();
  const navigate = useNavigate();
  const qc = useQueryClient();
  const { play } = usePlayback();
  const libraryId = Number(id);
  const season = Number(seasonStr);
  const [subtitleEpisode, setSubtitleEpisode] = useState<{
    id: number;
    filePath: string;
    label: string;
    season: number;
    episodeNumber: number;
  } | null>(null);
  const [episodePickId, setEpisodePickId] = useState<number | null>(null);
  const [episodeRematchBusyId, setEpisodeRematchBusyId] = useState<number | null>(null);
  const [episodeActionMsg, setEpisodeActionMsg] = useState<string | null>(null);
  const [selectedIds, setSelectedIds] = useState<Set<number>>(() => new Set());
  const [bulkBusy, setBulkBusy] = useState(false);

  const toggleSelect = useCallback((id: number) => {
    setSelectedIds((prev) => {
      const next = new Set(prev);
      if (next.has(id)) next.delete(id);
      else next.add(id);
      return next;
    });
  }, []);

  const clearSelection = useCallback(() => setSelectedIds(new Set()), []);

  const { data, isLoading } = useQuery({
    queryKey: ["show-season", libraryId, season],
    queryFn: () => getShowSeason(libraryId, season),
    enabled: Number.isFinite(libraryId) && libraryId > 0 && Number.isFinite(season),
  });

  const selectAllInSeason = useCallback(() => {
    const eps = (data?.episodes ?? []) as EpisodeRow[];
    setSelectedIds(new Set(eps.map((e) => e.id)));
  }, [data?.episodes]);

  const show = data?.show as { title?: string; tmdbId?: number; selectedPosterPath?: string; posterLocalPath?: string } | undefined;
  const episodes = (data?.episodes ?? []) as EpisodeRow[];
  const nextEpisode = data?.nextEpisode as
    | { id: number; season: number; episodeNumber: number; title?: string; filePath: string }
    | null
    | undefined;

  const bulkMarkWatched = useCallback(async () => {
    const ids = [...selectedIds];
    if (ids.length === 0) return;
    setBulkBusy(true);
    try {
      await Promise.all(ids.map((id) => setEpisodeWatchStatus(id, "Completed")));
      void qc.invalidateQueries({ queryKey: ["show-season", libraryId, season] });
      void qc.invalidateQueries({ queryKey: ["show", libraryId] });
      clearSelection();
    } catch {
      setEpisodeActionMsg("Could not update watch status for all selected.");
    } finally {
      setBulkBusy(false);
    }
  }, [selectedIds, qc, libraryId, season, clearSelection]);

  const bulkMarkUnwatched = useCallback(async () => {
    const ids = [...selectedIds];
    if (ids.length === 0) return;
    setBulkBusy(true);
    try {
      await Promise.all(ids.map((id) => setEpisodeWatchStatus(id, "Unwatched")));
      void qc.invalidateQueries({ queryKey: ["show-season", libraryId, season] });
      void qc.invalidateQueries({ queryKey: ["show", libraryId] });
      clearSelection();
    } catch {
      setEpisodeActionMsg("Could not update watch status for all selected.");
    } finally {
      setBulkBusy(false);
    }
  }, [selectedIds, qc, libraryId, season, clearSelection]);

  const bulkRematch = useCallback(async () => {
    const withFile = episodes.filter((e) => selectedIds.has(e.id) && e.filePath);
    if (withFile.length === 0) {
      setEpisodeActionMsg("Selected episodes have no video file to re-match.");
      return;
    }
    const ok = await pitflixConfirm(
      `Re-match ${withFile.length} episode file(s)? Each will be removed from the library and matched again.`,
    );
    if (!ok) return;
    setBulkBusy(true);
    setEpisodeActionMsg(null);
    try {
      for (const ep of withFile) {
        const r = await rematchEpisodeFromFile(ep.id);
        if (!r.success) {
          setEpisodeActionMsg(r.error ?? "Re-match failed.");
          return;
        }
        if (r.showId != null && r.showId !== libraryId) {
          navigate(`/series/${r.showId}/season/${season}`, { replace: true });
          clearSelection();
          return;
        }
      }
      void qc.invalidateQueries({ queryKey: ["show-season", libraryId, season] });
      void qc.invalidateQueries({ queryKey: ["show", libraryId] });
      clearSelection();
      setEpisodeActionMsg("Re-match finished for selected files.");
      window.setTimeout(() => setEpisodeActionMsg(null), 4500);
    } catch {
      setEpisodeActionMsg("Could not reach the API.");
    } finally {
      setBulkBusy(false);
    }
  }, [episodes, selectedIds, libraryId, season, navigate, qc, clearSelection]);

  const bulkRelink = useCallback(() => {
    if (selectedIds.size !== 1) {
      setEpisodeActionMsg("Re-link one episode at a time — select a single episode.");
      window.setTimeout(() => setEpisodeActionMsg(null), 4500);
      return;
    }
    setEpisodePickId([...selectedIds][0]!);
  }, [selectedIds]);

  const poster = useMemo(
    () => toPosterSrc(show?.selectedPosterPath || show?.posterLocalPath || undefined),
    [show?.selectedPosterPath, show?.posterLocalPath],
  );

  if (!Number.isFinite(libraryId) || libraryId <= 0 || !Number.isFinite(season))
    return <p className="text-pitflix-muted">Invalid route</p>;

  if (isLoading || !data || !show)
    return (
      <div className="flex justify-center py-24">
        <Spinner />
      </div>
    );

  const seasonName = (data.seasonName as string) ?? `Season ${season}`;
  const posterSeason = data.posterUrl as string | null | undefined;

  return (
    <div>
      <div className="mb-4 flex flex-wrap items-center gap-3">
        <button
          type="button"
          onClick={() => navigate(-1)}
          className="text-sm text-pitflix-muted hover:text-white"
        >
          ← Back
        </button>
        <Link
          to={`/series/${libraryId}`}
          className="text-sm text-pitflix-primary hover:underline"
        >
          Series overview
        </Link>
      </div>

      <div className="flex flex-col gap-6 md:flex-row md:items-start">
        <MediaImage
          src={posterSeason || poster}
          alt=""
          className="w-full max-w-[180px] shrink-0 overflow-hidden rounded-xl bg-pitflix-card shadow-xl"
          fallbackText={show.title ?? ""}
        />
        <div>
          <h1 className="text-2xl font-bold text-white md:text-3xl">
            {show.title} · {seasonName}
          </h1>
          {data.airDate ? (
            <p className="mt-1 text-sm text-pitflix-muted">Air date: {String(data.airDate)}</p>
          ) : null}
          <p className="mt-2 text-sm text-pitflix-subtle">
            {episodes.length} episode{episodes.length === 1 ? "" : "s"} in your library
            {typeof data.tmdbEpisodeCount === "number" && data.tmdbEpisodeCount > 0
              ? ` · ${data.tmdbEpisodeCount} listed on TMDB`
              : ""}
          </p>
        </div>
      </div>

      {episodeActionMsg ? (
        <p className="mt-6 text-sm text-pitflix-muted">{episodeActionMsg}</p>
      ) : null}

      <section className="mt-8 pb-24">
        <div className="mb-4 flex flex-wrap items-center justify-between gap-3">
          <h2 className="text-xl font-bold">Episodes</h2>
          {episodes.length > 0 ? (
            <div className="flex flex-wrap items-center gap-2 text-xs">
              <button
                type="button"
                className="rounded-lg border border-white/10 bg-pitflix-card/80 px-2.5 py-1.5 font-medium text-pitflix-muted hover:text-white"
                onClick={() => selectAllInSeason()}
              >
                Select all
              </button>
              <button
                type="button"
                className="rounded-lg border border-white/10 bg-pitflix-card/80 px-2.5 py-1.5 font-medium text-pitflix-muted hover:text-white"
                onClick={() => clearSelection()}
              >
                Clear
              </button>
            </div>
          ) : null}
        </div>
        <div className="space-y-2">
          {episodes.map((ep) => {
            const isWatched = ep.watchStatus === "Completed";
            const isNextUp = nextEpisode != null && ep.id === nextEpisode.id;
            const epThumb = toPosterSrc(ep.stillLocalPath ?? undefined) ?? poster;
            const isSelected = selectedIds.has(ep.id);
            return (
              <div
                key={ep.id}
                className={`group flex items-center gap-3 rounded-2xl border border-transparent bg-pitflix-bg/50 py-3 pl-3 pr-4 transition-all hover:border-pitflix-primary/30 hover:bg-pitflix-card/90 sm:gap-4 sm:pl-4 ${
                  isNextUp ? "border-l-4 border-l-pitflix-primary" : ""
                } ${isSelected ? "border-pitflix-primary/40 bg-pitflix-card/70 ring-1 ring-pitflix-primary/25" : ""}`}
              >
                <label className="flex shrink-0 cursor-pointer items-center justify-center p-1">
                  <input
                    type="checkbox"
                    className="h-4 w-4 rounded border-pitflix-card bg-pitflix-bg text-pitflix-primary focus:ring-pitflix-primary"
                    checked={isSelected}
                    onChange={() => toggleSelect(ep.id)}
                    aria-label={`Select episode ${ep.episodeNumber}`}
                  />
                </label>
                <MediaImage
                  src={epThumb}
                  alt=""
                  className="h-14 w-[88px] shrink-0 overflow-hidden rounded-lg bg-pitflix-card object-cover ring-1 ring-white/5"
                  fallbackText={`${ep.episodeNumber}`}
                />
                <span className="w-10 shrink-0 text-center font-mono text-sm font-medium tabular-nums text-pitflix-muted">
                  {String(ep.episodeNumber).padStart(2, "0")}
                </span>
                <div className="min-w-0 flex-1 pr-2">
                  <p className="flex flex-wrap items-center gap-2 truncate text-sm font-medium text-white">
                    <span className="truncate">
                      {ep.title?.trim() ? ep.title : `Episode ${ep.episodeNumber}`}
                    </span>
                    {isNextUp ? (
                      <span className="shrink-0 rounded-full bg-pitflix-primary/25 px-2 py-0.5 text-[10px] font-semibold uppercase tracking-wide text-pitflix-primary">
                        Next up
                      </span>
                    ) : null}
                    {ep.tmdbVoteAverage != null && ep.tmdbVoteAverage > 0 ? (
                      <span className="shrink-0 rounded bg-white/10 px-1.5 py-0.5 text-[10px] text-pitflix-muted">
                        TMDB ★ {ep.tmdbVoteAverage.toFixed(1)}
                      </span>
                    ) : null}
                  </p>
                  {ep.subtitlePath ? (
                    <span className="text-xs text-pitflix-subtle">🔤 Subtitles available</span>
                  ) : null}
                </div>
                <button
                  type="button"
                  role="switch"
                  aria-checked={isWatched}
                  onClick={() => {
                    const next = isWatched ? "Unwatched" : "Completed";
                    void setEpisodeWatchStatus(ep.id, next).then(() => {
                      void qc.invalidateQueries({ queryKey: ["show-season", libraryId, season] });
                      void qc.invalidateQueries({ queryKey: ["show", libraryId] });
                    });
                  }}
                  className={`shrink-0 select-none rounded-full border-2 px-3 py-2 text-xs font-semibold transition-all focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-pitflix-primary ${
                    isWatched
                      ? "border-green-500/90 bg-green-600/85 text-white shadow-[0_0_14px_rgba(34,197,94,0.25)]"
                      : "border-pitflix-subtle/70 bg-pitflix-surface text-pitflix-muted hover:border-pitflix-primary/60 hover:text-white"
                  }`}
                >
                  {isWatched ? "Watched" : "Mark watched"}
                </button>
                {ep.filePath ? (
                  <div className="flex shrink-0 flex-wrap justify-end gap-2 opacity-100 transition-all sm:opacity-0 sm:group-hover:opacity-100">
                    <button
                      type="button"
                      disabled={episodeRematchBusyId !== null}
                      onClick={() =>
                        void (async () => {
                          const ok = await pitflixConfirm(
                            "Remove this episode from the library and match the file again with TMDB?",
                          );
                          if (!ok) return;
                          setEpisodeActionMsg(null);
                          setEpisodeRematchBusyId(ep.id);
                          try {
                            const r = await rematchEpisodeFromFile(ep.id);
                            if (!r.success) {
                              setEpisodeActionMsg(r.error ?? "Re-match failed.");
                              return;
                            }
                            setEpisodeActionMsg("Episode matched again from the file.");
                            void qc.invalidateQueries({ queryKey: ["show-season", libraryId, season] });
                            void qc.invalidateQueries({ queryKey: ["show", libraryId] });
                            if (r.showId != null && r.showId !== libraryId) {
                              navigate(`/series/${r.showId}/season/${season}`, { replace: true });
                            }
                          } catch {
                            setEpisodeActionMsg("Could not reach the API.");
                          } finally {
                            setEpisodeRematchBusyId(null);
                            window.setTimeout(() => setEpisodeActionMsg(null), 4500);
                          }
                        })()
                      }
                      className="rounded-xl border border-pitflix-card bg-pitflix-surface px-3 py-2 text-xs font-semibold text-pitflix-muted shadow-md hover:border-pitflix-primary/50 hover:text-white disabled:opacity-45"
                    >
                      {episodeRematchBusyId === ep.id ? "…" : "Re-match file"}
                    </button>
                    <button
                      type="button"
                      disabled={episodeRematchBusyId !== null}
                      onClick={() => setEpisodePickId(ep.id)}
                      className="rounded-xl border border-pitflix-card bg-pitflix-surface px-3 py-2 text-xs font-semibold text-pitflix-muted shadow-md hover:border-pitflix-primary/50 hover:text-white disabled:opacity-45"
                    >
                      Re-link…
                    </button>
                    <button
                      type="button"
                      onClick={() =>
                        setSubtitleEpisode({
                          id: ep.id,
                          filePath: ep.filePath,
                          label: `S${season}E${ep.episodeNumber}`,
                          season,
                          episodeNumber: ep.episodeNumber,
                        })
                      }
                      className="rounded-xl border border-pitflix-card bg-pitflix-surface px-3 py-2 text-xs font-semibold text-pitflix-muted shadow-md hover:border-pitflix-primary/50 hover:text-white"
                    >
                      🔤 Subs
                    </button>
                    <button
                      type="button"
                      onClick={() =>
                        void play(
                          ep.filePath,
                          `${show.title} · S${season}E${ep.episodeNumber}`,
                          show.selectedPosterPath || show.posterLocalPath || null,
                          "Series",
                          0,
                        )
                      }
                      className="rounded-xl bg-pitflix-primary px-4 py-2 text-xs font-semibold text-white shadow-md transition-all hover:bg-pitflix-light"
                    >
                      ▶ Play
                    </button>
                  </div>
                ) : null}
              </div>
            );
          })}
        </div>
      </section>

      <SubtitleDrawer
        open={subtitleEpisode != null}
        onClose={() => setSubtitleEpisode(null)}
        title={
          subtitleEpisode
            ? `${show.title} · ${subtitleEpisode.label}`
            : show.title ?? ""
        }
        mode="episode"
        episodeId={subtitleEpisode?.id}
        showTmdbId={show.tmdbId}
        episodeSeason={subtitleEpisode?.season}
        episodeNumber={subtitleEpisode?.episodeNumber}
        videoFilePath={subtitleEpisode?.filePath ?? ""}
      />

      <PickTmdbTitleModal
        open={episodePickId !== null}
        onClose={() => setEpisodePickId(null)}
        target={episodePickId !== null ? { kind: "episode", episodeId: episodePickId } : null}
        hintTitle={show.title ?? ""}
        onMatched={(r) => {
          void qc.invalidateQueries({ queryKey: ["show-season", libraryId, season] });
          void qc.invalidateQueries({ queryKey: ["show", libraryId] });
          if (r.showId != null && r.showId !== libraryId) {
            navigate(`/series/${r.showId}/season/${season}`, { replace: true });
          }
        }}
      />

      {selectedIds.size > 0 ? (
        <div className="fixed bottom-0 left-0 right-0 z-40 border-t border-white/10 bg-pitflix-bg/95 px-4 py-3 shadow-[0_-8px_32px_rgba(0,0,0,0.5)] backdrop-blur-md">
          <div className="mx-auto flex max-w-4xl flex-wrap items-center justify-between gap-3">
            <p className="text-sm text-white">
              <span className="font-semibold text-pitflix-primary">{selectedIds.size}</span>{" "}
              {selectedIds.size === 1 ? "episode" : "episodes"} selected
            </p>
            <div className="flex flex-wrap gap-2">
              <button
                type="button"
                disabled={bulkBusy}
                className="rounded-lg bg-pitflix-primary px-3 py-2 text-xs font-semibold text-white hover:bg-pitflix-light disabled:opacity-45"
                onClick={() => void bulkMarkWatched()}
              >
                Mark watched
              </button>
              <button
                type="button"
                disabled={bulkBusy}
                className="rounded-lg border border-pitflix-card bg-pitflix-surface px-3 py-2 text-xs font-semibold text-pitflix-muted hover:text-white disabled:opacity-45"
                onClick={() => void bulkMarkUnwatched()}
              >
                Mark not watched
              </button>
              <button
                type="button"
                disabled={bulkBusy}
                className="rounded-lg border border-pitflix-card bg-pitflix-surface px-3 py-2 text-xs font-semibold text-pitflix-muted hover:text-white disabled:opacity-45"
                onClick={() => void bulkRematch()}
              >
                Re-match files
              </button>
              <button
                type="button"
                disabled={bulkBusy}
                className="rounded-lg border border-pitflix-card bg-pitflix-surface px-3 py-2 text-xs font-semibold text-pitflix-muted hover:text-white disabled:opacity-45"
                onClick={() => bulkRelink()}
              >
                Re-link…
              </button>
              <button
                type="button"
                disabled={bulkBusy}
                className="rounded-lg border border-white/10 px-3 py-2 text-xs text-pitflix-muted hover:text-white disabled:opacity-45"
                onClick={() => clearSelection()}
              >
                Cancel
              </button>
            </div>
          </div>
        </div>
      ) : null}
    </div>
  );
}
