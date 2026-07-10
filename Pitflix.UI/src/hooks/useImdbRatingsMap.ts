import { useQuery } from "@tanstack/react-query";
import { useMemo } from "react";
import { getBatchCachedRatings } from "../api/people";

export function imdbRatingKey(tmdbId: number, mediaType: "Movie" | "Series"): string {
  return `${mediaType === "Movie" ? "movie" : "tv"}:${tmdbId}`;
}

/** Batch-fetch IMDb ratings for library cards; queues enrichment for titles still missing scores. */
export function useImdbRatingsMap(
  items: { tmdbId: number; mediaType: "Movie" | "Series" }[],
) {
  const batchIds = useMemo(
    () => [...new Set(items.filter((i) => i.tmdbId > 0).map((i) => imdbRatingKey(i.tmdbId, i.mediaType)))],
    [items],
  );

  const q = useQuery({
    queryKey: ["imdb-ratings-batch", batchIds.join("|")],
    queryFn: () => getBatchCachedRatings(batchIds, true),
    enabled: batchIds.length > 0,
    staleTime: 30 * 60_000,
    gcTime: 60 * 60_000,
    refetchInterval: (query) => {
      const rows = query.state.data ?? [];
      if (batchIds.length === 0) return false;
      const haveAll = batchIds.every((id) => {
        const row = rows.find((r) => r.key === id);
        const parsed = row?.imdbRating != null ? parseFloat(row.imdbRating) : NaN;
        return !Number.isNaN(parsed) && parsed > 0;
      });
      return haveAll ? false : 8000;
    },
  });

  const map = useMemo(() => {
    const out = new Map<string, number>();
    for (const row of q.data ?? []) {
      const parsed = row.imdbRating != null ? parseFloat(row.imdbRating) : NaN;
      if (!Number.isNaN(parsed) && parsed > 0) out.set(row.key, parsed);
    }
    return out;
  }, [q.data]);

  return map;
}

export function lookupImdbRating(
  map: Map<string, number>,
  tmdbId: number,
  mediaType: "Movie" | "Series",
): number | null {
  const v = map.get(imdbRatingKey(tmdbId, mediaType));
  return v != null && v > 0 ? v : null;
}
