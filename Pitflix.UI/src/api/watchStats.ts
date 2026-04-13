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
  /** In-progress series with a valid “continue” target (library + progress rules). */
  currentlyWatchingCount?: number;
  episodesCompletedThisWeek?: number;
  /** % of matched series in library marked fully completed. */
  seriesCompletionPercent?: number;
  /** Series rows with library watch status “Watching”. */
  showsWatchingLibrary?: number;
  decadeTop?: { decade: string; count: number }[];
  /** Files with 2+ play sessions (approximate rewatches). */
  rewatchSessionsApprox?: number;
};

export const getWatchStats = () => api.get<WatchStats>("/stats/watch").then((r) => r.data);
