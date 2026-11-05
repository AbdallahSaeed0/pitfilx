import api from "./client";
import { getLetterboxdWatchlistSync } from "./letterboxd";
import { getListTmdbIds, getLists } from "./lists";
import type { CinemaSchedule, PremiereListings } from "./cinemas";

/**
 * Links the Cinemas Schedule's scraped movies to TMDB films (POST /api/cinemas/match), plus the
 * two personal signals built on that link: the Letterboxd-synced watchlist and "Notify me" follows.
 */

export type CinemaMatch = {
  tmdbId: number;
  title: string;
  year: string | null;
  posterUrl: string | null;
  voteAverage: number;
};

export type MatchRequest = { title: string; year: number | null };

const MATCH_CACHE_KEY = "pitflix.cinemas.tmdb.v1";
const HIT_TTL_MS = 7 * 24 * 60 * 60_000;
/** Matches the server's miss TTL — TMDB often adds a local release a few days late. */
const MISS_TTL_MS = 12 * 60 * 60_000;

type MatchCache = Record<string, { m: CinemaMatch | null; at: number }>;

export const normTitle = (t: string) => t.toLowerCase().replace(/[^a-z0-9؀-ۿ]+/g, "");

export const matchKey = (title: string, year: number | null) => `${normTitle(title)}|${year ?? ""}`;

function readMatchCache(): MatchCache {
  try {
    return JSON.parse(localStorage.getItem(MATCH_CACHE_KEY) ?? "{}") as MatchCache;
  } catch {
    return {};
  }
}

function writeMatchCache(cache: MatchCache) {
  try {
    localStorage.setItem(MATCH_CACHE_KEY, JSON.stringify(cache));
  } catch {
    /* it's a cache */
  }
}

/** Fresh cached matches by key (`null` = known miss); absent keys are unknown. */
export function readCachedMatches(): Record<string, CinemaMatch | null> {
  const now = Date.now();
  const out: Record<string, CinemaMatch | null> = {};
  for (const [k, v] of Object.entries(readMatchCache())) {
    if (now - v.at < (v.m ? HIT_TTL_MS : MISS_TTL_MS)) out[k] = v.m;
  }
  return out;
}

/** Matches any of `requests` not already cached; returns every known match by key. */
export async function matchCinemaTitles(requests: MatchRequest[]): Promise<Record<string, CinemaMatch | null>> {
  const known = readCachedMatches();
  const missing = new Map<string, MatchRequest>();
  for (const r of requests) {
    const key = matchKey(r.title, r.year);
    if (!(key in known) && !missing.has(key)) missing.set(key, r);
  }
  if (missing.size === 0) return known;

  const items = [...missing].map(([key, r]) => ({ key, title: r.title, year: r.year }));
  const cache = readMatchCache();
  // The server caps a request at 80 titles.
  for (let i = 0; i < items.length; i += 80) {
    const res = await api.post<{ matches: Record<string, CinemaMatch | null> }>("/cinemas/match", {
      items: items.slice(i, i + 80),
    });
    const now = Date.now();
    for (const [key, m] of Object.entries(res.data.matches)) {
      cache[key] = { m, at: now };
      known[key] = m;
    }
  }
  writeMatchCache(cache);
  return known;
}

const cairoYear = () => Number(new Intl.DateTimeFormat("en-CA", { timeZone: "Africa/Cairo", year: "numeric" }).format(new Date()));

/** VOX: coming-soon titles carry their release year; anything bookable now is this year's (or a re-release, matched on title). */
export function voxMatchRequests(s: CinemaSchedule): MatchRequest[] {
  const year = cairoYear();
  const out: MatchRequest[] = s.comingSoon.map((m) => ({
    title: m.title,
    year: m.releaseDate ? Number(m.releaseDate.slice(0, 4)) : year,
  }));
  for (const m of s.nowShowing) out.push({ title: m.title, year });
  for (const d of s.days) for (const m of d.movies) out.push({ title: m.title, year });
  return out;
}

/** "October 2026 | Drama" → 2026. */
export const premiereInfoYear = (info: string | null) => {
  const m = /\b(19|20)\d{2}\b/.exec(info ?? "");
  return m ? Number(m[0]) : null;
};

/** The year a Premiere now-showing film is matched with (its info line's, else this year). */
export const premiereNowShowingYear = (info: string | null) => premiereInfoYear(info) ?? cairoYear();

export function premiereMatchRequests(p: PremiereListings): MatchRequest[] {
  return [
    ...p.nowShowing.map((m) => ({ title: m.title, year: premiereNowShowingYear(m.info) })),
    ...p.comingSoon.map((m) => ({ title: m.title, year: m.year ? Number(m.year) : null })),
  ];
}

export function voxYearFor(title: string, schedule: CinemaSchedule | null): number {
  const cs = schedule?.comingSoon.find((m) => m.title === title);
  return cs?.releaseDate ? Number(cs.releaseDate.slice(0, 4)) : cairoYear();
}

// ── Watchlist ────────────────────────────────────────────────────────────────

let watchlistMemo: { at: number; ids: Promise<Set<number>> } | null = null;
const WATCHLIST_MEMO_MS = 10 * 60_000;

/**
 * TMDB ids on the user's watchlist: the Pitflix list the Letterboxd watchlist syncs into
 * (Settings → Providers), falling back to the default "Watch Later" list.
 */
export function loadWatchlistTmdbIds(): Promise<Set<number>> {
  if (watchlistMemo && Date.now() - watchlistMemo.at < WATCHLIST_MEMO_MS) return watchlistMemo.ids;
  const ids = (async () => {
    let listId: number | null = null;
    try {
      listId = (await getLetterboxdWatchlistSync()).listId;
    } catch {
      /* sync not configured — fall back below */
    }
    if (listId == null) {
      const lists = await getLists();
      listId = lists.find((l) => /watch\s*later|watchlist/i.test(l.name))?.id ?? null;
    }
    return listId == null ? new Set<number>() : new Set(await getListTmdbIds(listId, "Movie"));
  })().catch(() => new Set<number>());
  watchlistMemo = { at: Date.now(), ids };
  return ids;
}

// ── "Notify me" follows ──────────────────────────────────────────────────────

export type CinemaFollow = { title: string; tmdbId: number | null; at: number };

const FOLLOWS_KEY = "pitflix.cinemas.follows.v1";

/** A follow is keyed by TMDB id when the film is matched, else by its normalized title. */
export const followKey = (title: string, tmdbId: number | null | undefined) =>
  tmdbId ? `tmdb:${tmdbId}` : `title:${normTitle(title)}`;

export function readFollows(): Record<string, CinemaFollow> {
  try {
    return JSON.parse(localStorage.getItem(FOLLOWS_KEY) ?? "{}") as Record<string, CinemaFollow>;
  } catch {
    return {};
  }
}

export function writeFollows(follows: Record<string, CinemaFollow>) {
  try {
    localStorage.setItem(FOLLOWS_KEY, JSON.stringify(follows));
  } catch {
    /* best-effort */
  }
}

export function isFollowedIn(follows: Record<string, CinemaFollow>, title: string, tmdbId: number | null | undefined) {
  return !!(follows[followKey(title, tmdbId)] || follows[followKey(title, null)]);
}
