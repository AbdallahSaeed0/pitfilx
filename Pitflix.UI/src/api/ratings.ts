import api from "./client";

export type RatingsAggregate = {
  fetchedAtUtc: string;
  tmdbVoteAverage: number | null;
  tmdbVoteCount: number | null;
  imdbId: string | null;
  imdbRatingDisplay: string | null;
  imdbVoteCountDisplay: string | null;
  /** e.g. php-imdb-detail, omdb */
  imdbRatingSource?: string | null;
  rottenTomatoesCritics: string | null;
  rottenTomatoesAudience: string | null;
  omdbResolvedVia?: string | null;
  omdbMatchKind?: string | null;
};

export const getRatingsAggregate = (tmdbId: number, mediaType: "movie" | "tv") =>
  api
    .get<RatingsAggregate>("/ratings/aggregate", { params: { tmdbId, mediaType } })
    .then((r) => r.data);

export type EpisodeRating = { voteAverage: number; source: string };

export const getEpisodeRating = (tvTmdbId: number, season: number, episodeNumber: number) =>
  api
    .get<EpisodeRating | null>("/ratings/episode", {
      params: { tvTmdbId, season, episodeNumber },
    })
    .then((r) => r.data);
