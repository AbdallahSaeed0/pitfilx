import { useEffect } from "react";
import { getLatestTrailers, getNextEpisodesFollowed } from "../../api/homeDiscover";
import { getTrailerEmbedUrl } from "../../api/trailers";
import { pushNotification } from "../../store/notificationsStore";

// v2: entries are YouTube video ids now, not the URLs the old (non-firing) watcher stored — a
// fresh key keeps the format change from reading as "every followed show got a new trailer".
const FOLLOWED_CACHE_KEY = "pitflix.followedTrailers.v2";
const FOLLOWED_CACHE_KEY_LEGACY = "pitflix.followedTrailers.v1";
const FEED_CACHE_KEY = "pitflix.latestTrailerKeys.v1";
const CHECK_INTERVAL_MS = 30 * 60_000; // half-hourly — trailers don't drop faster than that
/** Feed entries older than this are treated as backlog, never as "just dropped". */
const FRESH_WINDOW_MS = 14 * 24 * 60 * 60_000;
/** Cap on remembered feed video ids so localStorage doesn't grow unbounded. */
const MAX_SEEN_KEYS = 400;

type FollowedCache = Record<string, string>;

function loadJson<T>(key: string, fallback: T): T {
  try {
    const raw = localStorage.getItem(key);
    return raw ? (JSON.parse(raw) as T) : fallback;
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

/**
 * Watches the Latest-trailers feed for newly published clips, and followed shows for a trailer
 * appearing/changing, pushing both into the notifications bell.
 *
 * The followed-show half deliberately goes through `/trailers/embed` rather than
 * `/trailers/{tmdbId}`: the latter only reads the locally ingested trailers table, which is empty
 * for most followed (not-in-library) shows, so it could never fire. `/trailers/embed` falls back to
 * a live TMDB lookup.
 *
 * Mounted once, globally (see App.tsx).
 */
export function NewTrailerWatcher() {
  useEffect(() => {
    let cancelled = false;
    try {
      localStorage.removeItem(FOLLOWED_CACHE_KEY_LEGACY);
    } catch {
      /* best-effort */
    }

    /** Any new clip in the Latest-trailers feed, whether or not the user follows the title. */
    const checkFeed = async () => {
      const cards = await getLatestTrailers();
      if (cancelled || cards.length === 0) return;

      const seen = loadJson<string[]>(FEED_CACHE_KEY, []);
      const seenSet = new Set(seen);
      const firstRun = seen.length === 0;
      const now = Date.now();
      const fresh: string[] = [];

      for (const card of cards) {
        if (!card.youtubeKey || seenSet.has(card.youtubeKey)) continue;
        fresh.push(card.youtubeKey);
        seenSet.add(card.youtubeKey);

        // On the very first run the whole feed is "new" — seed it silently instead of dumping
        // twenty notifications on the user.
        if (firstRun) continue;

        const publishedAt = card.trailerPublishedAtUtc
          ? Date.parse(card.trailerPublishedAtUtc)
          : NaN;
        if (Number.isFinite(publishedAt) && now - publishedAt > FRESH_WINDOW_MS) continue;

        pushNotification({
          kind: "trailer",
          title: `${card.title}: new trailer`,
          message: card.trailerTitle || "A new trailer just dropped.",
          // Plays this clip directly (see TrailersPage's `?clip=` handling) rather than
          // dumping the user on the grid to find it themselves.
          href: `/trailers?clip=${encodeURIComponent(card.youtubeKey)}&title=${encodeURIComponent(card.title)}`,
        });
      }

      if (fresh.length > 0) {
        // Newest first, so the oldest ids fall off the end once we hit the cap.
        saveJson(FEED_CACHE_KEY, [...fresh, ...seen].slice(0, MAX_SEEN_KEYS));
      }
    };

    /** Followed (TMDB-only) shows — a trailer showing up for one of these is worth surfacing. */
    const checkFollowed = async () => {
      const followed = await getNextEpisodesFollowed();
      if (cancelled || followed.length === 0) return;

      const cache = loadJson<FollowedCache>(FOLLOWED_CACHE_KEY, {});
      let changed = false;
      const followedIds = new Set(followed.map((f) => f.tmdbId));

      for (const show of followed) {
        if (cancelled) return;
        const key = String(show.tmdbId);
        try {
          const res = await getTrailerEmbedUrl(show.tmdbId, "Series");
          const youtubeKey = res.trailers?.[0]?.youtubeKey;
          const clip = youtubeKey ?? res.embedUrl;
          if (!clip) continue;

          const prev = cache[key];
          cache[key] = clip;
          changed = true;
          // First sighting has nothing to compare against — seed silently.
          if (prev === undefined || prev === clip) continue;

          pushNotification({
            kind: "trailer",
            title: `${show.title}: new trailer`,
            message: res.title || "A new trailer just dropped.",
            // NOT `/series/{tmdbId}` — that route takes a *library* id, and these shows are
            // followed-but-not-in-library by definition, so it never resolved to anything.
            href: youtubeKey
              ? `/trailers?clip=${encodeURIComponent(youtubeKey)}&title=${encodeURIComponent(show.title)}`
              : "/trailers",
          });
        } catch {
          /* best-effort — skip this show, the next check will retry */
        }
      }

      // Drop cached entries for shows no longer followed so the cache doesn't grow unbounded.
      for (const key of Object.keys(cache)) {
        if (!followedIds.has(Number(key))) {
          delete cache[key];
          changed = true;
        }
      }

      if (changed) saveJson(FOLLOWED_CACHE_KEY, cache);
    };

    const check = async () => {
      // Independent sources — one failing shouldn't take the other down.
      await Promise.allSettled([checkFeed(), checkFollowed()]);
    };

    void check();
    const interval = setInterval(() => void check(), CHECK_INTERVAL_MS);
    return () => {
      cancelled = true;
      clearInterval(interval);
    };
  }, []);

  return null;
}
