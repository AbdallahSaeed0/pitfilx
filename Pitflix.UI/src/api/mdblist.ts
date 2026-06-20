import api from "./client";

export type MdbListRatings = {
  imdbScore: number | null;
  imdbVotes: number | null;
  rottenTomatoesScore: number | null;
  rottenTomatoesAudience: number | null;
  metacriticScore: number | null;
  letterboxdScore: number | null;
  traktScore: number | null;
  rogerEbertScore: number | null;
};

export const getMdblistRatings = (tmdbId: number, imdbId?: string | null) =>
  api
    .get<MdbListRatings>("/ratings/mdblist", {
      params: {
        tmdbId,
        ...(imdbId ? { imdbId } : {}),
      },
      validateStatus: (s) => s === 200 || s === 404 || s === 503,
    })
    .then((r) => (r.status === 200 ? r.data : null));
