import type { AwardEdition } from "../../api/awards";
import type { LibraryTmdbIndex } from "../../hooks/useLibraryTmdbIndex";
import { nomineeMediaKind } from "../../utils/awardNomineeMedia";

function flattenNomineeRefs(edition: AwardEdition) {
  return edition.categories.flatMap((c) => c.nominees.map((n) => ({ n, categoryId: c.id })));
}

export type AwardEditionInsightStripProps = {
  edition: AwardEdition;
  library: LibraryTmdbIndex | null | undefined;
};

export function AwardEditionInsightStrip({ edition, library }: AwardEditionInsightStripProps) {
  const refs = flattenNomineeRefs(edition);
  let watched = 0;
  let inLibrary = 0;
  let streamEligible = 0;

  for (const { n } of refs) {
    if (!n.tmdbId || n.tmdbId <= 0) continue;
    streamEligible++;
    const kind = nomineeMediaKind(n.mediaType);
    const libId =
      kind === "movie" ? library?.movieByTmdb.get(n.tmdbId) : library?.seriesByTmdb.get(n.tmdbId);
    if (libId != null) inLibrary++;
    const done =
      kind === "movie"
        ? library?.watchedMovieTmdb.has(n.tmdbId)
        : library?.watchedSeriesTmdb.has(n.tmdbId);
    if (done) watched++;
  }

  return (
    <div className="flex flex-col gap-3 rounded-xl border border-white/[0.07] bg-pitflix-surface/40 px-4 py-3 sm:flex-row sm:flex-wrap sm:items-center sm:gap-x-6 sm:gap-y-2">
      <p className="text-sm text-white">
        <span className="text-pitflix-muted">You watched </span>
        <span className="font-semibold text-amber-200/95">{watched}</span>
        <span className="text-pitflix-muted"> nominee{watched === 1 ? "" : "s"}</span>
      </p>
      <p className="hidden text-pitflix-subtle sm:inline" aria-hidden>
        ·
      </p>
      <p className="text-sm text-white">
        <span className="font-semibold text-emerald-200/95">{inLibrary}</span>
        <span className="text-pitflix-muted"> nominee{inLibrary === 1 ? "" : "s"} in your local library</span>
      </p>
      <p className="hidden text-pitflix-subtle sm:inline" aria-hidden>
        ·
      </p>
      <p className="text-sm text-white">
        <span className="font-semibold text-sky-200/95">{streamEligible}</span>
        <span className="text-pitflix-muted"> available to stream online</span>
      </p>
    </div>
  );
}
