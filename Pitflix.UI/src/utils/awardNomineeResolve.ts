import { searchUnmatched } from "../api/unmatched";

/**
 * Acting-category nominees are stored as `"Actor Name — Film Title"`. Searching TMDB with the
 * full combined string never matches, so strip the person's name and keep the film title —
 * mirrors `AwardTitleForSearch` in `Pitflix.API/Services/Awards/AwardsService.cs`.
 */
function awardTitleForSearch(title: string): string {
  const t = title.trim();
  const separators = ["—", "–", " – ", " — ", " - "];
  for (const sep of separators) {
    const i = t.indexOf(sep);
    if (i >= 0 && i + sep.length < t.length) {
      const right = t.slice(i + sep.length).trim();
      if (right) return right;
    }
  }
  return t;
}

function normalizeForCompare(raw: string): string {
  return raw
    .trim()
    .toLowerCase()
    .replace(/[^a-z0-9\s]/g, " ")
    .replace(/\s+/g, " ")
    .trim();
}

/** Loose but non-blind relevance gate: the search title's word set must mostly overlap with the
 * candidate's. A short, generic title like "Task" would otherwise happily "match" any unrelated
 * result TMDB's search ranks first when no exact-year hit narrows it down. */
function titleLooksRelevant(searchTitle: string, candidateTitle: string | undefined): boolean {
  const a = normalizeForCompare(searchTitle);
  const b = normalizeForCompare(candidateTitle ?? "");
  if (!a || !b) return false;
  if (a === b) return true;
  if (a.startsWith(b) || b.startsWith(a)) return true;
  const ta = new Set(a.split(" ").filter(Boolean));
  const tb = new Set(b.split(" ").filter(Boolean));
  if (ta.size === 0 || tb.size === 0) return false;
  let inter = 0;
  for (const w of ta) if (tb.has(w)) inter++;
  const union = ta.size + tb.size - inter;
  return union > 0 && inter / union >= 0.6;
}

/**
 * TMDB match using the ceremony year when present. Awards nominees are usually recognized for a
 * season that aired the year *before* the ceremony, so both the ceremony year and the year before
 * it count as a "year match" — requiring the exact ceremony year alone caused this to miss almost
 * every TV nominee and fall through to the no-year-match branch below.
 *
 * That branch used to just take the first search result with no relevance check at all — for a
 * short, generic title ("Task", "Beef", ...) TMDB's top hit is often a same-named but completely
 * unrelated title, so a title-overlap gate is required before any candidate is accepted; if
 * nothing clears it, this returns null (safe placeholder) rather than guessing wrong.
 */
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
  const candidates = rows.filter((row) =>
    titleLooksRelevant(searchTitle, (row as { title?: string }).title),
  );

  if (ceremonyYear) {
    const acceptableYears = new Set([ceremonyYear, ceremonyYear - 1]);
    const byYear = candidates.find((row) => {
      const r = row as { year?: string };
      const ys = typeof r.year === "string" ? r.year.slice(0, 4) : "";
      const y = parseInt(ys, 10);
      return Number.isFinite(y) && acceptableYears.has(y);
    });
    const pick = byYear ?? candidates[0];
    const id = Number((pick as { id?: number } | undefined)?.id ?? 0);
    return id > 0 ? id : null;
  }

  const id = Number((candidates[0] as { id?: number } | undefined)?.id ?? 0);
  return id > 0 ? id : null;
}
