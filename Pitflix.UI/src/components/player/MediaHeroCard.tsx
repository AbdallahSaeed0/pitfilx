import type { ReactNode } from "react";
import { cn } from "../../utils/cn";
import { toPosterSrc } from "../../utils/posterSrc";
import { MediaImage } from "../ui/MediaImage";
import { PlayerTimelineBar } from "./PlayerTimelineBar";

type MediaHeroCardProps = {
  posterPath: string | null | undefined;
  /** Backdrop image for the banner background (e.g. selectedBackdropPath). Falls back to posterPath if not set. */
  backdropPath?: string | null;
  title: string;
  /** Short label, e.g. "S3 · E4" */
  episode?: string | null;
  /** Full episode title, e.g. "Type-A Personality" */
  episodeTitle?: string | null;
  progress: number;
  timePos: number;
  duration: number;
  /** Optional resume-from position (seconds) for timeline marker. */
  resumeFromSec?: number | null;
  children?: ReactNode;
  className?: string;
};

export function MediaHeroCard({
  posterPath,
  backdropPath,
  title,
  episode,
  episodeTitle,
  progress,
  timePos,
  duration,
  resumeFromSec,
  children,
  className,
}: MediaHeroCardProps) {
  const posterSrc = toPosterSrc(posterPath ?? undefined);
  const backdropSrc = toPosterSrc(backdropPath ?? undefined) ?? posterSrc;

  return (
    <div className={cn("mx-auto w-full max-w-4xl", className)}>
      <div className="overflow-hidden rounded-xl bg-pitflix-bg-card">

        {/* Hero banner — same pattern as the library detail pages */}
        <div className="relative min-h-[180px] sm:min-h-[210px]">
          {/* Backdrop: banner image stretched + dimmed (uses backdrop if available, falls back to poster) */}
          <div className="pointer-events-none absolute inset-0">
            {backdropSrc ? (
              <MediaImage
                src={backdropSrc}
                alt=""
                className="h-full w-full object-cover opacity-60"
                fallbackText=""
              />
            ) : (
              <div className="absolute inset-0 bg-pitflix-bg-card" />
            )}
            {/* Same two-gradient overlay as DetailPage */}
            <div className="absolute inset-0 bg-gradient-to-r from-pitflix-bg-base via-pitflix-bg-base/70 to-transparent" />
            <div className="absolute inset-0 bg-gradient-to-t from-pitflix-bg-base to-transparent" />
          </div>

          {/* Content row: small poster card + title */}
          <div className="relative z-10 flex items-end gap-4 p-4 pb-5 sm:gap-5 sm:p-6 sm:pb-6" style={{ minHeight: "inherit" }}>
            {posterSrc ? (
              <div className="hidden aspect-[2/3] w-20 shrink-0 overflow-hidden rounded-lg shadow-xl ring-1 ring-white/10 sm:block sm:w-24">
                <MediaImage
                  src={posterSrc}
                  alt={title}
                  className="h-full w-full object-cover"
                  fallbackText={title.slice(0, 2)}
                />
              </div>
            ) : null}
            <div className="min-w-0 flex-1">
              <h2 className="text-2xl font-bold leading-tight text-white drop-shadow sm:text-3xl">{title}</h2>
              {episode ? (
                <p className="mt-1 text-sm font-semibold text-pitflix-accent-hover drop-shadow">{episode}</p>
              ) : null}
              {episodeTitle ? (
                <p className="mt-0.5 text-sm text-white/80 drop-shadow">{episodeTitle}</p>
              ) : null}
            </div>
          </div>
        </div>

        {/* Progress + actions */}
        <div className="px-4 pb-4 pt-3 sm:px-6">
          <PlayerTimelineBar
            progressPct={progress}
            elapsedSec={timePos}
            durationSec={duration}
            resumeFromSec={resumeFromSec}
            className="mb-4"
          />
          {children && (
            <div className="flex flex-wrap items-center justify-center gap-3">
              {children}
            </div>
          )}
        </div>

      </div>
    </div>
  );
}
