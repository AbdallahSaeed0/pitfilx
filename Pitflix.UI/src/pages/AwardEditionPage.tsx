import { useQuery } from "@tanstack/react-query";
import { useEffect, useMemo, useState } from "react";
import { Link, Navigate, useParams } from "react-router-dom";
import { getAwardEdition, getAwardsCatalog, getAwardYears } from "../api/awards";
import { AwardCategorySection } from "../components/awards/AwardCategorySection";
import { AwardCategoryTabs } from "../components/awards/AwardCategoryTabs";
import { AwardEditionHero } from "../components/awards/AwardEditionHero";
import { AwardEditionInsightStrip } from "../components/awards/AwardEditionInsightStrip";
import { AwardEditionYearNav } from "../components/awards/AwardEditionYearNav";
import { AwardWinnerRecommendations } from "../components/awards/AwardWinnerRecommendations";
import { Spinner } from "../components/ui/Spinner";
import { useLibraryTmdbIndex } from "../hooks/useLibraryTmdbIndex";
import { debugAwards } from "../utils/awardDebug";
import { getAwardBrandingImageSrc } from "../utils/awardBranding";
import { toPosterSrc } from "../utils/posterSrc";

function isAwardPlaceholderUrl(url: string | null | undefined) {
  return (
    !url ||
    url.includes("/api/awards/placeholder/poster") ||
    url.includes("awards/placeholder/poster")
  );
}

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

  const years = yearsQ.data ?? [];
  const yearsReady = yearsQ.isSuccess;
  const yearIsListed = year > 0 && years.includes(year);
  const editionFetchEnabled = Boolean(awardId && yearsReady && years.length > 0 && yearIsListed);

  const editionQ = useQuery({
    queryKey: ["award-edition", awardId, year],
    queryFn: () => getAwardEdition(awardId!, year),
    enabled: editionFetchEnabled,
    staleTime: 600_000,
    gcTime: 3_600_000,
  });

  const libQ = useLibraryTmdbIndex();

  const [activeCatId, setActiveCatId] = useState<string | null>(null);

  const edition = editionQ.data;

  useEffect(() => {
    if (!edition) return;
    const nonEmpty = edition.categories.filter((c) => c.nominees.length > 0);
    const fallback = nonEmpty[0] ?? edition.categories[0];
    if (!fallback) {
      setActiveCatId(null);
      return;
    }
    if (!activeCatId || !edition.categories.some((c) => c.id === activeCatId)) {
      setActiveCatId(fallback.id);
      return;
    }
    const current = edition.categories.find((c) => c.id === activeCatId);
    if (current && current.nominees.length === 0 && nonEmpty.length > 0) {
      setActiveCatId(nonEmpty[0]!.id);
    }
  }, [edition, activeCatId]);

  const nomineeCount = useMemo(() => {
    if (!edition) return 0;
    return edition.categories.reduce((acc, c) => acc + c.nominees.length, 0);
  }, [edition]);

  useEffect(() => {
    const active =
      edition?.categories.find((c) => c.id === activeCatId) ?? edition?.categories[0] ?? null;
    debugAwards("AwardEditionPage", {
      selectedAward: awardId,
      selectedYear: year,
      selectedCategory: activeCatId,
      categoryName: active?.name,
      nomineesLoaded: !!edition,
      entriesCount: nomineeCount,
      categoryEntries: active?.nominees.length ?? 0,
    });
  }, [awardId, year, activeCatId, edition, nomineeCount]);

  if (!awardId) return <p className="text-pitflix-muted">Missing award</p>;

  const catalogName = (catQ.data ?? []).find((a) => a.id === awardId)?.name;
  const awardLabelForShell = catalogName ?? awardId;

  const yearsPending = yearsQ.isLoading || yearsQ.isFetching;

  if (!yearsReady)
    return (
      <div className="flex justify-center py-24">
        <Spinner />
      </div>
    );

  if (years.length === 0)
    return (
      <div className="space-y-4">
        <Link to="/awards" className="text-sm text-pitflix-primary hover:underline">
          ← All awards
        </Link>
        <p className="text-sm text-pitflix-muted">No edition years available for this award yet.</p>
      </div>
    );

  if (year <= 0 || !years.includes(year)) {
    const latest = Math.max(...years);
    return <Navigate to={`/awards/${encodeURIComponent(awardId)}/${latest}`} replace />;
  }

  const editionPending = editionFetchEnabled && (editionQ.isPending || (editionQ.isFetching && !edition));
  const showNotFound = editionFetchEnabled && !editionPending && (editionQ.isError || !edition);

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

  const rawCeremonyPoster = edition.eventPosterUrl ?? edition.heroPosterUrl ?? null;
  let ceremonyPoster = toPosterSrc(rawCeremonyPoster ?? undefined);
  if (isAwardPlaceholderUrl(rawCeremonyPoster)) {
    const brand = getAwardBrandingImageSrc(awardId);
    if (brand) ceremonyPoster = toPosterSrc(brand) ?? ceremonyPoster;
  }

  const awardLabel = edition.label ?? edition.awardId;
  const sparseSeed =
    edition.categories.length <= 1 &&
    (edition.dataSource?.toLowerCase().includes("wikidata") ||
      edition.notes?.toLowerCase().includes("wikidata") ||
      edition.notes?.toLowerCase().includes("winner-only"));

  const activeCat = edition.categories.find((c) => c.id === activeCatId);

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

      <AwardEditionInsightStrip edition={edition} library={libQ.data} />

      <AwardCategoryTabs
        categories={edition.categories}
        activeId={activeCatId}
        onSelect={(id) => setActiveCatId(id)}
      />

      <div className="space-y-5 sm:space-y-6">
        {activeCat ? (
          <AwardCategorySection
            key={activeCat.id}
            category={activeCat}
            ceremonyYear={edition.year}
            libraryIndex={libQ.data}
          />
        ) : (
          <p className="text-sm text-pitflix-muted">No categories for this edition.</p>
        )}
      </div>

      <AwardWinnerRecommendations edition={edition} library={libQ.data} />
    </div>
  );
}
