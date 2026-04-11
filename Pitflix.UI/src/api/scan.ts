import api from "./client";

export const startScan = (body: { folders: string[] }) =>
  api.post("/scan/start", body).then((r) => r.data);

export const getScanProgress = () => api.get("/scan/progress").then((r) => r.data);

export const cancelScan = () => api.post("/scan/cancel", {}).then((r) => r.data);
