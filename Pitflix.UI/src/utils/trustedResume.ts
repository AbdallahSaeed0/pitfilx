/** Mirrors server `TrustedResumePolicy` when the API omits `trustedResumeSeconds`. */
export type HistoryResumeFields = {
  filePath?: string;
  trustedResumeSeconds?: number;
  maxKnownPositionSeconds?: number;
  lastExplicitPositionSeconds?: number;
  estimatedSeconds?: number;
  fileDurationSeconds?: number;
};

export function trustedResumeHeadFromRow(row: HistoryResumeFields): number {
  if (typeof row.trustedResumeSeconds === "number" && row.trustedResumeSeconds >= 0) {
    return row.trustedResumeSeconds;
  }
  const lastExplicit = row.lastExplicitPositionSeconds ?? 0;
  const raw = lastExplicit > 0
    ? lastExplicit
    : Math.max(0, row.maxKnownPositionSeconds ?? 0, row.estimatedSeconds ?? 0);
  const dur = row.fileDurationSeconds ?? 0;
  return dur > 0 ? Math.min(raw, dur) : raw;
}
