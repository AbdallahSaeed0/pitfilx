import type { ReactNode } from "react";
import { useQuery } from "@tanstack/react-query";
import { loadRatingsPanelData } from "../api/ratings";
import { getMdblistRatings } from "../api/mdblist";
import { cn } from "../utils/cn";

function BrandLabel({ brand }: { brand: string }) {
  if (brand === "IMDb")
    return (
      <span className="inline-flex items-center rounded px-1 py-0.5 text-[8px] font-black leading-none tracking-tight bg-[#F5C518] text-black">
        IMDb
      </span>
    );
  if (brand === "Rotten Tomatoes")
    return <><span>🍅</span><span>Rotten Tomatoes</span></>;
  if (brand === "Metacritic")
    return <><span>🎯</span><span>Metacritic</span></>;
  if (brand === "Letterboxd")
    return <><span>🎞️</span><span>Letterboxd</span></>;
  if (brand === "Trakt")
    return <><span>📊</span><span>Trakt</span></>;
  return <><span>⭐</span><span>{brand}</span></>;
}

function SourceChip({
  brand,
  scoreLine,
  subLine,
  accent,
  barClass,
  thumbnailSrc,
}: {
  brand: string;
  scoreLine: string;
  subLine?: string | null;
  accent: string;
  barClass: string;
  thumbnailSrc?: string;
}) {
  return (
    <div
      className={cn(
        "relative min-w-[min(100%,148px)] flex-1 overflow-hidden rounded-xl border border-white/10 bg-black/30 px-3 py-2.5 pl-3.5 shadow-inner shadow-black/30",
        accent,
        barClass,
      )}
    >
      {thumbnailSrc && (
        <img
          src={thumbnailSrc}
          alt=""
          className="absolute inset-0 h-full w-full object-cover opacity-10"
          aria-hidden
        />
      )}
      <div className="relative z-[1]">
        <p className="flex items-center gap-1 text-[10px] font-bold uppercase tracking-wider text-pitflix-muted">
          <BrandLabel brand={brand} />
        </p>
        <p className="mt-1 text-lg font-semibold tabular-nums tracking-tight text-white">{scoreLine}</p>
        {subLine ? <p className="mt-0.5 text-[11px] leading-snug text-pitflix-subtle">{subLine}</p> : null}
      </div>
    </div>
  );
}

export type RatingSource = {
  key: "tmdb" | "imdb" | "rt" | "rt-audience" | "mc" | "lb";
  /** Short brand label ("IMDb", "RT", …). */
  label: string;
  /** Long label for lists and strips ("Rotten Tomatoes", "Audience", …). */
  longLabel: string;
  score: string;
  sub: string | null;
  /** Brand colour for the label text. */
  color: string;
};

/**
 * The same sources RatingsPanel draws, as plain data — for compact chips / strips in the
 * alternative detail layouts. Shares RatingsPanel's query keys, so both read one cache entry.
 */
export function useRatingSources(tmdbId: number, mediaType: "movie" | "tv") {
  const q = useQuery({
    queryKey: ["ratings-display", tmdbId, mediaType],
    queryFn: () => loadRatingsPanelData(tmdbId, mediaType),
    enabled: Number.isFinite(tmdbId) && tmdbId > 0,
    staleTime: 30 * 60_000,
    gcTime: 60 * 60_000,
    retry: 1,
  });
  const imdbId = q.data?.imdbId ?? null;
  const mdbQ = useQuery({
    queryKey: ["mdblist-ratings", tmdbId, imdbId, mediaType],
    queryFn: () => getMdblistRatings(tmdbId, imdbId),
    enabled: tmdbId > 0 && (q.isSuccess || q.isError),
    staleTime: 1000 * 60 * 60 * 24,
    retry: false,
  });

  const r = q.data;
  const mdb = mdbQ.data ?? null;
  const sources: RatingSource[] = [];
  if (mdb?.imdbScore != null && mdb.imdbScore > 0)
    sources.push({
      key: "imdb",
      label: "IMDb",
      longLabel: "IMDb",
      score: mdb.imdbScore.toFixed(1),
      sub: mdb.imdbVotes != null ? `${mdb.imdbVotes.toLocaleString()} votes` : null,
      color: "#f5c518",
    });
  if (mdb?.rottenTomatoesScore != null)
    sources.push({
      key: "rt",
      label: "RT",
      longLabel: "Rotten Tomatoes",
      score: `${Math.round(mdb.rottenTomatoesScore)}%`,
      sub: "Tomatometer",
      color: "#fa6450",
    });
  if (mdb?.rottenTomatoesAudience != null)
    sources.push({
      key: "rt-audience",
      label: "Audience",
      longLabel: "Audience",
      score: `${Math.round(mdb.rottenTomatoesAudience)}%`,
      sub: "Audience score",
      color: "#fb923c",
    });
  if (mdb?.metacriticScore != null)
    sources.push({
      key: "mc",
      label: "MC",
      longLabel: "Metacritic",
      score: `${Math.round(mdb.metacriticScore)}`,
      sub: "Metascore",
      color: "#86d35b",
    });
  if (mediaType === "movie" && mdb?.letterboxdScore != null)
    sources.push({
      key: "lb",
      label: "Letterboxd",
      longLabel: "Letterboxd",
      score: mdb.letterboxdScore.toFixed(1),
      sub: "out of 5",
      color: "#ff8000",
    });
  if (r?.tmdbVoteAverage != null && r.tmdbVoteAverage > 0)
    sources.push({
      key: "tmdb",
      label: "TMDB",
      longLabel: "TMDB",
      score: r.tmdbVoteAverage.toFixed(1),
      sub: r.tmdbVoteCount != null && r.tmdbVoteCount > 0 ? `${r.tmdbVoteCount.toLocaleString()} votes` : null,
      color: "#60c5e8",
    });

  return {
    sources,
    fetchedAtUtc: r?.fetchedAtUtc ?? null,
    loading: !(q.isSuccess || q.isError) || (mdbQ.isFetching && !mdbQ.data),
  };
}

export function RatingsPanel({
  tmdbId,
  mediaType,
  className,
  thumbnailSrc,
}: {
  tmdbId: number;
  mediaType: "movie" | "tv";
  className?: string;
  thumbnailSrc?: string;
}) {
  // Primary ratings — needed for TMDB score and imdbId (used to key MDBList lookup)
  const q = useQuery({
    queryKey: ["ratings-display", tmdbId, mediaType],
    queryFn: () => loadRatingsPanelData(tmdbId, mediaType),
    staleTime: 30 * 60_000,
    gcTime: 60 * 60_000,
    retry: 1,
  });

  const imdbId = q.data?.imdbId ?? null;
  const mdbQ = useQuery({
    queryKey: ["mdblist-ratings", tmdbId, imdbId, mediaType],
    queryFn: () => getMdblistRatings(tmdbId, imdbId),
    enabled: tmdbId > 0 && (q.isSuccess || q.isError),
    staleTime: 1000 * 60 * 60 * 24,
    retry: false,
  });

  if (!Number.isFinite(tmdbId) || tmdbId <= 0) return null;

  const bothSettled = (q.isSuccess || q.isError) && (mdbQ.isSuccess || mdbQ.isError || !mdbQ.isFetching);
  const tmdbReady = q.isSuccess && q.data;

  if (!bothSettled && !tmdbReady) {
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

  const r = q.data;
  const mdb = mdbQ.data ?? null;

  const chips: ReactNode[] = [];

  // ── TMDB ──────────────────────────────────────────────────────────────────
  if (r?.tmdbVoteAverage != null && r.tmdbVoteAverage > 0) {
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
            : "TMDB score"
        }
        thumbnailSrc={thumbnailSrc}
      />,
    );
  }

  // ── All remaining chips from MDBList ──────────────────────────────────────
  if (mdb) {
    // MDBList reports 0 for titles IMDb hasn't rated yet — hide the card rather than show "0.0/10".
    if (mdb.imdbScore != null && mdb.imdbScore > 0)
      chips.push(
        <SourceChip
          key="imdb"
          brand="IMDb"
          accent="ring-1 ring-amber-500/20"
          barClass="border-l-2 border-amber-400/75"
          scoreLine={`${mdb.imdbScore.toFixed(1)}/10`}
          subLine={mdb.imdbVotes != null ? `${mdb.imdbVotes.toLocaleString()} votes` : null}
          thumbnailSrc={thumbnailSrc}
        />,
      );

    if (mdb.rottenTomatoesScore != null)
      chips.push(
        <SourceChip
          key="rt"
          brand="Rotten Tomatoes"
          accent="ring-1 ring-red-500/20"
          barClass="border-l-2 border-red-500/70"
          scoreLine={`${Math.round(mdb.rottenTomatoesScore)}%`}
          subLine="Tomatometer"
          thumbnailSrc={thumbnailSrc}
        />,
      );

    if (mdb.rottenTomatoesAudience != null)
      chips.push(
        <SourceChip
          key="rt-audience"
          brand="Rotten Tomatoes"
          accent="ring-1 ring-orange-500/20"
          barClass="border-l-2 border-orange-400/70"
          scoreLine={`${Math.round(mdb.rottenTomatoesAudience)}%`}
          subLine="Audience Score"
          thumbnailSrc={thumbnailSrc}
        />,
      );

    if (mdb.metacriticScore != null)
      chips.push(
        <SourceChip
          key="mc"
          brand="Metacritic"
          accent="ring-1 ring-yellow-500/20"
          barClass="border-l-2 border-yellow-400/70"
          scoreLine={`${Math.round(mdb.metacriticScore)}/100`}
          subLine={null}
          thumbnailSrc={thumbnailSrc}
        />,
      );

    if (mediaType === "movie" && mdb.letterboxdScore != null)
      chips.push(
        <SourceChip
          key="lb"
          brand="Letterboxd"
          accent="ring-1 ring-green-500/20"
          barClass="border-l-2 border-green-500/60"
          scoreLine={`${mdb.letterboxdScore.toFixed(1)}/5`}
          subLine={null}
          thumbnailSrc={thumbnailSrc}
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
        <div className="min-w-0">
          <p className="text-[11px] font-semibold uppercase tracking-wider text-pitflix-muted">Ratings</p>
          <p className="text-[10px] text-pitflix-subtle">TMDB · IMDb · Rotten Tomatoes · Metacritic · Letterboxd</p>
        </div>
        {r?.fetchedAtUtc && (
          <p className="shrink-0 text-[10px] tabular-nums text-pitflix-subtle">
            Updated {new Date(r.fetchedAtUtc).toLocaleString(undefined, { dateStyle: "medium", timeStyle: "short" })}
          </p>
        )}
      </div>
      <div className="mt-3 flex flex-wrap gap-2.5">{chips}</div>
    </div>
  );
}
