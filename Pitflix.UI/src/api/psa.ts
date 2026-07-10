import api from "./client";
import type { WsmTorrent } from "./wsm";

export type PsaPayload = {
  items: WsmTorrent[];
};

export const getMoviePsaTorrents = (tmdbId: number, title: string, year: number) =>
  api
    .get<PsaPayload>(`/psa/movie/${tmdbId}`, { params: { title, year }, timeout: 60_000 })
    .then((r) => r.data);

export const getEpisodePsaTorrents = (tmdbId: number, season: number, episode: number, title: string) =>
  api
    .get<PsaPayload>(`/psa/episode/${tmdbId}/${season}/${episode}`, { params: { title }, timeout: 60_000 })
    .then((r) => r.data);

export const getSeasonPsaTorrents = (tmdbId: number, season: number, title: string) =>
  api
    .get<PsaPayload>(`/psa/season/${tmdbId}/${season}`, { params: { title }, timeout: 60_000 })
    .then((r) => r.data);
