import { useEffect } from "react";
import { getNextEpisodesAirScoped, getNextEpisodesFollowed } from "../../api/homeDiscover";
import { pushNotification } from "../../store/notificationsStore";

const CACHE_KEY = "pitflix.followedAirDates.v1";
const CHECK_INTERVAL_MS = 60 * 60_000; // hourly is plenty for TMDB air-date churn

type AirDateCache = Record<string, string>;

function loadCache(): AirDateCache {
  try {
    const raw = localStorage.getItem(CACHE_KEY);
    return raw ? (JSON.parse(raw) as AirDateCache) : {};
  } catch {
    return {};
  }
}

function saveCache(cache: AirDateCache) {
  try {
    localStorage.setItem(CACHE_KEY, JSON.stringify(cache));
  } catch {
    /* best-effort */
  }
}

/**
 * Notifies when a followed (TMDB-only, not-in-library) show's next air date is newly published or
 * changes — closing the loop between "Follow for schedule" on Next Episodes and actually finding
 * out something changed, without requiring the user to keep revisiting that page. Mounted once,
 * globally (see App.tsx), like the other listener hosts.
 */
export function FollowedAirDateWatcher() {
  useEffect(() => {
    let cancelled = false;

    const check = async () => {
      try {
        const followed = await getNextEpisodesFollowed();
        if (cancelled || followed.length === 0) return;
        const followedIds = new Set(followed.map((f) => f.tmdbId));
        const titleById = new Map(followed.map((f) => [f.tmdbId, f.title]));

        const rows = await getNextEpisodesAirScoped({ view: "all", limit: 200 });
        if (cancelled) return;

        const cache = loadCache();
        let changed = false;

        for (const row of rows) {
          if (!followedIds.has(row.showTmdbId) || !row.airDate) continue;
          const key = String(row.showTmdbId);
          const prev = cache[key];
          if (prev === undefined) {
            // First time we've ever seen this show's schedule — seed silently, nothing to compare to yet.
            cache[key] = row.airDate;
            changed = true;
            continue;
          }
          if (prev !== row.airDate) {
            const title = titleById.get(row.showTmdbId) ?? row.showTitle;
            pushNotification({
              kind: "airdate",
              title: `${title}: new air date`,
              message:
                row.season != null && row.episodeNumber != null
                  ? `S${row.season}E${row.episodeNumber} now airs ${row.airDate}`
                  : `Now airs ${row.airDate}`,
            });
            cache[key] = row.airDate;
            changed = true;
          }
        }

        // Drop cached entries for shows no longer followed so the cache doesn't grow unbounded.
        for (const key of Object.keys(cache)) {
          if (!followedIds.has(Number(key))) {
            delete cache[key];
            changed = true;
          }
        }

        if (changed) saveCache(cache);
      } catch {
        /* best-effort — next hourly check will retry */
      }
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
