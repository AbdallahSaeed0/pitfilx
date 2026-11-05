import { invoke, isTauri } from "@tauri-apps/api/core";

/**
 * Cinemas Schedule data. Scraped by the Tauri shell (`src-tauri/src/cinemas`) through hidden
 * webviews — VOX's bot protection blocks plain HTTP clients and Premiere encrypts its showtime
 * API — so there is no Pitflix.API endpoint for this. Results are cached in localStorage so the
 * page opens instantly.
 */

export type CinemaShowtime = { time: string; bookingUrl: string | null; id: string | null };
export type CinemaFormat = { name: string; times: CinemaShowtime[] };
export type CinemaBranch = { name: string; formats: CinemaFormat[] };

export type CinemaScreening = {
  slug: string;
  title: string;
  classification: string | null;
  language: string | null;
  durationMins: number | null;
  heroUrl: string | null;
  url: string | null;
  cinemas: CinemaBranch[];
};

export type CinemaMovieSummary = {
  slug: string;
  title: string;
  posterUrl: string | null;
  classification: string | null;
  language: string | null;
  starring: string | null;
  /** yyyy-mm-dd; only on coming-soon entries. */
  releaseDate: string | null;
  synopsis: string | null;
  url: string | null;
};

export type CinemaDay = { date: string; movies: CinemaScreening[] };

export type CinemaSchedule = {
  cinema: "vox";
  fetchedAt: number;
  comingSoon: CinemaMovieSummary[];
  nowShowing: CinemaMovieSummary[];
  days: CinemaDay[];
  failedDates: string[];
};

export type CinemaRefreshProgress = { done: number; total: number };

const CACHE_KEY = "pitflix.cinemas.vox.v1";
/**
 * How often both chains are re-checked while the app is open. Chains open bookings well ahead
 * of release, so this is about catching a ticket drop soon after it happens; a refresh is a
 * couple of hidden page loads (VOX ~2–5s, Premiere listings ~4s), so half-hourly is cheap.
 */
export const CINEMA_REFRESH_INTERVAL_MS = 30 * 60 * 1000;

/** localStorage keys for the branch picked on each chain's Showtimes view ("all" = every branch). */
export const BRANCH_STORAGE_KEYS = {
  vox: "pitflix.cinemas.branch.vox",
  premiere: "pitflix.cinemas.branch.premiere",
} as const;

export function readStoredBranch(chain: keyof typeof BRANCH_STORAGE_KEYS): string {
  try {
    return localStorage.getItem(BRANCH_STORAGE_KEYS[chain]) ?? "all";
  } catch {
    return "all";
  }
}

const PREMIERE_VIEWED_KEY = "pitflix.cinemas.premiere.viewedAt.v1";

/** Called when Premiere's showtimes are on screen; the background preload only runs for recent users. */
export function markPremiereViewed() {
  try {
    localStorage.setItem(PREMIERE_VIEWED_KEY, String(Date.now()));
  } catch {
    /* best-effort */
  }
}

export function premiereViewedAt(): number {
  try {
    return Number(localStorage.getItem(PREMIERE_VIEWED_KEY) ?? 0) || 0;
  } catch {
    return 0;
  }
}

export type VoxPartial =
  | { kind: "showtimes"; data: { date: string; movies: CinemaScreening[] } }
  | { kind: "comingSoon" | "nowShowing"; data: CinemaMovieSummary[] };

export function readCachedCinemaSchedule(): CinemaSchedule | null {
  try {
    const raw = localStorage.getItem(CACHE_KEY);
    return raw ? (JSON.parse(raw) as CinemaSchedule) : null;
  } catch {
    return null;
  }
}

/** A refresh takes ~30s; shared so leaving and reopening the page re-attaches instead of failing. */
let inflight: Promise<CinemaSchedule> | null = null;

type RawVoxSchedule = Omit<CinemaSchedule, "comingSoon" | "nowShowing"> & {
  comingSoon: CinemaMovieSummary[] | null;
  nowShowing: CinemaMovieSummary[] | null;
};

export function fetchVoxSchedule(): Promise<CinemaSchedule> {
  if (!isTauri()) return Promise.reject(new Error("Cinemas Schedule needs the Pitflix desktop app."));
  inflight ??= invoke<RawVoxSchedule>("cinemas_fetch_vox")
    .then((raw) => {
      // A section the scraper couldn't read this time comes back null: keep the last good copy.
      const previous = readCachedCinemaSchedule();
      const schedule: CinemaSchedule = {
        ...raw,
        comingSoon: raw.comingSoon ?? previous?.comingSoon ?? [],
        nowShowing: raw.nowShowing ?? previous?.nowShowing ?? [],
      };
      schedule.days.sort((a, b) => a.date.localeCompare(b.date));
      try {
        localStorage.setItem(CACHE_KEY, JSON.stringify(schedule));
      } catch {
        /* quota — the in-memory result still renders */
      }
      return schedule;
    })
    .finally(() => {
      inflight = null;
    });
  return inflight;
}

// ── Premiere Cinemas ─────────────────────────────────────────────────────────

export type PremiereMovie = {
  id: string;
  title: string;
  posterUrl: string | null;
  /** e.g. "October 2026 | Drama | Crime" */
  info: string | null;
  synopsis: string | null;
  /** Branches showing it (dates/times are fetched on demand). */
  cinemas: string[];
  url: string | null;
};

export type PremiereComingSoonMovie = {
  id: string;
  title: string;
  posterUrl: string | null;
  genres: string | null;
  /** Premiere only publishes a year for upcoming titles. */
  year: string | null;
  url: string | null;
};

export type PremiereListings = {
  cinema: "premiere";
  fetchedAt: number;
  nowShowing: PremiereMovie[];
  comingSoon: PremiereComingSoonMovie[];
};

export type PremiereShowtimes = {
  movieId: string;
  date: string;
  fetchedAt: number;
  cinemas: { name: string; formats: { name: string; times: { time: string }[] }[] }[];
};

const PREMIERE_CACHE_KEY = "pitflix.cinemas.premiere.v1";
const PREMIERE_TIMES_CACHE_KEY = "pitflix.cinemas.premiere.times.v1";
/**
 * Times rarely change within a day, but sell-outs/added shows do happen. A bit longer than the
 * background week prefetch interval (CinemasBackgroundSync) so switching days never hits a gap.
 */
const PREMIERE_TIMES_MAX_AGE_MS = 3 * 60 * 60 * 1000;

export function readCachedPremiereListings(): PremiereListings | null {
  try {
    const raw = localStorage.getItem(PREMIERE_CACHE_KEY);
    return raw ? (JSON.parse(raw) as PremiereListings) : null;
  } catch {
    return null;
  }
}

let premiereInflight: Promise<PremiereListings> | null = null;

export function fetchPremiereListings(): Promise<PremiereListings> {
  if (!isTauri()) return Promise.reject(new Error("Cinemas Schedule needs the Pitflix desktop app."));
  premiereInflight ??= invoke<PremiereListings>("cinemas_fetch_premiere")
    .then((listings) => {
      try {
        localStorage.setItem(PREMIERE_CACHE_KEY, JSON.stringify(listings));
      } catch {
        /* quota — the in-memory result still renders */
      }
      return listings;
    })
    .finally(() => {
      premiereInflight = null;
    });
  return premiereInflight;
}

type TimesCache = Record<string, PremiereShowtimes>;

const timesKey = (movieId: string, date: string, cinema: string | null) => `${movieId}|${date}|${cinema ?? "*"}`;

function readTimesCache(): TimesCache {
  try {
    return JSON.parse(localStorage.getItem(PREMIERE_TIMES_CACHE_KEY) ?? "{}") as TimesCache;
  } catch {
    return {};
  }
}

/** Cached times for this movie/date — an all-branches result also answers a one-branch request. */
export function readCachedPremiereShowtimes(
  movieId: string,
  date: string,
  cinema: string | null,
): PremiereShowtimes | null {
  const cache = readTimesCache();
  const fresh = (t: PremiereShowtimes | undefined) =>
    t && Date.now() - t.fetchedAt < PREMIERE_TIMES_MAX_AGE_MS ? t : undefined;
  const exact = fresh(cache[timesKey(movieId, date, cinema)]);
  if (exact) return exact;
  const all = cinema ? fresh(cache[timesKey(movieId, date, null)]) : undefined;
  return all ? { ...all, cinemas: all.cinemas.filter((c) => c.name === cinema) } : null;
}

function writeTimesCache(cinema: string | null, entries: PremiereShowtimes[]) {
  const cache = readTimesCache();
  const cutoff = Date.now() - PREMIERE_TIMES_MAX_AGE_MS;
  for (const [k, v] of Object.entries(cache)) if (v.fetchedAt < cutoff) delete cache[k];
  for (const times of entries) cache[timesKey(times.movieId, times.date, cinema)] = times;
  try {
    localStorage.setItem(PREMIERE_TIMES_CACHE_KEY, JSON.stringify(cache));
  } catch {
    /* quota — fine, it's a cache */
  }
}

/** Matches the Rust-side window pool (`POOL_SIZE` in `cinemas/premiere.rs`). */
const PREMIERE_CONCURRENCY = 3;

/** "user" jobs (a click on the page) always start before queued "background" prefetches. */
export type PremierePriority = "user" | "background";

type QueuedJob = { priority: PremierePriority; start: () => void };
const premiereQueue: QueuedJob[] = [];
let premiereActive = 0;

function pumpPremiereQueue() {
  while (premiereActive < PREMIERE_CONCURRENCY && premiereQueue.length > 0) {
    const i = premiereQueue.findIndex((j) => j.priority === "user");
    const [job] = premiereQueue.splice(i >= 0 ? i : 0, 1);
    premiereActive++;
    job.start();
  }
}

/** Queues `run` for a free Premiere window; skipped if `signal` aborts before its turn. */
function queuePremiere<T>(run: () => Promise<T>, priority: PremierePriority, signal?: AbortSignal): Promise<T> {
  return new Promise<T>((resolve, reject) => {
    premiereQueue.push({
      priority,
      start: () => {
        const job = signal?.aborted ? Promise.reject(new DOMException("Aborted", "AbortError")) : run();
        job.then(resolve, reject).finally(() => {
          premiereActive--;
          pumpPremiereQueue();
        });
      },
    });
    pumpPremiereQueue();
  });
}

/** The dates Premiere's own date picker offers (today + 6). */
export function premiereWeekDates(today: string): string[] {
  return Array.from({ length: 7 }, (_, i) => {
    const d = new Date(`${today}T12:00:00Z`);
    d.setUTCDate(d.getUTCDate() + i);
    return d.toISOString().slice(0, 10);
  });
}

type PremiereDaysResponse = {
  movieId: string;
  fetchedAt: number;
  days: Record<string, PremiereShowtimes["cinemas"]>;
};

/**
 * Showtimes for one movie on each of `dates`, keyed by date. Cached dates are answered straight
 * away; the rest go in one job that walks the dates under each branch (one movie for a whole
 * week: ~30s at every branch, ~7s at one). The cache is re-checked when the job's turn comes, so
 * a background prefetch that got there first isn't repeated.
 */
export function fetchPremiereShowtimes(
  movieId: string,
  dates: string[],
  cinema: string | null,
  signal?: AbortSignal,
  priority: PremierePriority = "user",
): Promise<Record<string, PremiereShowtimes>> {
  const result: Record<string, PremiereShowtimes> = {};
  const missing = () => dates.filter((d) => {
    if (result[d]) return false;
    const cached = readCachedPremiereShowtimes(movieId, d, cinema);
    if (cached) result[d] = cached;
    return !cached;
  });
  if (missing().length === 0) return Promise.resolve(result);
  if (!isTauri()) return Promise.reject(new Error("Cinemas Schedule needs the Pitflix desktop app."));
  return queuePremiere(async () => {
    const todo = missing();
    if (todo.length === 0) return result;
    const res = await invoke<PremiereDaysResponse>("cinemas_premiere_showtimes", { movieId, dates: todo, cinema });
    const entries = todo.map((date) => ({ movieId, date, fetchedAt: res.fetchedAt, cinemas: res.days[date] ?? [] }));
    writeTimesCache(cinema, entries);
    for (const e of entries) result[e.date] = e;
    return result;
  }, priority, signal);
}
