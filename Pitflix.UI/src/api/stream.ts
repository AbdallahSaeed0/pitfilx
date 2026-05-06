import api from "./client";

export type StreamImdbResponse = { imdbId: string | null };

export type StreamTvSeasonRow = {
  seasonNumber: number;
  episodeCount: number;
  name: string;
};

export function getStreamImdbId(tmdbId: number, mediaType: "Movie" | "Series") {
  return api
    .get<StreamImdbResponse>(`/stream/imdb-id/${tmdbId}`, { params: { mediaType } })
    .then((r) => r.data);
}

export function getStreamTvSeasons(tmdbId: number) {
  return api.get<StreamTvSeasonRow[]>(`/stream/tv/${tmdbId}/seasons`).then((r) => r.data);
}
