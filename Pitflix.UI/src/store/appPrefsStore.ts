import { create } from "zustand";
import { persist } from "zustand/middleware";

export type AppNavLayout = "sidebar" | "topDock" | "floatingDock";

/**
 * Visual direction for the Home "Continue Watching" + "Up Next" sections.
 * "classic" is the existing Pitflix hero + carousel; the rest are the Home redesign directions.
 */
export const LIBRARY_SECTIONS_STYLES = ["classic", "billboard", "preview", "backdropRow", "posterShelf"] as const;
export type LibrarySectionsStyle = (typeof LIBRARY_SECTIONS_STYLES)[number];

/**
 * Layout of the movie / series detail pages. "cinematic" is the full-bleed hero with tabs (series)
 * or a side "Your copy" panel (movies); "dossier" is the two-column poster + facts layout.
 */
export const DETAIL_LAYOUTS = ["classic", "cinematic", "dossier"] as const;
export type DetailLayout = (typeof DETAIL_LAYOUTS)[number];

/** Art used by Up Next tiles in the "preview" layout (Apple TV-style still vs poster choice). */
export type UpNextArtStyle = "still" | "poster";

type AppPrefsState = {
  /** Where primary navigation lives in the app shell. */
  navLayout: AppNavLayout;
  setNavLayout: (value: AppNavLayout) => void;
  /** Visual direction for the Home Continue Watching / Up Next sections. */
  librarySectionsStyle: LibrarySectionsStyle;
  setLibrarySectionsStyle: (value: LibrarySectionsStyle) => void;
  upNextArtStyle: UpNextArtStyle;
  setUpNextArtStyle: (value: UpNextArtStyle) => void;
  detailLayout: DetailLayout;
  setDetailLayout: (value: DetailLayout) => void;
  /** When true, the desktop app checks for updates once after launch (never auto-installs). */
  checkUpdatesOnStartup: boolean;
  setCheckUpdatesOnStartup: (value: boolean) => void;
  /** When true, all internet-dependent features are disabled (streaming, trailers, TMDB lookups). */
  offlineMode: boolean;
  setOfflineMode: (value: boolean) => void;
  /** Backend couldn't reach the internet (not persisted — refreshed from /api/offline/status). */
  detectedOffline: boolean;
  setDetectedOffline: (value: boolean) => void;
  /** When false, the Live TV nav item and route are hidden entirely. */
  liveTvEnabled: boolean;
  setLiveTvEnabled: (value: boolean) => void;
  /**
   * When false (the default), Cinemas Schedule is off entirely: no nav item, route or Home row,
   * and no background refresh (so no hidden scraper windows or ticket alerts).
   */
  cinemasEnabled: boolean;
  setCinemasEnabled: (value: boolean) => void;
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
  /**
   * Network-level (sub-resource) ad blocking for the embedded Browse tab
   * webview. Independent of the always-on cosmetic ad hiding — an escape
   * hatch in case this breaks a specific site. Applied to the Rust-side
   * `NetworkState` each time the Browse tab mounts (see `BrowsePage.tsx`),
   * since that state is per-process and doesn't persist itself.
   */
  browseAdBlockEnabled: boolean;
  setBrowseAdBlockEnabled: (value: boolean) => void;
  /**
   * Liquid glass (refracting rim) on floating chrome: the dock, player HUDs, menus and chips.
   * When false they fall back to plain frosted blur. Needs Chromium/WebView2.
   */
  liquidGlass: boolean;
  setLiquidGlass: (value: boolean) => void;
};

/** Offline either by choice (Settings) or because the backend can't reach the internet. */
export const selectEffectiveOffline = (s: AppPrefsState) => s.offlineMode || s.detectedOffline;

export const useAppPrefsStore = create<AppPrefsState>()(
  persist(
    (set) => ({
      navLayout: "sidebar",
      setNavLayout: (navLayout) => set({ navLayout }),
      librarySectionsStyle: "classic",
      setLibrarySectionsStyle: (librarySectionsStyle) => set({ librarySectionsStyle }),
      upNextArtStyle: "still",
      setUpNextArtStyle: (upNextArtStyle) => set({ upNextArtStyle }),
      detailLayout: "classic",
      setDetailLayout: (detailLayout) => set({ detailLayout }),
      checkUpdatesOnStartup: false,
      setCheckUpdatesOnStartup: (checkUpdatesOnStartup) => set({ checkUpdatesOnStartup }),
      offlineMode: false,
      setOfflineMode: (offlineMode) => set({ offlineMode }),
      detectedOffline: false,
      setDetectedOffline: (detectedOffline) => set({ detectedOffline }),
      liveTvEnabled: true,
      setLiveTvEnabled: (liveTvEnabled) => set({ liveTvEnabled }),
      cinemasEnabled: false,
      setCinemasEnabled: (cinemasEnabled) => set({ cinemasEnabled }),
      defaultSpoilerProtection: false,
      setDefaultSpoilerProtection: (defaultSpoilerProtection) => set({ defaultSpoilerProtection }),
      playerMode: "detached",
      setPlayerMode: (playerMode) => set({ playerMode }),
      browseAdBlockEnabled: true,
      setBrowseAdBlockEnabled: (browseAdBlockEnabled) => set({ browseAdBlockEnabled }),
      liquidGlass: true,
      setLiquidGlass: (liquidGlass) => set({ liquidGlass }),
    }),
    {
      name: "pitflix-app-prefs",
      version: 1,
      // v0 stored the retired "1a"-"1d" layout ids — anything unknown falls back to Classic.
      migrate: (persisted) => {
        const state = (persisted ?? {}) as Partial<AppPrefsState>;
        if (!LIBRARY_SECTIONS_STYLES.includes(state.librarySectionsStyle as LibrarySectionsStyle))
          state.librarySectionsStyle = "classic";
        return state as AppPrefsState;
      },
      // detectedOffline is live backend state, never a saved preference.
      partialize: ({ detectedOffline: _detected, setDetectedOffline: _set, ...rest }) => rest,
    },
  ),
);
