import api from "./client";
import type { WsmTorrent } from "./wsm";

export type EztvPayload = {
  items: WsmTorrent[];
};

/** TV only — EZTV has no movie catalog. */
export const getEpisodeEztvTorrents = (tmdbId: number, season: number, episode: number, imdbId: string) =>
  api.get<EztvPayload>(`/eztv/episode/${tmdbId}/${season}/${episode}`, { params: { imdbId } }).then((r) => r.data);

export const getSeasonEztvTorrents = (tmdbId: number, season: number, imdbId: string) =>
  api.get<EztvPayload>(`/eztv/season/${tmdbId}/${season}`, { params: { imdbId } }).then((r) => r.data);
