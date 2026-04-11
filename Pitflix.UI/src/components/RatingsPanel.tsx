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

  if (q.isError || !q.data || !hasAnyData(q.data)) return null;

  const r = q.data;
  const chips: { label: string; value: string; tone?: string }[] = [];

  if (r.tmdbVoteAverage != null && r.tmdbVoteAverage > 0) {
    chips.push({
      label: "TMDB",
      value:
        r.tmdbVoteCount != null && r.tmdbVoteCount > 0
          ? `${r.tmdbVoteAverage.toFixed(1)} · ${r.tmdbVoteCount.toLocaleString()} votes`
          : r.tmdbVoteAverage.toFixed(1),
    });
  }
  if (r.imdbRatingDisplay) {
    chips.push({
      label: "IMDb",
      value:
        r.imdbVoteCountDisplay != null
          ? `${r.imdbRatingDisplay} · ${r.imdbVoteCountDisplay}`
          : r.imdbRatingDisplay,
    });
  }
  if (r.rottenTomatoesCritics)
    chips.push({ label: "Tomatometer", value: r.rottenTomatoesCritics, tone: "text-emerald-200/90" });
  if (r.rottenTomatoesAudience)
    chips.push({
      label: "Audience",
      value: r.rottenTomatoesAudience,
      tone: "text-amber-100/90",
    });

  if (chips.length === 0) return null;

  return (
    <div
      className={cn(
        "rounded-xl border border-pitflix-card/60 bg-gradient-to-br from-pitflix-surface to-pitflix-bg/80 px-4 py-3 shadow-inner shadow-black/20",
        className,
      )}
    >
      <div className="flex flex-wrap items-center justify-between gap-2">
        <p className="text-[11px] font-semibold uppercase tracking-wider text-pitflix-muted">Ratings</p>
        <p className="text-[10px] text-pitflix-subtle">
          Updated {new Date(r.fetchedAtUtc).toLocaleString(undefined, { dateStyle: "medium", timeStyle: "short" })}
        </p>
      </div>
      <div className="mt-2 flex flex-wrap gap-2">
        {chips.map((c) => (
          <div
            key={c.label}
            className="min-w-0 rounded-lg border border-white/10 bg-black/20 px-3 py-2"
          >
            <p className="text-[10px] font-medium uppercase tracking-wide text-pitflix-subtle">{c.label}</p>
            <p className={cn("truncate text-sm font-semibold text-white", c.tone)}>{c.value}</p>
          </div>
        ))}
      </div>
    </div>
  );
}
