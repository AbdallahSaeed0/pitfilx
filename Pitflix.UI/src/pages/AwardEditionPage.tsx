import { useQuery } from "@tanstack/react-query";
import { Link, useParams } from "react-router-dom";
import { getAwardEdition, getAwardsCatalog, getAwardYears } from "../api/awards";
import { AwardEditionHero } from "../components/awards/AwardEditionHero";
import { AwardEditionYearNav } from "../components/awards/AwardEditionYearNav";
import { AwardCategorySection } from "../components/awards/AwardCategorySection";
import { Spinner } from "../components/ui/Spinner";
import { toPosterSrc } from "../utils/posterSrc";

export function AwardEditionPage() {
  const { awardId, year: yearStr } = useParams();
  const year = Math.max(0, parseInt(yearStr ?? "", 10) || 0);

  const catQ = useQuery({
    queryKey: ["awards-catalog"],
    queryFn: getAwardsCatalog,
    staleTime: 600_000,
    gcTime: 3_600_000,
  });

  const yearsQ = useQuery({
    queryKey: ["award-years", awardId],
    queryFn: () => getAwardYears(awardId!),
    enabled: !!awardId,
    staleTime: 600_000,
    gcTime: 3_600_000,
  });

  const editionQ = useQuery({
    queryKey: ["award-edition", awardId, year],
    queryFn: () => getAwardEdition(awardId!, year),
    enabled: !!awardId && year > 0,
    staleTime: 600_000,
    gcTime: 3_600_000,
  });

  if (!awardId) return <p className="text-pitflix-muted">Missing award</p>;

  const catalogName = (catQ.data ?? []).find((a) => a.id === awardId)?.name;
  const awardLabelForShell = catalogName ?? awardId;
  const years = yearsQ.data ?? [];
  const yearsPending = yearsQ.isLoading || yearsQ.isFetching;
  const edition = editionQ.data;
  const editionPending = editionQ.isPending || (editionQ.isFetching && !edition);

  const showNotFound = editionQ.isError || (!editionPending && !edition);

  if (showNotFound)
    return (
      <div className="space-y-4">
        <Link to="/awards" className="text-sm text-pitflix-primary hover:underline">
          ← All awards
        </Link>
        <p className="text-sm text-rose-200/90">Edition not found.</p>
      </div>
    );

  if (editionPending && !edition) {
    return (
      <div className="mx-auto max-w-5xl space-y-8 pb-16 sm:space-y-10">
        <AwardEditionHero
          awardId={awardId}
          awardLabel={awardLabelForShell}
          year={year}
          ceremonyPoster={undefined}
          heroBackdropUrl={undefined}
          dataSource={undefined}
        />
        <div className="space-y-3">
          {yearsPending && years.length === 0 ? (
            <p className="text-xs text-pitflix-subtle">Loading year list…</p>
          ) : null}
          <AwardEditionYearNav awardId={awardId} years={years} activeYear={year} />
        </div>
        <div className="flex justify-center py-16">
          <Spinner />
        </div>
      </div>
    );
  }

  if (!edition) {
    return null;
  }

  const ceremonyPoster = toPosterSrc(edition.eventPosterUrl ?? edition.heroPosterUrl ?? undefined);
  const awardLabel = edition.label ?? edition.awardId;
  const sparseSeed =
    edition.categories.length <= 1 &&
    (edition.dataSource?.toLowerCase().includes("wikidata") ||
      edition.notes?.toLowerCase().includes("wikidata") ||
      edition.notes?.toLowerCase().includes("winner-only"));

  return (
    <div className="mx-auto max-w-5xl space-y-8 pb-16 sm:space-y-10">
      <AwardEditionHero
        awardId={awardId}
        awardLabel={awardLabel}
        year={edition.year}
        ceremonyPoster={ceremonyPoster}
        heroBackdropUrl={edition.heroBackdropUrl ?? undefined}
        dataSource={edition.dataSource ?? undefined}
      />

      {sparseSeed ? (
        <div className="rounded-xl border border-amber-500/25 bg-amber-950/15 px-4 py-3 text-sm text-amber-100/90">
          <p className="font-medium">Partial award data</p>
          <p className="mt-1 text-xs text-pitflix-subtle">
            This year was seeded automatically (often winner-only). Add categories and nominees in the edition JSON
            under{" "}
            <span className="font-mono text-[11px] text-pitflix-muted">
              Pitflix.API/Data/Awards/editions/{edition.awardId}/{edition.year}.json
            </span>{" "}
            for a full lineup.
          </p>
        </div>
      ) : null}

      <div className="space-y-3">
        {yearsPending && years.length === 0 ? (
          <p className="text-xs text-pitflix-subtle">Loading year list…</p>
        ) : null}
        <AwardEditionYearNav awardId={awardId} years={years} activeYear={year} />
      </div>

      <div className="space-y-5 sm:space-y-6">
        {edition.categories.map((cat) => (
          <AwardCategorySection key={cat.id} category={cat} />
        ))}
      </div>
    </div>
  );
}
