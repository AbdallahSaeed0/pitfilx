import api from "./client";

export type Stats = {
  totalMovies: number;
  totalSeries: number;
  totalUnmatched: number;
  arabicMovies: number;
  englishMovies: number;
  arabicSeries: number;
  englishSeries: number;
  /** Watch breakdown for matched movies only. */
  moviesUnwatched: number;
  moviesWatching: number;
  moviesCompleted: number;
  /** Watch breakdown for matched series only. */
  seriesUnwatched: number;
  seriesWatching: number;
  seriesCompleted: number;
};

export const getStats = () => api.get<Stats>("/stats").then((r) => r.data);
