const MAX_ENTRIES = 320;
export const HOVER_PREVIEW_STEP_SEC = 5;

const cache = new Map<string, string>();

export function seekHoverPreviewSecond(seconds: number): number {
  if (!Number.isFinite(seconds) || seconds <= 0) return 0;
  return Math.max(0, Math.round(seconds / HOVER_PREVIEW_STEP_SEC) * HOVER_PREVIEW_STEP_SEC);
}

export function seekHoverCacheKey(filePath: string, second: number): string {
  return `${filePath}|${second}`;
}

/** Whole second under the pointer — what the click seeks to (mpv seeks `absolute exact`). */
export function seekHoverExactSecond(seconds: number): number {
  if (!Number.isFinite(seconds) || seconds <= 0) return 0;
  return Math.round(seconds);
}

/**
 * Frame-exact previews live under their own keys: a 5 s bucket entry can be a keyframe up to
 * 2.5 s off (see thumbs.rs), so it must never be mistaken for the exact frame at that second.
 */
export function getSeekHoverExact(filePath: string, second: number): string | undefined {
  return cache.get(`${filePath}|x${second}`);
}

export function setSeekHoverExact(filePath: string, second: number, objectUrl: string): void {
  putEntry(`${filePath}|x${second}`, objectUrl);
}

export function getSeekHoverCached(filePath: string, second: number): string | undefined {
  return cache.get(seekHoverCacheKey(filePath, second));
}

export function setSeekHoverCached(filePath: string, second: number, objectUrl: string): void {
  putEntry(seekHoverCacheKey(filePath, second), objectUrl);
}

function putEntry(key: string, objectUrl: string): void {
  if (cache.has(key)) return;
  if (cache.size >= MAX_ENTRIES) {
    const oldest = cache.keys().next().value;
    if (oldest) {
      const oldUrl = cache.get(oldest);
      if (oldUrl) releaseSeekHoverUrl(oldUrl);
      cache.delete(oldest);
    }
  }
  cache.set(key, objectUrl);
}

export function clearSeekHoverCache(): void {
  for (const url of cache.values()) releaseSeekHoverUrl(url);
  cache.clear();
}

/**
 * The real time (seconds) of the frame behind each preview URL, sent by thumbs.rs as an 8-byte
 * header. A swept preview is the nearest SAVED frame (a keyframe, possibly seconds away from the
 * cursor); knowing its time lets the label show it and a click land exactly on that frame.
 */
const frameTimeByUrl = new Map<string, number>();

export function getSeekHoverFrameTime(url: string | null | undefined): number | undefined {
  return url ? frameTimeByUrl.get(url) : undefined;
}

export function releaseSeekHoverUrl(url: string): void {
  frameTimeByUrl.delete(url);
  URL.revokeObjectURL(url);
}

export function isValidThumbBytes(buf: ArrayBuffer): boolean {
  // Tiny payloads are usually failed ffmpeg seeks / empty JPEG shells.
  return buf.byteLength >= 1200;
}

/// Converts the raw JPEG bytes returned by the `thumb_at_quick` / `thumb_at`
/// Tauri commands (as `tauri::ipc::Response`, received here as an
/// ArrayBuffer) into a blob URL usable by an `<img>` tag.
export function bytesToSeekHoverUrl(buf: ArrayBuffer): string | null {
  // New format: f64 (LE) frame time, then the JPEG. A JPEG starts with FF D8 — anything else
  // means the header is there.
  const head = new Uint8Array(buf, 0, Math.min(2, buf.byteLength));
  const hasTime = !(head[0] === 0xff && head[1] === 0xd8) && buf.byteLength > 8;
  const time = hasTime ? new DataView(buf).getFloat64(0, true) : NaN;
  const jpeg = hasTime ? buf.slice(8) : buf;
  if (!isValidThumbBytes(jpeg)) return null;
  const url = URL.createObjectURL(new Blob([jpeg], { type: "image/jpeg" }));
  if (Number.isFinite(time) && time >= 0) frameTimeByUrl.set(url, time);
  return url;
}
