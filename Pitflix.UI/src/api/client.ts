import axios from "axios";

/** Origin for JSON API and `/images/*` (no trailing slash). */
export const API_ORIGIN =
  (typeof import.meta !== "undefined" && (import.meta.env.VITE_API_ORIGIN as string | undefined)) ||
  "http://127.0.0.1:5001";

const api = axios.create({
  baseURL: `${API_ORIGIN}/api`,
  timeout: 30000,
});

export default api;
