import { dehydrate, hydrate, type QueryClient } from "@tanstack/react-query";

/**
 * Persists the react-query cache to localStorage so a relaunch paints from the last known data
 * instead of showing skeletons while every request re-runs from scratch.
 *
 * The in-memory cache already stops re-fetching on navigation, but it dies with the process — which is
 * why the app felt fast once you'd been clicking around and slow again on every launch. Restoring it
 * means Home/Movies/Series render immediately and revalidate in the background (`staleTime` still
 * governs whether a refetch happens, so nothing goes stale silently).
 *
 * Deliberately hand-rolled on react-query's own dehydrate/hydrate rather than pulling in
 * @tanstack/query-persist-client-core — it's ~40 lines and avoids another dependency in the bundle.
 */
const STORAGE_KEY = "pitflix.query-cache.v1";

/** Anything older than this is dropped rather than shown — a day-old Continue Watching row is noise. */
const MAX_AGE_MS = 24 * 60 * 60_000;

/** localStorage is synchronous; writing on every cache mutation would stutter during scrolling. */
const WRITE_THROTTLE_MS = 2_000;

/** localStorage caps out around 5 MB per origin. Well under that, and skip the write if we're over. */
const MAX_BYTES = 3_000_000;

/**
 * Query keys never worth restoring: playback/session state that must reflect reality right now, and
 * scan progress that's meaningless once the process is gone.
 */
const EXCLUDED_KEY_PREFIXES = ["scan", "player", "player-state", "now-playing", "api-health"];

type PersistedPayload = {
  savedAt: number;
  state: ReturnType<typeof dehydrate>;
};

function isPersistable(queryKey: readonly unknown[]): boolean {
  const head = queryKey[0];
  return typeof head !== "string" || !EXCLUDED_KEY_PREFIXES.includes(head);
}

/** Restores a previous session's cache. Call before the first render; safe to call when nothing is stored. */
export function restoreQueryCache(client: QueryClient): void {
  try {
    const raw = localStorage.getItem(STORAGE_KEY);
    if (!raw) return;
    const payload = JSON.parse(raw) as PersistedPayload;
    if (!payload?.state || typeof payload.savedAt !== "number") return;
    if (Date.now() - payload.savedAt > MAX_AGE_MS) {
      localStorage.removeItem(STORAGE_KEY);
      return;
    }
    hydrate(client, payload.state);
  } catch {
    // Corrupt or unreadable — drop it and start cold rather than failing to boot.
    try { localStorage.removeItem(STORAGE_KEY); } catch { /* ignore */ }
  }
}

/** Starts throttled persistence. Returns an unsubscribe function. */
export function startQueryCachePersistence(client: QueryClient): () => void {
  let timer: number | undefined;

  const write = () => {
    timer = undefined;
    try {
      const state = dehydrate(client, {
        // Only successful, non-excluded queries. Errors and in-flight states must not be replayed as
        // if they were real data on the next launch.
        shouldDehydrateQuery: (query) =>
          query.state.status === "success" &&
          query.state.data !== undefined &&
          isPersistable(query.queryKey),
        shouldDehydrateMutation: () => false,
      });
      const serialized = JSON.stringify({ savedAt: Date.now(), state } satisfies PersistedPayload);
      if (serialized.length > MAX_BYTES) return;
      localStorage.setItem(STORAGE_KEY, serialized);
    } catch {
      // Quota exceeded or a non-serializable value in the cache — clear so we don't keep retrying
      // against a full store, and carry on with an in-memory-only cache.
      try { localStorage.removeItem(STORAGE_KEY); } catch { /* ignore */ }
    }
  };

  const schedule = () => {
    if (timer !== undefined) return;
    timer = window.setTimeout(write, WRITE_THROTTLE_MS);
  };

  const unsubscribe = client.getQueryCache().subscribe(schedule);

  // A throttled write can still be pending when the window goes away; flush it so the very data the
  // user just loaded is what gets restored.
  const flush = () => {
    if (timer !== undefined) {
      window.clearTimeout(timer);
      timer = undefined;
    }
    write();
  };
  window.addEventListener("pagehide", flush);

  return () => {
    window.removeEventListener("pagehide", flush);
    if (timer !== undefined) window.clearTimeout(timer);
    unsubscribe();
  };
}
