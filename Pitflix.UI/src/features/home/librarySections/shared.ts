import type { WatchingCurrentlyCard } from "../../../api/homeDiscover";

/** "44 min left" / "1h 2m left" — mirrors the wording used across the design handoff. */
export function formatMinutesLeft(remainingSeconds: number): string {
  const totalMinutes = Math.max(0, Math.round(remainingSeconds / 60));
  if (totalMinutes < 60) return `${totalMinutes} min left`;
  const h = Math.floor(totalMinutes / 60);
  const m = totalMinutes % 60;
  return m > 0 ? `${h}h ${m}m left` : `${h}h left`;
}

/** "S05E04" badge from an Up Next card's next-episode fields. */
export function upNextEpisodeBadge(card: WatchingCurrentlyCard): string {
  return `S${String(card.nextSeason).padStart(2, "0")}E${String(card.nextEpisode).padStart(2, "0")}`;
}

/** "S05 · E04" — spaced variant used by the episode-first shelf (direction 1d). */
export function upNextEpisodeCode(card: WatchingCurrentlyCard): string {
  return `S${String(card.nextSeason).padStart(2, "0")} · E${String(card.nextEpisode).padStart(2, "0")}`;
}

export function upNextProgressPercent(card: WatchingCurrentlyCard): number {
  return Math.min(100, Math.max(0, Math.round((card.progressFraction ?? 0) * 100)));
}
