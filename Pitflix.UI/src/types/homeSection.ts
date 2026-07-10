import type { MediaCard } from "./media";

export type HomeSourceType =
  | "watching_currently"
  | "continue_watching"
  | "recently_added"
  | "top_rated"
  | "top_rated_library"
  | "unfinished_series"
  | "movie_night"
  | "genre_spotlight"
  | "hidden_gems"
  | "favorites_list"
  | "list_spotlight"
  | "arabic_picks"
  | "binge_series"
  | "trakt_recommendations"
  | "coming_soon"
  | "next_episodes"
  | "next_episodes_all"
  | "latest_trailers"
  | "coming_soon_trailers"
  | "upcoming_trending_trailers"
  | "custom";

export type HomeLayoutStyle = "poster-row" | "grid" | "landscape-row" | "ranked-row";

export type HomeCardVariant = "default" | "compact" | "landscape" | "ranked";

export type HomeSectionFilters = {
  genres?: string[];
  /** Maps to language: `arabic` | `english` | `all` */
  categories?: string[];
  languages?: string[];
  watched?: "all" | "watched" | "unwatched" | "watching" | "completed";
  minRating?: number;
  runtimeMin?: number;
  runtimeMax?: number;
  yearFrom?: number;
  yearTo?: number;
  tags?: string[];
  customListId?: number;
  spotlightGenre?: string;
};

export type HomeMetadataFlags = {
  showTitle?: boolean;
  showYear?: boolean;
  showRating?: boolean;
  showGenres?: boolean;
  showLang?: boolean;
  showWatchBadge?: boolean;
};

export type HomeSectionConfig = {
  id: string;
  title: string;
  subtitle?: string;
  enabled: boolean;
  order: number;
  sourceType: HomeSourceType;
  mediaType?: "all" | "movie" | "series";
  filters?: HomeSectionFilters;
  sortBy?: "dateadded" | "rating" | "year" | "title" | "random";
  limit?: number;
  layoutStyle: HomeLayoutStyle;
  cardVariant?: HomeCardVariant;
  metadata?: HomeMetadataFlags;
};

export type HomeSectionQueryBody = {
  sourceType: string;
  mediaType: string;
  limit: number;
  sortBy: string;
  shuffleSeed?: number | null;
  genres: string[];
  languageCategory: string;
  watchFilter: string;
  minRating?: number | null;
  minRuntimeMinutes?: number | null;
  maxRuntimeMinutes?: number | null;
  yearFrom?: number | null;
  yearTo?: number | null;
  tags: string[];
  listId?: number | null;
  spotlightGenre?: string | null;
};

export type WatchHistoryRow = {
  id: number;
  filePath: string;
  title: string;
  posterLocalPath?: string | null;
  posterRemoteUrl?: string | null;
  backdropLocalPath?: string | null;
  mediaType: string;
  estimatedSeconds?: number;
  maxKnownPositionSeconds?: number;
  lastExplicitPositionSeconds?: number;
  trustedResumeSeconds?: number;
  isStopFinalized?: boolean;
  fileDurationSeconds?: number;
  nextUpLabel?: string | null;
  libraryMovieId?: number | null;
  libraryShowId?: number | null;
  libraryEpisodeId?: number | null;
  episodeTitle?: string | null;
};

export type FeaturedFallbackResponse = { card: MediaCard | null };
