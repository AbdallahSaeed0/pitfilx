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

export type ThumbnailProgress = { done: number; total: number };

/**
 * Snapshot + live updates of how many of `paths` currently have a cached thumbnail. Calls `cb`
 * immediately with the current count, then again each time one of them gets a thumbnail for the
 * first time. Returns an unsubscribe function.
 *
 * Deliberately NOT wired up as a general "folder loading" indicator (tried that, removed it) — a
 * fixed/floating badge for ordinary background loading had nowhere safe to sit without overlapping
 * grid content. This exists specifically for callers that want to track one bounded, deliberate
 * bulk operation (e.g. "Regenerate thumbnails") where a short-lived, purpose-built indicator makes
 * sense.
 */
export function watchThumbnailProgress(paths: string[], cb: (p: ThumbnailProgress) => void): () => void {
  const total = paths.length;
  let done = 0;
  const pending: string[] = [];
  for (const path of paths) {
    if (cache.has(path)) done++;
    else pending.push(path);
  }
  cb({ done, total });
  if (pending.length === 0) return () => { /* nothing to watch */ };

  const unsubs = pending.map((path) =>
    onThumbnailReady(path, () => {
      done++;
      cb({ done, total });
    }),
  );
  return () => { for (const u of unsubs) u(); };
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

// Calls to loadThumbnailFromDisk that land within the same tick — e.g. a folder with hundreds of
// tiles all mounting in the same React commit — are coalesced into one shared batched transaction
// instead of each opening its own. This is what lets every tile mount (and look itself up) eagerly
// without reintroducing the "hundreds of simultaneous IndexedDB transactions" heaviness that
// batching was originally built to fix: callers don't need to know about batching at all, they just
// get a resolved answer a tick later than a truly single, isolated lookup would.
let pendingLookups: Map<string, Array<(v: string | undefined) => void>> | null = null;
let pendingLookupTimer: ReturnType<typeof setTimeout> | null = null;

function flushPendingLookups(): void {
  const batch = pendingLookups!;
  pendingLookups = null;
  pendingLookupTimer = null;
  const paths = Array.from(batch.keys());
  void loadThumbnailsFromDiskBatch(paths).then((found) => {
    for (const [path, resolvers] of batch) {
      const val = found.has(path) ? cache.get(path) : undefined;
      for (const resolve of resolvers) resolve(val);
    }
  });
}

/**
 * Looks up a single thumbnail on disk and, if found, stores it in memory. Concurrent calls across
 * different paths share one IndexedDB transaction (see pendingLookups above) rather than each
 * opening its own — from any individual caller's point of view this still behaves like a plain
 * single-key lookup, just resolved together with whichever other lookups were requested in the
 * same tick.
 *
 * Earlier this module bulk-loaded EVERY saved thumbnail into memory at app start before any card
 * was allowed to decide "not cached" — for folders visited over time that list can grow into the
 * thousands, so the bulk transfer + JSON/string copy of all of it delayed first paint noticeably. A
 * targeted get() avoids that regardless of how many unrelated thumbnails exist in the store.
 */
export function loadThumbnailFromDisk(path: string): Promise<string | undefined> {
  const inMemory = cache.get(path);
  if (inMemory !== undefined) return Promise.resolve(inMemory);

  return new Promise<string | undefined>((resolve) => {
    if (!pendingLookups) pendingLookups = new Map();
    let resolvers = pendingLookups.get(path);
    if (!resolvers) { resolvers = []; pendingLookups.set(path, resolvers); }
    resolvers.push(resolve);
    if (pendingLookupTimer == null) pendingLookupTimer = setTimeout(flushPendingLookups, 0);
  });
}

/**
 * Same lookup as `loadThumbnailFromDisk`, but for many paths at once, sharing ONE IndexedDB
 * transaction instead of opening a separate transaction per path. Opening a transaction has real
 * fixed overhead — firing hundreds of `loadThumbnailFromDisk` calls back-to-back (e.g. preloading
 * an entire 900-video folder) means hundreds of separate transactions all competing at once, which
 * is heavy enough on its own to make the app feel unresponsive even though every individual lookup
 * is a fast, already-cached, single-key get. Batching them into one transaction keeps the same
 * per-key cost but pays the transaction overhead once. Returns the set of paths that were found
 * (already stored into the in-memory cache as a side effect, like the single-path version).
 */
export function loadThumbnailsFromDiskBatch(paths: string[]): Promise<Set<string>> {
  const found = new Set<string>();
  const toQuery: string[] = [];
  for (const path of paths) {
    if (cache.has(path)) found.add(path);
    else toQuery.push(path);
  }
  if (toQuery.length === 0) return Promise.resolve(found);

  return openThumbDb().then((db) => {
    if (!db) return found;
    return new Promise<Set<string>>((resolve) => {
      try {
        const tx = db.transaction(STORE_NAME, "readonly");
        const store = tx.objectStore(STORE_NAME);
        for (const path of toQuery) {
          const req = store.get(path);
          req.onsuccess = () => {
            const val = req.result;
            if (typeof val === "string") { cacheFromDisk(path, val); found.add(path); }
          };
        }
        tx.oncomplete = () => resolve(found);
        tx.onerror = () => resolve(found);
      } catch {
        resolve(found);
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
      void invoke<ArrayBuffer>("thumb_poster", { filePath: path, atSeconds: 60.0 })
        .then((buf) => {
          const blob = new Blob([buf], { type: "image/jpeg" });
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
 *
 * `signal` lets a caller abort a capture that's still mid-decode (e.g. the user started
 * scrolling again) — the video/audio decode pipeline is real OS/GPU work regardless of which
 * thread the JS callbacks run on, so a capture left to finish on its own keeps competing with
 * scroll compositing for those resources for as long as it takes. Aborting tears the video
 * element down immediately instead of waiting it out.
 */
export function captureVideoFrame(src: string, signal?: AbortSignal): Promise<string | null> {
  if (canvasCaptureSupported === false) return Promise.resolve(null);
  if (signal?.aborted) return Promise.resolve(null);

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
      signal?.removeEventListener("abort", onAbort);
      // Release resources
      video.src = "";
      video.load();
      resolve(result);
    };

    const onAbort = () => done(null);
    signal?.addEventListener("abort", onAbort);

    // 12 s timeout — large files on slow drives can take time to read headers
    const timer = setTimeout(() => done(null), 12_000);

    video.onerror = () => done(null);

    video.onloadedmetadata = () => {
      const d = video.duration;
      if (!Number.isFinite(d) || d <= 0) { done(null); return; }
      video.currentTime = thumbnailSeekTime(d);
    };

    const drawFrame = () => {
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
        // toBlob's JPEG encode runs off the main thread in Chromium (unlike toDataURL, which
        // encodes synchronously and was blocking scroll/input while several captures ran at
        // once) — this is what made thumbnail population feel laggy on large folders.
        canvas.toBlob(
          (blob) => {
            if (!blob || blob.size <= 200) { done(null); return; }
            const reader = new FileReader();
            reader.onload = () => {
              canvasCaptureSupported = true;
              done(typeof reader.result === "string" ? reader.result : null);
            };
            reader.onerror = () => done(null);
            reader.readAsDataURL(blob);
          },
          "image/jpeg",
          0.85,
        );
      } catch (e) {
        // SecurityError means canvas is tainted — asset:// CORS headers not present
        if (e instanceof DOMException && e.name === "SecurityError") {
          canvasCaptureSupported = false;
        }
        done(null);
      }
    };

    video.onseeked = () => {
      // `seeked` can fire slightly before the browser has actually decoded and presented that
      // frame's pixels — drawing right away sometimes captured whatever was still in the video's
      // buffer (often just black), especially right after a fresh seek on a cold decoder. This was
      // the real cause of the occasional all-black thumbnail, not the seek position itself.
      // requestVideoFrameCallback (Chromium/WebView2) fires only once a frame has genuinely been
      // presented, which is exactly the guarantee needed here; where it's unavailable, two
      // animation frames is a reasonable fallback delay.
      const videoWithRvfc = video as HTMLVideoElement & {
        requestVideoFrameCallback?: (cb: () => void) => number;
      };
      if (typeof videoWithRvfc.requestVideoFrameCallback === "function") {
        videoWithRvfc.requestVideoFrameCallback(() => drawFrame());
      } else {
        requestAnimationFrame(() => requestAnimationFrame(drawFrame));
      }
    };

    video.src = src;
    video.load();
  });
}

function bytesToJpegDataUrl(bytes: Uint8Array): string {
  let binary = "";
  for (let i = 0; i < bytes.byteLength; i++) binary += String.fromCharCode(bytes[i]);
  return `data:image/jpeg;base64,${btoa(binary)}`;
}

// ── Native (ffmpeg) capture ───────────────────────────────────────────────────
// The canvas approach above decodes the video on the browser's own media pipeline and seeks
// "frame-accurately" (video.currentTime may have to decode forward from the nearest keyframe to
// land on the exact target frame) — real, sometimes-heavy work that runs adjacent to the main
// thread. ffmpeg's `-ss` (before `-i`) jumps straight to the nearest keyframe with no forward
// decode, and — just as importantly — runs as a separate OS process that never competes with
// Chromium's main thread or scroll compositing at all. On a folder of large files on a slow
// (especially spinning) drive this is both faster per capture and lighter on the app while it
// happens. Kept as a separate concurrency from PLAYLIST_POSTER_CONCURRENCY (playlist tiles) so a
// big background preload doesn't starve an open playlist's own poster fetches, or vice versa. This
// used to also be wrapped in the canvas-era MAX_VIDEO_LOADS/BG_MAX slot limiters (2 each) on top of
// this queue — a double throttle left over from when captures only ran on the main thread, and
// pointless now that native capture is process-based. This is genuinely the only gate on native
// capture concurrency now, so it can afford to be a bit higher than it was.
const NATIVE_CAPTURE_CONCURRENCY = 5;
let activeNativeCaptures = 0;
const nativeCaptureQueue: Array<() => void> = [];

function runNextNativeCapture(): void {
  if (activeNativeCaptures >= NATIVE_CAPTURE_CONCURRENCY) return;
  const next = nativeCaptureQueue.shift();
  if (!next) return;
  activeNativeCaptures++;
  next();
}

/** A modest default seek point — short enough that most clips exceed it, and short clips that
 * don't fall back to the very start on the Rust side (see thumb_poster_sync's retry). */
const NATIVE_CAPTURE_SEEK_SECONDS = 15;

/** Matches the old canvas capture's MAX_DIM — thumb_poster's own default (PIXEL_WIDTH = 160,
 * tuned for smaller playlist tiles) looked visibly blurrier at My Device grid tile sizes. Passing
 * this explicitly also gives this call its own cache file server-side (poster_w320.jpg) instead of
 * colliding with playlist tiles' poster_w160.jpg for the same video. */
const NATIVE_CAPTURE_WIDTH = 320;

/**
 * Starts the native background job that makes My Device grid thumbnails for every video under the
 * saved locations ahead of time (device_thumbs_prewarm in thumbs.rs) — same width and frame range
 * as captureVideoFrameNative, so it fills the very cache files the grid reads. Safe to call again:
 * a new call replaces the running job, and finished thumbnails are skipped.
 */
export function prewarmDeviceThumbnails(roots: string[]): void {
  if (roots.length === 0) return;
  const { thumbMinPct, thumbMaxPct } = getDeviceMediaSettings();
  void invoke("device_thumbs_prewarm", {
    roots,
    width: NATIVE_CAPTURE_WIDTH,
    minPct: thumbMinPct,
    maxPct: thumbMaxPct,
  }).catch(() => {});
}

/**
 * Captures a video thumbnail via the native `thumb_poster` ffmpeg command instead of the
 * browser's canvas pipeline. Falls back to null (letting the caller fall back to
 * `captureVideoFrame`) on any failure — e.g. ffmpeg not found on this system.
 */
export function captureVideoFrameNative(path: string): Promise<string | null> {
  // The user's configured "frame range" (Media settings) — thumb_poster probes duration itself and
  // resolves this into an actual seek time. atSeconds is passed too only as thumb_poster's own
  // fallback for if that probe fails; it's not what normally decides the position anymore.
  const { thumbMinPct, thumbMaxPct } = getDeviceMediaSettings();
  return new Promise((resolve) => {
    nativeCaptureQueue.push(() => {
      void invoke<ArrayBuffer>("thumb_poster", {
        filePath: path,
        atSeconds: NATIVE_CAPTURE_SEEK_SECONDS,
        width: NATIVE_CAPTURE_WIDTH,
        minPct: thumbMinPct,
        maxPct: thumbMaxPct,
      })
        .then((buf) => resolve(bytesToJpegDataUrl(new Uint8Array(buf))))
        .catch(() => resolve(null))
        .finally(() => {
          activeNativeCaptures--;
          runNextNativeCapture();
        });
    });
    runNextNativeCapture();
  });
}
