import { isTauri } from "@tauri-apps/api/core";
import { isPermissionGranted, requestPermission, sendNotification } from "@tauri-apps/plugin-notification";
import type { CinemaSchedule, PremiereListings } from "../../api/cinemas";
import {
  isFollowedIn,
  loadWatchlistTmdbIds,
  matchKey,
  premiereNowShowingYear,
  voxYearFor,
  type CinemaFollow,
  type CinemaMatch,
} from "../../api/cinemaMatches";
import { pushNotification } from "../../store/notificationsStore";

/**
 * "Tickets on sale" detection. Chains open bookings well before release, so after each refresh
 * we compare what's bookable now with what we've seen before:
 * - VOX: a movie with showtimes on any date (its date bar includes far-off advance-booking dates).
 * - Premiere: a movie on the now-showing page (which is where its "Pre-book" titles appear).
 *
 * Each bookable movie is remembered with when it was last seen, and only one we've never seen
 * (or haven't for SEEN_TTL) counts as new — so a refresh that misses a date, then catches it
 * next time, doesn't re-announce it.
 *
 * Every drop goes to the bell; a Windows toast is only for films on the watchlist or followed
 * with "Notify me" (or for all of them, if the user picked that on the page).
 */

const KEY = "pitflix.cinemas.bookable.v1";
const RECENT_KEY = "pitflix.cinemas.recentDrops.v1";
const SEEN_TTL_MS = 30 * 24 * 60 * 60 * 1000;
const RECENT_TTL_MS = 14 * 24 * 60 * 60 * 1000;
const MAX_RECENT = 30;
/** More toasts than this in one refresh become a single summary toast. */
const MAX_TOASTS = 3;

type Chain = "vox" | "premiere";
/** chain → movie key → last seen (epoch ms). A chain missing entirely = never checked. */
type Seen = Partial<Record<Chain, Record<string, number>>>;

export type DropContext = {
  matches: Record<string, CinemaMatch | null>;
  follows: Record<string, CinemaFollow>;
  alertMode: "important" | "all";
};

type Bookable = { title: string; firstDate: string | null; posterUrl: string | null; year: number | null };

export type RecentDrop = {
  title: string;
  chain: Chain;
  firstDate: string | null;
  posterUrl: string | null;
  tmdbId: number | null;
  /** On the watchlist or followed. */
  important: boolean;
  reason: "watchlist" | "followed" | null;
  at: number;
};

const CHAIN_NAMES: Record<Chain, string> = { vox: "VOX Cinemas", premiere: "Premiere Cinemas" };

function loadJson<T>(key: string, fallback: T): T {
  try {
    return JSON.parse(localStorage.getItem(key) ?? "null") ?? fallback;
  } catch {
    return fallback;
  }
}

function saveJson(key: string, value: unknown) {
  try {
    localStorage.setItem(key, JSON.stringify(value));
  } catch {
    /* best-effort */
  }
}

const normTitle = (t: string) => t.toLowerCase().replace(/[^a-z0-9]+/g, "");

/** Drops from the last two weeks, newest first (for the Home row). */
export function readRecentDrops(): RecentDrop[] {
  const cutoff = Date.now() - RECENT_TTL_MS;
  return loadJson<RecentDrop[]>(RECENT_KEY, []).filter((d) => d.at >= cutoff);
}

/** Records `bookable` (key → info) for `chain` and returns the ones not seen before. */
function diff(chain: Chain, bookable: Map<string, Bookable>): Bookable[] {
  const seen = loadJson<Seen>(KEY, {});
  const now = Date.now();
  const previous = seen[chain];
  const next: Record<string, number> = {};
  for (const [key, ts] of Object.entries(previous ?? {})) if (now - ts < SEEN_TTL_MS) next[key] = ts;
  const fresh: Bookable[] = [];
  for (const [key, info] of bookable) {
    // First check for this chain: seed silently rather than announcing everything on sale.
    if (previous && !(key in next)) fresh.push(info);
    next[key] = now;
  }
  seen[chain] = next;
  saveJson(KEY, seen);
  return fresh;
}

export async function detectVoxDrops(schedule: CinemaSchedule, ctx: DropContext) {
  const posters = new Map<string, string>();
  for (const m of [...schedule.nowShowing, ...schedule.comingSoon]) if (m.posterUrl) posters.set(m.slug, m.posterUrl);
  const bookable = new Map<string, Bookable>();
  for (const day of [...schedule.days].sort((a, b) => a.date.localeCompare(b.date))) {
    for (const m of day.movies) {
      if (bookable.has(m.slug)) continue;
      bookable.set(m.slug, {
        title: m.title,
        firstDate: day.date,
        posterUrl: posters.get(m.slug) ?? m.heroUrl,
        year: voxYearFor(m.title, schedule),
      });
    }
  }
  // A refresh that came back empty is a failure, not "everything stopped selling".
  if (bookable.size > 0) await announce("vox", diff("vox", bookable), ctx);
}

export async function detectPremiereDrops(listings: PremiereListings, ctx: DropContext) {
  const bookable = new Map<string, Bookable>();
  for (const m of listings.nowShowing) {
    bookable.set(normTitle(m.title), {
      title: m.title,
      firstDate: null,
      posterUrl: m.posterUrl,
      year: premiereNowShowingYear(m.info),
    });
  }
  if (bookable.size > 0) await announce("premiere", diff("premiere", bookable), ctx);
}

function fmtDay(isoDate: string) {
  return new Date(`${isoDate}T12:00:00Z`).toLocaleDateString("en-GB", {
    weekday: "short",
    day: "numeric",
    month: "short",
    timeZone: "UTC",
  });
}

function describe(d: RecentDrop) {
  const parts = [CHAIN_NAMES[d.chain]];
  if (d.firstDate) parts.push(`first show ${fmtDay(d.firstDate)}`);
  if (d.reason === "watchlist") parts.push("on your watchlist");
  if (d.reason === "followed") parts.push("you asked to be notified");
  return parts.join(" · ");
}

async function announce(chain: Chain, fresh: Bookable[], ctx: DropContext) {
  if (fresh.length === 0) return;
  const watchlist = await loadWatchlistTmdbIds();
  const now = Date.now();
  const drops: RecentDrop[] = fresh.map((b) => {
    const tmdbId = ctx.matches[matchKey(b.title, b.year)]?.tmdbId ?? null;
    const reason =
      tmdbId && watchlist.has(tmdbId) ? "watchlist" : isFollowedIn(ctx.follows, b.title, tmdbId) ? "followed" : null;
    return { title: b.title, chain, firstDate: b.firstDate, posterUrl: b.posterUrl, tmdbId, important: !!reason, reason, at: now };
  });

  for (const d of drops) {
    pushNotification({
      kind: "tickets",
      title: `${d.important ? "★ " : ""}${d.title}: tickets on sale`,
      message: describe(d),
      href: "/cinemas",
    });
  }
  saveJson(RECENT_KEY, [...drops, ...readRecentDrops()].slice(0, MAX_RECENT));
  await toast(ctx.alertMode === "all" ? drops : drops.filter((d) => d.important));
}

/** Windows toast, so a drop is noticed even when Pitflix is in the background. */
async function toast(drops: RecentDrop[]) {
  if (!isTauri() || drops.length === 0) return;
  try {
    let granted = await isPermissionGranted();
    if (!granted) granted = (await requestPermission()) === "granted";
    if (!granted) return;
    if (drops.length > MAX_TOASTS) {
      sendNotification({
        title: `${drops.length} movies just opened for booking`,
        body: drops.map((d) => d.title).join(", "),
      });
      return;
    }
    for (const d of drops) sendNotification({ title: `Tickets on sale: ${d.title}`, body: describe(d) });
  } catch {
    /* the bell entry is already there */
  }
}
