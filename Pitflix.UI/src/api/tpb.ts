import api from "./client";
import type { WsmTorrent } from "./wsm";

export type TpbPayload = {
  items: WsmTorrent[];
};

export const getMovieTpbTorrents = (tmdbId: number, title: string, year: number, imdbId?: string | null) =>
  api.get<TpbPayload>(`/tpb/movie/${tmdbId}`, { params: { title, year, imdbId: imdbId ?? undefined } }).then((r) => r.data);

export const getEpisodeTpbTorrents = (tmdbId: number, season: number, episode: number, title: string) =>
  api.get<TpbPayload>(`/tpb/episode/${tmdbId}/${season}/${episode}`, { params: { title } }).then((r) => r.data);

export const getSeasonTpbTorrents = (tmdbId: number, season: number, title: string) =>
  api.get<TpbPayload>(`/tpb/season/${tmdbId}/${season}`, { params: { title } }).then((r) => r.data);
