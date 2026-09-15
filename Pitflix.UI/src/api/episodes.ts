import api from "./client";

export const setEpisodeWatchStatus = (
  id: number,
  watchStatus: "Unwatched" | "Watching" | "Completed",
) => api.post(`/episodes/${id}/watch`, { watchStatus }).then((r) => r.data);

export const setEpisodeRewatchCount = (id: number, count: number) =>
  api.post(`/episodes/${id}/rewatch-count`, { count }).then((r) => r.data);
