import api from "./client";

export type ComingSoonItem = {
  id: number;
  tmdbId: number;
  mediaType: string;
  title: string;
  posterUrl: string | null;
  releaseDate: string | null;
  trailerUrl: string | null;
  overview: string | null;
  pinnedAt: string;
};

export const getComingSoon = () =>
  api.get<ComingSoonItem[]>("/coming-soon").then((r) => r.data);

export const pinComingSoon = (body: {
  tmdbId: number;
  mediaType: string;
  title: string;
  posterUrl?: string | null;
  releaseDate?: string | null;
  trailerUrl?: string | null;
  overview?: string | null;
}) => api.post<{ success: boolean; id?: number }>("/coming-soon", body).then((r) => r.data);

export const unpinComingSoon = (id: number) =>
  api.delete<{ success: boolean }>(`/coming-soon/${id}`).then((r) => r.data);
