import { useQuery, useQueryClient } from "@tanstack/react-query";
import { Check, Download, Eye, EyeOff, LayoutGrid, List, Play } from "lucide-react";
import { useState } from "react";
import { useLocation, useNavigate } from "react-router-dom";
import { getStreamSeasonEpisodes } from "../api/stream";
import { StreamingTitleActions } from "../components/streaming/StreamingTitleActions";
import { MediaContextMenu } from "../features/library/MediaContextMenu";
import { useMediaContextMenu } from "../features/library/useMediaContextMenu";
import { markStreamingWatched } from "../hooks/markStreamingWatched";
import { WsmDownloadModal } from "../components/WsmDownloadModal";
import { EpisodeRuntimeBadge } from "../components/episodes/EpisodeRuntimeBadge";
import {
  EpisodeExternalThumbOverlay,
  EpisodeStatusBadge,
  UpcomingEpisodePanel,
  episodeExternalCardClass,
  episodeExternalListClass,
  episodeExternalThumbClass,
} from "../components/episodes/EpisodeAvailabilityUi";
import { MediaImage } from "../components/ui/MediaImage";
import { Spinner } from "../components/ui/Spinner";
import { useAppPrefsStore } from "../store/appPrefsStore";
import { corsFlixTvUrl, streamTvEmbedUrl } from "../features/streaming/streamEmbedUrls";
import { isEpisodeAired } from "../hooks/useCountdown";
import { cn } from "../utils/cn";

export type StreamSeasonLocationState = {
  tmdbId: number;
  seasonNumber: number;
  seriesTitle: string;
  seriesYear?: number | null;
  seriesPosterUrl?: string | null;
  seasons?: number[];
  imdbId?: string | null;
};

const VIEW_KEY = "pitflix.stream-season.viewMode";

export function StreamSeasonPage() {
  const navigate = useNavigate();
  const location = useLocation();
  const qc = useQueryClient();
  const state = location.state as StreamSeasonLocationState | null;
  const { menu, closeMenu, handleContextMenu, runAction } = useMediaContextMenu();

  const tmdbId = state?.tmdbId ?? 0;
  const seasonNumber = state?.seasonNumber ?? 0;
  const seriesTitle = state?.seriesTitle ?? "Series";
  const seriesPosterUrl = state?.seriesPosterUrl ?? null;
  const availableSeasons = state?.seasons ?? [];
  const imdbId = state?.imdbId ?? null;

  const [viewMode, setViewMode] = useState<"list" | "grid">(() => {
    try { return (localStorage.getItem(VIEW_KEY) as "list" | "grid") || "list"; } catch { return "list"; }
  });
  const setView = (v: "list" | "grid") => {
    setViewMode(v);
    try { localStorage.setItem(VIEW_KEY, v); } catch {}
  };

  const defaultSpoilerProtection = useAppPrefsStore((s) => s.defaultSpoilerProtection);
  const [spoilerProtection, setSpoilerProtection] = useState(defaultSpoilerProtection);
  const toggleSpoilerProtection = () => setSpoilerProtection((prev) => !prev);
  const [downloadEpisode, setDownloadEpisode] = useState<number | null>(null);
  const [markBusyEp, setMarkBusyEp] = useState<number | null>(null);

  const markEpisodeWatched = (episode: number) => {
    if (markBusyEp != null) return;
    setMarkBusyEp(episode);
    void markStreamingWatched(
      {
        tmdbId,
        mediaType: "Series",
        title: `${seriesTitle} · S${seasonNumber}E${episode}`,
        posterUrl: seriesPosterUrl,
        imdbId,
        season: seasonNumber,
        episode,
      },
      qc,
    ).finally(() => setMarkBusyEp(null));
  };

  const { data, isLoading } = useQuery({
    queryKey: ["stream-season", tmdbId, seasonNumber],
    queryFn: () => getStreamSeasonEpisodes(tmdbId, seasonNumber),
    enabled: tmdbId > 0 && seasonNumber > 0,
    staleTime: 10 * 60 * 1000,
  });

  const currentIdx = availableSeasons.indexOf(seasonNumber);
  const prevSeason = currentIdx > 0 ? availableSeasons[currentIdx - 1] : null;
  const nextSeason = currentIdx >= 0 && currentIdx < availableSeasons.length - 1 ? availableSeasons[currentIdx + 1] : null;

  function goToSeason(s: number) {
    navigate("/stream-season", {
      state: { ...state, seasonNumber: s },
      replace: true,
    });
  }

  function playEpisode(episode: number, provider: "streamimdb" | "corsflix") {
    if (provider === "corsflix") {
      navigate("/stream-player", {
        state: {
          streamUrl: corsFlixTvUrl(tmdbId, seasonNumber, episode),
          title: `${seriesTitle} · S${seasonNumber}E${episode}`,
          libraryWatchMeta: { tmdbId, mediaType: "Series" as const, season: seasonNumber, episode },
          posterUrl: seriesPosterUrl,
          imdbId,
        },
      });
    } else {
      if (!imdbId) return;
      navigate("/stream-player", {
        state: {
          streamUrl: streamTvEmbedUrl(imdbId, seasonNumber, episode),
          title: `${seriesTitle} · S${seasonNumber}E${episode}`,
          libraryWatchMeta: { tmdbId, mediaType: "Series" as const, season: seasonNumber, episode },
          posterUrl: seriesPosterUrl,
          imdbId,
        },
      });
    }
  }

  if (tmdbId === 0 || seasonNumber === 0) {
    return (
      <div className="flex h-64 items-center justify-center text-pitflix-muted">
        Invalid season. Go back.
      </div>
    );
  }

  const episodes = data?.episodes ?? [];
  const seasonPoster = data?.seasonPosterUrl ?? seriesPosterUrl;

  return (
    <div>
      <button
        type="button"
        onClick={() => navigate(-1)}
        className="mb-4 text-sm text-pitflix-muted hover:text-white"
      >
        ← Back
      </button>

      <div className="flex flex-col gap-6 md:flex-row md:items-start">
        <MediaImage
          src={seasonPoster}
          alt=""
          className="w-full max-w-[180px] shrink-0 overflow-hidden rounded-xl bg-pitflix-card shadow-xl"
          fallbackText={seriesTitle}
        />
        <div>
          <h1 className="text-2xl font-bold text-white md:text-3xl">{seriesTitle}</h1>
          <p className="mt-1 text-base font-semibold text-pitflix-muted">
            {data?.seasonName ?? `Season ${seasonNumber}`}
          </p>

          {availableSeasons.length > 1 && (
            <div className="mt-3 flex items-center gap-2">
              <button
                type="button"
                disabled={prevSeason == null}
                onClick={() => prevSeason != null && goToSeason(prevSeason)}
                className="flex h-8 w-8 items-center justify-center rounded-full border border-white/15 bg-pitflix-card text-sm text-pitflix-muted transition hover:border-pitflix-primary/50 hover:text-white disabled:opacity-30 disabled:pointer-events-none"
              >
                ‹
              </button>
              <div className="flex flex-wrap gap-1">
                {availableSeasons.map((s) => (
                  <button
                    key={s}
                    type="button"
                    onClick={() => s !== seasonNumber && goToSeason(s)}
                    className={`rounded-lg px-2.5 py-1 text-xs font-semibold transition-all ${
                      s === seasonNumber
                        ? "bg-pitflix-primary text-white"
                        : "border border-white/10 bg-pitflix-card/70 text-pitflix-muted hover:border-pitflix-primary/40 hover:text-white"
                    }`}
                  >
                    S{s}
                  </button>
                ))}
              </div>
              <button
                type="button"
                disabled={nextSeason == null}
                onClick={() => nextSeason != null && goToSeason(nextSeason)}
                className="flex h-8 w-8 items-center justify-center rounded-full border border-white/15 bg-pitflix-card text-sm text-pitflix-muted transition hover:border-pitflix-primary/50 hover:text-white disabled:opacity-30 disabled:pointer-events-none"
              >
                ›
              </button>
            </div>
          )}

          {data?.seasonOverview && (
            <p className="mt-3 max-w-2xl text-sm leading-relaxed text-white/70">{data.seasonOverview}</p>
          )}
          {!imdbId && (
            <p className="mt-2 text-xs text-amber-400/90">
              IMDb ID unavailable — playback via StreamIMDB may not work. CorsFlix does not need it.
            </p>
          )}
          <div className="mt-4">
            <StreamingTitleActions
              tmdbId={tmdbId}
              mediaType="Series"
              title={seriesTitle}
              posterUrl={seriesPosterUrl}
              imdbId={imdbId}
              season={seasonNumber}
            />
          </div>
        </div>
      </div>

      <section className="mt-8 pb-24">
        <div className="mb-4 flex flex-wrap items-center justify-between gap-3">
          <h2 className="text-xl font-bold">Episodes</h2>
          {episodes.length > 0 && (
            <div className="flex flex-wrap items-center gap-2 text-xs">
              <button
                type="button"
                aria-label={spoilerProtection ? "Disable spoiler protection" : "Enable spoiler protection"}
                title={spoilerProtection ? "Spoiler protection ON — click to disable" : "Spoiler protection OFF — click to hide titles & overviews"}
                onClick={toggleSpoilerProtection}
                className={cn(
                  "flex items-center gap-1.5 rounded-lg border px-2.5 py-1.5 font-medium transition-colors",
                  spoilerProtection
                    ? "border-amber-500/60 bg-amber-500/15 text-amber-300 hover:bg-amber-500/25"
                    : "border-white/10 bg-pitflix-card/80 text-pitflix-muted hover:text-white",
                )}
              >
                {spoilerProtection ? <EyeOff className="h-3.5 w-3.5" /> : <Eye className="h-3.5 w-3.5" />}
                <span>Spoilers</span>
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
          )}
        </div>

        {isLoading && (
          <div className="flex justify-center py-16">
            <Spinner />
          </div>
        )}

        {/* Grid view */}
        {!isLoading && viewMode === "grid" && episodes.length > 0 && (
          <div className="grid grid-cols-2 gap-4 sm:grid-cols-3 lg:grid-cols-4 xl:grid-cols-5">
            {episodes.map((ep) => {
              const aired = isEpisodeAired(ep.airDate);
              return (
              <div
                key={ep.episodeNumber}
                className={cn(
                  "group relative flex flex-col overflow-hidden rounded-2xl border transition-all duration-300",
                  aired
                    ? "border-pitflix-card/60 bg-pitflix-surface hover:border-pitflix-primary/40"
                    : episodeExternalCardClass("upcoming", "rounded-2xl border"),
                )}
              >
                <div className="relative aspect-video w-full overflow-hidden bg-pitflix-card">
                  <MediaImage
                    src={ep.stillUrl}
                    alt={ep.title}
                    className={
                      aired
                        ? cn(
                            "h-full w-full object-cover transition-transform duration-300 group-hover:scale-105",
                            spoilerProtection && "blur-md",
                          )
                        : episodeExternalThumbClass("upcoming", spoilerProtection)
                    }
                    fallbackText={`E${ep.episodeNumber}`}
                  />
                  {!aired ? (
                    <>
                      <div className="absolute right-2 top-2 z-[1]">
                        <EpisodeStatusBadge kind="upcoming" />
                      </div>
                      <EpisodeExternalThumbOverlay kind="upcoming" />
                    </>
                  ) : null}
                  <div className="absolute bottom-2 left-2 z-[1] rounded bg-black/70 px-1.5 py-0.5 text-[10px] font-mono text-white backdrop-blur-sm">
                    E{String(ep.episodeNumber).padStart(2, "0")}
                  </div>
                  {ep.runtime > 0 ? (
                    <div className="absolute bottom-2 right-2 z-[1]">
                      <EpisodeRuntimeBadge minutes={ep.runtime} variant="thumb" />
                    </div>
                  ) : null}
                  {aired ? (
                  <div className="absolute inset-0 flex items-center justify-center gap-2 bg-black/0 opacity-0 transition-all group-hover:bg-black/30 group-hover:opacity-100">
                    <button
                      type="button"
                      disabled={!imdbId}
                      title="Play on StreamIMDB"
                      onClick={() => playEpisode(ep.episodeNumber, "streamimdb")}
                      className="flex h-9 w-9 items-center justify-center rounded-full bg-pitflix-primary shadow-lg disabled:cursor-not-allowed disabled:opacity-40"
                    >
                      <Play className="h-3.5 w-3.5 text-white" />
                    </button>
                    <button
                      type="button"
                      title="Play on CorsFlix"
                      onClick={() => playEpisode(ep.episodeNumber, "corsflix")}
                      className="flex h-9 w-9 items-center justify-center rounded-full bg-[#0891b2] shadow-lg"
                    >
                      <Play className="h-3.5 w-3.5 text-white" />
                    </button>
                    <button
                      type="button"
                      title="Download"
                      onClick={() => setDownloadEpisode(ep.episodeNumber)}
                      className="flex h-9 w-9 items-center justify-center rounded-full bg-pitflix-card shadow-lg"
                    >
                      <Download className="h-3.5 w-3.5 text-white" />
                    </button>
                    <button
                      type="button"
                      title="Mark watched"
                      disabled={markBusyEp === ep.episodeNumber}
                      onClick={() => markEpisodeWatched(ep.episodeNumber)}
                      className="flex h-9 w-9 items-center justify-center rounded-full bg-green-600/80 shadow-lg disabled:opacity-50"
                    >
                      <Check className="h-3.5 w-3.5 text-white" />
                    </button>
                  </div>
                  ) : null}
                </div>
                <div className="flex flex-1 flex-col p-3">
                  <p className={cn("line-clamp-2 text-sm font-semibold text-white", spoilerProtection && "blur-sm select-none")}>
                    {spoilerProtection ? `Episode ${ep.episodeNumber}` : ep.title}
                  </p>
                  <div className="mt-2 flex flex-wrap gap-1.5">
                    {ep.runtime > 0 ? <EpisodeRuntimeBadge minutes={ep.runtime} /> : null}
                    {ep.voteAverage > 0 && (
                      <span className="rounded bg-white/10 px-1.5 py-0.5 text-[10px] text-pitflix-muted">★ {ep.voteAverage.toFixed(1)}</span>
                    )}
                  </div>
                  {ep.overview && !spoilerProtection && (
                    <p className="mt-1.5 line-clamp-3 text-[11px] leading-[1rem] text-pitflix-muted/80">{ep.overview}</p>
                  )}
                  {!aired ? (
                    <div className="mt-auto pt-2">
                      <UpcomingEpisodePanel airDate={ep.airDate} variant="card" />
                    </div>
                  ) : null}
                </div>
              </div>
            );
            })}
          </div>
        )}

        {/* List view */}
        {!isLoading && viewMode === "list" && episodes.length > 0 && (
          <div className="space-y-2">
            {episodes.map((ep) => {
              const aired = isEpisodeAired(ep.airDate);
              return (
              <div
                key={ep.episodeNumber}
                onContextMenu={handleContextMenu({
                  kind: "streaming",
                  tmdbId,
                  mediaType: "Series",
                  title: `${seriesTitle} · S${seasonNumber}E${ep.episodeNumber}`,
                  posterUrl: seriesPosterUrl,
                  imdbId,
                  seasonNumber,
                  episodeNumber: ep.episodeNumber,
                })}
                className={cn(
                  "group flex items-center gap-3 rounded-2xl border py-3 pl-3 pr-4 transition-all duration-300 sm:gap-4 sm:pl-4",
                  aired
                    ? "border-transparent bg-pitflix-bg/50 hover:border-pitflix-primary/30 hover:bg-pitflix-card/90"
                    : episodeExternalListClass("upcoming", "rounded-2xl border"),
                )}
              >
                <MediaImage
                  src={ep.stillUrl}
                  alt=""
                  className={cn(
                    "h-14 w-[88px] shrink-0 overflow-hidden rounded-lg bg-pitflix-card object-cover ring-1",
                    aired ? "ring-white/5" : "ring-violet-500/25 saturate-[0.6]",
                    spoilerProtection && "blur-md",
                  )}
                  fallbackText={`${ep.episodeNumber}`}
                />
                <span className="w-10 shrink-0 text-center font-mono text-sm font-medium tabular-nums text-pitflix-muted">
                  {String(ep.episodeNumber).padStart(2, "0")}
                </span>
                <div className="min-w-0 flex-1 pr-2">
                  <p className="flex flex-wrap items-center gap-2 truncate text-sm font-medium text-white">
                    <span className="truncate">{spoilerProtection ? `Episode ${ep.episodeNumber}` : ep.title}</span>
                    {!aired ? <EpisodeStatusBadge kind="upcoming" className="shrink-0" /> : null}
                    {ep.runtime > 0 ? <EpisodeRuntimeBadge minutes={ep.runtime} className="shrink-0" /> : null}
                    {ep.voteAverage > 0 && (
                      <span className="shrink-0 rounded bg-white/10 px-1.5 py-0.5 text-[10px] text-pitflix-muted">★ {ep.voteAverage.toFixed(1)}</span>
                    )}
                  </p>
                  {ep.overview && !spoilerProtection ? (
                    <p className="mt-0.5 line-clamp-2 text-[11px] leading-relaxed text-pitflix-muted">{ep.overview}</p>
                  ) : spoilerProtection ? (
                    <p className="mt-0.5 flex items-center gap-1 text-[11px] text-amber-400/70">
                      <EyeOff className="inline h-3 w-3" />
                      <span>Spoiler protection on</span>
                    </p>
                  ) : null}
                </div>
                {aired ? (
                <div className="flex shrink-0 items-center gap-1.5">
                  <button
                    type="button"
                    disabled={!imdbId}
                    onClick={() => playEpisode(ep.episodeNumber, "streamimdb")}
                    title={imdbId ? `Play S${seasonNumber}E${ep.episodeNumber} on StreamIMDB` : "IMDb ID required for StreamIMDB"}
                    className="flex h-9 w-9 items-center justify-center rounded-full bg-pitflix-primary text-white shadow transition-all hover:bg-pitflix-light disabled:cursor-not-allowed disabled:opacity-40"
                  >
                    <Play className="h-3.5 w-3.5" />
                  </button>
                  <button
                    type="button"
                    onClick={() => playEpisode(ep.episodeNumber, "corsflix")}
                    title={`Play S${seasonNumber}E${ep.episodeNumber} on CorsFlix`}
                    className="flex h-9 w-9 items-center justify-center rounded-full bg-[#0891b2] text-white shadow transition-all hover:bg-[#0e7490]"
                  >
                    <Play className="h-3.5 w-3.5" />
                  </button>
                  <button
                    type="button"
                    onClick={() => setDownloadEpisode(ep.episodeNumber)}
                    title={`Download S${seasonNumber}E${ep.episodeNumber}`}
                    className="flex h-9 w-9 items-center justify-center rounded-full border border-pitflix-card/60 text-pitflix-muted shadow transition-all hover:border-pitflix-primary/50 hover:text-white"
                  >
                    <Download className="h-3.5 w-3.5" />
                  </button>
                  <button
                    type="button"
                    title="Mark watched"
                    disabled={markBusyEp === ep.episodeNumber}
                    onClick={() => markEpisodeWatched(ep.episodeNumber)}
                    className="flex h-9 w-9 items-center justify-center rounded-full border border-green-500/40 bg-green-600/20 text-green-300 shadow transition-all hover:bg-green-600/40 disabled:opacity-50"
                  >
                    <Check className="h-3.5 w-3.5" />
                  </button>
                </div>
                ) : (
                  <UpcomingEpisodePanel airDate={ep.airDate} variant="row" />
                )}
              </div>
            );
            })}
          </div>
        )}

        {!isLoading && episodes.length === 0 && (
          <p className="text-sm text-pitflix-muted">No episodes found for this season.</p>
        )}
      </section>

      <WsmDownloadModal
        isOpen={downloadEpisode != null}
        onClose={() => setDownloadEpisode(null)}
        mode="episode"
        tmdbId={tmdbId}
        imdbId={imdbId}
        title={seriesTitle}
        season={seasonNumber}
        episode={downloadEpisode ?? undefined}
        episodeLabel={downloadEpisode != null ? `S${String(seasonNumber).padStart(2, "0")}E${String(downloadEpisode).padStart(2, "0")}` : undefined}
      />
      {menu ? (
        <MediaContextMenu
          label={menu.target.title}
          x={menu.x}
          y={menu.y}
          showRescan={false}
          onAction={(action) => void runAction(action)}
          onClose={closeMenu}
        />
      ) : null}
    </div>
  );
}
