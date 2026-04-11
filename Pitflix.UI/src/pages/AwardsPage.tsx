import { useQuery } from "@tanstack/react-query";
import { ChevronRight, Trophy } from "lucide-react";
import { Link } from "react-router-dom";
import { getAwardsCatalog } from "../api/awards";
import { MediaImage } from "../components/ui/MediaImage";
import { Spinner } from "../components/ui/Spinner";
import { cn } from "../utils/cn";
import { getAwardBrandingImageSrc } from "../utils/awardBranding";
import { toPosterSrc } from "../utils/posterSrc";

export function AwardsPage() {
  const q = useQuery({
    queryKey: ["awards-catalog"],
    queryFn: getAwardsCatalog,
    staleTime: 600_000,
    gcTime: 3_600_000,
  });

  if (q.isLoading)
    return (
      <div className="flex justify-center py-24">
        <Spinner />
      </div>
    );

  if (q.isError)
    return <p className="text-sm text-rose-200/90">Could not load awards catalog.</p>;

  const list = q.data ?? [];

  return (
    <div className="mx-auto max-w-5xl space-y-8 pb-12">
      <div>
        <h1 className="flex items-center gap-2 text-3xl font-bold text-white">
          <Trophy className="h-8 w-8 text-amber-300/90" />
          Awards
        </h1>
        <p className="mt-2 max-w-2xl text-sm text-pitflix-subtle">
          Edition rosters ship as local JSON. Nominee posters use curated TMDB ids or strict title-and-year matching —
          weak matches show a neutral placeholder instead of wrong art. Hub cards use ceremony branding, not random film
          posters.
        </p>
      </div>

      <div className="grid gap-5 sm:grid-cols-2">
        {list.map((a) => {
          const branding = getAwardBrandingImageSrc(a.id);
          const poster = toPosterSrc(branding ?? a.eventPosterUrl ?? undefined);
          return (
            <Link
              key={a.id}
              to={`/awards/${encodeURIComponent(a.id)}`}
              className={cn(
                "group relative flex min-h-[168px] overflow-hidden rounded-2xl border border-white/10 shadow-lg transition-all hover:border-pitflix-primary/45 hover:shadow-pitflix-primary/10",
              )}
              style={{
                borderLeftWidth: 4,
                borderLeftColor: a.accent ?? "#c9a227",
              }}
            >
              <div className="absolute inset-0 bg-gradient-to-br from-pitflix-surface to-pitflix-bg" />
              <div className="relative z-[1] flex w-full items-stretch gap-4 p-5">
                <MediaImage
                  src={poster}
                  alt=""
                  className="hidden w-[88px] shrink-0 overflow-hidden rounded-lg border border-white/10 bg-black/40 object-cover shadow-md sm:block sm:h-[124px]"
                  fallbackText={a.name.slice(0, 2)}
                />
                <div className="flex min-w-0 flex-1 flex-col justify-center gap-1">
                  <h2 className="text-lg font-semibold text-white group-hover:text-pitflix-primary">{a.name}</h2>
                  {a.subtitle ? <p className="text-xs text-pitflix-muted/95">{a.subtitle}</p> : null}
                </div>
                <ChevronRight className="mt-1 h-5 w-5 shrink-0 self-center text-white/70 transition-transform group-hover:translate-x-0.5 group-hover:text-white" />
              </div>
            </Link>
          );
        })}
      </div>
    </div>
  );
}
