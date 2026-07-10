/** Where to return after the player closes (preserves list/detail context better than `history -1`). */
export type PlayerReturnTo = {
  pathname: string;
  search?: string;
  hash?: string;
  scrollY?: number;
  /** Scroll position for the app `<main>` scroller (overflow-y), when used instead of window scroll. */
  mainScrollTop?: number;
};

/** A single live IPTV channel entry carried through router state so the player can render the full channel playlist. */
export type LiveChannelEntry = {
  name: string;
  streamUrl: string;
  logoUrl?: string | null;
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
  /** Carries the suppressContinueWatching flag so sibling-file switches inside the player stay hidden from Continue Watching. */
  suppressContinueWatching?: boolean;
  /** True when the user selected the in-process libmpv engine — PlayerPage uses `player2_libmpv_*` commands. */
  useLibMpv?: boolean;
  /** Show / series display name (separate from `title`, which usually is the episode title). */
  seriesName?: string;
  /** Full ordered list of live IPTV channels from the provider — enables in-player channel playlist and prev/next navigation. */
  liveChannels?: LiveChannelEntry[];
};
