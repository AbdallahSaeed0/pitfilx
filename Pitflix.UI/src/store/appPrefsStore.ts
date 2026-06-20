import { create } from "zustand";
import { persist } from "zustand/middleware";

type AppPrefsState = {
  /** When true, the desktop app checks for updates once after launch (never auto-installs). */
  checkUpdatesOnStartup: boolean;
  setCheckUpdatesOnStartup: (value: boolean) => void;
  /** When true, all internet-dependent features are disabled (streaming, trailers, TMDB lookups). */
  offlineMode: boolean;
  setOfflineMode: (value: boolean) => void;
  /**
   * Default spoiler-protection state for episode pages.
   * When true every season page opens with spoilers hidden.
   * The per-page toggle in the episodes toolbar can still override it for that session.
   */
  defaultSpoilerProtection: boolean;
  setDefaultSpoilerProtection: (value: boolean) => void;
  /**
   * Built-in player window mode.
   * "detached" — mpv opens as a normal floating window (default).
   * "remote"   — mpv opens fullscreen; the Pitflix window becomes a live remote control.
   */
  playerMode: "detached" | "remote";
  setPlayerMode: (value: "detached" | "remote") => void;
};

export const useAppPrefsStore = create<AppPrefsState>()(
  persist(
    (set) => ({
      checkUpdatesOnStartup: false,
      setCheckUpdatesOnStartup: (checkUpdatesOnStartup) => set({ checkUpdatesOnStartup }),
      offlineMode: false,
      setOfflineMode: (offlineMode) => set({ offlineMode }),
      defaultSpoilerProtection: false,
      setDefaultSpoilerProtection: (defaultSpoilerProtection) => set({ defaultSpoilerProtection }),
      playerMode: "detached",
      setPlayerMode: (playerMode) => set({ playerMode }),
    }),
    { name: "pitflix-app-prefs" },
  ),
);
