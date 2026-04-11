import api from "./client";

export const getPosters = (tmdbId: number, mediaType: string) =>
  api.get(`/images/${tmdbId}/posters`, { params: { mediaType } }).then((r) => r.data);

export const getBackdrops = (tmdbId: number, mediaType: string) =>
  api.get(`/images/${tmdbId}/backdrops`, { params: { mediaType } }).then((r) => r.data);

export const selectImages = (
  libraryId: number,
  body: {
    tmdbId: number;
    mediaType: string;
    posterPath?: string;
    backdropPath?: string;
  },
) => api.post(`/images/${libraryId}/select`, body).then((r) => r.data);
