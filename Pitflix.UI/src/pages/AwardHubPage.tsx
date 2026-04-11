import { useQuery } from "@tanstack/react-query";
import { Link, useParams } from "react-router-dom";
import { getAwardYearTiles, getAwardsCatalog } from "../api/awards";
import { MediaImage } from "../components/ui/MediaImage";
import { Spinner } from "../components/ui/Spinner";
import { cn } from "../utils/cn";
import { getAwardBrandingImageSrc } from "../utils/awardBranding";
import { toPosterSrc } from "../utils/posterSrc";

export function AwardHubPage() {
  const { awardId } = useParams();

  const catQ = useQuery({
    queryKey: ["awards-catalog"],
    queryFn: getAwardsCatalog,
    staleTime: 600_000,
    gcTime: 3_600_000,
  });

  const tilesQ = useQuery({
    queryKey: ["award-year-tiles", awardId],
    queryFn: () => getAwardYearTiles(awardId!),
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

  const tiles = tilesQ.data ?? [];

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
              alt=""
              className="h-36 w-24 shrink-0 overflow-hidden rounded-xl border border-white/15 bg-black/40 object-cover shadow-lg sm:h-44 sm:w-[7.25rem]"
              fallbackText={(meta?.name ?? awardId).slice(0, 2)}
            />
          ) : null}
        </div>
      </div>

      <h2 className="text-lg font-semibold text-white">Choose year</h2>
      {tilesQ.isLoading && tiles.length === 0 ? (
        <div className="flex justify-center py-16">
          <Spinner />
        </div>
      ) : null}
      {!tilesQ.isLoading && tiles.length === 0 ? (
        <div className="rounded-xl border border-dashed border-amber-500/30 bg-amber-950/10 p-4 text-sm text-pitflix-subtle">
          <p className="font-medium text-amber-100/90">No edition JSON files for this award</p>
          <p className="mt-2 leading-relaxed">
            Pitflix loads years from{" "}
            <span className="font-mono text-xs text-pitflix-muted">
              {"Pitflix.API/Data/Awards/editions/<award-id>/<year>.json"}
            </span>
            . Only awards with at least one edition file list years here. Use{" "}
            <span className="font-mono text-xs">editions/academy-awards/2024.json</span> as a template for Emmys, BAFTA,
            Golden Globes, etc.
          </p>
        </div>
      ) : null}
      {tiles.length > 0 ? (
        <div className="grid grid-cols-2 gap-4 sm:grid-cols-3 md:grid-cols-4 lg:grid-cols-5">
          {tiles.map((t) => (
            <Link
              key={t.year}
              to={`/awards/${encodeURIComponent(awardId)}/${t.year}`}
              className="group overflow-hidden rounded-xl border border-pitflix-card/70 bg-pitflix-surface/40 shadow-md transition-all hover:border-pitflix-primary/45"
            >
              <div className="relative aspect-[2/3] w-full bg-pitflix-card/50">
                <MediaImage
                  // Year tiles should be ceremony posters when available; if missing, show a branded fallback (no nominee art).
                  src={toPosterSrc(t.posterUrl ?? undefined)}
                  alt=""
                  loading="lazy"
                  className="h-full w-full object-cover transition-transform duration-300 group-hover:scale-[1.04]"
                  fallbackText={String(t.year)}
                />
                <div className="absolute inset-x-0 bottom-0 bg-gradient-to-t from-black/88 to-transparent p-3 pt-10">
                  <p className="text-lg font-bold text-white">{t.year}</p>
                  {t.label ? <p className="line-clamp-2 text-[10px] text-pitflix-muted">{t.label}</p> : null}
                </div>
              </div>
            </Link>
          ))}
        </div>
      ) : null}
    </div>
  );
}
