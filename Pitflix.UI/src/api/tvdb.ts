import api from "./client";

export type TvdbArtwork = {
  url: string;
  thumbnail: string;
  /** 1=banner, 2=poster, 3=background, 11/23/25=clear logo */
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

export const TVDB_ARTWORK = {
  BANNER: 1,
  POSTER: 2,
  BACKGROUND: 3,
  CLEAR_LOGO_LEGACY: 11,
  CLEAR_LOGO_SERIES: 23,
  CLEAR_LOGO_MOVIE: 25,
} as const;

export const TVDB_CLEAR_LOGO_TYPES = [
  TVDB_ARTWORK.CLEAR_LOGO_LEGACY,
  TVDB_ARTWORK.CLEAR_LOGO_SERIES,
  TVDB_ARTWORK.CLEAR_LOGO_MOVIE,
] as const;

export function isClearLogoType(type: number): boolean {
  return (TVDB_CLEAR_LOGO_TYPES as readonly number[]).includes(type);
}

export function pickBestClearLogo(artworks: TvdbArtwork[] | null | undefined): TvdbArtwork | null {
  if (!artworks?.length) return null;
  const logos = artworks.filter((a) => isClearLogoType(a.type));
  if (!logos.length) return null;
  return logos.reduce((best, cur) => (cur.score > best.score ? cur : best));
}

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
