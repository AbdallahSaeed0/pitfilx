import api, { API_ORIGIN } from "./client";

export type LibraryCleanupResult = {
  removedShows: number;
  removedMovies: number;
  removedEpisodes: number;
  message: string;
};

export type LibraryTitleRow = {
  kind: "movie" | "series";
  id: number;
  title: string;
  year?: number | null;
};

export const cleanupLibrary = () =>
  api.post<LibraryCleanupResult>("/library/cleanup").then((r) => r.data);

export const cleanupMissingFiles = () =>
  api.post<LibraryCleanupResult>("/library/cleanup-missing-files").then((r) => r.data);

export type RefreshArtworkResult = {
  movies: number;
  shows: number;
  failures: number;
};

/** Re-download poster and backdrop from TMDB for every matched movie and series (fixes missing grey cards). */
export const refreshLibraryArtwork = () =>
  api.post<RefreshArtworkResult>("/library/refresh-artwork").then((r) => r.data);

export const searchLibraryTitles = (q: string) =>
  api
    .get<{ movies: LibraryTitleRow[]; shows: LibraryTitleRow[] }>("/library/title-search", { params: { q } })
    .then((r) => r.data);

export const removeLibraryMovie = (id: number) => api.delete(`/library/movie/${id}`).then((r) => r.data);

export const removeLibraryShow = (id: number) => api.delete(`/library/show/${id}`).then((r) => r.data);

export const bulkSetWatchStatus = (body: {
  movieIds?: number[];
  showIds?: number[];
  watchStatus: "Unwatched" | "Watching" | "Completed";
}) => api.post("/library/bulk-watch", body).then((r) => r.data);

export const bulkRemoveFromLibrary = (body: { movieIds?: number[]; showIds?: number[] }) =>
  api.post("/library/bulk-remove", body).then((r) => r.data);

export type BulkDeleteFromDeviceResult = {
  success: boolean;
  filesDeleted: number;
  errors: string[];
};

export const bulkDeleteFromDevice = (body: { movieIds?: number[]; showIds?: number[] }) =>
  api.post<BulkDeleteFromDeviceResult>("/library/bulk-delete-from-device", body).then((r) => r.data);

export type RematchMovieResult = { success: boolean; libraryId?: number; error?: string };

export const rematchMovieFromFile = (libraryId: number) =>
  api.post<RematchMovieResult>(`/library/movies/${libraryId}/rematch-from-file`).then((r) => r.data);

export const matchLibraryMovieTmdb = (libraryId: number, tmdbId: number) =>
  api
    .post<RematchMovieResult>(`/library/movies/${libraryId}/match-tmdb`, { tmdbId })
    .then((r) => r.data);

export const rematchSeriesFromFolder = (libraryId: number) =>
  api.post<RematchMovieResult>(`/library/series/${libraryId}/rematch-from-folder`).then((r) => r.data);

export const matchLibrarySeriesTmdb = (libraryId: number, tmdbId: number) =>
  api
    .post<RematchMovieResult>(`/library/series/${libraryId}/match-tmdb`, { tmdbId })
    .then((r) => r.data);

export type BulkRescanSeriesResult = {
  success: boolean;
  totalProcessed: number;
  successCount: number;
  failureCount: number;
  results: Array<{
    showId: number;
    success: boolean;
    newLibraryId?: number;
    error?: string;
  }>;
};

export const bulkRescanSeries = (body: { showIds: number[] }) =>
  api.post<BulkRescanSeriesResult>("/library/bulk-rescan-series", body).then((r) => r.data);

export type RematchEpisodeResult = {
  success: boolean;
  showId?: number;
  episodeId?: number;
  error?: string;
};

export const matchLibraryEpisodeTmdb = (episodeId: number, tmdbId: number) =>
  api
    .post<RematchEpisodeResult>(`/library/episodes/${episodeId}/match-tmdb`, { tmdbId })
    .then((r) => r.data);

export const rematchEpisodeFromFile = (episodeId: number) =>
  api.post<RematchEpisodeResult>(`/library/episodes/${episodeId}/rematch-from-file`).then((r) => r.data);

/** One NDJSON line from <c>POST /api/library/prefetch-metadata</c>. */
export type PrefetchProgressLine =
  | { phase: "start"; moviesTotal: number; seriesTotal: number }
  | {
      phase: "movie" | "series";
      index: number;
      itemTotal: number;
      libraryId?: number;
      title?: string;
      ok?: boolean;
      error?: string | null;
    }
  | { phase: "done"; moviesOk: number; seriesOk: number; errors?: string[] };

export async function prefetchLibraryMetadataStream(
  onLine: (line: PrefetchProgressLine) => void,
  opts?: { signal?: AbortSignal },
): Promise<void> {
  const res = await fetch(`${API_ORIGIN}/api/library/prefetch-metadata`, {
    method: "POST",
    headers: { Accept: "application/x-ndjson" },
    signal: opts?.signal,
  });
  if (!res.ok) {
    let msg = `HTTP ${res.status}`;
    try {
      const j = (await res.json()) as { error?: string };
      if (typeof j.error === "string" && j.error.trim()) msg = j.error;
    } catch {
      const t = await res.text();
      if (t.trim()) msg = t.trim().slice(0, 240);
    }
    throw new Error(msg);
  }
  const reader = res.body?.getReader();
  if (!reader) throw new Error("Empty response body");
  const dec = new TextDecoder();
  let buf = "";
  for (;;) {
    const { done, value } = await reader.read();
    if (done) break;
    buf += dec.decode(value, { stream: true });
    const parts = buf.split("\n");
    buf = parts.pop() ?? "";
    for (const line of parts) {
      const t = line.trim();
      if (!t) continue;
      try {
        onLine(JSON.parse(t) as PrefetchProgressLine);
      } catch {
        /* ignore */
      }
    }
  }
  const tail = buf.trim();
  if (tail) {
    try {
      onLine(JSON.parse(tail) as PrefetchProgressLine);
    } catch {
      /* ignore */
    }
  }
}

export const deleteMediaFromDevice = (body: {
  path: string;
  mediaType: "Movie" | "Series";
  libraryId: number;
}) => api.delete("/library/delete-from-device", { data: body }).then((r) => r.data);

export type RefreshMetadataResult = { success: boolean; error?: string };

export const refreshMovieMetadata = (libraryId: number) =>
  api.post<RefreshMetadataResult>(`/library/movies/${libraryId}/refresh-metadata`).then((r) => r.data);

export const refreshShowMetadata = (libraryId: number) =>
  api.post<RefreshMetadataResult>(`/library/series/${libraryId}/refresh-metadata`).then((r) => r.data);
