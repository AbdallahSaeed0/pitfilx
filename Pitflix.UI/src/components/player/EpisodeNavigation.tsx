import { ChevronLeft, ChevronRight } from "lucide-react";
import type { NextLibraryEpisode } from "../../api/series";

type EpisodeNavigationProps = {
  prevEpisode: NextLibraryEpisode | null | undefined;
  nextEpisode: NextLibraryEpisode | null | undefined;
  onPrevious: () => void;
  onNext: () => void;
  className?: string;
};

export function EpisodeNavigation({
  prevEpisode,
  nextEpisode,
  onPrevious,
  onNext,
  className,
}: EpisodeNavigationProps) {
  if (prevEpisode === undefined && nextEpisode === undefined) {
    return null;
  }

  return (
    <div className={className}>
      <div className="rounded-2xl border border-pitflix-border-subtle bg-pitflix-bg-card/70 p-4 shadow-xl">
        <p className="mb-3 text-center text-caption font-semibold uppercase tracking-wider text-pitflix-text-subtle">
          Episode Navigation
        </p>
        <div className="grid gap-3 md:grid-cols-2">
          {prevEpisode !== undefined && (
            <button
              type="button"
              onClick={onPrevious}
              disabled={!prevEpisode}
              className="group rounded-xl border border-white/10 bg-white/5 p-3 text-left transition hover:bg-white/10 disabled:cursor-not-allowed disabled:opacity-35"
            >
              <div className="mb-2 flex items-center gap-2 text-pitflix-text-primary">
                <ChevronLeft className="h-4 w-4" strokeWidth={2.5} />
                <span className="text-sm font-semibold">Previous Episode</span>
              </div>
              {prevEpisode ? (
                <p className="line-clamp-2 text-caption text-pitflix-text-muted">
                  S{prevEpisode.season}E{prevEpisode.episodeNumber}
                  {prevEpisode.title ? ` — ${prevEpisode.title}` : ""}
                </p>
              ) : (
                <p className="text-caption text-pitflix-text-subtle">No previous episode</p>
              )}
              <p className="mt-2 text-micro text-pitflix-text-subtle">Shortcut: Shift+P</p>
            </button>
          )}
          {nextEpisode !== undefined && (
            <button
              type="button"
              onClick={onNext}
              disabled={!nextEpisode}
              className="group rounded-xl border border-pitflix-accent-primary/35 bg-pitflix-accent-soft/10 p-3 text-left transition hover:bg-pitflix-accent-soft/20 disabled:cursor-not-allowed disabled:opacity-35"
            >
              <div className="mb-2 flex items-center gap-2 text-pitflix-text-primary">
                <span className="text-sm font-semibold">Next Episode</span>
                <ChevronRight className="h-4 w-4" strokeWidth={2.5} />
              </div>
              {nextEpisode ? (
                <p className="line-clamp-2 text-caption text-pitflix-text-muted">
                  S{nextEpisode.season}E{nextEpisode.episodeNumber}
                  {nextEpisode.title ? ` — ${nextEpisode.title}` : ""}
                </p>
              ) : (
                <p className="text-caption text-pitflix-text-subtle">No next episode</p>
              )}
              <p className="mt-2 text-micro text-pitflix-text-subtle">Shortcut: Shift+N</p>
            </button>
          )}
        </div>
      </div>
      {nextEpisode && (
        <p className="mt-2 text-center text-caption text-pitflix-text-subtle">
          Up next: S{nextEpisode.season}E{nextEpisode.episodeNumber}
          {nextEpisode.title ? ` — ${nextEpisode.title}` : ""}
        </p>
      )}
    </div>
  );
}
