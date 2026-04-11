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
