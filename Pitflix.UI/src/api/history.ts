import api from "./client";

export const getHistory = (limit = 10, opts?: { includeSuppressed?: boolean; lite?: boolean }) =>
  api
    .get("/history", {
      params: {
        limit,
        ...(opts?.includeSuppressed ? { includeSuppressed: true } : {}),
        ...(opts?.lite ? { lite: true } : {}),
      },
    })
    .then((r) => r.data);

export const getHistory10 = () => getHistory(10);

export const addHistory = (body: {
  filePath: string;
  title: string;
  posterPath?: string;
  mediaType: string;
  durationSeconds: number;
  /** Hide from Continue watching (home history); playback resume still sees the row when requested. */
  suppressContinueWatching?: boolean;
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

/**
 * Record a streaming or manual "watched" event so it counts in Statistics
 * even when the title is not in the local library.
 */
export const markWatchedEntry = (body: {
  tmdbId: number;
  imdbId?: string | null;
  mediaType: string;
  title: string;
  posterUrl?: string | null;
  source: "streaming" | "manual";
  seasonNumber?: number | null;
  episodeNumber?: number | null;
  runtimeMinutes?: number;
}) => api.post<{ success: boolean }>("/history/mark-watched", body).then((r) => r.data);
