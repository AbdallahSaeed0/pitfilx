import api from "./client";

export type TraktStatus = {
  connected: boolean;
  expired: boolean;
  autoSyncEnabled: boolean;
  username: string | null;
  /** Whether a Trakt app Client ID/Secret has been saved (by anyone using this Pitflix install). */
  appConfigured: boolean;
  /** ISO timestamp of the last successful Trakt import (manual or automatic), or null if never synced. */
  lastSyncedAt: string | null;
};

export type TraktImportResult = {
  success: boolean;
  error?: string;
  matched?: number;
  unmatched?: number;
  playbackApplied?: number;
  playbackSkipped?: number;
};

export const getTraktAuthUrl = () =>
  api.get<{ url?: string; error?: string }>("/trakt/auth-url").then((r) => r.data);

export const getTraktStatus = () => api.get<TraktStatus>("/trakt/status").then((r) => r.data);

export const disconnectTrakt = () =>
  api.post<{ success: boolean }>("/trakt/disconnect").then((r) => r.data);

export const patchTraktSettings = (body: {
  autoSyncEnabled?: boolean;
  clientId?: string;
  clientSecret?: string;
}) => api.patch<{ success: boolean }>("/trakt/settings", body).then((r) => r.data);

export const syncTraktNow = () =>
  api.post<TraktImportResult>("/trakt/import-history").then((r) => r.data);
