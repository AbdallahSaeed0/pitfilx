import api from "./client";

export type SmartScanStatus = {
  isRunning: boolean;
  current: number;
  total: number;
  currentLabel: string;
  lastResult: {
    processed: number;
    autoMatched: number;
    stillUnmatched: number;
    timeTakenSeconds: number;
  } | null;
};

export const startSmartScan = () => api.post("/unmatched/smart-scan", {}).then((r) => r.data);

export const getSmartScanStatus = () => api.get<SmartScanStatus>("/unmatched/smart-scan/status").then((r) => r.data);

export const cancelSmartScan = () => api.post("/unmatched/smart-scan/cancel", {}).then((r) => r.data);
