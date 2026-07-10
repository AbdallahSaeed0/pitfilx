import api from "./client";

export type SubtitleRow = {
  subtitleId: string;
  language: string;
  releaseName: string;
  downloadCount: number;
  ratings: number;
  isHearingImpaired: boolean;
  isMachineTranslated: boolean;
  format: string;
  fileId: number;
  fileName: string;
};

/** API wrapper around OpenSubtitles search results + optional error text from the server. */
export type SubtitlesPayload = {
  items: SubtitleRow[];
  error: string | null;
};

export const getMovieSubtitles = (movieId: number) =>
  api.get<SubtitlesPayload>(`/subtitles/movie/${movieId}`).then((r) => r.data);

export const getEpisodeSubtitles = (episodeId: number) =>
  api.get<SubtitlesPayload>(`/subtitles/episode/${episodeId}`).then((r) => r.data);

export type SubtitleSearchParams = {
  query: string;
  type: "movie" | "episode";
  season?: number;
  episode?: number;
  parentTmdbId?: number;
  tmdbId?: number;
};

export const searchSubtitles = (p: SubtitleSearchParams) =>
  api
    .get<SubtitlesPayload>("/subtitles/search", {
      params: {
        query: p.query,
        type: p.type,
        season: p.season,
        episode: p.episode,
        parentTmdbId: p.parentTmdbId,
        tmdbId: p.tmdbId,
      },
    })
    .then((r) => r.data);

export const downloadSubtitle = (body: { fileId: number; videoFilePath: string; languageCode: string }) =>
  api.post<{ success: boolean; savedPath?: string; error?: string }>("/subtitles/download", body).then((r) => r.data);

// ── SubDL ────────────────────────────────────────────────────────────────────

export type SubDlRow = {
  releaseName: string;
  language: string;
  fullLink: string;
  isHearingImpaired: boolean;
  format: string;
};

export type SubDlPayload = {
  items: SubDlRow[];
  error: string | null;
};

export type SubDlSearchParams = {
  imdbId?: string;
  tmdbId?: number;
  title?: string;
  mediaType?: string;
  season?: number;
  episode?: number;
};

export const searchSubDl = (p: SubDlSearchParams) =>
  api
    .get<SubDlPayload>("/subtitles/subdl/search", {
      params: {
        imdbId: p.imdbId,
        tmdbId: p.tmdbId,
        title: p.title,
        mediaType: p.mediaType,
        season: p.season,
        episode: p.episode,
      },
    })
    .then((r) => r.data);

export const downloadSubDl = (body: { fullLink: string; videoFilePath: string; language: string }) =>
  api
    .post<{ success: boolean; savedPath?: string; error?: string }>("/subtitles/subdl/download", body)
    .then((r) => r.data);

// ── SubSource ────────────────────────────────────────────────────────────────

export type SubSourceRow = {
  releaseName: string;
  language: string;
  subtitleId: number;
  isHearingImpaired: boolean;
};

export type SubSourcePayload = {
  items: SubSourceRow[];
  error: string | null;
};

export type SubSourceSearchParams = {
  imdbId?: string;
  title?: string;
  mediaType?: string;
  season?: number;
};

export const searchSubSource = (p: SubSourceSearchParams) =>
  api
    .get<SubSourcePayload>("/subtitles/subsource/search", {
      params: {
        imdbId: p.imdbId,
        title: p.title,
        mediaType: p.mediaType,
        season: p.season,
      },
    })
    .then((r) => r.data);

export const downloadSubSource = (body: { subtitleId: number; videoFilePath: string; language: string }) =>
  api
    .post<{ success: boolean; savedPath?: string; error?: string }>("/subtitles/subsource/download", body)
    .then((r) => r.data);
