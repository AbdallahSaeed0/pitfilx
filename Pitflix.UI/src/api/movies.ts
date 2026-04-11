import api from "./client";

export type MovieListParams = Record<string, string | number | undefined>;

export const getMovies = (params?: MovieListParams) =>
  api.get("/movies", { params }).then((r) => r.data);

export const getMovie = (id: number) => api.get(`/movies/${id}`).then((r) => r.data);
