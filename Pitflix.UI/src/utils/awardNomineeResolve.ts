import { searchUnmatched } from "../api/unmatched";

/**
 * Acting-category nominees are stored as `"Actor Name — Film Title"`. Searching TMDB with the
 * full combined string never matches, so strip the person's name and keep the film title —
 * mirrors `AwardTitleForSearch` in `Pitflix.API/Services/Awards/AwardsService.cs`.
 */
function awardTitleForSearch(title: string): string {
  const t = title.trim();
  const separators = ["\u2014", "\u2013", " – ", " — ", " - "];
  for (const sep of separators) {
    const i = t.indexOf(sep);
    if (i >= 0 && i + sep.length < t.length) {
      const right = t.slice(i + sep.length).trim();
      if (right) return right;
    }
  }
  return t;
}

/** Strict-ish TMDB match using ceremony year when present (first row matching release year, else first hit). */
export async function resolveTmdbIdFromTitleYear(
  title: string,
  ceremonyYear: number | undefined,
  mediaType: "Movie" | "Series",
): Promise<number | null> {
  const searchTitle = awardTitleForSearch(title);
  const q = ceremonyYear ? `${searchTitle} ${ceremonyYear}` : searchTitle;
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
