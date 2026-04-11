import { ExternalLink } from "lucide-react";
import { MediaImage } from "../ui/MediaImage";
import { cn } from "../../utils/cn";
import type { AwardNominee } from "../../api/awards";
import { toPosterSrc } from "../../utils/posterSrc";

export type AwardNomineeCardProps = {
  nominee: AwardNominee;
  listIndex: number;
};

function formatMediaType(raw: string) {
  if (!raw) return "";
  return raw.replace(/_/g, " ").replace(/\b\w/g, (c) => c.toUpperCase());
}

/** Compact editorial row for award shortlists — no full-card backdrop art. */
export function AwardNomineeCard({ nominee, listIndex }: AwardNomineeCardProps) {
  const { title, mediaType, tmdbId, winner, posterUrl } = nominee;

  return (
    <article
      className={cn(
        "group relative flex min-h-0 rounded-xl border transition-[border-color,background-color,box-shadow] duration-200",
        winner
          ? [
              "border-amber-400/35 bg-[linear-gradient(105deg,rgba(245,158,11,0.09)_0%,rgba(24,24,27,0.5)_42%,rgba(9,9,11,0.65)_100%)]",
              "shadow-[0_0_0_1px_rgba(251,191,36,0.1),0_2px_20px_-8px_rgba(0,0,0,0.85)]",
            ]
          : [
              "border-white/[0.06] bg-pitflix-surface/50",
              "hover:border-white/[0.1] hover:bg-pitflix-surface/75 hover:shadow-[0_4px_24px_-12px_rgba(0,0,0,0.6)]",
            ],
      )}
    >
      {winner ? (
        <div
          className="pointer-events-none absolute inset-y-0 left-0 w-[3px] rounded-l-xl bg-gradient-to-b from-amber-200/90 via-amber-400 to-amber-600/85 shadow-[0_0_14px_rgba(251,191,36,0.35)]"
          aria-hidden
        />
      ) : null}

      <div
        className={cn(
          "relative z-[1] flex min-w-0 flex-1 items-center gap-3 py-2.5 pl-3 pr-3 sm:gap-3.5 sm:py-3 sm:pl-3.5 sm:pr-4",
          winner && "pl-[14px] sm:pl-4",
        )}
      >
        <MediaImage
          src={toPosterSrc(posterUrl ?? undefined)}
          alt=""
          loading="lazy"
          className={cn(
            "h-[3.75rem] w-[2.5rem] shrink-0 overflow-hidden rounded-md bg-pitflix-card object-cover shadow-md ring-1 ring-black/40 sm:h-[4.5rem] sm:w-[3rem]",
            winner &&
              "ring-amber-400/30 shadow-[0_4px_16px_-4px_rgba(0,0,0,0.7)] sm:h-[4.75rem] sm:w-[3.15rem]",
          )}
          fallbackText={title.slice(0, 2)}
        />

        <div className="min-w-0 flex flex-1 flex-col justify-center gap-1">
          <div className="flex min-w-0 items-start justify-between gap-2">
            <h3 className="min-w-0 flex-1 text-sm font-semibold leading-tight text-white sm:text-[0.9375rem] sm:leading-snug">
              {title}
            </h3>
            {winner ? (
              <span className="mt-px shrink-0 rounded border border-amber-400/40 bg-amber-500/18 px-1.5 py-0.5 text-[9px] font-bold uppercase leading-none tracking-[0.12em] text-amber-100 shadow-sm sm:text-[10px] sm:tracking-[0.14em]">
                Winner
              </span>
            ) : (
              <span className="mt-px shrink-0 rounded border border-white/[0.08] bg-white/[0.05] px-1.5 py-0.5 text-[9px] font-semibold uppercase leading-none tracking-[0.11em] text-pitflix-muted sm:text-[10px]">
                Nominee
              </span>
            )}
          </div>

          <div className="flex min-w-0 flex-wrap items-center gap-x-2 gap-y-0.5">
            <span className="text-[10px] font-medium uppercase tracking-wider text-pitflix-muted">
              {formatMediaType(mediaType)}
            </span>
            {tmdbId ? (
              <>
                <span className="hidden text-[10px] text-white/15 sm:inline" aria-hidden>
                  ·
                </span>
                <a
                  href={`https://www.themoviedb.org/${mediaType}/${tmdbId}`}
                  target="_blank"
                  rel="noreferrer"
                  className={cn(
                    "inline-flex items-center gap-1 text-[10px] font-semibold uppercase tracking-wide transition-colors sm:text-[11px]",
                    winner
                      ? "text-amber-200/85 hover:text-amber-100"
                      : "text-pitflix-muted hover:text-pitflix-light",
                  )}
                >
                  <span>TMDB</span>
                  <ExternalLink className="h-3 w-3 shrink-0 opacity-70" aria-hidden />
                </a>
              </>
            ) : null}
          </div>
        </div>
      </div>

      <span className="sr-only">
        {listIndex + 1}. {title}
        {winner ? ", winner" : ", nominee"}
      </span>
    </article>
  );
}
