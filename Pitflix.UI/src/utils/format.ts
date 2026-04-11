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
