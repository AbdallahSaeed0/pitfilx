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
  movieWatchTimeMinutes?: number;
  seriesWatchTimeMinutes?: number;
  movieWatchTimeMinutesWeek?: number;
  seriesWatchTimeMinutesWeek?: number;
  movieWatchTimeMinutesMonth?: number;
  seriesWatchTimeMinutesMonth?: number;
  /** Most episodes of the same show watched on a single calendar day. */
  longestMarathonEpisodes?: number;
  longestMarathonShowTitle?: string;
  /** Per-network show counts (e.g. Netflix, HBO) across completed/in-progress matched series. */
  networkCounts?: { network: string; count: number }[];
  topMovieGenres?: { genre: string; count: number }[];
  topSeriesGenres?: { genre: string; count: number }[];
  decadeTopMovies?: { decade: string; count: number }[];
  decadeTopSeries?: { decade: string; count: number }[];
  recentlyCompletedMovies?: MediaCard[];
  recentlyCompletedSeries?: MediaCard[];
  /** Last 7 calendar days (today inclusive), oldest first — completions + which titles that day. */
  last7Days?: { date: string; count: number; titles: string[] }[];
};

export const getWatchStats = () => api.get<WatchStats>("/stats/watch").then((r) => r.data);
