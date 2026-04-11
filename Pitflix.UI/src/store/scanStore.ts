import { create } from "zustand";

export type ScanProgressSnapshot = {
  isRunning: boolean;
  total: number;
  current: number;
  currentFile: string;
  matched: number;
  unmatched: number;
  skipped: number;
  percent: number;
};

export type ScanCompleteSummary = {
  matched: number;
  unmatched: number;
  skipped: number;
  /** When true, scan found zero video files in the selected folders. */
  empty?: boolean;
  /** Optional user-facing message from the API. */
  message?: string;
};

const initial: ScanProgressSnapshot = {
  isRunning: false,
  total: 0,
  current: 0,
  currentFile: "",
  matched: 0,
  unmatched: 0,
  skipped: 0,
  percent: 0,
};

type ScanStore = ScanProgressSnapshot & {
  setProgress: (p: Partial<ScanProgressSnapshot>) => void;
  lastComplete: ScanCompleteSummary | null;
  setLastComplete: (s: ScanCompleteSummary | null) => void;
  reset: () => void;
};

export const useScanStore = create<ScanStore>((set) => ({
  ...initial,
  setProgress: (p) => set((s) => ({ ...s, ...p })),
  lastComplete: null,
  setLastComplete: (s) => set({ lastComplete: s }),
  reset: () => set({ ...initial, lastComplete: null }),
}));
