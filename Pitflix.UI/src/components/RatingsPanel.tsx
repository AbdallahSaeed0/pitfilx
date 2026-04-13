import type { ReactNode } from "react";
import { useQuery } from "@tanstack/react-query";
import { getRatingsAggregate, type RatingsAggregate } from "../api/ratings";
import { cn } from "../utils/cn";

function hasAnyData(r: RatingsAggregate) {
  return (
    r.tmdbVoteAverage != null ||
    (r.imdbRatingDisplay && r.imdbRatingDisplay.trim() !== "") ||
    (r.rottenTomatoesCritics && r.rottenTomatoesCritics.trim() !== "") ||
    (r.rottenTomatoesAudience && r.rottenTomatoesAudience.trim() !== "")
  );
}

function SourceChip({
  brand,
  scoreLine,
  subLine,
  accent,
  barClass,
}: {
  brand: string;
  scoreLine: string;
  subLine?: string | null;
  accent: string;
  barClass: string;
}) {
  return (
    <div
      className={cn(
        "min-w-[min(100%,148px)] flex-1 rounded-xl border border-white/10 bg-black/30 px-3 py-2.5 pl-3.5 shadow-inner shadow-black/30",
        accent,
        barClass,
      )}
    >
      <p className="text-[10px] font-bold uppercase tracking-wider text-pitflix-muted">{brand}</p>
      <p className="mt-1 text-lg font-semibold tabular-nums tracking-tight text-white">{scoreLine}</p>
      {subLine ? <p className="mt-0.5 text-[11px] leading-snug text-pitflix-subtle">{subLine}</p> : null}
    </div>
  );
}

export function RatingsPanel({
  tmdbId,
  mediaType,
  className,
}: {
  tmdbId: number;
  mediaType: "movie" | "tv";
  className?: string;
}) {
  const q = useQuery({
    queryKey: ["ratings-aggregate", tmdbId, mediaType],
    queryFn: () => getRatingsAggregate(tmdbId, mediaType),
    staleTime: 60 * 60_000,
    retry: 1,
  });

  if (!Number.isFinite(tmdbId) || tmdbId <= 0) return null;

  if (q.isLoading) {
    return (
      <div
        className={cn(
          "rounded-xl border border-pitflix-card/60 bg-pitflix-surface/50 px-4 py-3 text-xs text-pitflix-subtle",
          className,
        )}
      >
        Loading ratings…
      </div>
    );
  }

  if (q.isError) return null;

  if (q.isSuccess && q.data && !hasAnyData(q.data)) return null;

  if (!q.data || !hasAnyData(q.data)) return null;

  const r = q.data;
  const chips: ReactNode[] = [];

  if (r.tmdbVoteAverage != null && r.tmdbVoteAverage > 0) {
    chips.push(
      <SourceChip
        key="tmdb"
        brand="TMDB"
        accent="ring-1 ring-sky-500/25"
        barClass="border-l-2 border-sky-400/80"
        scoreLine={r.tmdbVoteAverage.toFixed(1)}
        subLine={
          r.tmdbVoteCount != null && r.tmdbVoteCount > 0
            ? `${r.tmdbVoteCount.toLocaleString()} votes`
            : "Audience score"
        }
      />,
    );
  }

  if (r.imdbRatingDisplay && r.imdbRatingDisplay.trim() !== "") {
    const src =
      r.imdbRatingSource === "php-imdb-detail"
        ? "IMDb · php-imdb-detail"
        : r.imdbRatingSource === "omdb"
          ? "IMDb · OMDb"
          : "IMDb";
    chips.push(
      <SourceChip
        key="imdb"
        brand={src}
        accent="ring-1 ring-amber-500/20"
        barClass="border-l-2 border-amber-400/75"
        scoreLine={`${r.imdbRatingDisplay}/10`}
        subLine={r.imdbVoteCountDisplay ?? undefined}
      />,
    );
  }

  if (r.rottenTomatoesCritics && r.rottenTomatoesCritics.trim() !== "") {
    chips.push(
      <SourceChip
        key="rt"
        brand="Rotten Tomatoes"
        accent="ring-1 ring-emerald-500/25"
        barClass="border-l-2 border-emerald-400/70"
        scoreLine={r.rottenTomatoesCritics}
        subLine="Tomatometer"
      />,
    );
  }

  if (r.rottenTomatoesAudience && r.rottenTomatoesAudience.trim() !== "") {
    chips.push(
      <SourceChip
        key="aud"
        brand="Audience"
        accent="ring-1 ring-violet-500/20"
        barClass="border-l-2 border-violet-400/70"
        scoreLine={r.rottenTomatoesAudience}
        subLine="Verified audience"
      />,
    );
  }

  if (chips.length === 0) return null;

  return (
    <div
      className={cn(
        "rounded-xl border border-white/10 bg-gradient-to-br from-zinc-900/60 via-pitflix-bg to-pitflix-bg px-4 py-3.5 shadow-lg shadow-black/30",
        className,
      )}
    >
      <div className="flex flex-wrap items-end justify-between gap-2 border-b border-white/5 pb-2.5">
        <div>
          <p className="text-[11px] font-semibold uppercase tracking-wider text-pitflix-muted">Ratings</p>
          <p className="text-[10px] text-pitflix-subtle">Aggregated from multiple providers</p>
        </div>
        <p className="shrink-0 text-[10px] tabular-nums text-pitflix-subtle">
          Updated {new Date(r.fetchedAtUtc).toLocaleString(undefined, { dateStyle: "medium", timeStyle: "short" })}
        </p>
      </div>
      <div
        className={cn(
          "mt-3 max-w-full overflow-x-auto overflow-y-visible pb-1",
          "[scrollbar-color:rgba(139,92,246,0.4)_rgba(15,15,20,0.85)] [scrollbar-width:thin]",
          "[&::-webkit-scrollbar]:h-2 [&::-webkit-scrollbar-thumb]:rounded-full [&::-webkit-scrollbar-thumb]:bg-violet-500/40",
          "[&::-webkit-scrollbar-thumb]:hover:bg-violet-400/50 [&::-webkit-scrollbar-track]:rounded-full [&::-webkit-scrollbar-track]:bg-black/45",
        )}
      >
        <div className="flex w-max flex-nowrap gap-2.5">{chips}</div>
      </div>
    </div>
  );
}
