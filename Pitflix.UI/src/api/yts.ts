import api from "./client";
import type { WsmTorrent } from "./wsm";

export type YtsPayload = {
  items: WsmTorrent[];
};

export const getMovieYtsTorrents = (tmdbId: number, imdbId: string | null | undefined, title: string, year: number) =>
  api.get<YtsPayload>(`/yts/movie/${tmdbId}`, { params: { imdbId: imdbId ?? undefined, title, year } }).then((r) => r.data);
