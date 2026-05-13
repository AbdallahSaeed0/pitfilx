import api from "./client";

export type StreamImdbResponse = { imdbId: string | null };

export type StreamTvSeasonRow = {
  seasonNumber: number;
  episodeCount: number;
  name: string;
};

export type StreamDetailsTrailer = {
  name: string | null;
  key: string;
  type: string | null;
  youtubeUrl: string;
};

export type StreamDetailsRec = {
  id: number;
  title: string;
  posterUrl: string | null;
  year: string | null;
  mediaType: "Movie" | "Series";
};

export type StreamDetailsResponse = {
  tmdbId: number;
  title: string | null;
  overview: string | null;
  posterUrl: string | null;
  backdropUrl: string | null;
  voteAverage: number;
  releaseDate: string | null;
  year: string | null;
  genres: string[];
  imdbId: string | null;
  mediaType: "Movie" | "Series";
  numberOfSeasons: number;
  trailer: StreamDetailsTrailer | null;
  recommendations: StreamDetailsRec[];
  error?: string;
};

export function getStreamImdbId(tmdbId: number, mediaType: "Movie" | "Series") {
  return api
    .get<StreamImdbResponse>(`/stream/imdb-id/${tmdbId}`, { params: { mediaType } })
    .then((r) => r.data);
}

export function getStreamTvSeasons(tmdbId: number) {
  return api.get<StreamTvSeasonRow[]>(`/stream/tv/${tmdbId}/seasons`).then((r) => r.data);
}

export function getStreamDetails(tmdbId: number, mediaType: "Movie" | "Series") {
  return api
    .get<StreamDetailsResponse>(`/stream/details/${tmdbId}`, { params: { mediaType } })
    .then((r) => r.data);
}
