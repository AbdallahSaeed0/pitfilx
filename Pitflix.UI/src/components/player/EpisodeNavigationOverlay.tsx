import { ChevronLeft, ChevronRight } from "lucide-react";
import type { NextLibraryEpisode } from "../../api/series";

type EpisodeNavigationOverlayProps = {
  prevEpisode: NextLibraryEpisode | null | undefined;
  nextEpisode: NextLibraryEpisode | null | undefined;
  onPrevious: () => void;
  onNext: () => void;
  visible: boolean;
};

/**
 * Floating episode navigation overlay that appears over the player
 * Shows prev/next episode buttons when hovering near edges
 */
export function EpisodeNavigationOverlay({
  prevEpisode,
  nextEpisode,
  onPrevious,
  onNext,
  visible,
}: EpisodeNavigationOverlayProps) {
  if (!visible || (prevEpisode === undefined && nextEpisode === undefined)) {
    return null;
  }

  return (
    <div className="pointer-events-none fixed inset-0 z-50 flex items-center justify-between px-8">
      {/* Previous Episode Button */}
      {prevEpisode !== undefined && (
        <button
          type="button"
          disabled={!prevEpisode}
          onClick={onPrevious}
          className="pointer-events-auto group flex h-20 w-20 items-center justify-center rounded-full bg-black/60 text-white backdrop-blur-sm transition-all duration-200 hover:bg-black/80 hover:scale-110 disabled:opacity-0 disabled:pointer-events-none"
          title={prevEpisode ? `Previous: S${prevEpisode.season}E${prevEpisode.episodeNumber}` : "No previous episode"}
        >
          <ChevronLeft className="h-10 w-10" strokeWidth={2.5} />
        </button>
      )}

      {/* Next Episode Button */}
      {nextEpisode !== undefined && (
        <button
          type="button"
          disabled={!nextEpisode}
          onClick={onNext}
          className="pointer-events-auto group flex h-20 w-20 items-center justify-center rounded-full bg-black/60 text-white backdrop-blur-sm transition-all duration-200 hover:bg-black/80 hover:scale-110 disabled:opacity-0 disabled:pointer-events-none"
          title={nextEpisode ? `Next: S${nextEpisode.season}E${nextEpisode.episodeNumber}` : "No next episode"}
        >
          <ChevronRight className="h-10 w-10" strokeWidth={2.5} />
        </button>
      )}
    </div>
  );
}
