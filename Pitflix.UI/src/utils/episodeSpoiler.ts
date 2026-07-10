/** True when the episode is marked fully watched — either a completed library episode, or one marked
 * watched via unified history without being downloaded (`inLibrary` kept for API compatibility). */
export function episodeIsWatched(
  ep: { watchStatus?: string | null },
  _inLibrary: boolean,
): boolean {
  return ep.watchStatus === "Completed";
}

/** Whether the real episode title may be shown (ratings & descriptions are always visible). */
export function episodeTitleVisible(
  spoilerProtection: boolean,
  inLibrary: boolean,
  ep: { watchStatus?: string | null },
): boolean {
  return !spoilerProtection || episodeIsWatched(ep, inLibrary);
}
