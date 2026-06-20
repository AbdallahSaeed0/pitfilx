import api from "./client";
import type { MediaVideoItem } from "./movies";

export type SeriesListParams = Record<string, string | number | undefined>;

export const getAllSeries = (params?: SeriesListParams) =>
  api.get("/series", { params }).then((r) => r.data);

export const getShow = (id: number) => api.get(`/series/${id}`).then((r) => r.data);

export type SeasonSummary = {
  seasonNumber: number;
  name: string;
  posterPath: string | null;
  posterUrl: string | null;
  airDate: string | null;
  episodeCount: number;
  tmdbEpisodeCount: number;
  voteAverage?: number | null;
  /** False when the season exists on TMDB but you have no episodes locally yet */
  inLibrary?: boolean;
};

export type ShowDetailResponse = {
  show: unknown;
  seasonsSummary?: SeasonSummary[];
  episodes?: unknown;
  nextEpisode?: unknown;
  similar?: unknown;
  cast?: unknown;
  crew?: unknown;
};

export const getShowSeason = (libraryShowId: number, seasonNumber: number) =>
  api.get(`/series/${libraryShowId}/season/${seasonNumber}`).then((r) => r.data);

export const getShowVideos = (id: number): Promise<{ videos: MediaVideoItem[] }> =>
  api.get(`/series/${id}/videos`).then((r) => r.data as { videos: MediaVideoItem[] });

export type NextLibraryEpisode = {
  id: number;
  filePath: string;
  season: number;
  episodeNumber: number;
  title: string | null;
};

/** When `currentEpisodeId` is set, returns the next episode in airing order after that episode (player prev/next). */
export const getNextLibraryEpisode = (libraryShowId: number, currentEpisodeId?: number | null) =>
  api
    .get<{ next: NextLibraryEpisode | null }>(`/series/${libraryShowId}/next-episode`, {
      params: currentEpisodeId != null ? { currentEpisodeId } : {},
    })
    .then((r) => r.data);

export const getPreviousLibraryEpisode = (libraryShowId: number, currentEpisodeId: number) =>
  api
    .get<{ previous: NextLibraryEpisode | null }>(`/series/${libraryShowId}/previous-episode`, {
      params: { currentEpisodeId },
    })
    .then((r) => r.data);

export type ResolvedPlaybackByPath = {
  mediaType: "Series" | "Movie";
  filePath: string;
  title: string;
  posterPath?: string | null;
  libraryMovieId?: number;
  libraryShowId?: number;
  libraryEpisodeId?: number;
  season?: number;
  episodeNumber?: number;
};

export const resolvePlaybackByPath = (filePath: string) =>
  api
    .get<ResolvedPlaybackByPath>("/playback/resolve-by-path", {
      params: { filePath },
    })
    .then((r) => r.data);
