import api from "./client";

export type MovieListParams = Record<string, string | number | undefined>;

export type MediaVideoItem = {
  key: string;
  name: string;
  type: string;
  site: string;
  thumbnailUrl: string;
};

export const getMovies = (params?: MovieListParams) =>
  api.get("/movies", { params }).then((r) => r.data);

export const getMovie = (id: number) => api.get(`/movies/${id}`).then((r) => r.data);

export const getMovieVideos = (id: number): Promise<{ videos: MediaVideoItem[] }> =>
  api.get(`/movies/${id}/videos`).then((r) => r.data as { videos: MediaVideoItem[] });
