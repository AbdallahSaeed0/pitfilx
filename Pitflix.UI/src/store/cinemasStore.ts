import { create } from "zustand";
import { isTauri } from "@tauri-apps/api/core";
import { listen } from "@tauri-apps/api/event";
import {
  fetchPremiereListings,
  fetchVoxSchedule,
  readCachedCinemaSchedule,
  readCachedPremiereListings,
  type CinemaRefreshProgress,
  type CinemaSchedule,
  type PremiereListings,
  type VoxPartial,
} from "../api/cinemas";
import {
  followKey,
  matchCinemaTitles,
  premiereMatchRequests,
  readCachedMatches,
  readFollows,
  voxMatchRequests,
  writeFollows,
  type CinemaFollow,
  type CinemaMatch,
} from "../api/cinemaMatches";
import { detectPremiereDrops, detectVoxDrops } from "../features/cinemas/ticketDrops";
import { pushNotification } from "./notificationsStore";

export type CinemaSource = "vox" | "premiere";
/** Which ticket drops also pop a Windows notification (all of them always go to the bell). */
export type CinemaAlertMode = "important" | "all";

const ALERT_MODE_KEY = "pitflix.cinemas.alertMode";
const LAYOUT_ALERT_KEY = "pitflix.cinemas.layoutAlertedAt.v1";
/** Prefix the scrapers use when the page loaded but its structure wasn't what they expect. */
export const LAYOUT_CHANGED = "Site layout changed";

/**
 * Cinemas Schedule data, shared by the page, the Home row and the app-wide background refresh
 * (`CinemasBackgroundSync`), so a refresh started at app launch shows wherever it's needed — and
 * VOX days appear one by one as the scraper reports them.
 */
type CinemasStore = {
  vox: CinemaSchedule | null;
  premiere: PremiereListings | null;
  refreshing: Record<CinemaSource, boolean>;
  errors: Record<CinemaSource, string | null>;
  voxProgress: CinemaRefreshProgress | null;
  /** TMDB matches by `matchKey(title, year)`; `null` = no confident match. */
  matches: Record<string, CinemaMatch | null>;
  follows: Record<string, CinemaFollow>;
  alertMode: CinemaAlertMode;
  refresh: (source: CinemaSource) => Promise<void>;
  /** Matches whatever's loaded that isn't matched yet (cheap when it all is). */
  ensureMatches: () => Promise<void>;
  toggleFollow: (title: string, tmdbId: number | null) => void;
  setAlertMode: (mode: CinemaAlertMode) => void;
};

function mergeVoxPartial(base: CinemaSchedule | null, partial: VoxPartial): CinemaSchedule {
  const schedule: CinemaSchedule = base ?? {
    cinema: "vox",
    fetchedAt: 0,
    comingSoon: [],
    nowShowing: [],
    days: [],
    failedDates: [],
  };
  if (partial.kind !== "showtimes") return { ...schedule, [partial.kind]: partial.data };
  const { date, movies } = partial.data;
  const days = schedule.days.filter((d) => d.date !== date);
  days.push({ date, movies });
  days.sort((a, b) => a.date.localeCompare(b.date));
  return { ...schedule, days };
}

let listenersReady: Promise<void> | null = null;

/** Subscribes once to the Rust-side progress/partial events. */
function ensureListeners(set: (fn: (s: CinemasStore) => Partial<CinemasStore>) => void) {
  listenersReady ??= Promise.all([
    listen<CinemaRefreshProgress>("cinemas-refresh-progress", (e) => set(() => ({ voxProgress: e.payload }))),
    listen<VoxPartial>("cinemas-vox-partial", (e) => set((s) => ({ vox: mergeVoxPartial(s.vox, e.payload) }))),
  ]).then(() => undefined);
  return listenersReady;
}

/** A site redesign silently breaks scraping, so say so — once a day per chain, not every 30 min. */
function alertLayoutChanged(source: CinemaSource, message: string) {
  try {
    const seen = JSON.parse(localStorage.getItem(LAYOUT_ALERT_KEY) ?? "{}") as Record<string, number>;
    if (Date.now() - (seen[source] ?? 0) < 24 * 60 * 60_000) return;
    seen[source] = Date.now();
    localStorage.setItem(LAYOUT_ALERT_KEY, JSON.stringify(seen));
  } catch {
    /* alert anyway */
  }
  pushNotification({
    kind: "info",
    title: `Cinemas Schedule: ${source === "vox" ? "VOX" : "Premiere"}'s website changed`,
    message: `${message.replace(/^.*?Site layout changed:\s*/, "")} Showing the last schedule that loaded.`,
    href: "/cinemas",
  });
}

function readAlertMode(): CinemaAlertMode {
  try {
    return localStorage.getItem(ALERT_MODE_KEY) === "all" ? "all" : "important";
  } catch {
    return "important";
  }
}

export const useCinemasStore = create<CinemasStore>((set, get) => ({
  vox: readCachedCinemaSchedule(),
  premiere: readCachedPremiereListings(),
  refreshing: { vox: false, premiere: false },
  errors: { vox: null, premiere: null },
  voxProgress: null,
  matches: readCachedMatches(),
  follows: readFollows(),
  alertMode: readAlertMode(),

  refresh: async (source) => {
    if (!isTauri() || get().refreshing[source]) return;
    set((s) => ({ refreshing: { ...s.refreshing, [source]: true }, errors: { ...s.errors, [source]: null } }));
    try {
      if (source === "vox") {
        await ensureListeners(set);
        const schedule = await fetchVoxSchedule();
        set({ vox: schedule });
        // Matched first so drops know which films are on the watchlist / followed.
        await get().ensureMatches();
        await detectVoxDrops(schedule, get());
      } else {
        const listings = await fetchPremiereListings();
        set({ premiere: listings });
        await get().ensureMatches();
        await detectPremiereDrops(listings, get());
      }
    } catch (e) {
      const message = e instanceof Error ? e.message : String(e);
      set((s) => ({ errors: { ...s.errors, [source]: message } }));
      if (message.includes(LAYOUT_CHANGED)) alertLayoutChanged(source, message);
    } finally {
      set((s) => ({
        refreshing: { ...s.refreshing, [source]: false },
        ...(source === "vox" ? { voxProgress: null } : {}),
      }));
    }
  },

  ensureMatches: async () => {
    const { vox, premiere } = get();
    const requests = [...(vox ? voxMatchRequests(vox) : []), ...(premiere ? premiereMatchRequests(premiere) : [])];
    if (requests.length === 0) return;
    try {
      set({ matches: await matchCinemaTitles(requests) });
    } catch {
      /* API down — the page works without matches */
    }
  },

  toggleFollow: (title, tmdbId) => {
    const follows = { ...get().follows };
    const keys = [followKey(title, tmdbId), followKey(title, null)];
    if (keys.some((k) => follows[k])) for (const k of keys) delete follows[k];
    else follows[keys[0]] = { title, tmdbId, at: Date.now() };
    writeFollows(follows);
    set({ follows });
  },

  setAlertMode: (mode) => {
    try {
      localStorage.setItem(ALERT_MODE_KEY, mode);
    } catch {
      /* per-viewer convenience */
    }
    set({ alertMode: mode });
  },
}));
