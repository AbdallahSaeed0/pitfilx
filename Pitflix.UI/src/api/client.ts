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
