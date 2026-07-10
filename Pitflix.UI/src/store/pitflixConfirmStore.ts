import { create } from "zustand";

type PitflixConfirmRequest = {
  message: string;
  resolve: (value: boolean) => void;
};

type PitflixConfirmState = {
  request: PitflixConfirmRequest | null;
  ask: (message: string) => Promise<boolean>;
  respond: (value: boolean) => void;
};

/** Backs `pitflixConfirm` — routes confirmation prompts through the app's own themed
 * `ConfirmDialog` instead of a native OS message box. */
export const usePitflixConfirmStore = create<PitflixConfirmState>((set, get) => ({
  request: null,
  ask: (message) =>
    new Promise<boolean>((resolve) => {
      set({ request: { message, resolve } });
    }),
  respond: (value) => {
    get().request?.resolve(value);
    set({ request: null });
  },
}));
