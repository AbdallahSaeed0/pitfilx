// LRU thumbnail cache for local video files.
// Stores canvas-captured frames as JPEG data URLs so thumbnails survive
// component unmounts (virtual scrolling, folder re-navigation).

import { invoke } from "@tauri-apps/api/core";
import { getDeviceMediaSettings } from "../features/device/deviceMediaSettings";

/** Pick a random seek position within the user-configured % range of the clip. */
export function thumbnailSeekTime(duration: number): number {
  if (!Number.isFinite(duration) || duration <= 0) return 0.5;
  const { thumbMinPct, thumbMaxPct } = getDeviceMediaSettings();
  const lo = duration * (thumbMinPct / 100);
  const hi = duration * (thumbMaxPct / 100);
  return lo + Math.random() * Math.max(0.1, hi - lo);
}

const MAX_ENTRIES = 2000;
const cache = new Map<string, string>(); // path → JPEG data URL

export function getThumbnail(path: string): string | undefined {
  return cache.get(path);
}

/** Drops in-memory thumbnails so they can regenerate with new settings. */
export function clearDeviceThumbnailMemoryCache(): void {
  cache.clear();
}

/** Clears persisted thumbnails so new frame settings take effect everywhere. */
export function clearDeviceThumbnailDiskCache(): Promise<void> {
  return openThumbDb().then((db) => {
    if (!db) return;
    return new Promise<void>((resolve) => {
      try {
        const tx = db.transaction(STORE_NAME, "readwrite");
        const req = tx.objectStore(STORE_NAME).clear();
        req.onsuccess = () => resolve();
        req.onerror = () => resolve();
      } catch {
        resolve();
      }
    });
  });
}

// Per-path subscribers notified the moment a thumbnail is stored.
// Used by DeviceVideoThumb to update immediately when the background
// preloader finishes, without waiting for a scroll / remount.
const listeners = new Map<string, Set<() => void>>();

/**
 * Subscribe to be called once a thumbnail for `path` is stored.
 * Returns an unsubscribe function — call it in the effect cleanup.
 */
export function onThumbnailReady(path: string, cb: () => void): () => void {
  let set = listeners.get(path);
  if (!set) { set = new Set(); listeners.set(path, set); }
  set.add(cb);
  return () => {
    set!.delete(cb);
    if (set!.size === 0) listeners.delete(path);
  };
}

export function setThumbnail(path: string, dataUrl: string): void {
  if (cache.size >= MAX_ENTRIES) {
    const oldest = cache.keys().next().value;
    if (oldest !== undefined) cache.delete(oldest);
  }
  cache.set(path, dataUrl);
  // Notify any mounted component that was waiting for this thumbnail
  listeners.get(path)?.forEach(cb => cb());
  persistThumbnail(path, dataUrl);
}

// ── Disk persistence (IndexedDB) ──────────────────────────────────────────────
// The in-memory `cache` Map above is wiped on every app reload/restart, which
// previously meant every thumbnail had to be re-decoded from the video files
// from scratch each time — slow for large folders. Thumbnails are mirrored to
// IndexedDB so they survive reloads; the random hover-PREVIEW position is
// intentionally NOT persisted (stays different every hover, by design).
const DB_NAME = "pitflix-thumb-cache";
// v4 = thumbnailSeekTime now targets the middle of the clip instead of the
// first minutes. Bumping the store name invalidates old "intro frame"
// entries so they regenerate from a more representative part of the video.
const STORE_NAME = "thumbs_v4";
const MAX_DISK_ENTRIES = 6000;

// IMPORTANT: object stores are only created inside `onupgradeneeded`, which
// ONLY fires when this version number increases from whatever is already on
// disk. Renaming STORE_NAME without bumping DB_VERSION means the "new" store
// never actually gets created — every transaction against it throws
// NotFoundError, which was being silently swallowed by the try/catch below,
// so persistence looked like it "worked" in-session but wrote nothing to
// disk at all. Whenever STORE_NAME changes, DB_VERSION MUST increase too.
const DB_VERSION = 4;

let dbPromise: Promise<IDBDatabase | null> | null = null;

function openThumbDb(): Promise<IDBDatabase | null> {
  if (dbPromise) return dbPromise;
  dbPromise = new Promise((resolve) => {
    if (typeof indexedDB === "undefined") { resolve(null); return; }
    try {
      const req = indexedDB.open(DB_NAME, DB_VERSION);
      req.onupgradeneeded = () => {
        const db = req.result;
        if (!db.objectStoreNames.contains(STORE_NAME)) db.createObjectStore(STORE_NAME);
      };
      req.onsuccess = () => resolve(req.result);
      req.onerror = () => resolve(null);
      // A version upgrade can block if another tab/window still holds an
      // older connection open — resolve null rather than hanging forever.
      req.onblocked = () => resolve(null);
    } catch {
      resolve(null);
    }
  });
  return dbPromise;
}

let persistWarned = false;
function persistThumbnail(path: string, dataUrl: string): void {
  void openThumbDb().then((db) => {
    if (!db) return;
    try {
      db.transaction(STORE_NAME, "readwrite").objectStore(STORE_NAME).put(dataUrl, path);
    } catch (e) {
      // Quota exceeded or DB unavailable — in-memory cache still works for this
      // session, but warn once so a persistence bug doesn't go unnoticed again.
      if (!persistWarned) { persistWarned = true; console.warn("[thumbCache] failed to persist to disk:", e); }
    }
  });
}

/** Stores a value loaded FROM disk into the memory cache (no disk write-back — it's already there). */
function cacheFromDisk(path: string, dataUrl: string): void {
  if (cache.size >= MAX_ENTRIES) {
    const oldest = cache.keys().next().value;
    if (oldest !== undefined) cache.delete(oldest);
  }
  cache.set(path, dataUrl);
  listeners.get(path)?.forEach(cb => cb());
}

/**
 * Looks up a single thumbnail on disk (IndexedDB single-key get — an O(log n)
 * B-tree lookup, not a full-table scan) and, if found, stores it in memory.
 *
 * Earlier this module bulk-loaded EVERY saved thumbnail into memory at app
 * start before any card was allowed to decide "not cached" — for folders
 * visited over time that list can grow into the thousands, so the bulk
 * transfer + JSON/string copy of all of it delayed first paint noticeably.
 * A targeted per-path get() is essentially instant regardless of how many
 * unrelated thumbnails exist in the store, so cards resolve individually and
 * in parallel instead of all waiting on one big transfer.
 */
export function loadThumbnailFromDisk(path: string): Promise<string | undefined> {
  const inMemory = cache.get(path);
  if (inMemory !== undefined) return Promise.resolve(inMemory);

  return openThumbDb().then((db) => {
    if (!db) return undefined;
    return new Promise<string | undefined>((resolve) => {
      try {
        const req = db.transaction(STORE_NAME, "readonly").objectStore(STORE_NAME).get(path);
        req.onsuccess = () => {
          const val = req.result;
          if (typeof val === "string") { cacheFromDisk(path, val); resolve(val); }
          else resolve(undefined);
        };
        req.onerror = () => resolve(undefined);
      } catch {
        resolve(undefined);
      }
    });
  });
}

/**
 * Lazily caps disk growth: if the store has grown well past what we'd ever
 * need, prune the oldest-inserted entries. Runs once at startup, fully in
 * the background — never blocks thumbnail lookups above.
 */
function pruneOldDiskEntries(): void {
  void openThumbDb().then((db) => {
    if (!db) return;
    try {
      const tx = db.transaction(STORE_NAME, "readwrite");
      const store = tx.objectStore(STORE_NAME);
      const countReq = store.count();
      countReq.onsuccess = () => {
        const total = countReq.result;
        if (total <= MAX_DISK_ENTRIES) return;
        let toDelete = total - MAX_DISK_ENTRIES;
        const cursorReq = store.openCursor();
        cursorReq.onsuccess = () => {
          const cursor = cursorReq.result;
          if (!cursor || toDelete <= 0) return;
          cursor.delete();
          toDelete--;
          cursor.continue();
        };
      };
    } catch {
      // ignore
    }
  });
}

pruneOldDiskEntries();

/** Poster frames from native `thumb_poster` (playlist tiles). */
const posterCache = new Map<string, string>();

export function getPosterThumbnail(path: string): string | undefined {
  return posterCache.get(path);
}

export function setPosterThumbnail(path: string, objectUrl: string): void {
  if (posterCache.size >= MAX_ENTRIES) {
    const oldest = posterCache.keys().next().value;
    if (oldest !== undefined) {
      const oldUrl = posterCache.get(oldest);
      if (oldUrl) URL.revokeObjectURL(oldUrl);
      posterCache.delete(oldest);
    }
  }
  posterCache.set(path, objectUrl);
}

// ── Playlist poster resolution ─────────────────────────────────────────────
// Opening a playlist used to fire one native `thumb_poster` decode (an mpv
// frame grab) per row, all at once — dozens of simultaneous decodes was what
// caused the app to lag on open. `resolvePlaylistPoster` first reuses
// whatever was already captured for that same file elsewhere (My Device grid
// canvas captures, in memory or on disk) since playlist entries usually
// overlap with a folder the user already browsed; only files with no capture
// anywhere fall back to a native decode, and those are throttled so at most
// a few run concurrently.
const PLAYLIST_POSTER_CONCURRENCY = 3;
let activePlaylistPosterFetches = 0;
const playlistPosterQueue: Array<() => void> = [];

function runNextPlaylistPosterTask(): void {
  if (activePlaylistPosterFetches >= PLAYLIST_POSTER_CONCURRENCY) return;
  const next = playlistPosterQueue.shift();
  if (!next) return;
  activePlaylistPosterFetches++;
  next();
}

function scheduleNativePosterFetch(path: string): Promise<string | null> {
  return new Promise((resolve) => {
    playlistPosterQueue.push(() => {
      void invoke<number[]>("thumb_poster", { filePath: path, atSeconds: 60.0 })
        .then((bytes) => {
          const blob = new Blob([new Uint8Array(bytes)], { type: "image/jpeg" });
          const url = URL.createObjectURL(blob);
          setPosterThumbnail(path, url);
          resolve(url);
        })
        .catch(() => resolve(null))
        .finally(() => {
          activePlaylistPosterFetches--;
          runNextPlaylistPosterTask();
        });
    });
    runNextPlaylistPosterTask();
  });
}

/** Resolves a playlist tile thumbnail, reusing existing captures before falling back to a throttled native decode. */
export function resolvePlaylistPoster(path: string): Promise<string | null> {
  const poster = posterCache.get(path);
  if (poster) return Promise.resolve(poster);
  const main = getThumbnail(path);
  if (main) return Promise.resolve(main);

  return loadThumbnailFromDisk(path).then((diskHit) => {
    if (diskHit) return diskHit;
    return scheduleNativePosterFetch(path);
  });
}

// Tri-state: null = untested, true = works, false = CORS broken
let canvasCaptureSupported: boolean | null = null;

export function isCanvasCaptureSupported(): boolean | null {
  return canvasCaptureSupported;
}

/**
 * Capture a frame from a video file as a JPEG data URL via canvas.
 * Requires Tauri's asset:// protocol to send CORS headers (it does in Tauri v2 with
 * assetProtocol.enable = true). Returns null on any failure; on first SecurityError
 * sets a module-level flag so subsequent calls skip canvas entirely.
 */
export function captureVideoFrame(src: string): Promise<string | null> {
  if (canvasCaptureSupported === false) return Promise.resolve(null);

  return new Promise<string | null>((resolve) => {
    const video = document.createElement("video");
    video.muted = true;
    video.playsInline = true;
    video.preload = "metadata";
    video.crossOrigin = "anonymous";

    let settled = false;
    const done = (result: string | null) => {
      if (settled) return;
      settled = true;
      clearTimeout(timer);
      video.onerror = null;
      video.onloadedmetadata = null;
      video.onseeked = null;
      // Release resources
      video.src = "";
      video.load();
      resolve(result);
    };

    // 12 s timeout — large files on slow drives can take time to read headers
    const timer = setTimeout(() => done(null), 12_000);

    video.onerror = () => done(null);

    video.onloadedmetadata = () => {
      const d = video.duration;
      if (!Number.isFinite(d) || d <= 0) { done(null); return; }
      video.currentTime = thumbnailSeekTime(d);
    };

    video.onseeked = () => {
      try {
        // Preserve the source video's own aspect ratio instead of forcing a
        // fixed 320x180 (16:9) box — stretching a portrait/vertical clip into
        // a 16:9 canvas squished it, and the square grid tile's object-fit:
        // cover then cropped that already-distorted frame a second time.
        // Downscaling to fit within a 320px box (no cropping here) means the
        // saved image itself is correctly proportioned; the tile's own
        // object-fit: cover then crops it centered and undistorted, same as
        // any normal photo — landscape clips lose the sides, portrait clips
        // lose top/bottom, but nothing looks stretched.
        const vw = video.videoWidth || 320;
        const vh = video.videoHeight || 180;
        const aspect = vw / vh;
        const MAX_DIM = 320;
        const cw = aspect >= 1 ? MAX_DIM : Math.max(1, Math.round(MAX_DIM * aspect));
        const ch = aspect >= 1 ? Math.max(1, Math.round(MAX_DIM / aspect)) : MAX_DIM;
        const canvas = document.createElement("canvas");
        canvas.width = cw;
        canvas.height = ch;
        const ctx = canvas.getContext("2d");
        if (!ctx) { done(null); return; }
        ctx.drawImage(video, 0, 0, cw, ch);
        const dataUrl = canvas.toDataURL("image/jpeg", 0.85);
        if (dataUrl.length > 200) {
          canvasCaptureSupported = true;
          done(dataUrl);
        } else {
          done(null);
        }
      } catch (e) {
        // SecurityError means canvas is tainted — asset:// CORS headers not present
        if (e instanceof DOMException && e.name === "SecurityError") {
          canvasCaptureSupported = false;
        }
        done(null);
      }
    };

    video.src = src;
    video.load();
  });
}
