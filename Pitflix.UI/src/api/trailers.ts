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
