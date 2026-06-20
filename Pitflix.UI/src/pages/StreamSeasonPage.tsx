import { useQuery } from "@tanstack/react-query";
import { Play } from "lucide-react";
import { useLocation, useNavigate } from "react-router-dom";
import { getStreamSeasonEpisodes } from "../api/stream";
import { MediaImage } from "../components/ui/MediaImage";
import { Spinner } from "../components/ui/Spinner";
import { corsFlixTvUrl, streamTvEmbedUrl } from "../features/streaming/streamEmbedUrls";

export type StreamSeasonLocationState = {
  tmdbId: number;
  seasonNumber: number;
  seriesTitle: string;
  imdbId?: string | null;
  provider?: "streamimdb" | "corsflix";
};

export function StreamSeasonPage() {
  const navigate = useNavigate();
  const location = useLocation();
  const state = location.state as StreamSeasonLocationState | null;

  const tmdbId = state?.tmdbId ?? 0;
  const seasonNumber = state?.seasonNumber ?? 0;
  const seriesTitle = state?.seriesTitle ?? "Series";
  const imdbId = state?.imdbId ?? null;
  const provider = state?.provider ?? "streamimdb";

  const { data, isLoading } = useQuery({
    queryKey: ["stream-season", tmdbId, seasonNumber],
    queryFn: () => getStreamSeasonEpisodes(tmdbId, seasonNumber),
    enabled: tmdbId > 0 && seasonNumber > 0,
    staleTime: 10 * 60 * 1000,
  });

  function playEpisode(episode: number) {
    if (provider === "corsflix") {
      navigate("/stream-player", {
        state: {
          streamUrl: corsFlixTvUrl(tmdbId, seasonNumber, episode),
          title: `${seriesTitle} · S${seasonNumber}E${episode}`,
          libraryWatchMeta: { tmdbId, mediaType: "Series" as const, season: seasonNumber, episode },
        },
      });
    } else {
      if (!imdbId) return;
      navigate("/stream-player", {
        state: {
          streamUrl: streamTvEmbedUrl(imdbId, seasonNumber, episode),
          title: `${seriesTitle} · S${seasonNumber}E${episode}`,
          libraryWatchMeta: { tmdbId, mediaType: "Series" as const, season: seasonNumber, episode },
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

  return (
    <div className="pb-16">
      <button
        type="button"
        onClick={() => navigate(-1)}
        className="mb-4 inline-flex items-center gap-1 rounded-lg px-2 py-1.5 text-sm font-medium text-white hover:bg-white/10"
      >
        ← Back
      </button>

      <div className="mb-6">
        <p className="text-xs font-semibold uppercase tracking-wide text-pitflix-muted">{seriesTitle}</p>
        <h1 className="mt-1 text-2xl font-bold text-white">
          {data?.seasonName ?? `Season ${seasonNumber}`}
        </h1>
        {data?.seasonOverview && (
          <p className="mt-2 max-w-2xl text-sm leading-relaxed text-white/70">{data.seasonOverview}</p>
        )}
        {provider === "streamimdb" && !imdbId && (
          <p className="mt-2 text-xs text-amber-400/90">
            IMDb ID unavailable — playback via StreamIMDB may not work. CorsFlix does not need it.
          </p>
        )}
      </div>

      {isLoading && (
        <div className="flex justify-center py-16">
          <Spinner />
        </div>
      )}

      {!isLoading && data?.episodes && data.episodes.length > 0 && (
        <div className="space-y-3">
          {data.episodes.map((ep) => {
            const canPlay = provider === "corsflix" || !!imdbId;
            return (
              <div
                key={ep.episodeNumber}
                className="flex gap-4 rounded-xl border border-white/[0.06] bg-pitflix-surface/50 p-3 transition-colors hover:border-white/10 hover:bg-pitflix-surface/75"
              >
                {/* Thumbnail */}
                <div className="h-[72px] w-[128px] shrink-0 overflow-hidden rounded-lg bg-pitflix-card/60">
                  <MediaImage
                    src={ep.stillUrl}
                    alt={ep.title}
                    className="h-full w-full object-cover"
                    fallbackText={`E${ep.episodeNumber}`}
                  />
                </div>

                {/* Info */}
                <div className="flex min-w-0 flex-1 flex-col gap-1 py-0.5">
                  <div className="flex items-start justify-between gap-2">
                    <div className="min-w-0">
                      <p className="text-[10px] font-semibold uppercase tracking-wide text-pitflix-muted">
                        Episode {ep.episodeNumber}
                        {ep.runtime > 0 && ` · ${ep.runtime}m`}
                        {ep.airDate && ` · ${ep.airDate.slice(0, 4)}`}
                      </p>
                      <p className="truncate text-sm font-semibold text-white">{ep.title}</p>
                    </div>
                    {ep.voteAverage > 0 && (
                      <span className="shrink-0 text-xs text-amber-400">
                        ★ {ep.voteAverage.toFixed(1)}
                      </span>
                    )}
                  </div>
                  {ep.overview && (
                    <p className="line-clamp-2 text-[11px] leading-snug text-pitflix-muted">{ep.overview}</p>
                  )}
                </div>

                {/* Play button */}
                <div className="flex shrink-0 items-center">
                  <button
                    type="button"
                    disabled={!canPlay}
                    onClick={() => playEpisode(ep.episodeNumber)}
                    title={canPlay ? `Play S${seasonNumber}E${ep.episodeNumber}` : "IMDb ID required for StreamIMDB"}
                    className="flex h-10 w-10 items-center justify-center rounded-full bg-pitflix-primary text-white shadow transition-all hover:bg-pitflix-light disabled:cursor-not-allowed disabled:opacity-40"
                  >
                    <Play className="h-4 w-4" />
                  </button>
                </div>
              </div>
            );
          })}
        </div>
      )}

      {!isLoading && (!data?.episodes || data.episodes.length === 0) && (
        <p className="text-sm text-pitflix-muted">No episodes found for this season.</p>
      )}
    </div>
  );
}
