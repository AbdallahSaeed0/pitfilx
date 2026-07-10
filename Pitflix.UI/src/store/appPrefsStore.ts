import { create } from "zustand";
import { persist } from "zustand/middleware";

export type AppNavLayout = "sidebar" | "topDock" | "floatingDock";

/**
 * Visual direction for the Home "Continue Watching" + "Up Next" sections.
 * "classic" is the existing Pitflix hero + carousel; 1a-1d are the design-handoff explorations.
 */
export type LibrarySectionsStyle = "classic" | "1a" | "1b" | "1c" | "1d";

type AppPrefsState = {
  /** Where primary navigation lives in the app shell. */
  navLayout: AppNavLayout;
  setNavLayout: (value: AppNavLayout) => void;
  /** Visual direction for the Home Continue Watching / Up Next sections. */
  librarySectionsStyle: LibrarySectionsStyle;
  setLibrarySectionsStyle: (value: LibrarySectionsStyle) => void;
  /** When true, the desktop app checks for updates once after launch (never auto-installs). */
  checkUpdatesOnStartup: boolean;
  setCheckUpdatesOnStartup: (value: boolean) => void;
  /** When true, all internet-dependent features are disabled (streaming, trailers, TMDB lookups). */
  offlineMode: boolean;
  setOfflineMode: (value: boolean) => void;
  /** When false, the Live TV nav item and route are hidden entirely. */
  liveTvEnabled: boolean;
  setLiveTvEnabled: (value: boolean) => void;
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
      navLayout: "sidebar",
      setNavLayout: (navLayout) => set({ navLayout }),
      librarySectionsStyle: "classic",
      setLibrarySectionsStyle: (librarySectionsStyle) => set({ librarySectionsStyle }),
      checkUpdatesOnStartup: false,
      setCheckUpdatesOnStartup: (checkUpdatesOnStartup) => set({ checkUpdatesOnStartup }),
      offlineMode: false,
      setOfflineMode: (offlineMode) => set({ offlineMode }),
      liveTvEnabled: true,
      setLiveTvEnabled: (liveTvEnabled) => set({ liveTvEnabled }),
      defaultSpoilerProtection: false,
      setDefaultSpoilerProtection: (defaultSpoilerProtection) => set({ defaultSpoilerProtection }),
      playerMode: "detached",
      setPlayerMode: (playerMode) => set({ playerMode }),
    }),
    { name: "pitflix-app-prefs" },
  ),
);
