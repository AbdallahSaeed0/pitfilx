import { useQuery } from "@tanstack/react-query";
import { Link, Navigate, useParams } from "react-router-dom";
import { getAwardsCatalog, getAwardYears } from "../api/awards";
import { MediaImage } from "../components/ui/MediaImage";
import { Spinner } from "../components/ui/Spinner";
import { cn } from "../utils/cn";
import { getAwardBrandingFallbackSrc, getAwardBrandingImageSrc } from "../utils/awardBranding";
import { toPosterSrc } from "../utils/posterSrc";

/** Opening `/awards/:awardId` jumps straight to the latest year that has edition JSON so nominees render immediately. */
export function AwardHubPage() {
  const { awardId } = useParams();

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

  if (!awardId) return <p className="text-pitflix-muted">Missing award</p>;

  const meta = (catQ.data ?? []).find((x) => x.id === awardId);

  if (catQ.isLoading && !catQ.data)
    return (
      <div className="flex justify-center py-24">
        <Spinner />
      </div>
    );

  const years = yearsQ.data ?? [];

  if (!yearsQ.isLoading && !yearsQ.isFetching && years.length > 0) {
    const latest = Math.max(...years);
    return <Navigate to={`/awards/${encodeURIComponent(awardId)}/${latest}`} replace />;
  }

  return (
    <div className="mx-auto max-w-5xl space-y-8 pb-12">
      <div
        className={cn(
          "relative overflow-hidden rounded-2xl border border-white/10",
          meta?.eventBackdropUrl ? "min-h-[140px]" : "bg-pitflix-surface/50",
        )}
      >
        {meta?.eventBackdropUrl ? (
          <>
            <div
              className="absolute inset-0 bg-cover bg-center"
              style={{
                backgroundImage: `url(${toPosterSrc(meta.eventBackdropUrl) ?? ""})`,
              }}
            />
            <div className="absolute inset-0 bg-gradient-to-r from-black/95 via-black/65 to-black/25" />
          </>
        ) : null}
        <div className="relative z-[1] flex flex-col gap-4 p-6 sm:flex-row sm:items-end">
          <div className="flex min-w-0 flex-1 flex-col gap-2">
            <Link to="/awards" className="text-sm text-pitflix-primary hover:underline">
              ← All awards
            </Link>
            <h1 className="text-2xl font-bold text-white">{meta?.name ?? awardId}</h1>
            {meta?.subtitle ? <p className="max-w-2xl text-sm text-pitflix-muted">{meta.subtitle}</p> : null}
          </div>
          {meta ? (
            <MediaImage
              src={toPosterSrc(getAwardBrandingImageSrc(meta.id) ?? meta.eventPosterUrl ?? undefined)}
              fallbackSrc={toPosterSrc(getAwardBrandingFallbackSrc(meta.id))}
              alt=""
              className="h-36 w-24 shrink-0 overflow-hidden rounded-xl border border-white/15 bg-zinc-950 object-cover shadow-lg sm:h-44 sm:w-[7.25rem]"
              fallbackText={(meta?.name ?? awardId).slice(0, 2)}
            />
          ) : null}
        </div>
      </div>

      <div className="flex justify-center py-16">
        <Spinner />
      </div>

      {!yearsQ.isLoading && years.length === 0 ? (
        <div className="rounded-xl border border-dashed border-amber-500/30 bg-amber-950/10 p-4 text-sm text-pitflix-subtle">
          <p className="font-medium text-amber-100/90">No edition JSON files for this award</p>
          <p className="mt-2 leading-relaxed">
            Pitflix loads years from{" "}
            <span className="font-mono text-xs text-pitflix-muted">
              {"Pitflix.API/Data/Awards/editions/<award-id>/<year>.json"}
            </span>
            .
          </p>
        </div>
      ) : null}
    </div>
  );
}
