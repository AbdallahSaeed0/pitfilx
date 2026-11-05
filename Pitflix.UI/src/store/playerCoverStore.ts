import { create } from "zustand";

/**
 * While the full player is open, the page it was opened from stays mounted underneath it (hidden,
 * see AppRoutes in App.tsx) so closing the player doesn't rebuild that page from scratch. This
 * store says when that's the case, so the hidden page's always-on listeners (keyboard shortcuts,
 * drag-the-window-from-empty-space) can stand down instead of reacting to input meant for the player.
 */
type PlayerCoverState = {
  covering: boolean;
  /** The page kept alive under the player (path + query), or null when the player isn't open. */
  pageUnderPlayer: { pathname: string; search: string } | null;
  set: (covering: boolean, pageUnderPlayer: { pathname: string; search: string } | null) => void;
};

export const usePlayerCoverStore = create<PlayerCoverState>((set) => ({
  covering: false,
  pageUnderPlayer: null,
  set: (covering, pageUnderPlayer) => set({ covering, pageUnderPlayer }),
}));

/** True while the full player covers the app — hidden pages must ignore keyboard/pointer input. */
export function isPlayerCovering(): boolean {
  return usePlayerCoverStore.getState().covering;
}
