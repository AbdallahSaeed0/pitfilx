import { useQuery } from "@tanstack/react-query";
import { ChevronRight, CirclePlay, Play } from "lucide-react";
import { useState } from "react";
import { Link } from "react-router-dom";
import { getLatestTrailers, type TrailerCard } from "../../api/homeDiscover";
import { TrailerModal } from "../../components/trailers/TrailerModal";
import { MediaImage } from "../../components/ui/MediaImage";
import { Spinner } from "../../components/ui/Spinner";

type LatestTrailersProps = { embedded?: boolean };

export function LatestTrailersSection({ embedded = false }: LatestTrailersProps) {
  const [active, setActive] = useState<TrailerCard | null>(null);
  const q = useQuery({
    queryKey: ["home-trailers"],
    queryFn: getLatestTrailers,
    staleTime: 180_000,
  });

  if (q.isLoading)
    return (
      <div className={embedded ? "py-2" : "rounded-2xl border border-pitflix-card/40 bg-pitflix-surface/30 p-6"}>
        <div className="flex items-center gap-2 text-sm text-pitflix-subtle">
          <Spinner className="h-5 w-5" /> Fetching trailers…
        </div>
      </div>
    );

  if (q.isError)
    return (
      <div
        className={
          embedded ? "py-2 text-sm text-rose-100/90" : "rounded-2xl border border-rose-500/30 bg-rose-950/20 p-6 text-sm text-rose-100/90"
        }
      >
        Could not load trailers.
      </div>
    );

  const list = q.data ?? [];
  if (list.length === 0) {
    return (
      <div
        className={
          embedded
            ? "py-2 text-sm text-pitflix-subtle"
            : "rounded-2xl border border-dashed border-pitflix-card/50 bg-pitflix-bg/40 p-6 text-sm text-pitflix-subtle"
        }
      >
        No upcoming trending trailers right now — check back after TMDB updates.
      </div>
    );
  }

  return (
    <div
      className={
        embedded ? "" : "rounded-2xl border border-pitflix-card/40 bg-gradient-to-b from-pitflix-surface/40 to-pitflix-bg/20 p-6"
      }
    >
      {embedded ? null : (
        <div className="mb-4 flex flex-wrap items-center gap-2">
          <Play className="h-5 w-5 shrink-0 text-pitflix-primary" />
          <h2 className="text-lg font-bold text-white">Upcoming trailers</h2>
          <span className="text-xs text-pitflix-subtle">Trending upcoming movies &amp; series · in-app player</span>
          <Link
            to="/trailers?mode=all-upcoming"
            className="ml-auto inline-flex items-center gap-1 text-xs font-semibold text-pitflix-primary hover:underline"
          >
            Browse all
            <ChevronRight className="h-3.5 w-3.5" />
          </Link>
        </div>
      )}
      <div className="flex gap-3 overflow-x-auto pb-2">
        {list.map((t) => {
          // Trailer row should look like trailer media, not wallpaper.
          const youtubeThumb = `https://img.youtube.com/vi/${t.youtubeKey}/hqdefault.jpg`;
          const thumb = youtubeThumb || t.posterUrl || t.backdropUrl;
          return (
            <button
              key={`${t.mediaType}-${t.tmdbId}-${t.youtubeKey}`}
              type="button"
              onClick={() => setActive(t)}
              className="group relative w-[200px] shrink-0 overflow-hidden rounded-xl border border-pitflix-card/60 bg-black/40 text-left shadow-lg transition-colors hover:border-pitflix-primary/40"
            >
              <MediaImage src={thumb} alt="" className="aspect-video w-full object-cover" fallbackText="▶" />
              <div className="absolute inset-0 flex items-center justify-center bg-black/35 opacity-90 transition-opacity group-hover:bg-black/50">
                <CirclePlay className="h-8 w-8 text-white drop-shadow-lg" />
              </div>
              <div className="space-y-0.5 p-2">
                <p className="line-clamp-2 text-xs font-semibold text-white">{t.title}</p>
                <p className="line-clamp-1 text-[10px] text-pitflix-subtle">{t.trailerTitle}</p>
              </div>
            </button>
          );
        })}
      </div>
      <TrailerModal open={!!active} onClose={() => setActive(null)} trailer={active} />
    </div>
  );
}
