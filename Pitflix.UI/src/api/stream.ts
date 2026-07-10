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

export type StreamDetailsSeason = {
  seasonNumber: number;
  name: string;
  episodeCount: number;
  airDate: string | null;
  posterUrl: string | null;
};

export type StreamDetailsCastMember = {
  id: number;
  name: string;
  character: string | null;
  profileUrl: string | null;
};

export type StreamDetailsCrewMember = {
  id: number;
  name: string;
  job: string;
  profileUrl: string | null;
};

export type StreamDetailsResponse = {
  tmdbId: number;
  title: string | null;
  overview: string | null;
  posterUrl: string | null;
  backdropUrl: string | null;
  voteAverage: number;
  voteCount: number;
  releaseDate: string | null;
  year: string | null;
  genres: string[];
  imdbId: string | null;
  mediaType: "Movie" | "Series";
  numberOfSeasons: number;
  runtimeMinutes: number | null;
  seasons: StreamDetailsSeason[];
  cast: StreamDetailsCastMember[];
  crew: StreamDetailsCrewMember[];
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

export type StreamSeasonEpisode = {
  episodeNumber: number;
  title: string;
  overview: string | null;
  airDate: string | null;
  runtime: number;
  voteAverage: number;
  stillUrl: string | null;
};

export type StreamSeasonResponse = {
  seasonName: string;
  seasonOverview: string | null;
  seasonPosterUrl: string | null;
  episodes: StreamSeasonEpisode[];
  error?: string | null;
};

export function getStreamSeasonEpisodes(tmdbId: number, seasonNumber: number) {
  return api
    .get<StreamSeasonResponse>(`/stream/tv/${tmdbId}/season/${seasonNumber}/episodes`)
    .then((r) => r.data);
}

export type StreamDiscoverItem = {
  id: number;
  title: string;
  overview: string | null;
  posterUrl: string | null;
  backdropUrl: string | null;
  voteAverage: number;
  year: string | null;
  mediaType: "Movie" | "Series";
};

export type DiscoverCategory =
  | "trending-movie"
  | "trending-tv"
  | "popular-movie"
  | "popular-tv"
  | "top-rated-movie"
  | "top-rated-tv"
  | "upcoming";

export function getStreamDiscover(category: DiscoverCategory) {
  return api
    .get<StreamDiscoverItem[]>("/stream/discover", { params: { category } })
    .then((r) => r.data);
}

export type ParentsGuideCategory = {
  name: string;
  severity: string;
  items: string[];
};

export type ParentsGuideResponse = {
  imdbId: string;
  overallRating: string | null;
  categories: ParentsGuideCategory[];
  error?: string;
};

export function getParentsGuide(imdbId: string) {
  return api
    .get<ParentsGuideResponse>(`/stream/parents-guide/${encodeURIComponent(imdbId)}`)
    .then((r) => r.data);
}
