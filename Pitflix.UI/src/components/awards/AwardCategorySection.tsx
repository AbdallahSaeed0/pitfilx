import type { AwardCategory } from "../../api/awards";
import type { LibraryTmdbIndex } from "../../hooks/useLibraryTmdbIndex";
import { AwardNomineeCard } from "./AwardNomineeCard";

export type AwardCategorySectionProps = {
  category: AwardCategory;
  ceremonyYear: number;
  libraryIndex?: LibraryTmdbIndex | null;
};

export function AwardCategorySection({ category, ceremonyYear, libraryIndex }: AwardCategorySectionProps) {
  const winners = category.nominees.filter((n) => n.winner).length;

  return (
    <section className="rounded-xl border border-white/[0.06] bg-pitflix-surface/[0.35] p-4 shadow-[inset_0_1px_0_0_rgba(255,255,255,0.04)] sm:p-5">
      <header className="mb-3.5 flex flex-col gap-2 border-b border-white/[0.06] pb-3.5 sm:mb-4 sm:flex-row sm:items-end sm:justify-between sm:gap-4 sm:pb-4">
        <div className="min-w-0">
          <h2 className="text-lg font-bold tracking-tight text-white sm:text-xl">{category.name}</h2>
        </div>
        <div className="flex flex-wrap items-center gap-1.5 text-[10px] text-pitflix-muted sm:text-[11px]">
          <span className="rounded-md border border-white/10 bg-black/20 px-2 py-0.5 font-semibold tabular-nums">
            {category.nominees.length} {category.nominees.length === 1 ? "entry" : "entries"}
          </span>
          {winners > 0 ? (
            <span className="rounded-md border border-amber-400/20 bg-amber-500/10 px-2 py-0.5 font-semibold text-amber-100/90">
              {winners} winner{winners === 1 ? "" : "s"}
            </span>
          ) : null}
          {category.completeness === "winner_only" ? (
            <span className="rounded-md border border-sky-400/25 bg-sky-500/10 px-2 py-0.5 font-semibold text-sky-100/90">
              Winner only
            </span>
          ) : null}
          {category.completeness === "incomplete" || category.completeness === "empty" ? (
            <span className="rounded-md border border-rose-400/25 bg-rose-500/10 px-2 py-0.5 font-semibold text-rose-100/90">
              {category.completeness === "empty" ? "No nominees" : "Incomplete data"}
            </span>
          ) : null}
        </div>
      </header>

      <ul className="flex flex-col gap-2">
        {category.nominees.map((n, i) => (
          <li key={`${category.id}-${n.title}-${i}`}>
            <AwardNomineeCard
              nominee={n}
              listIndex={i}
              ceremonyYear={ceremonyYear}
              libraryIndex={libraryIndex}
            />
          </li>
        ))}
      </ul>
    </section>
  );
}
