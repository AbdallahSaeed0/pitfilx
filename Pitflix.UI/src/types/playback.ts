/** Where to return after the player closes (preserves list/detail context better than `history -1`). */
export type PlayerReturnTo = {
  pathname: string;
  search?: string;
  hash?: string;
  scrollY?: number;
};

/** Router state for `/player` (built-in mpv). */
export type PlaybackLaunchState = {
  historyId: number;
  filePath: string;
  title: string;
  posterPath?: string | null;
  mediaType: string;
  durationSeconds: number;
  /** From history — show resume prompt when &gt; 60s */
  resumeSeconds?: number;
  libraryMovieId?: number;
  libraryShowId?: number;
  libraryEpisodeId?: number;
  season?: number;
  episodeNumber?: number;
  /** Set when opening the player so close / end-of-play can restore the prior screen (and scroll). */
  returnTo?: PlayerReturnTo;
};
