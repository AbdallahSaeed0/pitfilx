import api from "./client";

export const setMovieWatchStatus = (id: number, watchStatus: string) =>
  api.post(`/movies/${id}/watch`, { watchStatus }).then((r) => r.data);

export const setShowWatchStatus = (id: number, watchStatus: string) =>
  api.post(`/series/${id}/watch`, { watchStatus }).then((r) => r.data);
