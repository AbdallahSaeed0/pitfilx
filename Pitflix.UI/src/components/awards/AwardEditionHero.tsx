import { Link } from "react-router-dom";
import { MediaImage } from "../ui/MediaImage";
import { cn } from "../../utils/cn";
import { toPosterSrc } from "../../utils/posterSrc";

export type AwardEditionHeroProps = {
  awardId: string;
  awardLabel: string;
  year: number;
  ceremonyPoster?: string | null;
  heroBackdropUrl?: string | null;
  dataSource?: string | null;
};

export function AwardEditionHero({
  awardId,
  awardLabel,
  year,
  ceremonyPoster,
  heroBackdropUrl,
  dataSource,
}: AwardEditionHeroProps) {
  const backdrop = toPosterSrc(heroBackdropUrl ?? undefined);

  return (
    <div
      className={cn(
        "relative overflow-hidden rounded-2xl border border-white/[0.08]",
        "shadow-[0_24px_80px_-24px_rgba(0,0,0,0.85)]",
      )}
    >
      {backdrop ? (
        <>
          <div
            className="pointer-events-none absolute inset-0 scale-[1.02] bg-cover bg-[center_25%] opacity-[0.22]"
            style={{ backgroundImage: `url(${backdrop})` }}
            aria-hidden
          />
          <div
            className="pointer-events-none absolute inset-0 bg-gradient-to-br from-pitflix-bg via-pitflix-bg/92 to-pitflix-bg/88"
            aria-hidden
          />
          <div
            className="pointer-events-none absolute inset-0 bg-gradient-to-t from-pitflix-bg via-transparent to-transparent opacity-90"
            aria-hidden
          />
        </>
      ) : (
        <div
          className="pointer-events-none absolute inset-0 bg-gradient-to-br from-pitflix-surface via-pitflix-bg to-pitflix-bg"
          aria-hidden
        />
      )}

      <div className="relative z-[1] grid gap-8 p-6 sm:grid-cols-[minmax(0,1fr)_auto] sm:items-end sm:gap-10 sm:p-8">
        <div className="min-w-0 space-y-4">
          <nav className="flex flex-wrap items-center gap-x-3 gap-y-1 text-[11px] font-medium uppercase tracking-[0.14em] text-pitflix-subtle">
            <Link
              to="/awards"
              className="text-pitflix-muted transition-colors hover:text-pitflix-light"
            >
              Awards
            </Link>
            <span className="text-pitflix-subtle/80" aria-hidden>
              /
            </span>
            <Link
              to={`/awards/${encodeURIComponent(awardId)}`}
              className="text-pitflix-muted transition-colors hover:text-pitflix-light"
            >
              {awardLabel}
            </Link>
          </nav>

          <div className="space-y-2">
            <h1 className="font-sans text-4xl font-bold tracking-tight text-white sm:text-5xl">
              <span className="block text-[0.95rem] font-semibold normal-case leading-snug tracking-normal text-white/85 sm:text-base">
                {awardLabel}
              </span>
              <span className="mt-1 block tabular-nums">{year}</span>
            </h1>
            <p className="text-sm text-pitflix-muted">Ceremony edition</p>
          </div>

          {dataSource ? (
            <div className="pt-1">
              <span className="inline-flex items-center rounded-md border border-white/10 bg-black/25 px-2.5 py-1 text-[10px] font-semibold uppercase tracking-wider text-pitflix-muted backdrop-blur-sm">
                Source · {dataSource}
              </span>
            </div>
          ) : null}
        </div>

        {ceremonyPoster ? (
          <div className="flex justify-start sm:justify-end">
            <MediaImage
              src={ceremonyPoster}
              alt=""
              loading="eager"
              className="aspect-[2/3] h-44 w-[7.35rem] shrink-0 overflow-hidden rounded-xl border border-white/15 bg-black/40 object-cover shadow-2xl ring-1 ring-white/10 sm:h-[13.5rem] sm:w-[9rem]"
              fallbackText={awardLabel.slice(0, 2)}
            />
          </div>
        ) : (
          <div className="hidden sm:block" aria-hidden />
        )}
      </div>
    </div>
  );
}
