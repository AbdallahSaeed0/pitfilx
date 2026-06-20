export type MediaCard = {
  id: number;
  tmdbId: number;
  title: string;
  year?: number | null;
  voteAverage?: number;
  posterLocalPath?: string | null;
  selectedPosterPath?: string | null;
  /** TMDB CDN when no local/cache poster (set by API). */
  posterRemoteUrl?: string | null;
  backdropLocalPath?: string | null;
  selectedBackdropPath?: string | null;
  isArabic: boolean;
  watchStatus?: string;
  overview?: string | null;
  genresCsv?: string | null;
  dateAdded?: string;
  /** Movie play path (API may expose `filePath` or `mediaFilePath`). */
  mediaFilePath?: string | null;
  filePath?: string | null;
  /** Series folder path (for shows). */
  folderPath?: string | null;
  /** "Movie" | "Series" from API card payloads. */
  tmdbMediaType?: string | null;
  /** IMDb ID stored at add-time for streaming/awards list items. */
  imdbId?: string | null;
};

export type Stats = {
  totalMovies: number;
  totalSeries: number;
  totalUnmatched: number;
  arabicMovies: number;
  englishMovies: number;
  arabicSeries: number;
  englishSeries: number;
};
