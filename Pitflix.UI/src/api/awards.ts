import api from "./client";

export type AwardCard = {
  id: string;
  name: string;
  subtitle?: string | null;
  accent?: string | null;
  heroBackdropUrl?: string | null;
  /** Ceremony / brand backdrop. */
  eventBackdropUrl?: string | null;
  /** Ceremony / brand art (Oscars, BAFTA, …). */
  eventPosterUrl?: string | null;
  cardPosterUrl?: string | null;
  spotlightPosterUrl?: string | null;
};

export const getAwardsCatalog = () =>
  api.get<{ awards: AwardCard[] }>("/awards/catalog").then((r) => r.data.awards);

export const getAwardYears = (awardId: string) =>
  api.get<{ years: number[] }>(`/awards/${encodeURIComponent(awardId)}/years`).then((r) => r.data.years);

export type AwardYearTile = {
  year: number;
  label?: string | null;
  posterUrl?: string | null;
};

export const getAwardYearTiles = (awardId: string) =>
  api
    .get<{ tiles: AwardYearTile[] }>(`/awards/${encodeURIComponent(awardId)}/year-tiles`)
    .then((r) => r.data.tiles);

export type AwardNominee = {
  title: string;
  mediaType: string;
  tmdbId: number | null;
  winner: boolean;
  posterUrl: string | null;
  backdropUrl?: string | null;
  imdbId?: string | null;
  inLibrary?: boolean;
  streamEligible?: boolean;
};

export type AwardCategory = {
  id: string;
  name: string;
  /** API: full | winner_only | empty | incomplete */
  completeness?: string | null;
  nominees: AwardNominee[];
};

export type AwardEdition = {
  awardId: string;
  year: number;
  label?: string | null;
  dataSource?: string | null;
  notes?: string | null;
  heroBackdropUrl?: string | null;
  heroPosterUrl?: string | null;
  eventPosterUrl?: string | null;
  categories: AwardCategory[];
};

export const getAwardEdition = (awardId: string, year: number) =>
  api.get<AwardEdition>(`/awards/${encodeURIComponent(awardId)}/${year}`).then((r) => r.data);

export type AwardsCachePreloadStatus = {
  running: boolean;
  phase: string;
  awardId?: string | null;
  year?: number | null;
  categoryId?: string | null;
  processedNominees: number;
  totalNominees: number;
  successCount: number;
  failedCount: number;
  /** Nominees belonging to editions already in cache — skipped during an incremental run. */
  skippedNominees: number;
  cachedRowCount: number;
  lastError?: string | null;
  /** ISO-8601 UTC timestamp of the last completed/cancelled/errored cache run. */
  lastCompletedAt?: string | null;
};

export const getAwardsCacheStatus = () =>
  api.get<AwardsCachePreloadStatus>("/awards/cache/status").then((r) => r.data);

export const startAwardsCachePreload = () =>
  api.post<{ started: boolean; busy?: boolean }>("/awards/cache/preload").then((r) => r.data);

export const clearAwardsCache = () =>
  api.post<{ ok: boolean }>("/awards/cache/clear").then((r) => r.data);

export const cancelAwardsCachePreload = () =>
  api.post<{ ok: boolean }>("/awards/cache/cancel").then((r) => r.data);

export type TitleNomination = {
  awardId: string;
  awardName: string;
  year: number;
  categoryId: string;
  categoryName: string;
  winner: boolean;
};

export type PersonNomination = {
  awardId: string;
  awardName: string;
  year: number | null;
  categoryName: string;
  winner: boolean;
  workTitle: string | null;
  workTmdbMovieId: number | null;
  workTmdbTvId: number | null;
  posterUrl: string | null;
};

export const getPersonAwards = (tmdbId: number) =>
  api
    .get<{ nominations: PersonNomination[] }>("/awards/for-person", { params: { tmdbId } })
    .then((r) => r.data.nominations);

export const getTitleNominations = (tmdbId: number, mediaType: "movie" | "tv", imdbId?: string | null) =>
  api
    .get<{ nominations: TitleNomination[] }>("/awards/for-title", { params: { tmdbId, mediaType, imdbId: imdbId ?? undefined } })
    .then((r) => r.data.nominations);
