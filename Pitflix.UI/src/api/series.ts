import api from "./client";

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
