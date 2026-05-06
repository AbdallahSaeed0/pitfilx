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

/** Toast when background auto-scan indexes a new file (pinned folders or hourly library pass). */
export type LibraryAddToastPayload = {
  title: string;
  kind: string;
  matched: boolean;
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
  libraryToastVisible: LibraryAddToastPayload | null;
  libraryToastQueue: LibraryAddToastPayload[];
  pushLibraryToast: (p: LibraryAddToastPayload) => void;
  dismissLibraryToast: () => void;
  reset: () => void;
};

export const useScanStore = create<ScanStore>((set) => ({
  ...initial,
  setProgress: (p) => set((s) => ({ ...s, ...p })),
  lastComplete: null,
  setLastComplete: (s) => set({ lastComplete: s }),
  libraryToastVisible: null,
  libraryToastQueue: [],
  pushLibraryToast: (p) =>
    set((s) => {
      if (!s.libraryToastVisible) return { libraryToastVisible: p };
      return { libraryToastQueue: [...s.libraryToastQueue, p] };
    }),
  dismissLibraryToast: () =>
    set((s) => {
      const [next, ...rest] = s.libraryToastQueue;
      return { libraryToastVisible: next ?? null, libraryToastQueue: rest };
    }),
  reset: () =>
    set({
      ...initial,
      lastComplete: null,
      libraryToastVisible: null,
      libraryToastQueue: [],
    }),
}));
