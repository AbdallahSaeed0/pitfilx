import api from "./client";

export const getUnmatched = (params?: Record<string, string | number | undefined>) =>
  api.get("/unmatched", { params }).then((r) => r.data);

export const matchUnmatched = (id: number, body: { tmdbId: number; mediaType: string }) =>
  api.post(`/unmatched/${id}/match`, body).then((r) => r.data);

export const bulkMatchUnmatched = (body: {
  ids: number[];
  tmdbId: number;
  mediaType: string;
  title?: string;
}) => api.post("/unmatched/bulk-match", body).then((r) => r.data);

export const skipUnmatched = (id: number) =>
  api.post(`/unmatched/${id}/skip`, {}).then((r) => r.data);

export const searchUnmatched = (body: { query: string; mediaType: string }) =>
  api.post("/unmatched/search", body).then((r) => r.data);

export const clearAllUnmatched = () =>
  api.post("/unmatched/clear-all", {}).then((r) => r.data);
