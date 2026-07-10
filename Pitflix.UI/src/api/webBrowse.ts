import api from "./client";

export type BrowseDownloadRequest = {
  url: string;
  type: "image" | "video" | "hls";
  pageUrl: string;
};

export type BrowseDownloadResult = {
  success: boolean;
  savedPath?: string | null;
  /** Every download now runs as a background job — this is normally true, with a
   * jobId to poll/cancel. `pending: false` (no jobId) means the request was
   * rejected before a job could even start (bad URL, ffmpeg missing, etc). */
  pending?: boolean;
  jobId?: string | null;
};

export type BrowseDownloadJobStatus = {
  status: "running" | "succeeded" | "failed" | "cancelled";
  savedPath?: string | null;
  error?: string | null;
  progressPercent?: number | null;
  bytesDone?: number | null;
  bytesTotal?: number | null;
};

export const postBrowseDownload = (body: BrowseDownloadRequest) =>
  api.post<BrowseDownloadResult>("/browse/download", body).then((r) => r.data);

export const getBrowseDownloadStatus = (jobId: string) =>
  api.get<BrowseDownloadJobStatus>(`/browse/download/${jobId}/status`).then((r) => r.data);

export const cancelBrowseDownload = (jobId: string) =>
  api.post<{ success: boolean }>(`/browse/download/${jobId}/cancel`).then((r) => r.data);
