import api from "./client";

export type TvdbArtwork = {
  url: string;
  thumbnail: string;
  /** 2=poster, 3=background, 11=clearlogo */
  type: number;
  score: number;
  width: number;
  height: number;
};

export type TvdbPerson = {
  personName: string;
  characterName: string;
  imageUrl: string;
  role: string;
};

export const getTvdbArtworks = (tmdbId: number, mediaType: "movie" | "series") =>
  api
    .get<TvdbArtwork[]>("/tvdb/artworks", {
      params: { tmdbId, mediaType },
      validateStatus: (s) => s === 200 || s === 404 || s === 400,
    })
    .then((r) => (r.status === 200 ? r.data : null));

export const getTvdbPeople = (tmdbId: number, mediaType: "movie" | "series") =>
  api
    .get<TvdbPerson[]>("/tvdb/people", {
      params: { tmdbId, mediaType },
      validateStatus: (s) => s === 200 || s === 404 || s === 400,
    })
    .then((r) => (r.status === 200 ? r.data : null));
