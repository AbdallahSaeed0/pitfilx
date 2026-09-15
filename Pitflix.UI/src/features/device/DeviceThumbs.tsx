import { convertFileSrc } from "@tauri-apps/api/core";
import { Film, Loader2 } from "lucide-react";
import { useCallback, useEffect, useRef, useState } from "react";
import {
  captureVideoFrame,
  captureVideoFrameNative,
  getThumbnail,
  isCanvasCaptureSupported,
  loadThumbnailFromDisk,
  loadThumbnailsFromDiskBatch,
  onThumbnailReady,
  setThumbnail,
  thumbnailSeekTime,
} from "../../utils/videoThumbnailCache";
import {
  captureImageThumb,
  getImageThumb,
  loadImageFromDisk,
  loadImagesFromDiskBatch,
  onImageReady,
  setImageThumb,
} from "../../utils/deviceImageCache";
import { getDeviceMediaSettings, subscribeDeviceMediaSettings } from "./deviceMediaSettings";

// ── Foreground concurrency limiter ────────────────────────────────────────────
// when the browser is not busy — i.e. user slowed/stopped scrolling), then
// tries to acquire one of the N slots.  If all slots are taken it reschedules
// itself for the next idle window — no central queue, no card blocks another.
// Capturing a video thumbnail means seeking to a random position in the file and decoding from
// there — that's random disk I/O, not sequential. On an SSD that parallelizes fine, but on a
// spinning HDD (a common case here: My Device folders are often bulk media on a secondary/external
// drive) every concurrent capture forces the drive head to keep jumping between different files'
// physical locations, and that seek time dominates. Past a small number, MORE concurrency doesn't
// mean more throughput on an HDD — it means more thrashing, so each individual capture actually
// gets slower and total throughput can go DOWN. This was raised to 10 assuming concurrency was
// free once scroll-time gating existed; on an HDD it isn't, so it's kept low instead.
const MAX_VIDEO_LOADS = 2;
let activeVideoLoads = 0;

function tryAcquireVideoSlot(): boolean {
  if (activeVideoLoads < MAX_VIDEO_LOADS) { activeVideoLoads++; return true; }
  return false;
}
function releaseVideoSlot() {
  activeVideoLoads = Math.max(0, activeVideoLoads - 1);
}

// ── Scroll-aware pause ────────────────────────────────────────────────────────
// When the user is actively scrolling, all background I/O pauses immediately.
// The scroll container calls notifyScroll() on each scroll event; 200 ms after
// the last event the pause lifts and queued jobs resume.
let isScrolling = false;
let scrollTimer: ReturnType<typeof setTimeout> | null = null;

// Captures still mid-decode when scrolling (re)starts are aborted outright rather than left to
// finish — the decode itself is real OS/GPU/disk work that competes with scroll compositing for
// as long as it runs, so gating only *new* captures (the isScrolling checks below) wasn't enough:
// captures already in flight when a fling began kept running the whole time regardless. Every
// video capture registers its controller here on start and unregisters on settle.
const activeVideoCaptures = new Set<AbortController>();

function abortActiveVideoCaptures(): void {
  for (const c of activeVideoCaptures) c.abort();
  activeVideoCaptures.clear();
}

// ── Background thumbnail preloader ────────────────────────────────────────────
// See MAX_VIDEO_LOADS above — same random-seek-on-a-spinning-disk reasoning applies here. This pool
// and the foreground one run independently, so worst case both are active at once; kept low enough
// that even 2 (here) + 2 (foreground) stays disk-friendly instead of thrashing an HDD.
const BG_MAX = 2;
let bgActive = 0;
const bgQueue: Array<() => void> = [];
let bgCancelKey = 0;

// ── Background image thumbnail preloader ─────────────────────────────────────
// Images are a full sequential read of a much smaller file (no in-file seeking needed the way video
// capture needs), so they're less exposed to HDD seek-thrashing than MAX_VIDEO_LOADS/BG_MAX — but
// still real disk I/O competing with any concurrent video capture, so kept modest rather than high.
const IMG_BG_MAX = 3;
let imgBgActive = 0;
const imgBgQueue: Array<() => void> = [];
let imgBgCancelKey = 0;
const warmedImagePaths = new Set<string>();

// Splitting "scroll" and "thumbnail loading" into two genuinely independent processes: aborting
// in-flight captures (above) stops wasted work, but anything that was already resolved (a warm
// disk hit, a background capture that finished a moment earlier) still wanted to apply its result
// via a React state update — and a state update/re-render mid-scroll is exactly the kind of main-
// thread work that shows up as scroll jank, independent of whether any decode is happening. So no
// thumbnail-driven state update is allowed to fire while isScrolling is true, full stop; instead it
// registers here and every registered callback fires together, once, right when scrolling settles.
const scrollSettleCallbacks: Array<() => void> = [];

/** Runs `cb` now if not scrolling, otherwise defers it to fire once scrolling settles. */
export function runAfterScrollSettles(cb: () => void): void {
  if (isScrolling) scrollSettleCallbacks.push(cb);
  else cb();
}

/** Whether the grid is actively scrolling right now (see notifyScroll). Used to skip starting
 * expensive work — e.g. mounting a real `<video>` element for hover preview — while content is
 * sliding under a stationary cursor, which otherwise fires a mouseenter/mouseleave burst across
 * every tile that passes underneath and is a major source of scroll jank. */
export function isDeviceScrolling(): boolean {
  return isScrolling;
}

export function notifyScroll(): void {
  if (!isScrolling) abortActiveVideoCaptures();
  isScrolling = true;
  if (scrollTimer !== null) clearTimeout(scrollTimer);
  scrollTimer = setTimeout(() => {
    isScrolling = false;
    scrollTimer = null;
    // Resume any background jobs that were deferred while scrolling
    while (bgActive < BG_MAX && bgQueue.length > 0) {
      bgActive++;
      bgQueue.shift()!();
    }
    while (imgBgActive < IMG_BG_MAX && imgBgQueue.length > 0) {
      imgBgActive++;
      imgBgQueue.shift()!();
    }
    // Flush every thumbnail-ready update that was held back during the scroll, all at once.
    const settled = scrollSettleCallbacks.splice(0);
    for (const cb of settled) cb();
  }, 200);
}

function acquireBgSlot(cb: () => void) {
  if (bgActive < BG_MAX) { bgActive++; cb(); }
  else bgQueue.push(cb);
}
function releaseBgSlot() {
  bgActive = Math.max(0, bgActive - 1);
  if (!isScrolling) {
    const next = bgQueue.shift();
    if (next) { bgActive++; next(); }
  }
  // If scrolling, notifyScroll's timeout will pump the queue when scroll stops
}

// No cap: leaving a folder open (even without scrolling) should eventually
// preload every video's thumbnail, not just the first N. The BG_MAX slot
// limiter above already keeps this from competing with foreground work — it
// just takes longer to finish on very large folders, which is fine since
// nothing here blocks the UI.
const BG_PRELOAD_LIMIT = Number.POSITIVE_INFINITY;

/** Stops queuing further background video-frame captures — e.g. when leaving the Device page to
 * open the player, so the still-in-flight canvas decode/encode work (synchronous, main-thread)
 * doesn't keep competing with the player's own rendering and input handling. Anything already
 * mid-capture finishes; nothing new starts. Thumbnails scrolled into view still self-heal via
 * DeviceVideoThumb's own on-demand capture, so nothing is lost — just no longer pre-warmed. */
export function cancelBackgroundThumbnails(): void {
  scheduleBackgroundThumbnails([]);
  // Cancelling drops queued jobs, but scheduleBackgroundThumbnails already marked every path it
  // queued as "warmed" up front (its don't-queue-this-twice guard). Leaving cancelled-but-never-
  // captured paths marked would make the NEXT visit skip them all as already-handled, which
  // permanently disables background preloading for that folder — the only thing still filling in
  // thumbnails would be each card's slow on-demand capture as it scrolls into view. So release the
  // mark on anything that didn't actually produce a thumbnail; re-queuing it later is cheap (a
  // targeted disk lookup short-circuits before any real capture if it was already saved).
  releaseUncapturedThumbMarks();
}

function releaseUncapturedThumbMarks(): void {
  for (const path of [...warmedThumbPaths]) {
    if (getThumbnail(path) === undefined) warmedThumbPaths.delete(path);
  }
}

// How many paths' disk lookups share one IndexedDB transaction. Opening a huge folder (e.g. 900
// videos) used to fire 900 separate `loadThumbnailFromDisk` calls — each its own transaction — all
// at once; the fixed per-transaction overhead multiplied 900x, plus every resulting cache fill and
// listener notification landing in the same tick, was heavy enough to make the whole app stutter
// even though every individual lookup was an instant, already-cached hit. Chunking keeps the same
// per-key cost but pays transaction overhead ~paths/CHUNK times instead of once per path, and
// spreading chunks across idle callbacks (below) keeps any given tick's work small.
const DISK_LOOKUP_CHUNK = 120;

export function scheduleBackgroundThumbnails(paths: string[]): void {
  const myKey = ++bgCancelKey;
  bgQueue.length = 0;

  const capped = paths.slice(0, BG_PRELOAD_LIMIT);
  const pending: string[] = [];
  for (const path of capped) {
    if (getThumbnail(path) !== undefined || warmedThumbPaths.has(path)) continue;
    warmedThumbPaths.add(path);
    pending.push(path);
  }

  const queueCapture = (path: string) => {
    const src = convertFileSrc(path);
    // Native (ffmpeg) capture runs as a separate OS process — unlike the canvas fallback below, it
    // never touches the main thread, so it doesn't need the scroll-pause dance or the BG_MAX slot
    // limiter (both exist specifically to protect the main thread from canvas decode work). It's
    // gated only by its own NATIVE_CAPTURE_CONCURRENCY queue inside captureVideoFrameNative.
    // Wrapping it in the old slot system on top of that was double-throttling it for no benefit.
    void captureVideoFrameNative(path).then((dataUrl) => {
      if (bgCancelKey !== myKey) return;
      if (dataUrl) { setThumbnail(path, dataUrl); return; }

      // Native failed outright (e.g. ffmpeg not found) — fall back to canvas capture, which DOES
      // need the scroll-aware slot system since it runs on/adjacent to the main thread.
      const runJob = () => {
        if (bgCancelKey !== myKey) { releaseBgSlot(); return; }
        if (isScrolling) {
          bgActive = Math.max(0, bgActive - 1);
          bgQueue.unshift(runJob);
          return;
        }
        const controller = new AbortController();
        activeVideoCaptures.add(controller);
        void captureVideoFrame(src, controller.signal).then((fallbackUrl) => {
          activeVideoCaptures.delete(controller);
          releaseBgSlot();
          if (fallbackUrl) setThumbnail(path, fallbackUrl);
        });
      };
      acquireBgSlot(runJob);
    });
  };

  const processChunk = (start: number) => {
    if (bgCancelKey !== myKey || start >= pending.length) return;
    const chunk = pending.slice(start, start + DISK_LOOKUP_CHUNK);
    // Fast targeted disk lookup first (one shared transaction, near-instant) — only spawn an
    // actual video capture for paths truly never saved before.
    void loadThumbnailsFromDiskBatch(chunk).then((found) => {
      if (bgCancelKey !== myKey) return;
      for (const path of chunk) {
        if (!found.has(path)) queueCapture(path);
      }
      scheduleIdle(() => processChunk(start + DISK_LOOKUP_CHUNK));
    });
  };
  processChunk(0);
}

function acquireImgBgSlot(cb: () => void) {
  if (imgBgActive < IMG_BG_MAX) { imgBgActive++; cb(); }
  else imgBgQueue.push(cb);
}
function releaseImgBgSlot() {
  imgBgActive = Math.max(0, imgBgActive - 1);
  if (!isScrolling) {
    const next = imgBgQueue.shift();
    if (next) { imgBgActive++; next(); }
  }
}

export function resetImageWarmState(): void {
  warmedImagePaths.clear();
}

/** Image counterpart to cancelBackgroundThumbnails — see its comment. */
export function cancelBackgroundImages(): void {
  scheduleBackgroundImages([]);
  // Same warm-mark release as the video path — see cancelBackgroundThumbnails.
  for (const path of [...warmedImagePaths]) {
    if (getImageThumb(path) === undefined) warmedImagePaths.delete(path);
  }
}

export function scheduleBackgroundImages(paths: string[]): void {
  const myKey = ++imgBgCancelKey;
  imgBgQueue.length = 0;

  const pending: string[] = [];
  for (const path of paths) {
    if (getImageThumb(path) !== undefined || warmedImagePaths.has(path)) continue;
    warmedImagePaths.add(path);
    pending.push(path);
  }

  const queueCapture = (path: string) => {
    const src = convertFileSrc(path);
    const runJob = () => {
      if (imgBgCancelKey !== myKey) { releaseImgBgSlot(); return; }
      if (isScrolling) {
        imgBgActive = Math.max(0, imgBgActive - 1);
        imgBgQueue.unshift(runJob);
        return;
      }
      void captureImageThumb(src).then((dataUrl) => {
        releaseImgBgSlot();
        if (dataUrl) setImageThumb(path, dataUrl);
      });
    };
    acquireImgBgSlot(runJob);
  };

  // Same chunked/idle-spread batching as scheduleBackgroundThumbnails — see DISK_LOOKUP_CHUNK.
  const processChunk = (start: number) => {
    if (imgBgCancelKey !== myKey || start >= pending.length) return;
    const chunk = pending.slice(start, start + DISK_LOOKUP_CHUNK);
    void loadImagesFromDiskBatch(chunk).then((found) => {
      if (imgBgCancelKey !== myKey) return;
      for (const path of chunk) {
        if (!found.has(path)) queueCapture(path);
      }
      scheduleIdle(() => processChunk(start + DISK_LOOKUP_CHUNK));
    });
  };
  processChunk(0);
}

/** Defer a non-urgent callback to browser idle time; falls back to a short timeout. */
function scheduleIdle(cb: () => void): () => void {
  if (typeof window !== "undefined" && "requestIdleCallback" in window) {
    const id = (window as typeof window & {
      requestIdleCallback(cb: () => void, o?: { timeout: number }): number;
    }).requestIdleCallback(cb, { timeout: 100 });
    return () => (window as typeof window & { cancelIdleCallback(id: number): void })
      .cancelIdleCallback(id);
  }
  const id = setTimeout(cb, 50 + Math.random() * 50);
  return () => clearTimeout(id);
}

// Tries canvas capture first (produces a cached <img>).
// Falls back to a <video> element if canvas is CORS-blocked (Tauri v2 asset://
// should have CORS headers, but we detect failure and degrade gracefully).
/** Paths whose thumbnails were already requested — skip IntersectionObserver delay on revisit. */
const warmedThumbPaths = new Set<string>();

export function resetThumbnailWarmState(): void {
  warmedThumbPaths.clear();
}

export function DeviceVideoThumb({ path }: { path: string }) {
  const src = convertFileSrc(path);
  const [thumbSrc, setThumbSrc] = useState<string | null>(() => getThumbnail(path) ?? null);
  const [useVideoFallback, setUseVideoFallback] = useState(false);
  const [failed, setFailed] = useState(false);

  useEffect(() => {
    return subscribeDeviceMediaSettings(() => {
      const t = getThumbnail(path);
      setThumbSrc(t ?? null);
      if (!t) {
        setUseVideoFallback(false);
        setFailed(false);
      }
    });
  }, [path]);

  useEffect(() => {
    warmedThumbPaths.add(path);
    if (thumbSrc !== null || useVideoFallback || failed) return;
    // Note: unlike before, canvas support being known-unsupported does NOT skip straight to the
    // <video> fallback here — native (ffmpeg) capture doesn't touch canvas at all, so it's still
    // worth trying first. The canvas-specific fallback further below checks this itself.

    let alive = true;
    let cancelIdle: (() => void) | null = null;

    // ── Subscribe for instant update from background preloader ───────────────
    // A capture finishing (this card's own, or the background preloader's) is a React state
    // update — that's real main-thread work regardless of how cheap it looks, so it's never
    // allowed to land while the user is mid-scroll. runAfterScrollSettles holds it until the
    // scroll fully stops, then every held-back thumbnail update flushes together in one go.
    const unsubscribe = onThumbnailReady(path, () => {
      const t = getThumbnail(path);
      if (!t || !alive) return;
      runAfterScrollSettles(() => {
        requestAnimationFrame(() => { if (alive) setThumbSrc(t); });
      });
    });

    // ── Self-scheduling capture — truly independent per card ─────────────────
    // Each card fires its own requestIdleCallback (only runs when browser is
    // idle = user not actively scrolling). On idle:
    //   1. Check cache — if background preloader already finished, show instantly.
    //   2. Try to grab a slot — up to MAX_VIDEO_LOADS concurrent captures.
    //   3. If all slots taken → reschedule for next idle window (no queue, no
    //      blocking of other cards; each retries on its own schedule).
    // timeout: 600 ms guarantees eventual execution even on a busy main thread.
    const attempt = () => {
      cancelIdle = null;
      if (!alive) return;
      const cached = getThumbnail(path);
      if (cached) { setThumbSrc(cached); return; }

      // Native (ffmpeg) capture first — runs as a separate OS process, so unlike the canvas
      // fallback below it doesn't need to wait for scrolling to settle or share the canvas-era
      // MAX_VIDEO_LOADS slot limiter (both exist specifically to protect the main thread from
      // canvas decode work, which native capture never touches). It's gated only by its own
      // NATIVE_CAPTURE_CONCURRENCY queue inside captureVideoFrameNative.
      void captureVideoFrameNative(path).then((nativeUrl) => {
        if (!alive) return;
        if (nativeUrl) { setThumbnail(path, nativeUrl); return; }

        // Native failed outright (e.g. ffmpeg missing) — fall back to canvas capture, which DOES
        // need the scroll-aware slot system since it runs on/adjacent to the main thread.
        if (isScrolling) { cancelIdle = scheduleIdle(attempt); return; }
        if (tryAcquireVideoSlot()) {
          const controller = new AbortController();
          activeVideoCaptures.add(controller);
          void captureVideoFrame(src, controller.signal).then((dataUrl) => {
            const wasAborted = controller.signal.aborted;
            activeVideoCaptures.delete(controller);
            releaseVideoSlot();
            if (dataUrl) setThumbnail(path, dataUrl);
            else if (wasAborted) {
              // Cut short because scrolling resumed, not a real decode failure — retry once idle
              // again instead of falling back to a <video> element for what's still a valid file.
              if (alive) cancelIdle = scheduleIdle(attempt);
            } else if (alive) setUseVideoFallback(true);
          });
        } else {
          // All slots busy right now — retry at the next idle moment
          cancelIdle = scheduleIdle(attempt);
        }
      });
    };

    // Fast targeted disk lookup first (single-key get, near-instant even with thousands of
    // unrelated saved thumbnails) — only fall through to a fresh video capture if this exact path
    // was never saved before. The *kickoff* itself — not just applying its result — waits for
    // scrolling to settle: every tile in a folder mounts immediately (see LazyFolderThumb), so a
    // fast/continuous scroll through a big folder means a lot of tiles mounting close together, and
    // each one firing its own IndexedDB transaction the instant it mounts is real main-thread work
    // landing mid-scroll regardless of how fast any single lookup is (lookups are also coalesced
    // into shared batched transactions — see pendingLookups in videoThumbnailCache.ts — but that
    // still doesn't help if it's happening *during* the scroll). runAfterScrollSettles holds every
    // newly-mounted tile's lookup until scrolling actually stops, then they all fire together —
    // scrolling itself never competes with thumbnail loading, at the cost of thumbnails only
    // starting to appear once you pause.
    runAfterScrollSettles(() => {
      if (!alive) return;
      void loadThumbnailFromDisk(path).then((found) => {
        if (!alive) return;
        if (found) { runAfterScrollSettles(() => { if (alive) setThumbSrc(found); }); return; }
        cancelIdle = scheduleIdle(attempt);
      });
    });

    return () => {
      alive = false;
      unsubscribe();
      cancelIdle?.();
      // No central queue entry to clean up — each card is self-contained
    };
  }, [src, path]); // eslint-disable-line react-hooks/exhaustive-deps

  if (thumbSrc) {
    return <img src={thumbSrc} alt="" draggable={false} className="h-full w-full object-cover" />;
  }

  if (failed) {
    return (
      <div className="flex h-full flex-col items-center justify-center gap-1 bg-black/60 px-1">
        <Film className="h-8 w-8 text-violet-400/70" strokeWidth={1.25} />
        <span className="text-[9px] text-pitflix-muted">No preview</span>
      </div>
    );
  }

  if (useVideoFallback) {
    return (
      <video
        src={src}
        className="h-full w-full object-cover"
        draggable={false}
        muted
        playsInline
        preload="metadata"
        onLoadedMetadata={(e) => {
          const el = e.currentTarget;
          try {
            const d = el.duration;
            if (Number.isFinite(d) && d > 0) el.currentTime = thumbnailSeekTime(d);
          } catch { /* ignore */ }
        }}
        onError={() => setFailed(true)}
      />
    );
  }

  return (
    <div className="device-thumb-shimmer">
      <div className="absolute inset-0 flex items-center justify-center">
        <Film className="h-7 w-7 text-violet-500/30" strokeWidth={1.25} aria-hidden />
      </div>
      {/* Small per-tile spinner — makes "this one is actively waiting on its thumbnail" explicit,
          rather than relying on the shimmer sweep alone to read as "loading". */}
      <div className="absolute bottom-1.5 right-1.5 flex h-5 w-5 items-center justify-center rounded-full bg-black/50">
        <Loader2 className="h-3 w-3 animate-spin text-violet-300/80" aria-hidden />
      </div>
    </div>
  );
}

export function DeviceImageThumb({ path }: { path: string }) {
  const src = convertFileSrc(path);
  const [thumbSrc, setThumbSrc] = useState<string | null>(() => getImageThumb(path) ?? null);
  const [failed, setFailed] = useState(false);

  useEffect(() => {
    warmedImagePaths.add(path);
    if (thumbSrc !== null || failed) return;

    let alive = true;
    let cancelIdle: (() => void) | null = null;

    const unsubscribe = onImageReady(path, () => {
      const t = getImageThumb(path);
      if (!t || !alive) return;
      runAfterScrollSettles(() => {
        requestAnimationFrame(() => { if (alive) setThumbSrc(t); });
      });
    });

    const attempt = () => {
      cancelIdle = null;
      if (!alive) return;
      const cached = getImageThumb(path);
      if (cached) { setThumbSrc(cached); return; }
      if (isScrolling) { cancelIdle = scheduleIdle(attempt); return; }

      void captureImageThumb(src).then((dataUrl) => {
        if (dataUrl) setImageThumb(path, dataUrl);
        else if (alive) setFailed(true);
      });
    };

    // Same reasoning as DeviceVideoThumb: don't even start the disk lookup while scrolling — a
    // fast/continuous scroll mounts a steady stream of newly-visible tiles, and firing each one's
    // own IndexedDB transaction the instant it mounts competes with scroll compositing regardless
    // of how fast any single lookup is. Defer the whole kickoff to scroll-settle instead.
    runAfterScrollSettles(() => {
      if (!alive) return;
      void loadImageFromDisk(path).then((found) => {
        if (!alive) return;
        if (found) { runAfterScrollSettles(() => { if (alive) setThumbSrc(found); }); return; }
        cancelIdle = scheduleIdle(attempt);
      });
    });

    return () => {
      alive = false;
      unsubscribe();
      cancelIdle?.();
    };
  }, [src, path]); // eslint-disable-line react-hooks/exhaustive-deps

  if (thumbSrc) {
    return <img src={thumbSrc} alt="" draggable={false} className="h-full w-full object-cover" />;
  }

  if (failed) {
    return (
      <div className="flex h-full items-center justify-center text-[10px] text-pitflix-muted">No preview</div>
    );
  }

  return (
    <div className="device-thumb-shimmer">
      <div className="absolute inset-0 flex items-center justify-center">
        <Film className="h-7 w-7 text-violet-500/30" strokeWidth={1.25} aria-hidden />
      </div>
      {/* Small per-tile spinner — makes "this one is actively waiting on its thumbnail" explicit,
          rather than relying on the shimmer sweep alone to read as "loading". */}
      <div className="absolute bottom-1.5 right-1.5 flex h-5 w-5 items-center justify-center rounded-full bg-black/50">
        <Loader2 className="h-3 w-3 animate-spin text-violet-300/80" aria-hidden />
      </div>
    </div>
  );
}

// ─── Piggyback thumbnail capture ─────────────────────────────────────────────
// When the hover-preview video has already decoded a frame (Phase 1 or Phase 2),
// we can capture a thumbnail from it for ~1 ms instead of ~200 ms, because the
// frame is already in GPU memory — no extra seek, load, or video element needed.
// Falls back silently if the video is CORS-tainted (canvas SecurityError).
function captureThumbnailFromVideo(video: HTMLVideoElement, path: string): void {
  if (isCanvasCaptureSupported() === false) return;
  if (getThumbnail(path) !== undefined) return; // already cached
  try {
    // Preserve the source video's aspect ratio (see captureVideoFrame in
    // videoThumbnailCache.ts) — a fixed 320x180 box would squish portrait
    // clips before the tile's own object-fit: cover crops them again.
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
    if (!ctx) return;
    ctx.drawImage(video, 0, 0, cw, ch);
    // toBlob avoids the synchronous main-thread JPEG encode toDataURL does (see
    // captureVideoFrame in videoThumbnailCache.ts for why that matters here).
    canvas.toBlob(
      (blob) => {
        if (!blob || blob.size <= 200) return;
        const reader = new FileReader();
        reader.onload = () => {
          // setThumbnail notifies any mounted DeviceVideoThumb subscribers immediately
          if (typeof reader.result === "string") setThumbnail(path, reader.result);
        };
        reader.readAsDataURL(blob);
      },
      "image/jpeg",
      0.85,
    );
  } catch {
    // SecurityError = CORS not configured; hover preview is unaffected
  }
}

// ─── Video hover-preview — video element mounted ONLY while hovered ─────────
//
// Earlier versions kept a <video> DOM element permanently mounted on every
// visible card (even with no src) so it could be "pre-warmed". That meant the
// virtualizer was constantly creating/destroying real <video> elements as rows
// recycled during scroll — video elements are far heavier for the browser to
// construct/teardown than img/div, and this was the actual cause of scroll
// jank (not I/O timing). Cards now render only `children` (the lightweight
// thumbnail) until the user hovers; the <video> tag is mounted on hover and
// unmounted again shortly after the mouse leaves. Thumbnail generation is
// entirely separate (off-DOM, see captureVideoFrame) so it's unaffected.
// ──────────────────────────────────────────────────────────────────────────────

const HOVER_DEBOUNCE_MS  = 80;   // ignore mouse bursts shorter than this before mounting <video>
const UNMOUNT_GRACE_MS   = 250;  // keep <video> mounted briefly after mouseleave (fast re-hover)

// ── Progressive per-file hover position ──────────────────────────────────────
// Each hover of a given file should land deeper into it than the previous
// hover did. Timing ranges come from user settings (deviceMediaSettings).
const previewProgressCache = new Map<string, number>(); // path -> last seek time used (seconds)

function previewStartPosition(duration: number): number {
  const s = getDeviceMediaSettings();
  let lo = s.previewStartMinSec;
  let hi = s.previewStartMaxSec;
  if (duration < hi) {
    lo = duration * 0.1;
    hi = duration * 0.4;
  }
  lo = Math.min(lo, duration - 1);
  hi = Math.min(hi, duration - 0.5);
  if (hi <= lo) return Math.max(0.5, duration * 0.1);
  return lo + Math.random() * (hi - lo);
}

function nextPreviewSeekTime(path: string, duration: number): number {
  if (!Number.isFinite(duration) || duration <= 0) return 0.5;
  const s = getDeviceMediaSettings();
  const ceiling = Math.max(1, duration - 1);
  const prev = previewProgressCache.get(path);
  let next: number;
  if (prev === undefined || prev >= ceiling - 5) {
    next = Math.min(ceiling, previewStartPosition(duration));
  } else {
    const step = s.previewStepMinSec + Math.random() * (s.previewStepMaxSec - s.previewStepMinSec);
    next = prev + step;
    if (next >= ceiling) next = Math.min(ceiling, previewStartPosition(duration));
  }
  previewProgressCache.set(path, next);
  return next;
}

/** Clears per-file hover progression so the next hover starts fresh. */
export function resetPreviewProgress(): void {
  previewProgressCache.clear();
}

let activePreviewVideo: HTMLVideoElement | null = null;

export function DeviceVideoHoverPreview({
  path,
  children,
  hoverContainerRef,
}: {
  path: string;
  children: React.ReactNode;
  /** When set, hover is detected on this element instead of the component's own wrapper — e.g. a
   * playlist row wants hovering anywhere on the row to trigger the preview, not just the small
   * thumbnail box the video itself renders into. */
  hoverContainerRef?: React.RefObject<HTMLElement | null>;
}) {
  const src = convertFileSrc(path);
  const videoRef = useRef<HTMLVideoElement>(null);

  // mounted = the <video> tag exists in the DOM at all (hover + grace period)
  const [mounted, setMounted] = useState(false);
  // ready = video has seeked to a frame and can be shown without a flash of black
  const [ready,   setReady]   = useState(false);

  const hoverTimerRef   = useRef<ReturnType<typeof setTimeout> | null>(null);
  const unmountTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  const holdIntervalRef = useRef<ReturnType<typeof setInterval> | null>(null);
  // Suppresses mounting the preview <video> while the mouse button is held — mounting a new
  // element under the cursor mid-press (e.g. right as the user is starting a press-and-hold drag
  // gesture on a video thumbnail) mutates the DOM at the exact spot the browser is tracking for
  // native drag-initiation, which silently aborts it (shows a permanent "not allowed" cursor).
  const mouseDownRef = useRef(false);

  const stopHoldTimer = useCallback(() => {
    if (holdIntervalRef.current) { clearInterval(holdIntervalRef.current); holdIntervalRef.current = null; }
  }, []);

  // While the mouse keeps hovering without leaving, jump to a new (deeper)
  // part of the video every HOLD_ADVANCE_MS — same progressive position
  // logic as a fresh hover, just triggered by time instead of a new mouseenter.
  const startHoldTimer = useCallback(() => {
    stopHoldTimer();
    const advanceMs = getDeviceMediaSettings().previewAutoAdvanceSec * 1000;
    holdIntervalRef.current = setInterval(() => {
      const v = videoRef.current;
      if (!v || !Number.isFinite(v.duration) || v.duration <= 0) return;
      v.currentTime = nextPreviewSeekTime(path, v.duration);
    }, advanceMs);
  }, [path, stopHoldTimer]);

  const onMouseEnter = useCallback(() => {
    // Scrolling re-hit-tests continuously, so content sliding under a stationary cursor fires a
    // real mouseenter/mouseleave per tile it passes — without this guard, a single scroll gesture
    // can mount and tear down a dozen real <video> elements (each a genuine decode-pipeline touch)
    // in a few hundred ms, which is exactly the kind of main-thread work that shows up as scroll
    // jank/erratic speed. Skip starting a mount while that's happening; the tile the cursor settles
    // on (or the next deliberate mouse movement) will trigger its own mouseenter normally once
    // scrolling stops.
    if (isDeviceScrolling()) return;
    if (unmountTimerRef.current) { clearTimeout(unmountTimerRef.current); unmountTimerRef.current = null; }
    if (hoverTimerRef.current) clearTimeout(hoverTimerRef.current);
    hoverTimerRef.current = setTimeout(() => {
      if (mouseDownRef.current || isDeviceScrolling()) return; // mid-press, or scrolling started during the debounce window
      setMounted(true);
      // If the <video> is still around from a very recent hover (grace
      // period), onLoadedMetadata won't fire again since src didn't change —
      // pick the next progressive position now so every hover goes deeper
      // into the file, not just the first hover of a given mount.
      const v = videoRef.current;
      if (v && Number.isFinite(v.duration) && v.duration > 0) {
        setReady(false);
        v.currentTime = nextPreviewSeekTime(path, v.duration);
      }
      startHoldTimer();
    }, HOVER_DEBOUNCE_MS);
  }, [path, startHoldTimer]);

  const onMouseLeave = useCallback(() => {
    if (hoverTimerRef.current) { clearTimeout(hoverTimerRef.current); hoverTimerRef.current = null; }
    stopHoldTimer();
    setReady(false);
    const v = videoRef.current;
    if (v) {
      v.pause();
      if (activePreviewVideo === v) activePreviewVideo = null;
    }
    // Grace period: a quick re-hover (e.g. mouse passing over the card) won't
    // pay the mount/seek cost again.
    if (unmountTimerRef.current) clearTimeout(unmountTimerRef.current);
    unmountTimerRef.current = setTimeout(() => setMounted(false), UNMOUNT_GRACE_MS);
  }, [stopHoldTimer]);

  // Progressive position for a freshly-mounted <video> (first hover, or a
  // hover long after the grace period expired so a new element was created).
  const onLoadedMetadata = useCallback(() => {
    const v = videoRef.current;
    if (!v) return;
    const d = v.duration;
    v.currentTime = Number.isFinite(d) && d > 0 ? nextPreviewSeekTime(path, d) : 0.5;
  }, [path]);

  const onSeeked = useCallback(() => {
    const v = videoRef.current;
    if (!v) return;
    setReady(true);
    if (activePreviewVideo && activePreviewVideo !== v) activePreviewVideo.pause();
    activePreviewVideo = v;
    void v.play().catch(() => {});
    captureThumbnailFromVideo(v, path);
  }, [path]);

  useEffect(() => {
    return subscribeDeviceMediaSettings(() => {
      if (holdIntervalRef.current) startHoldTimer();
    });
  }, [startHoldTimer]);

  const onMouseDown = useCallback(() => {
    mouseDownRef.current = true;
    // Cancel an already-pending mount too, in case the timer was started by hovering just before
    // the press — not only future ones.
    if (hoverTimerRef.current) { clearTimeout(hoverTimerRef.current); hoverTimerRef.current = null; }
  }, []);

  // Mouseup can land outside this element entirely (e.g. the drag ended over a different card or
  // off the grid) — listen on window so the suppression reliably clears regardless of where the
  // button was released.
  useEffect(() => {
    const onWindowMouseUp = () => { mouseDownRef.current = false; };
    window.addEventListener("mouseup", onWindowMouseUp);
    return () => window.removeEventListener("mouseup", onWindowMouseUp);
  }, []);

  // External hover container (e.g. a whole playlist row): attach native listeners there instead of
  // relying on the wrapper div's own onMouseEnter/onMouseLeave, which only cover the thumbnail box.
  useEffect(() => {
    const target = hoverContainerRef?.current;
    if (!target) return;
    target.addEventListener("mouseenter", onMouseEnter);
    target.addEventListener("mouseleave", onMouseLeave);
    target.addEventListener("mousedown", onMouseDown);
    return () => {
      target.removeEventListener("mouseenter", onMouseEnter);
      target.removeEventListener("mouseleave", onMouseLeave);
      target.removeEventListener("mousedown", onMouseDown);
    };
  }, [hoverContainerRef, onMouseEnter, onMouseLeave, onMouseDown]);

  useEffect(() => {
    return () => {
      if (hoverTimerRef.current) clearTimeout(hoverTimerRef.current);
      if (unmountTimerRef.current) clearTimeout(unmountTimerRef.current);
      stopHoldTimer();
      const v = videoRef.current;
      if (v && activePreviewVideo === v) activePreviewVideo = null;
    };
  }, [stopHoldTimer]);

  const showVideo = mounted && ready;

  return (
    <div
      style={{ position: "relative", width: "100%", height: "100%" }}
      {...(hoverContainerRef ? {} : { onMouseEnter, onMouseLeave, onMouseDown })}
    >
      <div style={{
        position: "absolute", inset: 0,
        opacity: showVideo ? 0 : 1,
        transition: showVideo ? "opacity 0.08s" : "opacity 0.15s",
      }}>
        {children}
      </div>

      {/* Mounted only while hovered (+ short grace period) — never during scroll. */}
      {mounted ? (
        <video
          ref={videoRef}
          src={src}
          crossOrigin="anonymous"
          draggable={false}
          style={{
            position: "absolute", inset: 0, width: "100%", height: "100%",
            objectFit: "cover",
            opacity: showVideo ? 1 : 0,
            transition: showVideo ? "opacity 0.08s" : "opacity 0.15s",
            // Browsers give <video> its own native "drag out" behavior by default, which sits
            // directly on top of the thumbnail while hovered/dragged and hijacks the gesture
            // before it can reach the grid item's own draggable button (My Device drag-to-move).
            // draggable={false} alone isn't reliably honored on media elements in every engine,
            // so also block pointer events here — the hover container above it already forwards
            // enter/leave for the preview logic, and this element is purely decorative overlay.
            pointerEvents: "none",
          }}
          muted
          playsInline
          loop
          preload="auto"
          onLoadedMetadata={onLoadedMetadata}
          onSeeked={onSeeked}
        />
      ) : null}
    </div>
  );
}

/** Renders the thumbnail immediately, for every tile currently in the DOM — deliberately NOT
 * gated behind visibility (that was tried: wrapping this in LazyMountOnVisible, so a virtualization
 * miss on a huge folder didn't also mean hundreds of thumbnails all starting at once). It fixed the
 * open-a-big-folder heaviness, but as a side effect meant nothing off-screen ever mounted a
 * component at all — so the folder's own background preloader (scheduleBackgroundThumbnails/Images
 * in MyDevicePage.tsx, which proactively works through every video/image in the folder regardless
 * of scroll position) had nothing listening for its results until you actually scrolled a tile into
 * view. The whole folder WAS still preloading in the background, just invisibly. Since then, the
 * actual expensive work (the disk lookup and the video-frame capture) has been moved behind its own
 * scroll-settle gating directly in DeviceVideoThumb/DeviceImageThumb below — so mounting doesn't
 * mean loading starts immediately, mounting just means "this tile is willing to show a result once
 * one exists." That's what makes it safe to mount immediately again: the folder now visibly fills
 * in as the background preloader works through it, without that work competing with scrolling. */
export function LazyFolderThumb({ mode, path }: { mode: "video" | "image"; path: string }) {
  useEffect(() => { warmedThumbPaths.add(path); }, [path]);

  return (
    <div className="h-full w-full min-h-0">
      {mode === "video"
        ? <DeviceVideoThumb path={path} />
        : <DeviceImageThumb path={path} />
      }
    </div>
  );
}

/** For grids that AREN'T virtualized (e.g. a My Videos folder, which just renders every video's
 * tile in one pass instead of windowing like the main My Device grid does) — defers mounting
 * `children` until the wrapper is about to scroll into view, so opening a folder with hundreds of
 * videos doesn't mount hundreds of hover-preview listeners and thumbnail components in one React
 * commit. Once shown, stays mounted permanently (no re-hiding on scroll-away) — the point is
 * cutting the up-front cost of opening the folder, not adding teardown/rebuild churn later. Caller
 * is responsible for giving the wrapper real dimensions (e.g. via an aspect-ratio box) so the grid
 * doesn't reflow as tiles mount in. */
export function LazyMountOnVisible({
  children,
  rootMargin = "800px 0px",
}: {
  children: React.ReactNode;
  rootMargin?: string;
}) {
  const ref = useRef<HTMLDivElement>(null);
  const [visible, setVisible] = useState(false);

  useEffect(() => {
    if (visible) return;
    const el = ref.current;
    if (!el) return;
    const io = new IntersectionObserver(
      (entries) => {
        if (entries[0]?.isIntersecting) { setVisible(true); io.disconnect(); }
      },
      { rootMargin },
    );
    io.observe(el);
    return () => io.disconnect();
  }, [visible, rootMargin]);

  return <div ref={ref} className="h-full w-full">{visible ? children : null}</div>;
}
