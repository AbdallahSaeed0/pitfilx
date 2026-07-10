import api from "./client";

export type LetterboxdAuthStatus = {
  configured: boolean;
  username: string | null;
  sessionActive: boolean;
};

export type LetterboxdDiaryEntry = {
  date: string | null;
  rating: number | null;
  reviewText: string | null;
  logEntryUrl: string | null;
};

export type LetterboxdFriendReview = {
  reviewerUsername: string;
  reviewerDisplayName: string | null;
  reviewerAvatarUrl: string | null;
  rating: number | null;
  reviewText: string | null;
  watchedDate: string | null;
  logEntryUrl: string | null;
};

export type LetterboxdFilmData = {
  configured: boolean;
  communityRating: number | null;
  ratingCount: number | null;
  userRating: number | null;
  userDiaryEntries: LetterboxdDiaryEntry[];
  friendReviews: LetterboxdFriendReview[];
};

export const getLetterboxdAuthStatus = () =>
  api.get<LetterboxdAuthStatus>("/letterboxd/auth/status").then((r) => r.data);

export const verifyLetterboxdUsername = (username: string) =>
  api.get<{ exists: boolean }>("/letterboxd/username/verify", { params: { username } }).then((r) => r.data);

export const getLetterboxdFilmData = (tmdbId: number) =>
  api.get<LetterboxdFilmData>(`/letterboxd/film/${tmdbId}/data`).then((r) => r.data);

export const saveLetterboxdSession = (cookieHeader: string, userAgent?: string) =>
  api.post<{ success: boolean }>("/letterboxd/session", { cookieHeader, userAgent }).then((r) => r.data);

export type LetterboxdSyncedMovie = {
  tmdbId: number;
  title: string;
  ratingFound: boolean;
  userRating: number | null;
};

export type LetterboxdSyncStatus = {
  isRunning: boolean;
  processed: number;
  total: number;
  rateLimited: boolean;
  message: string | null;
  recentlyProcessed: LetterboxdSyncedMovie[];
};

export const startLetterboxdSync = () =>
  api.post<LetterboxdSyncStatus>("/letterboxd/sync/start").then((r) => r.data);

export const cancelLetterboxdSync = () =>
  api.post<LetterboxdSyncStatus>("/letterboxd/sync/cancel").then((r) => r.data);

export const getLetterboxdSyncStatus = () =>
  api.get<LetterboxdSyncStatus>("/letterboxd/sync/status").then((r) => r.data);
