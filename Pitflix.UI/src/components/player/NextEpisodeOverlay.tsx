import { X } from "lucide-react";
import type { NextLibraryEpisode } from "../../api/series";
import { PlayerActionButton } from "./PlayerActionButton";

type NextEpisodeOverlayProps = {
  episode: NextLibraryEpisode;
  countdown: number;
  onPlayNow: () => void;
  onCancel: () => void;
};

export function NextEpisodeOverlay({
  episode,
  countdown,
  onPlayNow,
  onCancel,
}: NextEpisodeOverlayProps) {
  return (
    <div className="fixed bottom-8 right-8 z-50 animate-slide-in-from-bottom">
      <div className="relative w-80 overflow-hidden rounded-xl border border-pitflix-border-medium bg-pitflix-bg-card/95 shadow-2xl backdrop-blur-lg">
        {/* Close Button */}
        <button
          type="button"
          onClick={onCancel}
          className="absolute right-2 top-2 rounded-lg p-1.5 text-pitflix-text-subtle hover:bg-pitflix-bg-elevated hover:text-pitflix-text-primary transition-colors"
          aria-label="Dismiss next episode prompt"
        >
          <X className="h-4 w-4" />
        </button>

        <div className="p-5">
          {/* Countdown */}
          <div className="mb-3 flex items-center gap-2">
            <div className="flex h-8 w-8 items-center justify-center rounded-full bg-pitflix-accent-soft text-sm font-bold text-pitflix-accent-primary">
              {countdown > 0 ? countdown : "—"}
            </div>
            <div>
              <p className="text-sm font-medium text-pitflix-text-secondary">Up next</p>
              <p className="text-micro text-pitflix-text-subtle">
                {countdown > 0 ? `Playing next in ${countdown}s` : "Playing next…"}
              </p>
            </div>
          </div>

          {/* Episode Info */}
          <div className="mb-4">
            <p className="text-xs font-semibold text-pitflix-text-primary">
              S{episode.season}E{episode.episodeNumber}
            </p>
            {episode.title && (
              <p className="mt-1 line-clamp-2 text-caption text-pitflix-text-muted">
                {episode.title}
              </p>
            )}
          </div>

          {/* Actions */}
          <div className="flex gap-2">
            <PlayerActionButton
              variant="primary"
              onClick={onPlayNow}
              className="flex-1"
            >
              Play next now
            </PlayerActionButton>
            <PlayerActionButton
              variant="secondary"
              onClick={onCancel}
            >
              Cancel
            </PlayerActionButton>
          </div>
        </div>
      </div>
    </div>
  );
}
