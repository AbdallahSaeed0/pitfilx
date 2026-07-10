import api from "./client";

export type TvTimeReviewItem = {
  name: string;
  status: "unmatched" | "low";
  totalEpisodes?: number;
  seasons?: { season: number; episodeCount: number }[];
  watchCount?: number;
};

export const getTvTimeUnmatched = (mediaType: "show" | "movie" = "show"): Promise<TvTimeReviewItem[]> =>
  api.get("/tvtime-review/unmatched", { params: { mediaType } }).then((r) => r.data);

export const matchTvTimeShow = (body: {
  name: string;
  tmdbId: number | null;
  title?: string;
  year?: string;
  mediaType?: "show" | "movie";
}) => api.post("/tvtime-review/match", body).then((r) => r.data);
