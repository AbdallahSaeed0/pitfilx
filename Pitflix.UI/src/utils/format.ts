export function formatYear(y?: number | null) {
  return y ? String(y) : "—";
}

export function formatRating(v?: number | null) {
  if (v == null || Number.isNaN(v)) return "—";
  return v.toFixed(1);
}

export function formatCount(n: number) {
  return n.toLocaleString();
}

/** TMDB-style episode/movie runtime in minutes → "47m" or "1h 2m". */
export function formatRuntimeMinutes(minutes?: number | null): string {
  if (minutes == null || minutes <= 0) return "";
  const h = Math.floor(minutes / 60);
  const m = minutes % 60;
  if (h === 0) return `${m}m`;
  if (m === 0) return `${h}h`;
  return `${h}h ${m}m`;
}
