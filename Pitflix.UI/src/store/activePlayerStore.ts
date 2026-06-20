import { create } from "zustand";
import type { PlaybackLaunchState } from "../types/playback";

type ActivePlayerState = {
  /** The most-recent PlaybackLaunchState from the built-in player. Cleared when playback idles out. */
  launchState: PlaybackLaunchState | null;
  setLaunchState: (s: PlaybackLaunchState | null) => void;
  /** True while an episode/sibling switch is in progress. Prevents the global IPC-error listener
   *  and BackToPlayerChip from clearing launchState mid-switch. */
  switchInProgress: boolean;
  setSwitchInProgress: (v: boolean) => void;
};

export const useActivePlayerStore = create<ActivePlayerState>((set) => ({
  launchState: null,
  setLaunchState: (launchState) => set({ launchState }),
  switchInProgress: false,
  setSwitchInProgress: (switchInProgress) => set({ switchInProgress }),
}));
