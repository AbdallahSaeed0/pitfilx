import { convertFileSrc } from "@tauri-apps/api/core";
import { Film } from "lucide-react";
import { useCallback, useEffect, useRef, useState } from "react";
import {
  captureVideoFrame,
  getThumbnail,
  isCanvasCaptureSupported,
  loadThumbnailFromDisk,
  onThumbnailReady,
  setThumbnail,
  thumbnailSeekTime,
} from "../../utils/videoThumbnailCache";
import {
  captureImageThumb,
  getImageThumb,
  loadImageFromDisk,
  onImageReady,
  setImageThumb,
} from "../../utils/deviceImageCache";
import { getDeviceMediaSettings, subscribeDeviceMediaSettings } from "./deviceMediaSettings";

// ── Foreground concurrency limiter ────────────────────────────────────────────
// when the browser is not busy — i.e. user slowed/stopped scrolling), then
// tries to acquire one of the N slots.  If all slots are taken it reschedules
// itself for the next idle window — no central queue, no card blocks another.
const MAX_VIDEO_LOADS = 5;
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

// ── Background thumbnail preloader ────────────────────────────────────────────
const BG_MAX = 3;
let bgActive = 0;
const bgQueue: Array<() => void> = [];
let bgCancelKey = 0;

// ── Background image thumbnail preloader ─────────────────────────────────────
const IMG_BG_MAX = 3;
let imgBgActive = 0;
const imgBgQueue: Array<() => void> = [];
let imgBgCancelKey = 0;
const warmedImagePaths = new Set<string>();

export function notifyScroll(): void {
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

export function scheduleBackgroundThumbnails(paths: string[]): void {
  const myKey = ++bgCancelKey;
  bgQueue.length = 0;

  const capped = paths.slice(0, BG_PRELOAD_LIMIT);
  for (const path of capped) {
    if (getThumbnail(path) !== undefined || warmedThumbPaths.has(path)) continue;
    warmedThumbPaths.add(path);

    // Fast targeted disk lookup first (single-key get, near-instant) —
    // only spawn an actual video capture if it's truly never been saved.
    void loadThumbnailFromDisk(path).then((found) => {
      if (bgCancelKey !== myKey || found !== undefined) return;

      const src = convertFileSrc(path);
      const runJob = () => {
        if (bgCancelKey !== myKey) { releaseBgSlot(); return; }
        // Pause during scroll — put job back at front of queue and release slot.
        // notifyScroll's timeout will restart it once scrolling stops.
        if (isScrolling) {
          bgActive = Math.max(0, bgActive - 1);
          bgQueue.unshift(runJob);
          return;
        }
        void captureVideoFrame(src).then((dataUrl) => {
          releaseBgSlot();
          if (dataUrl) setThumbnail(path, dataUrl);
        });
      };
      acquireBgSlot(runJob);
    });
  }
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

export function scheduleBackgroundImages(paths: string[]): void {
  const myKey = ++imgBgCancelKey;
  imgBgQueue.length = 0;

  for (const path of paths) {
    if (getImageThumb(path) !== undefined || warmedImagePaths.has(path)) continue;
    warmedImagePaths.add(path);

    void loadImageFromDisk(path).then((found) => {
      if (imgBgCancelKey !== myKey || found !== undefined) return;

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
    });
  }
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
    if (isCanvasCaptureSupported() === false) { setUseVideoFallback(true); return; }

    let alive = true;
    let cancelIdle: (() => void) | null = null;

    // ── Subscribe for instant update from background preloader ───────────────
    // Deferred through rAF so thumbnail updates land between frames, not
    // mid-scroll-handler — this prevents React re-renders from causing jank.
    const unsubscribe = onThumbnailReady(path, () => {
      const t = getThumbnail(path);
      if (t && alive) requestAnimationFrame(() => { if (alive) setThumbSrc(t); });
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

      // Don't start a new decode+canvas-readback while the user is actively
      // scrolling — that work runs on the main thread and drops frames.
      // Retry as soon as scrolling settles (notifyScroll's 200ms timeout).
      if (isScrolling) { cancelIdle = scheduleIdle(attempt); return; }

      if (tryAcquireVideoSlot()) {
        void captureVideoFrame(src).then((dataUrl) => {
          releaseVideoSlot();
          if (dataUrl) setThumbnail(path, dataUrl);
          else if (alive) setUseVideoFallback(true);
        });
      } else {
        // All slots busy right now — retry at the next idle moment
        cancelIdle = scheduleIdle(attempt);
      }
    };

    // Fast targeted disk lookup first (single-key get, near-instant even
    // with thousands of unrelated saved thumbnails) — only fall through to
    // a fresh video capture if this exact path was never saved before.
    void loadThumbnailFromDisk(path).then((found) => {
      if (!alive) return;
      if (found) { setThumbSrc(found); return; }
      cancelIdle = scheduleIdle(attempt);
    });

    return () => {
      alive = false;
      unsubscribe();
      cancelIdle?.();
      // No central queue entry to clean up — each card is self-contained
    };
  }, [src, path]); // eslint-disable-line react-hooks/exhaustive-deps

  if (thumbSrc) {
    return <img src={thumbSrc} alt="" className="h-full w-full object-cover" />;
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
      if (t && alive) requestAnimationFrame(() => { if (alive) setThumbSrc(t); });
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

    void loadImageFromDisk(path).then((found) => {
      if (!alive) return;
      if (found) { setThumbSrc(found); return; }
      cancelIdle = scheduleIdle(attempt);
    });

    return () => {
      alive = false;
      unsubscribe();
      cancelIdle?.();
    };
  }, [src, path]); // eslint-disable-line react-hooks/exhaustive-deps

  if (thumbSrc) {
    return <img src={thumbSrc} alt="" className="h-full w-full object-cover" />;
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
    const dataUrl = canvas.toDataURL("image/jpeg", 0.85);
    // setThumbnail notifies any mounted DeviceVideoThumb subscribers immediately
    if (dataUrl.length > 200) setThumbnail(path, dataUrl);
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
}: {
  path: string;
  children: React.ReactNode;
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
    if (unmountTimerRef.current) { clearTimeout(unmountTimerRef.current); unmountTimerRef.current = null; }
    if (hoverTimerRef.current) clearTimeout(hoverTimerRef.current);
    hoverTimerRef.current = setTimeout(() => {
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
      onMouseEnter={onMouseEnter}
      onMouseLeave={onMouseLeave}
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
          style={{
            position: "absolute", inset: 0, width: "100%", height: "100%",
            objectFit: "cover",
            opacity: showVideo ? 1 : 0,
            transition: showVideo ? "opacity 0.08s" : "opacity 0.15s",
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

/** Renders the thumbnail immediately — the virtualizer already limits DOM size. */
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
