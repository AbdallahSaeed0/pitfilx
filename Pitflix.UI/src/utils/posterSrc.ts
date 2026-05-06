import { convertFileSrc, isTauri } from "@tauri-apps/api/core";
import { API_ORIGIN } from "../api/client";

/**
 * Turn API image paths into something the current runtime can load.
 * - `http(s)`: unchanged.
 * - Tauri + local disk path: `convertFileSrc` (asset protocol).
 * - Browser + local disk path: Pitflix.API `/images/...` (same cache Pitflix.WPF uses).
 */
export function toPosterSrc(path: string | null | undefined): string | undefined {
  if (!path) return undefined;
  if (path.startsWith("http://") || path.startsWith("https://")) {
    try {
      const u = new URL(path);
      const loopback =
        u.hostname === "127.0.0.1" || u.hostname === "localhost" || u.hostname === "[::1]";
      if (loopback && (u.pathname.startsWith("/images/") || u.pathname.startsWith("/api/"))) {
        return `${API_ORIGIN}${u.pathname}${u.search}`;
      }
      if (u.hostname === "image.tmdb.org") {
        const m = u.pathname.match(/\/t\/p\/([^/]+)\/(.+)$/);
        if (m) {
          const qs = new URLSearchParams({ size: m[1], file: m[2] });
          return `${API_ORIGIN}/api/img/tmdb?${qs.toString()}`;
        }
      }
    } catch {
      /* ignore */
    }
    return path;
  }
  if (path.startsWith("/images/")) return `${API_ORIGIN}${path}`;

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

  if (isTauri()) return convertFileSrc(path);

  // Plain browser (Vite dev): cannot read %LocalAppData% paths — use API static images.
  return pitflixLocalCachePathToImageUrl(path);
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
