import api from "./client";

export const clearImageCache = () =>
  api.post<{ success: boolean; deleted: number; message: string }>("/maintenance/clear-image-cache").then((r) => r.data);

export const clearRatingsCache = () =>
  api.post<{ success: boolean; deleted: number; message: string }>("/maintenance/clear-ratings-cache").then((r) => r.data);
