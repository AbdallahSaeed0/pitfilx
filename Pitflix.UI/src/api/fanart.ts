import api from "./client";

export type FanartImage = { url: string; type: string; language?: string | null };

export type FanartResponse = {
  clearLogos: FanartImage[];
  posters: FanartImage[];
  backgrounds: FanartImage[];
  characterArt: FanartImage[];
};

export const getFanartArtwork = (tmdbId: number, mediaType: "movie" | "series") =>
  api
    .get<FanartResponse>(`/fanart/${mediaType}/${tmdbId}`)
    .then((r) => r.data)
    .catch(() => null);
