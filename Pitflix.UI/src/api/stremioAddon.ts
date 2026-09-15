import api from "./client";
import type { WsmTorrent } from "./wsm";

export type StremioAddonPayload = {
  items: WsmTorrent[];
};

export type StremioAddonProvider = "torrentio" | "comet";

export const getMovieStremioAddonStreams = (
  tmdbId: number,
  imdbId: string,
  provider: StremioAddonProvider = "torrentio",
) =>
  api
    .get<StremioAddonPayload>(`/stremio-addon/movie/${tmdbId}`, { params: { imdbId, provider } })
    .then((r) => r.data);

export const getEpisodeStremioAddonStreams = (
  tmdbId: number,
  season: number,
  episode: number,
  imdbId: string,
  provider: StremioAddonProvider = "torrentio",
) =>
  api
    .get<StremioAddonPayload>(`/stremio-addon/episode/${tmdbId}/${season}/${episode}`, {
      params: { imdbId, provider },
    })
    .then((r) => r.data);
