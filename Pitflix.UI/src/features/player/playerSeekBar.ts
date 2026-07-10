/** Map a pointer X coordinate to a seek time on the track element. */
export function seekSecondsFromPointer(
  clientX: number,
  trackEl: HTMLElement,
  durationSeconds: number,
): number {
  if (!Number.isFinite(durationSeconds) || durationSeconds <= 0) return 0;
  const rect = trackEl.getBoundingClientRect();
  const x = Math.max(0, Math.min(rect.width, clientX - rect.left));
  const ratio = rect.width > 0 ? x / rect.width : 0;
  return Math.max(0, Math.min(durationSeconds, ratio * durationSeconds));
}

/** Pointer X relative to the track's left edge (for hover preview placement). */
export function pointerXOnTrack(clientX: number, trackEl: HTMLElement): number {
  const rect = trackEl.getBoundingClientRect();
  return Math.max(0, Math.min(rect.width, clientX - rect.left));
}
