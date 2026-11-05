import { useQuery } from "@tanstack/react-query";
import { getSeasonRatings } from "../../api/ratings";
import { ImdbRatingBadge } from "../../components/ui/ImdbRatingBadge";
import { cn } from "../../utils/cn";
import { formatRating } from "../../utils/format";

const chip = "inline-flex items-center gap-1.5 rounded-lg border border-white/10 bg-pitflix-card/70 px-2.5 py-1 text-xs font-semibold text-white";

/** Metacritic's own bands: 61+ green, 40-60 yellow, below red. */
function metascoreClass(score: number): string {
  if (score >= 61) return "bg-[#00ce7a] text-black";
  if (score >= 40) return "bg-[#ffbd3f] text-black";
  return "bg-[#ff6874] text-black";
}

/**
 * This season's own scores — TMDB, IMDb, Rotten Tomatoes (critics + audience) and Metacritic — on
 * the season page. Separate request from the season data (GET /api/ratings/season), so a season
 * whose RT/Metacritic pages haven't been read yet never holds up the page; it fills in after.
 */
export function SeasonRatingsRow({ tvTmdbId, season }: { tvTmdbId: number; season: number }) {
  const q = useQuery({
    queryKey: ["season-ratings", tvTmdbId, season],
    queryFn: () => getSeasonRatings(tvTmdbId, season),
    enabled: tvTmdbId > 0 && season > 0,
    staleTime: 6 * 60 * 60_000,
  });

  if (q.isPending) {
    return (
      <div className="mt-3 flex gap-2" aria-hidden>
        {[0, 1, 2].map((i) => (
          <span key={i} className="h-7 w-20 animate-pulse rounded-lg bg-white/[0.06]" />
        ))}
      </div>
    );
  }
  const r = q.data;
  if (!r) return null;
  const has = (v: number | null | undefined): v is number => v != null && v > 0;
  if (![r.tmdb, r.imdb, r.rottenTomatoes, r.rottenTomatoesAudience, r.metacritic].some(has)) return null;

  return (
    <div className="mt-3 flex flex-wrap items-center gap-2" aria-label="Season ratings">
      {has(r.tmdb) ? (
        <span className={chip} title="TMDB season rating">
          <span className="text-[#01b4e4]">TMDB</span>
          <span>★ {formatRating(r.tmdb)}</span>
        </span>
      ) : null}
      {has(r.imdb) ? (
        <span className={chip} title="IMDb — average of this season's episodes">
          <ImdbRatingBadge value={r.imdb} size="xs" />
        </span>
      ) : null}
      {has(r.rottenTomatoes) ? (
        <span className={chip} title="Rotten Tomatoes — Tomatometer (critics)">
          {/* Fresh (60%+) in colour, "rotten" greyed out. */}
          <span aria-hidden className={r.rottenTomatoes >= 60 ? undefined : "grayscale"}>🍅</span>
          <span>{r.rottenTomatoes}%</span>
          <span className="font-medium text-pitflix-muted">critics</span>
        </span>
      ) : null}
      {has(r.rottenTomatoesAudience) ? (
        <span className={chip} title="Rotten Tomatoes — Popcornmeter (audience)">
          <span aria-hidden>🍿</span>
          <span>{r.rottenTomatoesAudience}%</span>
          <span className="font-medium text-pitflix-muted">audience</span>
        </span>
      ) : null}
      {has(r.metacritic) ? (
        <span className={chip} title="Metacritic — Metascore">
          <span className={cn("rounded px-1 text-[11px] font-bold", metascoreClass(r.metacritic))}>{r.metacritic}</span>
          <span className="font-medium text-pitflix-muted">Metacritic</span>
        </span>
      ) : null}
    </div>
  );
}
