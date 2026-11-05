import type { WatchingCurrentlyCard } from "../../../api/homeDiscover";
import type { WatchHistoryRow } from "../../../types/homeSection";
import { POSTER_WIDTHS, toPosterSrc } from "../../../utils/posterSrc";
import { trustedResumeHeadFromRow } from "../../../utils/trustedResume";
import { parseSeEp } from "../ContinueWatchingHero";

/** "44 min left" / "1h 2m left". */
export function formatMinutesLeft(remainingSeconds: number): string {
  const totalMinutes = Math.max(0, Math.round(remainingSeconds / 60));
  if (totalMinutes < 60) return `${totalMinutes} min left`;
  const h = Math.floor(totalMinutes / 60);
  const m = totalMinutes % 60;
  return m > 0 ? `${h}h ${m}m left` : `${h}h left`;
}

export function upNextProgressPercent(card: WatchingCurrentlyCard): number {
  return Math.min(100, Math.max(0, Math.round((card.progressFraction ?? 0) * 100)));
}

/** "S6 E1" from an Up Next card. */
export function upNextCode(card: WatchingCurrentlyCard): string {
  return `S${card.nextSeason} E${card.nextEpisode}`;
}

/** Season page for the card's next episode — same target as the classic Up Next carousel. */
export function upNextRoute(card: WatchingCurrentlyCard): string {
  return card.nextSeason > 0
    ? `/series/${card.libraryShowId}/season/${card.nextSeason}`
    : `/series/${card.libraryShowId}`;
}

/** Short status tag for a card ("NEW SEASON", "ALMOST DONE", …) or null when nothing stands out. */
export function upNextTag(card: WatchingCurrentlyCard): string | null {
  if (!card.nextEpisodeDownloaded) return "NOT DOWNLOADED";
  if (card.nextEpisode === 1 && card.nextSeason > 1) return "NEW SEASON";
  if (card.watchedEpisodes === 0) return "JUST STARTED";
  if (card.episodesRemaining > 0 && card.episodesRemaining <= 2) return "ALMOST DONE";
  return null;
}

/** Second line under a card title: "E4 · Episode title" / "Season 6 premiere". */
export function upNextEpisodeLine(card: WatchingCurrentlyCard): string {
  if (card.nextEpisode === 1 && card.nextSeason > 1 && !card.nextEpisodeTitle)
    return `Season ${card.nextSeason} premiere`;
  const title = card.nextEpisodeTitle?.trim();
  return title ? `${upNextCode(card)} · ${title}` : upNextCode(card);
}

export function upNextCta(card: WatchingCurrentlyCard): string {
  if (card.nextEpisode === 1 && card.nextSeason > 1) return `Start Season ${card.nextSeason}`;
  return `Go to ${upNextCode(card)}`;
}

/** Landscape art for a card: episode still → show backdrop. Poster is the caller's fallback. */
export function upNextLandscapeSrc(card: WatchingCurrentlyCard, width?: number): string | undefined {
  return toPosterSrc(card.nextEpisodeStillUrl ?? card.backdropUrl ?? undefined, width);
}

export function upNextPosterSrc(card: WatchingCurrentlyCard, width: number = POSTER_WIDTHS.card): string | undefined {
  return toPosterSrc(card.posterUrl ?? undefined, width);
}

// ─── Continue-watching (history) helpers ────────────────────────────────────

/**
 * Show / movie name for a history row. Series titles may carry "Show · S1E1 · Episode" — the
 * headline is the show, not the episode (the classic hero showed the episode title as the headline).
 */
export function historyShowName(row: WatchHistoryRow, upNext: WatchingCurrentlyCard[] = []): string {
  if (row.mediaType !== "Series") return row.title;
  const match = row.libraryShowId != null ? upNext.find((c) => c.libraryShowId === row.libraryShowId) : undefined;
  if (match?.showTitle) return match.showTitle;
  const parts = row.title.split(/\s*[·•]\s*/).map((p) => p.trim()).filter(Boolean);
  const seIdx = parts.findIndex((p) => /S\s*\d+\s*E\s*\d+/i.test(p));
  if (seIdx > 0) return parts.slice(0, seIdx).join(" · ");
  const stripped = row.title.replace(/[\s._-]*S\d+\s*E\d+.*$/i, "").trim();
  return stripped || row.title;
}

/** "S1 E1" for a series row, null for movies. */
export function historyCode(row: WatchHistoryRow): string | null {
  const { season, episodeNumber } = parseSeEp(row.nextUpLabel ?? row.title);
  return season != null && episodeNumber != null ? `S${season} E${episodeNumber}` : null;
}

export function historyProgress(row: WatchHistoryRow): { pct: number; remaining: number; hasDuration: boolean } {
  const dur = row.fileDurationSeconds ?? 0;
  const head = trustedResumeHeadFromRow(row);
  return {
    pct: dur > 0 ? Math.min(100, Math.round((head / dur) * 100)) : 0,
    remaining: Math.max(0, dur - head),
    hasDuration: dur > 0,
  };
}

/** `S1 E1 · "Brothers" · 9 min left` (pieces that exist only). */
export function historyMetaLine(row: WatchHistoryRow): string {
  const parts: string[] = [];
  const code = historyCode(row);
  if (code) parts.push(code);
  const ep = row.episodeTitle?.trim();
  if (ep) parts.push(`“${ep}”`);
  if (!code && row.mediaType) parts.push(row.mediaType === "Movie" ? "Movie" : row.mediaType);
  const { remaining, hasDuration } = historyProgress(row);
  if (hasDuration) parts.push(formatMinutesLeft(remaining));
  return parts.join(" · ");
}

export function historyDetailPath(row: WatchHistoryRow): string | null {
  if (row.libraryMovieId != null) return `/movie/${row.libraryMovieId}`;
  if (row.libraryShowId != null) return `/series/${row.libraryShowId}`;
  return null;
}

export function historyBackdropSrc(row: WatchHistoryRow, width: number = POSTER_WIDTHS.hero): string | undefined {
  return toPosterSrc(row.backdropLocalPath ?? undefined, width);
}

export function historyPosterSrc(row: WatchHistoryRow, width: number = POSTER_WIDTHS.card): string | undefined {
  return toPosterSrc(row.posterLocalPath ?? row.posterRemoteUrl ?? undefined, width);
}

/** Up Next cards minus the shows already represented by the continue-watching history. */
export function upNextExcludingHistory(upNext: WatchingCurrentlyCard[], history: WatchHistoryRow[]): WatchingCurrentlyCard[] {
  const inHistory = new Set(history.map((h) => h.libraryShowId).filter((id): id is number => id != null));
  return upNext.filter((c) => !inHistory.has(c.libraryShowId));
}
