import { convertFileSrc, isTauri } from "@tauri-apps/api/core";
import { API_ORIGIN } from "../api/client";

/**
 * CSS widths the various artwork slots are actually drawn at, scaled to device pixels.
 *
 * The API snaps whatever we ask for up to its nearest supported bucket (see
 * `ImageThumbnailService.AllowedWidths`) and ignores anything it doesn't recognise, serving the
 * full-size file — so a mismatch here degrades quietly instead of breaking.
 *
 * Scaling by devicePixelRatio matters: at 1x a 145 px grid cell needs a ~160 px image, and hardcoding
 * a HiDPI-sized 300 px one would throw away most of the saving on the ordinary displays the app
 * usually runs on. Capped at 2x — beyond that the extra pixels cost more to decode than they show.
 */
const dpr = (() => {
  const ratio = typeof window !== "undefined" ? window.devicePixelRatio || 1 : 1;
  return Math.min(2, Math.max(1, ratio));
})();

const scaled = (cssWidth: number) => Math.round(cssWidth * dpr);

/**
 * Small posters need ~1.5x more pixels than the slot to look crisp. An exact-fit variant is a
 * small q82 JPEG that the browser then resamples a second time onto the cell, and posters are
 * mostly fine text and faces — both steps soften them visibly next to the sharp UI text around
 * them (user report 2026-10-16: "posters are good quality but don't look like it").
 */
const crisp = (cssWidth: number) => scaled(cssWidth * 1.5);

export const POSTER_WIDTHS = {
  /** Dense carousel / list-row thumbnails (~130-136 px cells). */
  thumb: crisp(136),
  /**
   * Library grid cells and default home-row cards. The 145 px baseline undersold this in practice:
   * `LibraryPosterGrid`'s columns are `minmax(145px, 1fr)`, so on anything wider than a few narrow
   * columns cells grow well past 145px, and the non-compact home rows (`PosterCard` with `!w-44`)
   * are a fixed 176px — both were requesting a ~150-160px variant and getting stretched, which read
   * as pixelation. 200 covers both with headroom and is still a fraction of the 500px cached source.
   */
  card: crisp(200),
  /** Detail-page poster and hover-card art. */
  detail: crisp(200),
  /**
   * Hero backdrops — drawn across the full home-page column (900-1900px+ CSS wide), not a small
   * fixed-size slot, so this deliberately isn't `scaled()`. The API's largest resize bucket is 640,
   * which is well below both the display width and the 1280px-wide file already sitting in the cache.
   * Asking for more than that bucket makes `ImageThumbnailService.NormalizeWidth` return null and
   * serve the untouched w1280 backdrop instead of a stretched, downscaled one.
   */
  hero: 1280,
} as const;

/**
 * Turn API image paths into something the current runtime can load.
 * - `http(s)`: unchanged.
 * - Tauri + local disk path: `convertFileSrc` (asset protocol).
 * - Browser + local disk path: Pitflix.API `/images/...` (same cache Pitflix.WPF uses).
 *
 * `width` asks the API for a downscaled variant (see POSTER_WIDTHS). Pass it for anything drawn small.
 * The cache stores 500x750 posters and 1280x720 backdrops, so a grid of forty cards otherwise pulls
 * ~2.6 MB and — the expensive part — decodes forty 500x750 bitmaps just to paint them at 145 px.
 * Requesting a width also routes local files through the API instead of Tauri's asset protocol, since
 * the asset protocol only ever hands back the original file.
 */
export function toPosterSrc(path: string | null | undefined, width?: number): string | undefined {
  if (!path) return undefined;
  if (path.startsWith("http://") || path.startsWith("https://")) {
    try {
      const u = new URL(path);
      const loopback =
        u.hostname === "127.0.0.1" || u.hostname === "localhost" || u.hostname === "[::1]";
      if (loopback && (u.pathname.startsWith("/images/") || u.pathname.startsWith("/api/"))) {
        return withWidth(`${API_ORIGIN}${u.pathname}${u.search}`, width);
      }
      if (u.hostname === "image.tmdb.org") {
        const m = u.pathname.match(/\/t\/p\/([^/]+)\/(.+)$/);
        if (m) {
          const qs = new URLSearchParams({ size: m[1], file: m[2] });
          if (width) qs.set("w", String(width));
          return `${API_ORIGIN}/api/img/tmdb?${qs.toString()}`;
        }
      }
    } catch {
      /* ignore */
    }
    return path;
  }
  if (path.startsWith("/images/")) return withWidth(`${API_ORIGIN}${path}`, width);

  // Vite production bundles imported images as `/assets/<hash>.ext` (same origin as the SPA).
  if (path.startsWith("/assets/")) {
    const base = (import.meta.env.BASE_URL ?? "/").replace(/\/$/, "");
    return `${base}${path}`;
  }

  // Vite `public/` files (same origin as the UI). Must run before Tauri `convertFileSrc` — `/awards/...` is not a disk path.
  if (path.startsWith("/awards/")) {
    const base = import.meta.env.BASE_URL ?? "/";
    const trimmed = base.endsWith("/") ? base.slice(0, -1) : base;
    return trimmed === "" ? path : `${trimmed}${path}`;
  }

  // A requested width has to go through the API — Tauri's asset protocol serves the file verbatim.
  // Only paths genuinely under the image cache qualify; anything else keeps the asset protocol, since
  // the API can only serve files below its images root.
  if (width && isUnderImageCache(path)) {
    const viaApi = pitflixLocalCachePathToImageUrl(path);
    if (viaApi) return withWidth(viaApi, width);
  }

  if (isTauri()) return convertFileSrc(path);

  // Plain browser (Vite dev): cannot read %LocalAppData% paths — use API static images.
  return pitflixLocalCachePathToImageUrl(path);
}

/**
 * Episode `stillUrl` fields are hardcoded server-side to TMDB's `w300` bucket (see
 * CatalogEndpoints.cs) — plenty for a small playlist-row thumbnail, but visibly pixelated when
 * stretched full-bleed as a player pause-screen backdrop. Swaps the size segment in a TMDB image
 * URL for a much larger one; no-ops (and is safe to call) on anything else, including local paths.
 */
export function upscaleTmdbImageUrl(url: string | null | undefined, size = "original"): string | null | undefined {
  if (!url) return url;
  return url.replace(/\/t\/p\/w\d+\//, `/t/p/${size}/`);
}

function isUnderImageCache(localPath: string): boolean {
  return localPath.replace(/\\/g, "/").toLowerCase().includes("/pitflix/images/");
}

function withWidth(url: string, width?: number): string {
  if (!width) return url;
  return `${url}${url.includes("?") ? "&" : "?"}w=${width}`;
}

/** Matches `/images/<relative>` URLs produced when the API maps paths under the Images folder. */
function pitflixLocalCachePathToImageUrl(localPath: string): string | undefined {
  const norm = localPath.replace(/\\/g, "/").trim();
  const lower = norm.toLowerCase();
  const marker = "/pitflix/images/";
  const idx = lower.lastIndexOf(marker);
  if (idx >= 0) {
    const rel = norm.slice(idx + marker.length).replace(/^\/+/, "");
    if (!rel) return undefined;
    return `${API_ORIGIN}/images/${rel
      .split("/")
      .filter(Boolean)
      .map((seg) => encodeURIComponent(seg))
      .join("/")}`;
  }

  const parts = norm.split("/").filter(Boolean);
  const fileName = parts.pop();
  if (!fileName) return undefined;
  return `${API_ORIGIN}/images/${encodeURIComponent(fileName)}`;
}
