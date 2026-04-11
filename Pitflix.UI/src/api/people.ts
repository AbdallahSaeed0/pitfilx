import api from "./client";

export const getPerson = (tmdbId: number) => api.get(`/people/${tmdbId}`).then((r) => r.data);
