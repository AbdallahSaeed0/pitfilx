// LRU thumbnail cache for local video files.
// Stores canvas-captured frames as JPEG data URLs so thumbnails survive
// component unmounts (virtual scrolling, folder re-navigation).

const MAX_ENTRIES = 600;
const cache = new Map<string, string>(); // path → JPEG data URL

export function getThumbnail(path: string): string | undefined {
  return cache.get(path);
}

export function setThumbnail(path: string, dataUrl: string): void {
  if (cache.size >= MAX_ENTRIES) {
    const oldest = cache.keys().next().value;
    if (oldest !== undefined) cache.delete(oldest);
  }
  cache.set(path, dataUrl);
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
      const lo = Math.min(d * 0.08, Math.max(0, d - 1));
      const hi = Math.max(lo, d * 0.92);
      video.currentTime = lo + Math.random() * (hi - lo);
    };

    video.onseeked = () => {
      try {
        const canvas = document.createElement("canvas");
        canvas.width = 320;
        canvas.height = 180;
        const ctx = canvas.getContext("2d");
        if (!ctx) { done(null); return; }
        ctx.drawImage(video, 0, 0, 320, 180);
        const dataUrl = canvas.toDataURL("image/jpeg", 0.75);
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
