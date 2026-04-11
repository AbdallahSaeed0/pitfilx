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
  libraryShowId: number;
  showTitle: string;
  showTmdbId: number;
  episodeTitle: string;
  season: number | null;
  episodeNumber: number | null;
  airDate: string;
  pinned?: boolean;
};

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
};

export const getLatestTrailers = () =>
  api.get<TrailerCard[]>("/home/trailers").then((r) => r.data);

export type TrailerBrowseMode = "latest" | "upcoming-movies" | "upcoming-tv" | "all-upcoming";
export type TrailerBrowseFilter = "movie" | "tv" | "all";

export const browseTrailers = (
  mode: TrailerBrowseMode,
  filter: TrailerBrowseFilter,
  search?: string | null,
) =>
  api
    .get<TrailerCard[]>("/trailers/browse", {
      params: {
        mode,
        filter,
        ...(search && search.trim().length >= 2 ? { search: search.trim() } : {}),
      },
    })
    .then((r) => r.data);
