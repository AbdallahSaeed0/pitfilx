import { useQuery } from "@tanstack/react-query";
import { ChevronRight, Trophy } from "lucide-react";
import { Link } from "react-router-dom";
import { getAwardsCatalog } from "../api/awards";
import { MediaImage } from "../components/ui/MediaImage";
import { Spinner } from "../components/ui/Spinner";
import { cn } from "../utils/cn";
import { getAwardBrandingFallbackSrc, getAwardBrandingImageSrc } from "../utils/awardBranding";
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
    <div className="mx-auto max-w-3xl space-y-8 pb-12">
      <div>
        <h1 className="flex items-center gap-2 text-2xl font-bold text-white sm:text-3xl">
          <Trophy className="h-7 w-7 text-amber-300/90 sm:h-8 sm:w-8" />
          Awards
        </h1>
        <p className="mt-2 max-w-xl text-sm text-pitflix-subtle">
          Jump into a ceremony, pick a year, then open trailers, streaming, library details, and lists from each nominee.
        </p>
      </div>

      <div className="flex flex-col gap-3">
        {list.map((a) => {
          const branding = getAwardBrandingImageSrc(a.id);
          const brandFallback = toPosterSrc(getAwardBrandingFallbackSrc(a.id));
          const poster = toPosterSrc(branding ?? a.eventPosterUrl ?? undefined);
          return (
            <Link
              key={a.id}
              to={`/awards/${encodeURIComponent(a.id)}`}
              className={cn(
                "group relative flex min-h-[72px] overflow-hidden rounded-xl border border-white/10 shadow-md transition-all hover:border-pitflix-primary/45 hover:shadow-lg hover:shadow-pitflix-primary/10 sm:min-h-[88px]",
              )}
              style={{
                borderLeftWidth: 4,
                borderLeftColor: a.accent ?? "#c9a227",
              }}
            >
              <div className="absolute inset-0 bg-gradient-to-r from-pitflix-surface to-pitflix-bg" />
              <div className="relative z-[1] flex w-full items-center gap-4 px-4 py-3 sm:px-5">
                <MediaImage
                  src={poster}
                  fallbackSrc={brandFallback}
                  alt=""
                  className="hidden h-[52px] w-[52px] shrink-0 overflow-hidden rounded-lg border border-white/10 bg-zinc-950 object-cover shadow sm:block sm:h-14 sm:w-14"
                  fallbackText={a.name.slice(0, 2)}
                />
                <div className="flex min-w-0 flex-1 flex-col justify-center gap-0.5">
                  <h2 className="text-base font-semibold text-white group-hover:text-pitflix-primary sm:text-lg">{a.name}</h2>
                  {a.subtitle ? <p className="line-clamp-2 text-xs text-pitflix-muted">{a.subtitle}</p> : null}
                </div>
                <ChevronRight className="h-5 w-5 shrink-0 self-center text-white/60 transition-transform group-hover:translate-x-0.5 group-hover:text-white" />
              </div>
            </Link>
          );
        })}
      </div>
    </div>
  );
}
