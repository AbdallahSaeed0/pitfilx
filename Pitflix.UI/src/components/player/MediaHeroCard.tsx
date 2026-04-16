import type { ReactNode } from "react";
import { ExternalLink } from "lucide-react";
import { cn } from "../../utils/cn";
import { toPosterSrc } from "../../utils/posterSrc";
import { MediaImage } from "../ui/MediaImage";
import { PlayerTimelineBar } from "./PlayerTimelineBar";

type MediaHeroCardProps = {
  posterPath: string | null | undefined;
  title: string;
  episode?: string | null;
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
  title,
  episode,
  progress,
  timePos,
  duration,
  resumeFromSec,
  children,
  className,
}: MediaHeroCardProps) {
  const posterSrc = toPosterSrc(posterPath ?? undefined);
  return (
    <div className={cn("w-full max-w-4xl", className)}>
      <div className="overflow-hidden rounded-2xl border border-pitflix-border-subtle bg-pitflix-bg-card shadow-2xl">
        {/* Backdrop/Poster Section */}
        <div className="relative">
          {posterSrc ? (
            <div className="relative aspect-video w-full overflow-hidden bg-black/40">
              <MediaImage src={posterSrc} alt={title} className="h-full w-full object-cover opacity-50" fallbackText="" />
              <div className="absolute inset-0 bg-gradient-to-t from-pitflix-bg-card via-pitflix-bg-card/80 to-transparent" />
              <div className="absolute inset-0 flex items-center justify-center">
                <div className="rounded-full bg-black/40 p-6 backdrop-blur-sm">
                  <ExternalLink className="h-10 w-10 text-white/80" strokeWidth={1.5} />
                </div>
              </div>
            </div>
          ) : (
            <div className="relative flex aspect-video w-full items-center justify-center bg-gradient-to-br from-pitflix-bg-card to-black/40">
              <ExternalLink className="h-16 w-16 text-white/30" strokeWidth={1.5} />
            </div>
          )}
        </div>

        {/* Info Section */}
        <div className="p-8">
          {/* Title & Episode */}
          <div className="mb-6">
            <h2 className="mb-2 text-title text-pitflix-text-primary">{title}</h2>
            {episode && (
              <p className="text-body text-pitflix-text-muted">{episode}</p>
            )}
          </div>

          <PlayerTimelineBar
            progressPct={progress}
            elapsedSec={timePos}
            durationSec={duration}
            resumeFromSec={resumeFromSec}
            className="mb-6"
          />

          {/* Actions */}
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
