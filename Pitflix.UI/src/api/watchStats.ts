import api from "./client";
import type { MediaCard } from "../types/media";

export type WatchStats = {
  totalWatchTimeMinutes: number;
  thisWeekMinutes: number;
  thisMonthMinutes: number;
  totalMoviesWatched: number;
  totalEpisodesWatched: number;
  totalSeriesCompleted: number;
  topGenres: { genre: string; count: number }[];
  topLanguage: string;
  recentlyCompleted: MediaCard[];
  watchStreak: number;
  movieVsSeries: { moviePercent: number; seriesPercent: number };
  mostWatchedGenre: string;
  averageMovieRating: number;
  averageSeriesRating: number;
};

export const getWatchStats = () => api.get<WatchStats>("/stats/watch").then((r) => r.data);
