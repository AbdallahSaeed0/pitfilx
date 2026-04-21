import api from "./client";

export type ComingSoonItem = {
  tmdbId: number;
  mediaType: string;
  title: string;
  releaseDate: string;
  posterUrl: string | null;
  overview: string | null;
  voteAverage: number;
};

export const getComingSoon = () =>
  api.get<{ movies: ComingSoonItem[]; tv: ComingSoonItem[] }>("/home/coming-soon").then((r) => r.data);

export type NextEpisodeAir = {
  kind?: "library" | "followed";
  libraryShowId: number | null;
  showTitle: string;
  showTmdbId: number;
  episodeTitle: string;
  season: number | null;
  episodeNumber: number | null;
  airDate: string;
  pinned?: boolean;
  posterUrl?: string | null;
  followed?: boolean;
};

export type FollowedExternalShow = {
  tmdbId: number;
  title: string;
  posterPath?: string | null;
  addedAtUtc: string;
};

export const getNextEpisodesFollowed = () =>
  api.get<FollowedExternalShow[]>("/home/next-episodes/followed").then((r) => r.data);

export const putNextEpisodesFollowed = (body: FollowedExternalShow[]) =>
  api.put("/home/next-episodes/followed", body);

export const getNextEpisodesAir = () =>
  api.get<NextEpisodeAir[]>("/home/next-episodes").then((r) => r.data);

export const getNextEpisodesPins = () =>
  api.get<{ showIds: number[] }>("/home/next-episodes/pins").then((r) => r.data);

export const putNextEpisodesPins = (showIds: number[]) =>
  api.put("/home/next-episodes/pins", { showIds });

export type TrailerCard = {
  tmdbId: number;
  mediaType: string;
  title: string;
  posterUrl: string | null;
  backdropUrl?: string | null;
  youtubeKey: string;
  trailerTitle: string;
  releaseDate?: string | null;
  /** TMDB video published_at — when the trailer clip was published (drives latest ordering). */
  trailerPublishedAtUtc?: string | null;
};

/** Home “Latest trailers” — persisted Phase-1 ingestion + TMDB title/poster enrich (compact JSON). */
export const getLatestTrailers = () =>
  api.get<TrailerCard[]>("/home/trailers/latest", { timeout: 60_000 }).then((r) => r.data);

export const getUpcomingTrailers = () =>
  api.get<TrailerCard[]>("/home/trailers/upcoming").then((r) => r.data);

export type WatchingCurrentlyCard = {
  libraryShowId: number;
  showTitle: string;
  showTmdbId: number;
  posterUrl: string | null;
  lastWatchedLabel: string;
  nextLabel: string;
  episodesRemaining: number;
  watchedEpisodes: number;
  totalEpisodes: number;
  progressFraction: number;
  lastPlayedAtUtc: string;
};

export const getWatchingCurrently = () =>
  api.get<WatchingCurrentlyCard[]>("/home/watching-currently").then((r) => r.data);

export type TvSearchHit = { tmdbId: number; title: string; year: number | null; posterUrl: string | null };

export const discoverTvSearch = (q: string) =>
  api.get<TvSearchHit[]>("/discover/tv-search", { params: { q } }).then((r) => r.data);

export type TvScheduleResponse =
  | {
      ok: true;
      showTitle: string | null;
      tmdbId: number;
      episodeTitle: string;
      season: number | null;
      episodeNumber: number | null;
      airDate: string | null;
    }
  | { ok: false; showTitle?: string | null; message: string };

export const discoverTvSchedule = (tmdbId: number) =>
  api.get<TvScheduleResponse>("/discover/tv-schedule", { params: { tmdbId } }).then((r) => r.data);

/** TMDB-backed browse only; use `getLatestTrailers` for persisted Latest feed. */
export type TrailerBrowseMode = "trending" | "upcoming";
export type TrailerBrowseFilter = "movie" | "tv" | "all";

export const browseTrailers = (
  mode: TrailerBrowseMode,
  filter: TrailerBrowseFilter,
  search?: string | null,
) =>
  api
    .get<TrailerCard[]>("/trailers/browse", {
      timeout: 120_000,
      params: {
        mode,
        filter,
        ...(search && search.trim().length >= 2 ? { search: search.trim() } : {}),
      },
    })
    .then((r) => r.data);
