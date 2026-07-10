import api from "./client";

export type WsmTorrent = {
  title: string;
  size: string;
  quality: string;
  format: string;
  badges: string[];
  magnetLink: string;
  torrentFileUrl: string;
};

export type WsmPayload = {
  items: WsmTorrent[];
};

// WatchSoMuch's internal id is exactly the numeric part of the title's IMDb id — no search step needed.
export const getMovieWsmTorrents = (tmdbId: number, imdbId: string, title: string, year: number) =>
  api.get<WsmPayload>(`/wsm/movie/${tmdbId}`, { params: { imdbId, title, year } }).then((r) => r.data);

export const getEpisodeWsmTorrents = (tmdbId: number, season: number, episode: number, imdbId: string) =>
  api.get<WsmPayload>(`/wsm/episode/${tmdbId}/${season}/${episode}`, { params: { imdbId } }).then((r) => r.data);

export const getSeasonWsmTorrents = (tmdbId: number, season: number, imdbId: string) =>
  api.get<WsmPayload>(`/wsm/season/${tmdbId}/${season}`, { params: { imdbId } }).then((r) => r.data);

export type WsmDownloadResult = { action: "queued" | "open_magnet" };

export const downloadWsmTorrent = (body: { magnetLink: string; savePath?: string }) =>
  api.post<WsmDownloadResult>("/wsm/download", body).then((r) => r.data);

export const saveTorrentFile = (body: { torrentFileUrl: string; savePath: string; title: string }) =>
  api.post<{ success: boolean; savePath: string }>("/wsm/save-torrent-file", body).then((r) => r.data);
