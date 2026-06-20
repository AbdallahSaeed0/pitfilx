import api from "./client";

export type RatingsAggregate = {
  fetchedAtUtc: string;
  tmdbVoteAverage: number | null;
  tmdbVoteCount: number | null;
  imdbId: string | null;
  imdbRatingDisplay: string | null;
  imdbVoteCountDisplay: string | null;
  /** e.g. php-imdb-detail, omdb */
  imdbRatingSource?: string | null;
  rottenTomatoesCritics: string | null;
  rottenTomatoesAudience: string | null;
  omdbResolvedVia?: string | null;
  omdbMatchKind?: string | null;
  /** Present when row came from persisted snapshot (aggregate endpoint). */
  fromSnapshot?: boolean;
  isStale?: boolean;
};

/** Unified shape for <RatingsPanel /> (persisted route first, then aggregate fallback). */
export type RatingsPanelData = RatingsAggregate & {
  /** True when this response was built from GET /ratings/{tmdbId} (first-time seed). */
  seeded?: boolean;
};

const SOURCE_MASK_OMDB = 2;
const SOURCE_MASK_PHP = 4;

function imdbSourceFromSnapshot(sourceMask: number, hasImdbRating: boolean): string | null {
  if (!hasImdbRating) return null;
  if ((sourceMask & SOURCE_MASK_OMDB) !== 0) return "omdb";
  if ((sourceMask & SOURCE_MASK_PHP) !== 0) return "php-imdb-detail";
  return "tmdb";
}

type PersistedOk = {
  ok: true;
  seeded: boolean;
  isStale: boolean;
  tmdbId: number;
  mediaType: "movie" | "tv";
  tmdbRating: number | null;
  tmdbVoteCount: number | null;
  imdbId: string | null;
  imdbRating: string | null;
  imdbVotes: string | null;
  rtCritics: string | null;
  rtAudience: string | null;
  confidence: number;
  sourceMask: number;
  refreshTier: string;
  updated: string;
  nextRefresh: string;
};

function mapPersistedToPanel(d: PersistedOk): RatingsPanelData {
  const hasImdb = !!(d.imdbRating && d.imdbRating.trim() !== "");
  return {
    fetchedAtUtc: d.updated,
    tmdbVoteAverage: d.tmdbRating,
    tmdbVoteCount: d.tmdbVoteCount,
    imdbId: d.imdbId,
    imdbRatingDisplay: d.imdbRating,
    imdbVoteCountDisplay: d.imdbVotes,
    imdbRatingSource: imdbSourceFromSnapshot(d.sourceMask, hasImdb),
    rottenTomatoesCritics: d.rtCritics,
    rottenTomatoesAudience: d.rtAudience,
    omdbResolvedVia: "persisted",
    omdbMatchKind: d.seeded ? "persisted_seeded" : "persisted",
    fromSnapshot: true,
    isStale: d.isStale,
    seeded: d.seeded,
  };
}

/** Prefer persisted snapshot; on miss or error fall back to aggregate (live / cache). */
export async function loadRatingsPanelData(tmdbId: number, mediaType: "movie" | "tv"): Promise<RatingsPanelData> {
  try {
    const res = await api.get<PersistedOk | { ok: false; reason?: string }>(`/ratings/${tmdbId}`, {
      params: { mediaType },
      validateStatus: (s) => s === 200 || s === 400 || s === 404 || s === 503,
    });
    const body = res.data;
    if (res.status === 200 && body && typeof body === "object" && "ok" in body && body.ok === true) {
      return mapPersistedToPanel(body as PersistedOk);
    }
  } catch {
    // network — fall through
  }

  const agg = await getRatingsAggregate(tmdbId, mediaType);
  return {
    ...agg,
    seeded: false,
    isStale: agg.isStale ?? false,
    fromSnapshot: agg.fromSnapshot ?? false,
  };
}

export const getRatingsAggregate = (tmdbId: number, mediaType: "movie" | "tv") =>
  api
    .get<RatingsAggregate>("/ratings/aggregate", { params: { tmdbId, mediaType } })
    .then((r) => r.data);

export type EpisodeRating = { voteAverage: number; source: string };

export const getEpisodeRating = (tvTmdbId: number, season: number, episodeNumber: number) =>
  api
    .get<EpisodeRating | null>("/ratings/episode", {
      params: { tvTmdbId, season, episodeNumber },
    })
    .then((r) => r.data);

export type QueueLibraryRatingsResult = {
  ok: boolean;
  accepted: number;
  movies: number;
  shows: number;
  cap: number;
};

export type RatingsQueueStatus = {
  ok: boolean;
  active: boolean;
  queueDepth: number;
  isProcessing: boolean;
  processedTotal: number;
  lastProcessedUtc: string | null;
  lastError: string | null;
  coverage: {
    total: number;
    withImdb: number;
    withRottenTomatoes: number;
    tmdbOnly: number;
    hasImdbIdButNoImdbScore: number;
  };
};

export const getRatingsQueueStatus = async (): Promise<RatingsQueueStatus | null> => {
  const res = await api.get<RatingsQueueStatus>("/ratings/queue/status", {
    validateStatus: (s) => s === 200 || s === 404,
  });
  if (res.status === 404) return null;
  return res.data;
};

/** Queues enrichment for matched library titles (split movies / TV, capped). Same optional auth as re-enrich. */
export const queueRatingsLibraryBackfill = (opts?: { limit?: number; maintenanceKey?: string }) =>
  api
    .post<QueueLibraryRatingsResult>(
      "/ratings/queue-library",
      {},
      {
        params: { limit: opts?.limit ?? 500 },
        headers: opts?.maintenanceKey
          ? { "X-Pitflix-Ratings-ReEnrich-Key": opts.maintenanceKey }
          : undefined,
      },
    )
    .then((r) => r.data);

/** Enqueues background stale snapshot refresh (same as empty-body POST /ratings/re-enrich). */
export const queueRatingsStaleSweep = (maintenanceKey?: string) =>
  api.post<{ ok: boolean; queued: string }>(
    "/ratings/re-enrich",
    {},
    {
      headers: maintenanceKey ? { "X-Pitflix-Ratings-ReEnrich-Key": maintenanceKey } : undefined,
    },
  ).then((r) => r.data);
