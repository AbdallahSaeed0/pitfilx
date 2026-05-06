import { useQuery } from "@tanstack/react-query";
import { getMovies } from "../api/movies";
import { getAllSeries } from "../api/series";
import type { MediaCard } from "../types/media";

export type LibraryTmdbIndex = {
  movieByTmdb: Map<number, number>;
  seriesByTmdb: Map<number, number>;
  watchedMovieTmdb: Set<number>;
  watchedSeriesTmdb: Set<number>;
};

async function fetchAllPages(
  fetchPage: (page: number) => Promise<{ items?: MediaCard[]; totalPages?: number }>,
): Promise<MediaCard[]> {
  const first = await fetchPage(1);
  const items = [...(first.items ?? [])];
  const totalPages = Math.max(1, first.totalPages ?? 1);
  for (let p = 2; p <= totalPages; p++) {
    const next = await fetchPage(p);
    items.push(...(next.items ?? []));
  }
  return items;
}

export function useLibraryTmdbIndex() {
  return useQuery({
    queryKey: ["library-tmdb-index"],
    queryFn: async (): Promise<LibraryTmdbIndex> => {
      const [movies, series] = await Promise.all([
        fetchAllPages((page) => getMovies({ page, pageSize: 400 })),
        fetchAllPages((page) => getAllSeries({ page, pageSize: 400 })),
      ]);

      const movieByTmdb = new Map<number, number>();
      const seriesByTmdb = new Map<number, number>();
      const watchedMovieTmdb = new Set<number>();
      const watchedSeriesTmdb = new Set<number>();

      for (const m of movies) {
        if (m.tmdbId > 0) movieByTmdb.set(m.tmdbId, m.id);
        if (m.tmdbId > 0 && m.watchStatus === "Completed") watchedMovieTmdb.add(m.tmdbId);
      }
      for (const s of series) {
        if (s.tmdbId > 0) seriesByTmdb.set(s.tmdbId, s.id);
        if (s.tmdbId > 0 && s.watchStatus === "Completed") watchedSeriesTmdb.add(s.tmdbId);
      }

      return { movieByTmdb, seriesByTmdb, watchedMovieTmdb, watchedSeriesTmdb };
    },
    staleTime: 120_000,
    gcTime: 600_000,
  });
}
