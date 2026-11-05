import { useEffect } from "react";
import { useQueryClient, type QueryClient } from "@tanstack/react-query";
import { isTauri } from "@tauri-apps/api/core";
import {
  CINEMA_REFRESH_INTERVAL_MS,
  fetchPremiereShowtimes,
  premiereViewedAt,
  premiereWeekDates,
  readStoredBranch,
} from "../../api/cinemas";
import { useAppPrefsStore } from "../../store/appPrefsStore";
import { useCinemasStore, type CinemaSource } from "../../store/cinemasStore";
import { cairoToday } from "./cinemaTime";

/** Let the app finish launching before spinning up hidden webviews. */
const STARTUP_DELAY_MS = 20_000;
/** A refresh this recent (e.g. the app was just restarted) is good enough to skip. */
const MIN_AGE_MS = 10 * 60_000;
/**
 * Premiere times preload at most this often (background priority, 3 windows). Must stay under
 * PREMIERE_TIMES_MAX_AGE_MS in `api/cinemas.ts` so switching days never hits a gap.
 */
const PREMIERE_PREFETCH_EVERY_MS = 2 * 60 * 60_000;
const PREMIERE_PREFETCH_KEY = "pitflix.cinemas.premiere.prefetchedAt.v2";
/** No preload at all unless Premiere's showtimes were opened this recently. */
const PREMIERE_RECENT_USE_MS = 14 * 24 * 60 * 60_000;
/** With "All branches" picked, only these first days are preloaded; later ones load when opened. */
const ALL_BRANCHES_DAYS = 2;

/**
 * Preloads Premiere showtimes into the same query keys the page reads, so browsing is instant —
 * kept light, since every movie means clicking through Premiere's pickers in a hidden window:
 * - Only if Premiere's showtimes were opened in the last two weeks.
 * - A picked branch: that branch only, whole week, only films playing there (~7s a film).
 * - "All branches": every branch, but only today and tomorrow (~10s a film instead of ~30s for
 *   the week); later days load when opened.
 * Re-runs every PREMIERE_PREFETCH_EVERY_MS, or as soon as the day or the picked branch changes.
 */
function prefetchPremiere(queryClient: QueryClient) {
  const listings = useCinemasStore.getState().premiere;
  if (!listings || Date.now() - premiereViewedAt() > PREMIERE_RECENT_USE_MS) return;

  const today = cairoToday();
  const branch = readStoredBranch("premiere");
  const plan = `${today}|${branch}`;
  try {
    const last = JSON.parse(localStorage.getItem(PREMIERE_PREFETCH_KEY) ?? "null") as { plan: string; at: number } | null;
    if (last && last.plan === plan && Date.now() - last.at < PREMIERE_PREFETCH_EVERY_MS) return;
    localStorage.setItem(PREMIERE_PREFETCH_KEY, JSON.stringify({ plan, at: Date.now() }));
  } catch {
    /* fall through and prefetch */
  }

  const cinema = branch === "all" ? null : branch;
  const week = premiereWeekDates(today);
  const dates = cinema ? week : week.slice(0, ALL_BRANCHES_DAYS);
  for (const movie of listings.nowShowing) {
    if (cinema && !movie.cinemas.includes(cinema)) continue;
    fetchPremiereShowtimes(movie.id, dates, cinema, undefined, "background")
      .then((byDate) => {
        for (const [date, times] of Object.entries(byDate)) {
          queryClient.setQueryData(["premiere-times", movie.id, date, cinema], times);
        }
      })
      .catch(() => {
        /* best-effort — the page loads that movie on demand */
      });
  }
}

/**
 * Keeps the Cinemas Schedule fresh while the app is open — shortly after launch, then every
 * CINEMA_REFRESH_INTERVAL_MS — whether or not the page is open. Each refresh also checks for
 * newly bookable movies (see `ticketDrops.ts`). Mounted once, globally (see App.tsx).
 */
export function CinemasBackgroundSync() {
  const queryClient = useQueryClient();
  const cinemasEnabled = useAppPrefsStore((s) => s.cinemasEnabled);

  useEffect(() => {
    // Off (the default): no hidden scraper windows, no ticket checks.
    if (!isTauri() || !cinemasEnabled) return;

    const refreshIfDue = async (source: CinemaSource) => {
      const store = useCinemasStore.getState();
      const data = source === "vox" ? store.vox : store.premiere;
      if (data && data.fetchedAt > 0 && Date.now() - data.fetchedAt < MIN_AGE_MS) return;
      await store.refresh(source);
    };

    const run = () => {
      void refreshIfDue("vox");
      void refreshIfDue("premiere").then(() => prefetchPremiere(queryClient));
    };

    const first = window.setTimeout(run, STARTUP_DELAY_MS);
    const interval = window.setInterval(run, CINEMA_REFRESH_INTERVAL_MS);
    return () => {
      window.clearTimeout(first);
      window.clearInterval(interval);
    };
  }, [queryClient, cinemasEnabled]);

  return null;
}
