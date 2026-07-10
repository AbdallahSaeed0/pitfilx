const MAX_ENTRIES = 160;
export const HOVER_PREVIEW_STEP_SEC = 5;

const cache = new Map<string, string>();

export function seekHoverPreviewSecond(seconds: number): number {
  if (!Number.isFinite(seconds) || seconds <= 0) return 0;
  return Math.max(0, Math.round(seconds / HOVER_PREVIEW_STEP_SEC) * HOVER_PREVIEW_STEP_SEC);
}

export function seekHoverCacheKey(filePath: string, second: number): string {
  return `${filePath}|${second}`;
}

export function getSeekHoverCached(filePath: string, second: number): string | undefined {
  return cache.get(seekHoverCacheKey(filePath, second));
}

export function setSeekHoverCached(filePath: string, second: number, objectUrl: string): void {
  const key = seekHoverCacheKey(filePath, second);
  if (cache.has(key)) return;
  if (cache.size >= MAX_ENTRIES) {
    const oldest = cache.keys().next().value;
    if (oldest) {
      const oldUrl = cache.get(oldest);
      if (oldUrl) URL.revokeObjectURL(oldUrl);
      cache.delete(oldest);
    }
  }
  cache.set(key, objectUrl);
}

export function clearSeekHoverCache(): void {
  for (const url of cache.values()) URL.revokeObjectURL(url);
  cache.clear();
}

export function isValidThumbBytes(buf: ArrayBuffer): boolean {
  // Tiny payloads are usually failed ffmpeg seeks / empty JPEG shells.
  return buf.byteLength >= 1200;
}

/// Converts the raw JPEG bytes returned by the `thumb_at_quick` / `thumb_at`
/// Tauri commands (as `tauri::ipc::Response`, received here as an
/// ArrayBuffer) into a blob URL usable by an `<img>` tag.
export function bytesToSeekHoverUrl(buf: ArrayBuffer): string | null {
  if (!isValidThumbBytes(buf)) return null;
  const blob = new Blob([buf], { type: "image/jpeg" });
  return URL.createObjectURL(blob);
}
