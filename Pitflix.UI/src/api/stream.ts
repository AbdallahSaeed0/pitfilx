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
  /** TV only — episodes this person did this job on (from TMDB aggregate_credits). Absent for movies. */
  episodeCount?: number | null;
};

export type StreamDetailsCompany = {
  id: number;
  name: string;
  logoUrl: string | null;
  /** "network" (TMDB TV networks — where streaming originals show up) or "company" (production studio). */
  kind: "network" | "company";
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
  companies: StreamDetailsCompany[];
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
  /** "imdb" when `voteAverage` is a real IMDb score (the precomputed Top 100 row); "tmdb" otherwise. */
  ratingSource?: "imdb" | "tmdb";
};

export type DiscoverCategory =
  | "trending-movie"
  | "trending-tv"
  | "popular-movie"
  | "popular-tv"
  | "top-rated-movie"
  | "top-rated-tv"
  | "upcoming"
  | "now-playing-movie"
  | "airing-today-tv"
  | "on-the-air-tv"
  | "top-imdb-movie"
  | "top-imdb-tv"
  | `genre-movie-${number}`
  | `genre-tv-${number}`;

export const STREAM_MOVIE_GENRES = [
  { id: 28, name: "Action" },
  { id: 12, name: "Adventure" },
  { id: 16, name: "Animation" },
  { id: 35, name: "Comedy" },
  { id: 80, name: "Crime" },
  { id: 99, name: "Documentary" },
  { id: 18, name: "Drama" },
  { id: 10751, name: "Family" },
  { id: 14, name: "Fantasy" },
  { id: 27, name: "Horror" },
  { id: 9648, name: "Mystery" },
  { id: 10749, name: "Romance" },
  { id: 878, name: "Sci-Fi" },
  { id: 53, name: "Thriller" },
] as const;

export type StreamDiscoverSort = "popularity" | "rating" | "newest";

export type StreamDiscoverPage = {
  items: StreamDiscoverItem[];
  /** True when TMDB reports more pages beyond this one (independent of how many items survived filtering). */
  hasMore: boolean;
};

/**
 * The `/stream/discover` response body used to be a plain array before it grew a `hasMore` flag.
 * That endpoint is served with a 30-minute Cache-Control header, so a browser (or the Tauri
 * webview) that fetched it before the shape changed can still hand back the old array body from
 * its HTTP cache for a while after the API itself has been upgraded — normalize defensively so a
 * stale cache hit degrades to "one full page, no more" instead of crashing every caller.
 */
function normalizeDiscoverPage(raw: unknown): StreamDiscoverPage {
  if (Array.isArray(raw)) return { items: raw as StreamDiscoverItem[], hasMore: false };
  const r = raw as Partial<StreamDiscoverPage> | null | undefined;
  return { items: r?.items ?? [], hasMore: r?.hasMore ?? false };
}

export function getStreamDiscoverPage(
  category: DiscoverCategory,
  opts?: { page?: number; sort?: StreamDiscoverSort },
) {
  return api
    .get<unknown>("/stream/discover", {
      params: { category, page: opts?.page, sort: opts?.sort },
    })
    .then((r) => normalizeDiscoverPage(r.data));
}

/** Convenience wrapper for callers that just want page 1's items (sliders, hero row). */
export function getStreamDiscover(category: DiscoverCategory) {
  return getStreamDiscoverPage(category).then((r) => r.items);
}

export type StreamGenrePreview = { id: number; posterUrl: string | null };

export function getStreamGenrePreviews(ids: number[]) {
  return api
    .get<StreamGenrePreview[]>("/stream/genre-previews", { params: { ids: ids.join(",") } })
    .then((r) => r.data);
}

export type StreamStudioItem = {
  id: number;
  title: string;
  posterUrl: string | null;
  voteAverage: number;
  year: string | null;
  mediaType: "Movie" | "Series";
};

export type StreamStudioResponse = {
  name: string | null;
  logoUrl: string | null;
  items: StreamStudioItem[];
  hasMore: boolean;
  error?: string;
};

export function getStreamStudio(id: number, kind: "network" | "company", page?: number) {
  return api
    .get<StreamStudioResponse>(`/stream/studio/${id}`, { params: { kind, page } })
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
