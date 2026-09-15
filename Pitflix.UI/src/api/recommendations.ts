import api from "./client";

export type RecommendationItem = {
  tmdbId: number;
  mediaType: string;
  title: string;
  year: string | null;
  overview: string | null;
  posterUrl: string | null;
  voteAverage: number;
  voteCount: number;
};

export type RecommendationFilter = "movie" | "tv" | "both";

export type RecommendationsResponse = {
  items: RecommendationItem[];
  error?: string | null;
  detail?: string | null;
};

export const fetchRecommendations = (body: {
  tmdbId: number;
  mediaType: "movie" | "tv";
  filter: RecommendationFilter;
}) =>
  api
    .post<RecommendationsResponse>("/recommendations/from", body, { validateStatus: () => true })
    .then((r) => ({ status: r.status, data: r.data }));

export type LibraryRecommendationItem = RecommendationItem & {
  score: number;
  contributingSeeds: { tmdbId: number; mediaType: string; title: string }[];
  isInLibrary: boolean;
  libraryId: number | null;
  watchStatus: string | null;
};

export type LibraryRecommendationsResponse = {
  items: LibraryRecommendationItem[];
  computedAtUtc: string | null;
  refreshed: boolean;
  error?: string | null;
};

export const fetchLibraryRecommendations = () =>
  api.get<LibraryRecommendationsResponse>("/recommendations/library").then((r) => r.data);

export const refreshLibraryRecommendations = () =>
  api.post<LibraryRecommendationsResponse>("/recommendations/library/refresh").then((r) => r.data);
