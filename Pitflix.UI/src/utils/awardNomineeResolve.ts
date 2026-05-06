import { searchUnmatched } from "../api/unmatched";

/** Strict-ish TMDB match using ceremony year when present (first row matching release year, else first hit). */
export async function resolveTmdbIdFromTitleYear(
  title: string,
  ceremonyYear: number | undefined,
  mediaType: "Movie" | "Series",
): Promise<number | null> {
  const q = ceremonyYear ? `${title.trim()} ${ceremonyYear}` : title.trim();
  if (q.length < 2) return null;
  const raw = await searchUnmatched({ query: q, mediaType });
  const rows = Array.isArray(raw) ? raw : [];
  if (ceremonyYear) {
    const byYear = rows.find((row) => {
      const r = row as { year?: string };
      const ys = typeof r.year === "string" ? r.year.slice(0, 4) : "";
      const y = parseInt(ys, 10);
      return Number.isFinite(y) && y === ceremonyYear;
    });
    const pick = byYear ?? rows[0];
    const id = Number((pick as { id?: number } | undefined)?.id ?? 0);
    return id > 0 ? id : null;
  }
  const id = Number((rows[0] as { id?: number } | undefined)?.id ?? 0);
  return id > 0 ? id : null;
}
