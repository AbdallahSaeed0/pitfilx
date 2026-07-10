import api from "./client";

export const getPerson = (tmdbId: number) => api.get(`/people/${tmdbId}`).then((r) => r.data);

export type CreditRatings = {
  key: string;
  tmdbRating: number | null;
  imdbRating: string | null;
  rtCritics: string | null;
  rtAudience: string | null;
  metacritic: number | null;
  letterboxd: number | null;
  trakt: number | null;
};

/** Reads ratings from the local cache; optionally queues background enrichment for missing IMDb scores. */
export const getBatchCachedRatings = (ids: string[], queueMissing = true): Promise<CreditRatings[]> =>
  api
    .get<{ results: CreditRatings[] }>("/ratings/batch-cached", {
      params: { ids: ids.join(","), queueMissing: queueMissing ? "true" : "false" },
    })
    .then((r) => r.data.results);

export type PersonStreamCredit = {
  id: number;
  title: string;
  mediaType: "Movie" | "Series";
  posterUrl: string | null;
  year: string | null;
  voteAverage: number;
  character?: string | null;
  job?: string | null;
  creditType: "cast" | "crew";
};

export const getPersonStreamCredits = (tmdbId: number) =>
  api
    .get<{ cast: PersonStreamCredit[]; crew: PersonStreamCredit[]; error: string | null }>(`/people/${tmdbId}/stream-credits`)
    .then((r) => r.data);
