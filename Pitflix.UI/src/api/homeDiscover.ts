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

export const getNextEpisodesAirScoped = (params?: { view?: "priority" | "all"; limit?: number }) =>
  api.get<NextEpisodeAir[]>("/home/next-episodes", { params }).then((r) => r.data);

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
  nextSeason: number;
  nextEpisode: number;
  episodesRemaining: number;
  watchedEpisodes: number;
  totalEpisodes: number;
  progressFraction: number;
  lastPlayedAtUtc: string;
};

function normalizeWatchingRow(raw: Record<string, unknown>): WatchingCurrentlyCard {
  const n = (v: unknown): number => {
    if (typeof v === "number" && Number.isFinite(v)) return v;
    if (typeof v === "string" && v.trim() !== "") {
      const x = Number(v);
      return Number.isFinite(x) ? x : 0;
    }
    return 0;
  };
  const libraryShowId = n(raw.libraryShowId ?? raw.LibraryShowId);
  let nextSeason = n(raw.nextSeason ?? raw.NextSeason);
  const nextLabel = String(raw.nextLabel ?? raw.NextLabel ?? "");
  if (!Number.isFinite(nextSeason) || nextSeason <= 0) {
    const m = /^S(\d+)/i.exec(nextLabel.trim());
    if (m) nextSeason = parseInt(m[1]!, 10);
  }
  return {
    libraryShowId,
    showTitle: String(raw.showTitle ?? raw.ShowTitle ?? ""),
    showTmdbId: n(raw.showTmdbId ?? raw.ShowTmdbId),
    posterUrl: (raw.posterUrl ?? raw.PosterUrl ?? null) as string | null,
    lastWatchedLabel: String(raw.lastWatchedLabel ?? raw.LastWatchedLabel ?? ""),
    nextLabel,
    nextSeason,
    nextEpisode: n(raw.nextEpisode ?? raw.NextEpisode),
    episodesRemaining: n(raw.episodesRemaining ?? raw.EpisodesRemaining),
    watchedEpisodes: n(raw.watchedEpisodes ?? raw.WatchedEpisodes),
    totalEpisodes: n(raw.totalEpisodes ?? raw.TotalEpisodes),
    progressFraction: Number(raw.progressFraction ?? raw.ProgressFraction ?? 0) || 0,
    lastPlayedAtUtc: String(raw.lastPlayedAtUtc ?? raw.LastPlayedAtUtc ?? ""),
  };
}

export const getWatchingCurrently = () =>
  api.get<WatchingCurrentlyCard[]>("/home/watching-currently").then((r) => {
    const rows = r.data as unknown[];
    return rows.map((row) => normalizeWatchingRow(row as Record<string, unknown>));
  });

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

export const runTrailerIngestion = () =>
  api
    .post<{ ok: boolean; message?: string }>("/trailers/monitor/run", {}, { timeout: 300_000 })
    .then((r) => r.data);
