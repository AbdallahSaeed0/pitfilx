import { useQuery } from "@tanstack/react-query";
import { ExternalLink, Sparkles } from "lucide-react";
import { Link } from "react-router-dom";
import type { AwardEdition, AwardNominee } from "../../api/awards";
import { fetchRecommendations } from "../../api/recommendations";
import type { LibraryTmdbIndex } from "../../hooks/useLibraryTmdbIndex";
import { nomineeMediaKind } from "../../utils/awardNomineeMedia";
import { formatRating } from "../../utils/format";
import { toPosterSrc } from "../../utils/posterSrc";
import { HorizontalDragScroll } from "../ui/HorizontalDragScroll";
import { MediaImage } from "../ui/MediaImage";
import { Spinner } from "../ui/Spinner";

function pickSpotlightWinner(edition: AwardEdition): AwardNominee | null {
  const winners: { nominee: AwardNominee; categoryName: string }[] = [];
  for (const c of edition.categories) {
    for (const n of c.nominees) {
      if (n.winner && n.tmdbId && n.tmdbId > 0) winners.push({ nominee: n, categoryName: c.name });
    }
  }
  const picture = winners.find((w) => /\bpicture\b/i.test(w.categoryName));
  return (picture ?? winners[0])?.nominee ?? null;
}

export type AwardWinnerRecommendationsProps = {
  edition: AwardEdition;
  library: LibraryTmdbIndex | null | undefined;
};

export function AwardWinnerRecommendations({ edition, library }: AwardWinnerRecommendationsProps) {
  const spotlight = pickSpotlightWinner(edition);
  const kind = spotlight ? nomineeMediaKind(spotlight.mediaType) : "movie";

  const recQ = useQuery({
    queryKey: ["award-edition-recs", edition.awardId, edition.year, spotlight?.tmdbId],
    queryFn: async () => {
      const res = await fetchRecommendations({
        tmdbId: spotlight!.tmdbId!,
        mediaType: kind === "tv" ? "tv" : "movie",
        filter: "both",
      });
      if (res.status >= 400 || (res.data.error && res.data.error.length > 0)) {
        throw new Error(res.data.error || `Request failed (${res.status})`);
      }
      return res.data.items ?? [];
    },
    enabled: !!spotlight?.tmdbId && spotlight.tmdbId > 0,
    staleTime: 600_000,
  });

  if (!spotlight?.tmdbId) return null;

  const items = recQ.data ?? [];
  const hrefForTmdb = (tmdbId: number, mediaType: string) => {
    const mt = mediaType === "tv" ? "tv" : "movie";
    if (mt === "movie") {
      const lid = library?.movieByTmdb.get(tmdbId);
      return lid != null ? `/movie/${lid}` : null;
    }
    const lid = library?.seriesByTmdb.get(tmdbId);
    return lid != null ? `/series/${lid}` : null;
  };

  return (
    <section className="mt-10 border-t border-white/[0.06] pt-8">
      <div className="mb-4 flex flex-wrap items-center gap-2">
        <Sparkles className="h-5 w-5 text-pitflix-primary" aria-hidden />
        <h2 className="text-lg font-semibold text-white">If you liked this winner…</h2>
      </div>
      <p className="mb-4 max-w-2xl text-sm text-pitflix-muted">
        Because you&apos;re viewing{" "}
        <span className="font-medium text-white">{spotlight.title}</span>, here are TMDB-powered picks in a similar
        vein (same engine as Recommendations).
      </p>

      {recQ.isLoading ? (
        <div className="flex justify-center py-10">
          <Spinner />
        </div>
      ) : recQ.isError ? (
        <p className="text-sm text-rose-200/90">Could not load suggestions right now.</p>
      ) : items.length === 0 ? (
        <p className="text-sm text-pitflix-muted">No similar titles returned for this winner yet.</p>
      ) : (
        <HorizontalDragScroll className="flex gap-4 pb-2">
          {items.map((item) => {
            const internal = hrefForTmdb(item.tmdbId, item.mediaType);
            const poster = toPosterSrc(item.posterUrl ?? undefined);
            const meta = (
              <div className="shrink-0">
                <div className="relative w-[140px] overflow-hidden rounded-lg border border-white/10 bg-pitflix-card shadow-md">
                  <MediaImage
                    src={poster}
                    alt=""
                    className="aspect-[2/3] w-full object-cover"
                    fallbackText={item.title.slice(0, 2)}
                  />
                  <span className="pointer-events-none absolute left-2 top-2 rounded bg-black/80 px-1.5 py-0.5 text-[10px] font-bold text-amber-200">
                    ★ {formatRating(item.voteAverage)}
                  </span>
                </div>
                <p className="mt-2 line-clamp-2 w-[140px] text-xs font-semibold text-white">{item.title}</p>
                <p className="text-[10px] text-pitflix-muted">
                  {item.year ?? "—"} · {item.mediaType === "tv" ? "Series" : "Movie"}
                </p>
              </div>
            );

            return internal ? (
              <Link key={`${item.mediaType}-${item.tmdbId}`} to={internal} className="group shrink-0">
                {meta}
              </Link>
            ) : (
              <a
                key={`${item.mediaType}-${item.tmdbId}`}
                href={`https://www.themoviedb.org/${item.mediaType}/${item.tmdbId}`}
                target="_blank"
                rel="noreferrer"
                className="group shrink-0"
              >
                {meta}
                <p className="mt-1 flex items-center gap-1 text-[10px] text-pitflix-muted">
                  TMDB <ExternalLink className="h-3 w-3 opacity-70" />
                </p>
              </a>
            );
          })}
        </HorizontalDragScroll>
      )}
    </section>
  );
}
