import api from "./client";

export type OfflineStatus = {
  offline: boolean;
  forcedOffline: boolean;
  detectedOffline: boolean;
  preload: {
    running: boolean;
    total: number;
    done: number;
    current: string | null;
    lastCompletedUtc: string | null;
    lastError: string | null;
    readyTitles: number;
    totalTitles: number;
  };
  imdbRatings: {
    available: boolean;
    builtAtUtc: string | null;
    refreshing: boolean;
    lastError: string | null;
  };
  savedTmdbResponses: number;
};

export const getOfflineStatus = () => api.get<OfflineStatus>("/offline/status").then((r) => r.data);

/** Persists Offline mode on the backend, which then serves saved data instead of calling the internet. */
export const setBackendOfflineMode = (enabled: boolean) =>
  api.post<{ ok: boolean; offline: boolean }>("/offline/mode", { enabled }).then((r) => r.data);

export const startOfflinePreload = () =>
  api.post<{ ok: boolean; error?: string }>("/offline/preload").then((r) => r.data);

export const refreshImdbRatings = () =>
  api.post<{ ok: boolean; error?: string }>("/offline/imdb-ratings/refresh").then((r) => r.data);
