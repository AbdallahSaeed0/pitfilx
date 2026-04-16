import api from "./client";

export const getHistory = (limit = 10) =>
  api.get("/history", { params: { limit } }).then((r) => r.data);

export const getHistory10 = () => getHistory(10);

export const addHistory = (body: {
  filePath: string;
  title: string;
  posterPath?: string;
  mediaType: string;
  durationSeconds: number;
}) => api.post("/history", body).then((r) => r.data);

export const historyStopped = (id: number, body: { stoppedAt: string; positionSeconds?: number }) =>
  api.post(`/history/${id}/stopped`, body).then((r) => r.data);

export const postHistoryProgress = (
  id: number,
  body: { positionSeconds: number; durationSeconds?: number; markWatching?: boolean },
) => api.post(`/history/${id}/progress`, body).then((r) => r.data);

/** Removes this title from Continue watching (deletes all history rows for that media file). */
export const removeHistoryEntry = (id: number) =>
  api.delete<{ success: boolean }>(`/history/${id}`).then((r) => r.data);

/** Dismiss from Continue watching; optionally mark the library movie or episode as completed first. */
export const dismissHistoryEntry = (id: number, markCompleted: boolean) =>
  api.post<{ success: boolean }>(`/history/${id}/dismiss`, { markCompleted }).then((r) => r.data);
