import axios from "axios";

/**
 * Server origin only (scheme + host + optional port). No path, no `/api` suffix.
 * `VITE_API_ORIGIN` is often mis-set to `http://127.0.0.1:5280/api`; we strip a trailing `/api`
 * so axios `baseURL` stays `.../5280/api` and paths like `/home/trailers/latest` resolve to
 * `/api/home/trailers/latest` (not `/api/api/...` → 404).
 */
function normalizePitflixApiOrigin(raw: string | undefined): string {
  let s = (raw ?? "").trim();
  if (!s) s = "http://127.0.0.1:5280";
  s = s.replace(/\/+$/, "");
  if (/\/api$/i.test(s)) s = s.replace(/\/api$/i, "");
  return s;
}

/** Origin for JSON API and `/images/*` (no trailing slash, no `/api`). */
export const API_ORIGIN = normalizePitflixApiOrigin(
  typeof import.meta !== "undefined" ? (import.meta.env.VITE_API_ORIGIN as string | undefined) : undefined,
);

const api = axios.create({
  baseURL: `${API_ORIGIN}/api`,
  timeout: 30000,
});

export default api;

/**
 * React Query options for anything fired from Home on first mount (trailers, coming soon, up
 * next, next episodes, ...). The global default (`retry: 1`, ~1s backoff — see main.tsx) gives up
 * before the bundled API sidecar finishes its cold start (~2.1-2.5s, same window the `settings`
 * query in App.tsx polls through with retry:25/retryDelay:200). Home only mounts after `settings`
 * has already succeeded once, but that just proves Kestrel is accepting connections — these
 * heavier, DB/TMDB-backed endpoints can still refuse connections for a bit longer while the rest
 * of the host finishes warming up, so they need the same forgiving retry budget or every cold
 * launch shows "Network Error" until the user manually refreshes.
 */
export const HOME_COLD_START_RETRY = {
  retry: 15,
  retryDelay: 300,
} as const;
