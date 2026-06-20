import api from "./client";

export type TrailerLookupPrimary = {
  youtubeUrl?: string | null;
  title?: string | null;
  tmdbId?: number;
  mediaType?: string | null;
};

export type TrailerLookupResponse = {
  primary: TrailerLookupPrimary | null;
};

/** Persisted / ingested trailers matched to a TMDB title (`Program.cs` `/api/trailers/{tmdbId}`). */
export function getTrailersForTmdbTitle(tmdbId: number, mediaType?: string | null) {
  return api
    .get<TrailerLookupResponse>(`/trailers/${tmdbId}`, {
      params: mediaType ? { mediaType } : undefined,
    })
    .then((r) => r.data);
}

export type TrailerEntry = {
  embedUrl: string;
  title?: string | null;
  type?: string | null;
  youtubeKey?: string | null;
};

export type TrailerEmbedResponse = {
  /** Primary / best trailer embed URL (backward-compat). */
  embedUrl: string | null;
  title?: string | null;
  error?: string | null;
  /** All available trailers, sorted by type priority (Trailer first, then Teaser, etc.). */
  trailers?: TrailerEntry[];
};

/**
 * Returns YouTube embed URLs for the given TMDB title.
 * Tries persisted trailers first (up to 5), then falls back to a live TMDB lookup.
 * Response includes both a primary `embedUrl` for backward compat and a full `trailers` list.
 */
export function getTrailerEmbedUrl(tmdbId: number, mediaType: string) {
  return api
    .get<TrailerEmbedResponse>("/trailers/embed", { params: { tmdbId, mediaType } })
    .then((r) => r.data);
}
