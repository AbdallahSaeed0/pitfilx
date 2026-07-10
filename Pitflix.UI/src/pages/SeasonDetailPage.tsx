import { useQuery, useQueryClient } from "@tanstack/react-query";
import { useCallback, useMemo, useState } from "react";
import { AlertCircle, Eye, EyeOff, FolderInput, LayoutGrid, List, Subtitles } from "lucide-react";
import { Link, useNavigate, useParams } from "react-router-dom";
import { useAppPrefsStore } from "../store/appPrefsStore";
import { setEpisodeWatchStatus } from "../api/episodes";
import { rematchEpisodeFromFile, wrapSeasonEpisodes } from "../api/library";
import { getShowSeason, getShow } from "../api/series";
import { getStreamImdbId } from "../api/stream";
import { PickTmdbTitleModal } from "../components/PickTmdbTitleModal";
import { SubtitleDrawer } from "../components/SubtitleDrawer";
import { WsmDownloadModal } from "../components/WsmDownloadModal";
import { EpisodeRuntimeBadge } from "../components/episodes/EpisodeRuntimeBadge";
import { useResumeBeforePlay } from "../hooks/useResumeBeforePlay";
import { markStreamingWatched, unmarkStreamingWatched } from "../hooks/markStreamingWatched";
import {
  EpisodeExternalListIcon,
  EpisodeExternalListMeta,
  EpisodeExternalThumbOverlay,
  EpisodeStatusBadge,
  MissingEpisodeDownloadButton,
  MissingEpisodeHint,
  MissingEpisodeMarkWatchedButton,
  MissingEpisodesBanner,
  UpcomingEpisodePanel,
  episodeExternalCardClass,
  episodeExternalListClass,
  episodeExternalThumbClass,
} from "../components/episodes/EpisodeAvailabilityUi";
import { MediaImage } from "../components/ui/MediaImage";
import { ImdbRatingBadge } from "../components/ui/ImdbRatingBadge";
import { cn } from "../utils/cn";
import { Spinner } from "../components/ui/Spinner";
import { toPosterSrc } from "../utils/posterSrc";
import { pitflixConfirm } from "../utils/pitflixDialog";
import { episodeIsWatched, episodeTitleVisible } from "../utils/episodeSpoiler";

type EpisodeRow = {
  id?: number | null;
  season: number;
  episodeNumber: number;
  title?: string | null;
  overview?: string | null;
  filePath?: string | null;
  subtitlePath?: string | null;
  watchStatus?: string;
  stillLocalPath?: string | null;
  stillUrl?: string | null;
  tmdbVoteAverage?: number | null;
  imdbVoteAverage?: number | null;
  airDate?: string | null;
  inLibrary?: boolean;
  isAired?: boolean;
  runtimeMinutes?: number | null;
};

const VIEW_KEY = "pitflix.season.viewMode";

export function SeasonDetailPage() {
  const { id, seasonNumber: seasonStr } = useParams();
  const navigate = useNavigate();
  const qc = useQueryClient();
  const { requestPlay, ResumePromptModal } = useResumeBeforePlay();
  const libraryId = Number(id);
  const season = Number(seasonStr);
  const [subtitleEpisode, setSubtitleEpisode] = useState<{
    id: number;
    filePath: string;
    label: string;
    season: number;
    episodeNumber: number;
  } | null>(null);
  const [episodePickIds, setEpisodePickIds] = useState<number[] | null>(null);
  const [episodeRematchBusyId, setEpisodeRematchBusyId] = useState<number | null>(null);
  const [episodeActionMsg, setEpisodeActionMsg] = useState<string | null>(null);
  const [selectedIds, setSelectedIds] = useState<Set<number>>(() => new Set());
  const [bulkBusy, setBulkBusy] = useState(false);
  const [downloadEpisode, setDownloadEpisode] = useState<number | null>(null);
  const [wrapBusy, setWrapBusy] = useState(false);
  const [wrapResult, setWrapResult] = useState<{ message: string; ok: boolean } | null>(null);
  const [markWatchedBusyEpisode, setMarkWatchedBusyEpisode] = useState<number | null>(null);
  const [viewMode, setViewMode] = useState<"list" | "grid">(() => {
    try { return (localStorage.getItem(VIEW_KEY) as "list" | "grid") || "list"; } catch { return "list"; }
  });
  const setView = (v: "list" | "grid") => {
    setViewMode(v);
    try { localStorage.setItem(VIEW_KEY, v); } catch {}
  };

  const defaultSpoilerProtection = useAppPrefsStore((s) => s.defaultSpoilerProtection);
  // Session-only toggle — overrides the global default for this page visit only.
  const [spoilerProtection, setSpoilerProtection] = useState<boolean>(defaultSpoilerProtection);
  const toggleSpoilerProtection = () => setSpoilerProtection((prev) => !prev);

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
    staleTime: 10 * 60_000,
    gcTime: 60 * 60_000,
    refetchInterval: (query) => {
      const eps = (query.state.data?.episodes ?? []) as EpisodeRow[];
      const pending = eps.some(
        (e) => e.isAired !== false && (e.imdbVoteAverage == null || e.imdbVoteAverage <= 0),
      );
      return pending ? 8000 : false;
    },
  });

  const showDataQ = useQuery({
    queryKey: ["show", libraryId],
    queryFn: () => getShow(libraryId),
    enabled: Number.isFinite(libraryId) && libraryId > 0,
    staleTime: 10 * 60_000,
    refetchInterval: (query) => {
      const seasons = (query.state.data?.seasonsSummary ?? []) as { imdbVoteAverage?: number | null }[];
      const pending = seasons.some((s) => s.imdbVoteAverage == null || s.imdbVoteAverage <= 0);
      return pending ? 8000 : false;
    },
  });
  const seasonsSummary = (showDataQ.data?.seasonsSummary ?? []) as { seasonNumber: number; inLibrary?: boolean }[];
  const availableSeasons = seasonsSummary
    .map((s) => s.seasonNumber)
    .sort((a, b) => a - b);
  const currentIdx = availableSeasons.indexOf(season);
  const prevSeason = currentIdx > 0 ? availableSeasons[currentIdx - 1] : null;
  const nextSeason = currentIdx < availableSeasons.length - 1 ? availableSeasons[currentIdx + 1] : null;

  const selectAllInSeason = useCallback(() => {
    const eps = (data?.episodes ?? []) as EpisodeRow[];
    setSelectedIds(new Set(eps.filter((e) => e.inLibrary !== false && e.id != null).map((e) => e.id!)));
  }, [data?.episodes]);

  const show = data?.show as { title?: string; tmdbId?: number; selectedPosterPath?: string; posterLocalPath?: string } | undefined;
  const episodes = (data?.episodes ?? []) as EpisodeRow[];
  const libraryEpisodes = useMemo(
    () => episodes.filter((e) => e.inLibrary !== false && e.id != null),
    [episodes],
  );
  const missingReleasedEpisodes = useMemo(
    () => episodes.filter((e) => e.inLibrary === false && e.isAired),
    [episodes],
  );

  const toggleMissingEpisodeWatched = useCallback(
    async (episodeNumber: number, currentlyWatched: boolean) => {
      if (!show?.tmdbId || markWatchedBusyEpisode != null) return;
      setMarkWatchedBusyEpisode(episodeNumber);
      try {
        const input = {
          tmdbId: show.tmdbId,
          mediaType: "Series" as const,
          title: show.title ?? "",
          posterUrl: show.selectedPosterPath ?? show.posterLocalPath ?? null,
          season,
          episode: episodeNumber,
        };
        if (currentlyWatched) await unmarkStreamingWatched(input, qc);
        else await markStreamingWatched(input, qc);
        void qc.invalidateQueries({ queryKey: ["show-season", libraryId, season] });
        void qc.invalidateQueries({ queryKey: ["show", libraryId] });
      } catch {
        setEpisodeActionMsg(
          currentlyWatched ? "Could not unmark that episode." : "Could not mark that episode as watched.",
        );
        window.setTimeout(() => setEpisodeActionMsg(null), 4500);
      } finally {
        setMarkWatchedBusyEpisode(null);
      }
    },
    [show?.tmdbId, show?.title, show?.selectedPosterPath, show?.posterLocalPath, season, libraryId, qc, markWatchedBusyEpisode],
  );

  const imdbQ = useQuery({
    queryKey: ["stream-imdb", show?.tmdbId, "Series"],
    queryFn: () => getStreamImdbId(show!.tmdbId!, "Series"),
    enabled: (show?.tmdbId ?? 0) > 0,
    staleTime: 24 * 60 * 60_000,
  });
  const imdbId = imdbQ.data?.imdbId ?? null;
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
    const withFile = libraryEpisodes.filter((e) => e.id != null && selectedIds.has(e.id) && e.filePath);
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
        const r = await rematchEpisodeFromFile(ep.id!);
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
  }, [libraryEpisodes, selectedIds, libraryId, season, navigate, qc, clearSelection]);

  const bulkRelink = useCallback(() => {
    const ids = libraryEpisodes.filter((e) => e.id != null && selectedIds.has(e.id)).map((e) => e.id!);
    if (ids.length === 0) {
      setEpisodeActionMsg("Select at least one episode to re-link.");
      window.setTimeout(() => setEpisodeActionMsg(null), 3500);
      return;
    }
    setEpisodePickIds(ids);
  }, [libraryEpisodes, selectedIds]);

  const wrapSeason = useCallback(async () => {
    if (wrapBusy) return;
    const ok = await pitflixConfirm(
      "Move this season's loose episode files (and any matching subtitles) into one folder named after the show?",
    );
    if (!ok) return;
    setWrapBusy(true);
    setWrapResult(null);
    try {
      const r = await wrapSeasonEpisodes(libraryId, season);
      setWrapResult({ message: r.message, ok: r.success });
      if (r.movedCount > 0) {
        void qc.invalidateQueries({ queryKey: ["show-season", libraryId, season] });
        void qc.invalidateQueries({ queryKey: ["show", libraryId] });
      }
    } catch (e) {
      setWrapResult({ message: e instanceof Error ? e.message : "Could not wrap this season's files.", ok: false });
    } finally {
      setWrapBusy(false);
      window.setTimeout(() => setWrapResult(null), 6000);
    }
  }, [wrapBusy, libraryId, season, qc]);

  const poster = useMemo(
    () => toPosterSrc(show?.selectedPosterPath || show?.posterLocalPath || undefined),
    [show?.selectedPosterPath, show?.posterLocalPath],
  );

  const episodeThumb = useCallback(
    (ep: EpisodeRow) => toPosterSrc(ep.stillLocalPath ?? undefined) ?? ep.stillUrl ?? poster,
    [poster],
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
      {ResumePromptModal}
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
            {show.title}
          </h1>
          <p className="mt-1 text-base font-semibold text-pitflix-muted">{seasonName}</p>

          {/* Season navigation */}
          {availableSeasons.length > 1 && (
            <div className="mt-3 flex items-center gap-2">
              <button
                type="button"
                disabled={prevSeason == null}
                onClick={() => prevSeason != null && navigate(`/series/${libraryId}/season/${prevSeason}`)}
                className="flex h-8 w-8 items-center justify-center rounded-full border border-white/15 bg-pitflix-card text-sm text-pitflix-muted transition hover:border-pitflix-primary/50 hover:text-white disabled:opacity-30 disabled:pointer-events-none"
              >
                ‹
              </button>

              <div className="flex gap-1">
                {availableSeasons.map((s) => (
                  <button
                    key={s}
                    type="button"
                    onClick={() => s !== season && navigate(`/series/${libraryId}/season/${s}`)}
                    className={`rounded-lg px-2.5 py-1 text-xs font-semibold transition-all ${
                      s === season
                        ? "bg-pitflix-primary text-white"
                        : "border border-white/10 bg-pitflix-card/70 text-pitflix-muted hover:border-pitflix-primary/40 hover:text-white"
                    }`}
                  >
                    {s === 0 ? "Specials" : `S${s}`}
                  </button>
                ))}
              </div>

              <button
                type="button"
                disabled={nextSeason == null}
                onClick={() => nextSeason != null && navigate(`/series/${libraryId}/season/${nextSeason}`)}
                className="flex h-8 w-8 items-center justify-center rounded-full border border-white/15 bg-pitflix-card text-sm text-pitflix-muted transition hover:border-pitflix-primary/50 hover:text-white disabled:opacity-30 disabled:pointer-events-none"
              >
                ›
              </button>
            </div>
          )}

          {data.airDate ? (
            <p className="mt-2 text-sm text-pitflix-muted">Air date: {String(data.airDate)}</p>
          ) : null}
          <p className="mt-1 text-sm text-pitflix-subtle">
            {libraryEpisodes.length} episode{libraryEpisodes.length === 1 ? "" : "s"} in your library
            {typeof data.tmdbEpisodeCount === "number" && data.tmdbEpisodeCount > 0
              ? ` · ${data.tmdbEpisodeCount} listed on TMDB`
              : ""}
            {missingReleasedEpisodes.length > 0
              ? ` · ${missingReleasedEpisodes.length} released and missing`
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
              {/* Spoiler protection toggle */}
              <button
                type="button"
                aria-label={spoilerProtection ? "Disable spoiler protection" : "Enable spoiler protection"}
                title={spoilerProtection ? "Spoiler protection ON — hides episode titles & thumbnails" : "Spoiler protection OFF"}
                onClick={toggleSpoilerProtection}
                className={`flex items-center gap-1.5 rounded-lg border px-2.5 py-1.5 font-medium transition-colors ${
                  spoilerProtection
                    ? "border-amber-500/60 bg-amber-500/15 text-amber-300 hover:bg-amber-500/25"
                    : "border-white/10 bg-pitflix-card/80 text-pitflix-muted hover:text-white"
                }`}
              >
                {spoilerProtection ? <EyeOff className="h-3.5 w-3.5" /> : <Eye className="h-3.5 w-3.5" />}
                <span>Spoilers</span>
              </button>
              <button
                type="button"
                disabled={wrapBusy}
                title="Move this season's loose episode files into one folder named after the show"
                onClick={() => void wrapSeason()}
                className="flex items-center gap-1.5 rounded-lg border border-white/10 bg-pitflix-card/80 px-2.5 py-1.5 font-medium text-pitflix-muted transition-colors hover:text-white disabled:opacity-50"
              >
                <FolderInput className="h-3.5 w-3.5" />
                <span>{wrapBusy ? "Wrapping…" : "Wrap it"}</span>
              </button>
              <div className="flex rounded-lg border border-white/10 overflow-hidden">
                <button
                  type="button"
                  aria-label="List view"
                  onClick={() => setView("list")}
                  className={`flex items-center justify-center px-2.5 py-1.5 transition-colors ${viewMode === "list" ? "bg-pitflix-primary text-white" : "bg-pitflix-card/80 text-pitflix-muted hover:text-white"}`}
                >
                  <List className="h-3.5 w-3.5" />
                </button>
                <button
                  type="button"
                  aria-label="Grid view"
                  onClick={() => setView("grid")}
                  className={`flex items-center justify-center px-2.5 py-1.5 transition-colors ${viewMode === "grid" ? "bg-pitflix-primary text-white" : "bg-pitflix-card/80 text-pitflix-muted hover:text-white"}`}
                >
                  <LayoutGrid className="h-3.5 w-3.5" />
                </button>
              </div>
            </div>
          ) : null}
        </div>

        {wrapResult ? (
          <div
            role="status"
            className={cn(
              "mb-4 flex items-start gap-2.5 rounded-xl border px-4 py-3 text-sm shadow-lg backdrop-blur-sm",
              wrapResult.ok
                ? "border-pitflix-primary/40 bg-pitflix-primary/10 text-white shadow-pitflix-primary/10"
                : "border-red-500/40 bg-red-950/30 text-red-100 shadow-red-900/20",
            )}
          >
            {wrapResult.ok ? (
              <FolderInput className="mt-0.5 h-4 w-4 shrink-0 text-pitflix-primary" />
            ) : (
              <AlertCircle className="mt-0.5 h-4 w-4 shrink-0 text-red-300" />
            )}
            <p className="leading-snug">{wrapResult.message}</p>
            <button
              type="button"
              onClick={() => setWrapResult(null)}
              className="ml-auto shrink-0 text-xs text-white/40 hover:text-white"
              aria-label="Dismiss"
            >
              ✕
            </button>
          </div>
        ) : null}

        {missingReleasedEpisodes.length > 0 ? (
          <MissingEpisodesBanner
            count={missingReleasedEpisodes.length}
            onDownload={() => setDownloadEpisode(missingReleasedEpisodes[0]!.episodeNumber)}
          />
        ) : null}

        {/* Grid view */}
        {viewMode === "grid" && (
          <div className="grid grid-cols-2 gap-4 sm:grid-cols-3 lg:grid-cols-4 xl:grid-cols-5">
            {episodes.map((ep) => {
              const inLibrary = ep.inLibrary !== false && ep.id != null;
              const isWatched = episodeIsWatched(ep, inLibrary);
              const revealTitle = episodeTitleVisible(spoilerProtection, inLibrary, ep);
              const isNextUp = inLibrary && nextEpisode != null && ep.id === nextEpisode.id;
              const epThumb = episodeThumb(ep);
              const missingReleased = !inLibrary && ep.isAired;
              const upcoming = !inLibrary && !ep.isAired;
              return (
                <div
                  key={ep.id ?? `tmdb-${ep.episodeNumber}`}
                  role={missingReleased ? "button" : undefined}
                  tabIndex={missingReleased ? 0 : undefined}
                  onClick={missingReleased ? () => setDownloadEpisode(ep.episodeNumber) : undefined}
                  onKeyDown={
                    missingReleased
                      ? (e) => {
                          if (e.key === "Enter" || e.key === " ") {
                            e.preventDefault();
                            setDownloadEpisode(ep.episodeNumber);
                          }
                        }
                      : undefined
                  }
                  className={cn(
                    "group relative flex flex-col overflow-hidden rounded-2xl border transition-all duration-300",
                    inLibrary && (isNextUp ? "border-pitflix-primary/60 bg-pitflix-surface hover:border-pitflix-primary/40" : "border-pitflix-card/60 bg-pitflix-surface hover:border-pitflix-primary/40"),
                    missingReleased && episodeExternalCardClass("missing", "cursor-pointer rounded-2xl border"),
                    upcoming && episodeExternalCardClass("upcoming", "rounded-2xl border"),
                  )}
                >
                  {/* Thumbnail */}
                  <div className="relative aspect-video w-full overflow-hidden bg-pitflix-card">
                    <MediaImage
                      src={epThumb}
                      alt=""
                      className={
                        inLibrary
                          ? `h-full w-full object-cover transition-transform duration-300 group-hover:scale-105 ${spoilerProtection && !isWatched ? "blur-md" : ""}`
                          : episodeExternalThumbClass(missingReleased ? "missing" : "upcoming", spoilerProtection && !isWatched)
                      }
                      fallbackText={`E${ep.episodeNumber}`}
                    />
                    {isWatched && (
                      <div className="absolute inset-0 flex items-center justify-center bg-black/40">
                        <span className="rounded-full bg-green-600/90 px-2 py-0.5 text-[10px] font-semibold text-white">Watched</span>
                      </div>
                    )}
                    {isNextUp && (
                      <div className="absolute left-2 top-2 rounded-full bg-pitflix-primary/90 px-2 py-0.5 text-[10px] font-bold text-white shadow-lg">Next up</div>
                    )}
                    {missingReleased ? (
                      <div className="absolute right-2 top-2">
                        <EpisodeStatusBadge kind="missing" />
                      </div>
                    ) : null}
                    {upcoming ? (
                      <div className="absolute right-2 top-2">
                        <EpisodeStatusBadge kind="upcoming" />
                      </div>
                    ) : null}
                    {(missingReleased || upcoming) ? (
                      <EpisodeExternalThumbOverlay kind={missingReleased ? "missing" : "upcoming"} />
                    ) : null}
                    <div className="absolute bottom-2 left-2 z-[1] rounded bg-black/70 px-1.5 py-0.5 text-[10px] font-mono text-white backdrop-blur-sm">
                      E{String(ep.episodeNumber).padStart(2, "0")}
                    </div>
                    {(ep.runtimeMinutes ?? 0) > 0 ? (
                      <div className="absolute bottom-2 right-2 z-[1]">
                        <EpisodeRuntimeBadge minutes={ep.runtimeMinutes} variant="thumb" />
                      </div>
                    ) : null}
                    {inLibrary && ep.filePath ? (
                      <button
                        type="button"
                        onClick={() =>
                          void requestPlay({
                            filePath: ep.filePath!,
                            title: `${show.title} · S${season}E${ep.episodeNumber}`,
                            posterPath: show.selectedPosterPath || show.posterLocalPath || null,
                            mediaType: "Series",
                            durationSeconds: 0,
                            context: {
                              libraryShowId: libraryId,
                              libraryEpisodeId: ep.id!,
                              season,
                              episodeNumber: ep.episodeNumber,
                            },
                          })
                        }
                        className="absolute inset-0 flex items-center justify-center bg-black/0 opacity-0 transition-all group-hover:bg-black/30 group-hover:opacity-100"
                      >
                        <span className="flex h-10 w-10 items-center justify-center rounded-full bg-pitflix-primary shadow-lg">
                          <span className="ml-0.5 text-lg text-white">▶</span>
                        </span>
                      </button>
                    ) : null}
                  </div>
                  {/* Info */}
                  <div className="flex flex-1 flex-col p-3">
                    {missingReleased ? <MissingEpisodeHint className="mb-1" /> : null}
                    <p className="line-clamp-2 text-sm font-semibold text-white transition">
                      {revealTitle
                        ? (ep.title?.trim() ? ep.title : `Episode ${ep.episodeNumber}`)
                        : `Episode ${ep.episodeNumber}`}
                    </p>
                    <div className="mt-2 flex flex-wrap gap-1.5">
                      {(ep.runtimeMinutes ?? 0) > 0 ? (
                        <EpisodeRuntimeBadge minutes={ep.runtimeMinutes} />
                      ) : null}
                      {ep.imdbVoteAverage != null && ep.imdbVoteAverage > 0 ? (
                        <ImdbRatingBadge value={ep.imdbVoteAverage} size="xs" />
                      ) : null}
                      {ep.subtitlePath && (
                        <span className="inline-flex items-center gap-1 rounded bg-sky-500/15 px-1.5 py-0.5 text-[10px] text-sky-300">
                          <span className="inline-block h-2.5 w-2.5 rounded-sm bg-sky-500/40 text-center text-[7px] font-bold leading-[10px] text-sky-200">CC</span>
                          Subs
                        </span>
                      )}
                    </div>
                    {/* Synopsis — always shown when the API provides it; fixed height so grid rows stay aligned */}
                    <div className="mt-1.5 min-h-[3rem]">
                      {ep.overview ? (
                        <p className="line-clamp-3 text-[11px] leading-[1rem] text-pitflix-muted/80">
                          {ep.overview}
                        </p>
                      ) : null}
                    </div>
                    {/* Action row */}
                    <div className="mt-auto flex flex-col gap-2 pt-2">
                      {inLibrary ? (
                        <div className="flex flex-wrap items-center gap-1.5">
                          <button
                            type="button"
                            onClick={() => {
                              const next = isWatched ? "Unwatched" : "Completed";
                              void setEpisodeWatchStatus(ep.id!, next).then(() => {
                                void qc.invalidateQueries({ queryKey: ["show-season", libraryId, season] });
                                void qc.invalidateQueries({ queryKey: ["show", libraryId] });
                              });
                            }}
                            className={`rounded-full border px-2.5 py-1 text-[10px] font-semibold transition-all ${isWatched ? "border-green-500/90 bg-green-600/85 text-white" : "border-pitflix-subtle/50 text-pitflix-muted hover:border-pitflix-primary/60 hover:text-white"}`}
                          >
                            {isWatched ? "✓ Watched" : "Mark watched"}
                          </button>
                          {ep.filePath ? (
                            <>
                              <button
                                type="button"
                                onClick={() => setSubtitleEpisode({ id: ep.id!, filePath: ep.filePath!, label: `S${season}E${ep.episodeNumber}`, season, episodeNumber: ep.episodeNumber })}
                                className="flex items-center justify-center rounded-full border border-pitflix-card/60 p-1.5 text-pitflix-muted hover:border-sky-500/50 hover:text-sky-300"
                                title="Subtitles"
                              >
                                <Subtitles className="h-3.5 w-3.5" />
                              </button>
                              <button
                                type="button"
                                onClick={() => setEpisodePickIds([ep.id!])}
                                className="rounded-full border border-pitflix-card/60 px-2.5 py-1 text-[10px] text-pitflix-muted hover:border-pitflix-primary/40 hover:text-white"
                              >
                                Re-link
                              </button>
                              <button
                                type="button"
                                disabled={episodeRematchBusyId !== null}
                                onClick={() =>
                                  void (async () => {
                                    const ok = await pitflixConfirm("Remove and re-match this episode from file?");
                                    if (!ok) return;
                                    setEpisodeRematchBusyId(ep.id!);
                                    try {
                                      const r = await rematchEpisodeFromFile(ep.id!);
                                      if (!r.success) { setEpisodeActionMsg(r.error ?? "Re-match failed."); return; }
                                      void qc.invalidateQueries({ queryKey: ["show-season", libraryId, season] });
                                      void qc.invalidateQueries({ queryKey: ["show", libraryId] });
                                    } catch { setEpisodeActionMsg("Could not reach the API."); }
                                    finally { setEpisodeRematchBusyId(null); }
                                  })()
                                }
                                className="rounded-full border border-pitflix-card/60 px-2.5 py-1 text-[10px] text-pitflix-muted hover:border-pitflix-primary/40 hover:text-white disabled:opacity-40"
                              >
                                {episodeRematchBusyId === ep.id ? "…" : "Re-match"}
                              </button>
                            </>
                          ) : null}
                        </div>
                      ) : missingReleased ? (
                        <div className="flex flex-col gap-1.5">
                          <MissingEpisodeDownloadButton
                            layout="grid"
                            onClick={(e) => {
                              e.stopPropagation();
                              setDownloadEpisode(ep.episodeNumber);
                            }}
                          />
                          <MissingEpisodeMarkWatchedButton
                            layout="grid"
                            watched={isWatched}
                            busy={markWatchedBusyEpisode === ep.episodeNumber}
                            onClick={(e) => {
                              e.stopPropagation();
                              void toggleMissingEpisodeWatched(ep.episodeNumber, isWatched);
                            }}
                          />
                        </div>
                      ) : upcoming ? (
                        <UpcomingEpisodePanel airDate={ep.airDate} variant="card" />
                      ) : null}
                    </div>
                  </div>
                </div>
              );
            })}
          </div>
        )}

        {/* List view */}
        {viewMode === "list" && (
        <div className="space-y-2">
          {episodes.map((ep) => {
            const inLibrary = ep.inLibrary !== false && ep.id != null;
            const isWatched = episodeIsWatched(ep, inLibrary);
            const revealTitle = episodeTitleVisible(spoilerProtection, inLibrary, ep);
            const isNextUp = inLibrary && nextEpisode != null && ep.id === nextEpisode.id;
            const epThumb = episodeThumb(ep);
            const isSelected = inLibrary && ep.id != null && selectedIds.has(ep.id);
            const missingReleased = !inLibrary && ep.isAired;
            const upcoming = !inLibrary && !ep.isAired;
            return (
              <div
                key={ep.id ?? `tmdb-${ep.episodeNumber}`}
                className={cn(
                  "group flex items-center gap-3 rounded-2xl border py-3 pl-3 pr-4 transition-all duration-300 sm:gap-4 sm:pl-4",
                  inLibrary && "border-transparent bg-pitflix-bg/50 hover:border-pitflix-primary/30 hover:bg-pitflix-card/90",
                  isNextUp && "border-l-4 border-l-pitflix-primary",
                  isSelected && "border-pitflix-primary/40 bg-pitflix-card/70 ring-1 ring-pitflix-primary/25",
                  missingReleased && episodeExternalListClass("missing", "rounded-2xl border"),
                  upcoming && episodeExternalListClass("upcoming", "rounded-2xl border"),
                )}
              >
                {inLibrary ? (
                  <label className="flex shrink-0 cursor-pointer items-center justify-center p-1">
                    <input
                      type="checkbox"
                      className="h-4 w-4 rounded border-pitflix-card bg-pitflix-bg text-pitflix-primary focus:ring-pitflix-primary"
                      checked={isSelected}
                      onChange={() => ep.id != null && toggleSelect(ep.id)}
                      aria-label={`Select episode ${ep.episodeNumber}`}
                    />
                  </label>
                ) : (
                  <EpisodeExternalListIcon kind={missingReleased ? "missing" : "upcoming"} />
                )}
                <MediaImage
                  src={epThumb}
                  alt=""
                  className={cn(
                    "h-14 w-[88px] shrink-0 overflow-hidden rounded-lg bg-pitflix-card object-cover ring-1",
                    inLibrary && "ring-white/5",
                    missingReleased && "ring-amber-500/30 saturate-[0.7]",
                    upcoming && "ring-violet-500/25 saturate-[0.6]",
                    spoilerProtection && !isWatched && "blur-md",
                  )}
                  fallbackText={`${ep.episodeNumber}`}
                />
                <span className="w-10 shrink-0 text-center font-mono text-sm font-medium tabular-nums text-pitflix-muted">
                  {String(ep.episodeNumber).padStart(2, "0")}
                </span>
                <div className="min-w-0 flex-1 pr-2">
                  <p className="flex flex-wrap items-center gap-2 truncate text-sm font-medium text-white">
                    <span className="truncate">
                      {revealTitle
                        ? (ep.title?.trim() ? ep.title : `Episode ${ep.episodeNumber}`)
                        : `Episode ${ep.episodeNumber}`}
                    </span>
                    {missingReleased ? (
                      <EpisodeStatusBadge kind="missing" className="shrink-0" />
                    ) : null}
                    {upcoming ? (
                      <EpisodeStatusBadge kind="upcoming" className="shrink-0" />
                    ) : null}
                    {isNextUp ? (
                      <span className="shrink-0 rounded-full bg-pitflix-primary/25 px-2 py-0.5 text-[10px] font-semibold uppercase tracking-wide text-pitflix-primary">
                        Next up
                      </span>
                    ) : null}
                    {ep.imdbVoteAverage != null && ep.imdbVoteAverage > 0 ? (
                      <ImdbRatingBadge value={ep.imdbVoteAverage} size="xs" className="shrink-0" />
                    ) : null}
                    {(ep.runtimeMinutes ?? 0) > 0 ? (
                      <EpisodeRuntimeBadge minutes={ep.runtimeMinutes} className="shrink-0" />
                    ) : null}
                  </p>
                  {ep.overview ? (
                    <p className="mt-0.5 line-clamp-2 text-[11px] leading-relaxed text-pitflix-muted">{ep.overview}</p>
                  ) : null}
                  {(!inLibrary && (missingReleased || upcoming)) ? (
                    <EpisodeExternalListMeta
                      kind={missingReleased ? "missing" : "upcoming"}
                      airDate={ep.airDate}
                    />
                  ) : null}
                  {spoilerProtection && !isWatched && inLibrary ? (
                    <p className="mt-0.5 flex items-center gap-1 text-[11px] text-amber-400/70">
                      <EyeOff className="inline h-3 w-3" />
                      <span>Spoiler protection on</span>
                    </p>
                  ) : null}
                  {ep.subtitlePath ? (
                    <span className="mt-0.5 inline-flex items-center gap-1 text-xs text-pitflix-subtle">
                      <span className="inline-block h-3 w-3 rounded-sm bg-white/20 text-center text-[8px] font-bold leading-3 text-white">CC</span>
                      Subtitles
                    </span>
                  ) : null}
                </div>
                {inLibrary ? (
                  <>
                    <button
                      type="button"
                      role="switch"
                      aria-checked={isWatched}
                      onClick={() => {
                        const next = isWatched ? "Unwatched" : "Completed";
                        void setEpisodeWatchStatus(ep.id!, next).then(() => {
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
                              setEpisodeRematchBusyId(ep.id!);
                              try {
                                const r = await rematchEpisodeFromFile(ep.id!);
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
                          onClick={() => setEpisodePickIds([ep.id!])}
                          className="rounded-xl border border-pitflix-card bg-pitflix-surface px-3 py-2 text-xs font-semibold text-pitflix-muted shadow-md hover:border-pitflix-primary/50 hover:text-white disabled:opacity-45"
                        >
                          Re-link…
                        </button>
                        <button
                          type="button"
                          onClick={() =>
                            setSubtitleEpisode({
                              id: ep.id!,
                              filePath: ep.filePath!,
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
                            void requestPlay({
                              filePath: ep.filePath!,
                              title: `${show.title} · S${season}E${ep.episodeNumber}`,
                              posterPath: show.selectedPosterPath || show.posterLocalPath || null,
                              mediaType: "Series",
                              durationSeconds: 0,
                              context: {
                                libraryShowId: libraryId,
                                libraryEpisodeId: ep.id!,
                                season,
                                episodeNumber: ep.episodeNumber,
                              },
                            })
                          }
                          className="rounded-xl bg-pitflix-primary px-4 py-2 text-xs font-semibold text-white shadow-md transition-all hover:bg-pitflix-light"
                        >
                          ▶ Play
                        </button>
                      </div>
                    ) : null}
                  </>
                ) : missingReleased ? (
                  <div className="flex shrink-0 gap-2">
                    <MissingEpisodeDownloadButton
                      layout="list"
                      onClick={() => setDownloadEpisode(ep.episodeNumber)}
                    />
                    <MissingEpisodeMarkWatchedButton
                      layout="list"
                      watched={isWatched}
                      busy={markWatchedBusyEpisode === ep.episodeNumber}
                      onClick={() => void toggleMissingEpisodeWatched(ep.episodeNumber, isWatched)}
                    />
                  </div>
                ) : (
                  <UpcomingEpisodePanel airDate={ep.airDate} variant="row" />
                )}
              </div>
            );
          })}
        </div>
        )}
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

      <WsmDownloadModal
        isOpen={downloadEpisode != null}
        onClose={() => setDownloadEpisode(null)}
        mode="episode"
        tmdbId={show.tmdbId ?? 0}
        imdbId={imdbId}
        title={show.title ?? "Series"}
        season={season}
        episode={downloadEpisode ?? undefined}
        episodeLabel={
          downloadEpisode != null
            ? `S${String(season).padStart(2, "0")}E${String(downloadEpisode).padStart(2, "0")}`
            : undefined
        }
      />

      <PickTmdbTitleModal
        open={episodePickIds != null}
        onClose={() => setEpisodePickIds(null)}
        target={
          episodePickIds == null
            ? null
            : episodePickIds.length === 1
              ? { kind: "episode", episodeId: episodePickIds[0]! }
              : { kind: "episode-bulk", episodeIds: episodePickIds }
        }
        hintTitle={show.title ?? ""}
        onMatched={(r) => {
          clearSelection();
          setEpisodeActionMsg(
            episodePickIds && episodePickIds.length > 1
              ? `Re-linked ${episodePickIds.length} selected episodes.`
              : "Episode re-linked.",
          );
          window.setTimeout(() => setEpisodeActionMsg(null), 4500);
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
