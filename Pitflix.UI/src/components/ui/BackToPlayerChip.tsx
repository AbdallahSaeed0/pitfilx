import { ChevronUp, Pause, Play } from "lucide-react";
import { useEffect } from "react";
import { useLocation, useNavigate } from "react-router-dom";
import { useActivePlayerStore } from "../../store/activePlayerStore";
import { usePlaybackPolStore } from "../../playback/playbackStore";

/**
 * Floating mini-chip that appears at the bottom of the screen whenever the built-in
 * player is running but the user has navigated away from /player.
 * Clicking it brings them back to the player, restoring the same session.
 */
export function BackToPlayerChip() {
  const navigate = useNavigate();
  const location = useLocation();
  const phase = usePlaybackPolStore((s) => s.snapshot.phase);
  const launchState = useActivePlayerStore((s) => s.launchState);
  const setLaunchState = useActivePlayerStore((s) => s.setLaunchState);
  const switchInProgress = useActivePlayerStore((s) => s.switchInProgress);

  // Only show while the player is actually running (not idle or fully ended)
  const isActive = phase === "loading" || phase === "playing" || phase === "paused" || phase === "buffering";

  const isOnPlayerPage = location.pathname === "/player";

  // If mpv exits or ends on its own while the chip is visible, clear launchState so the chip disappears.
  // Don't clear during an episode/sibling switch (player will reopen immediately), and don't clear
  // while still on /player — episode switches close mpv briefly before reopening, and the player
  // page manages its own state.
  useEffect(() => {
    if (!isActive && launchState && !switchInProgress && !isOnPlayerPage) {
      setLaunchState(null);
    }
  }, [isActive, launchState, setLaunchState, switchInProgress, isOnPlayerPage]);

  if (!isActive || !launchState) return null;

  const isPlaying = phase === "playing" || phase === "buffering";

  return (
    <button
      type="button"
      onClick={() => navigate("/player", { state: launchState })}
      className="group fixed bottom-5 right-5 z-50 flex items-center gap-2.5 rounded-2xl border border-pitflix-primary/40 bg-pitflix-bg/95 px-4 py-2.5 shadow-[0_8px_30px_rgba(0,0,0,0.6)] backdrop-blur-md transition-all hover:border-pitflix-primary/70 hover:bg-pitflix-surface/95 hover:shadow-pitflix-primary/20"
    >
      <span className="flex h-7 w-7 shrink-0 items-center justify-center rounded-full bg-pitflix-primary/20 group-hover:bg-pitflix-primary/35 transition-colors">
        {isPlaying ? (
          <Play className="h-3.5 w-3.5 fill-pitflix-primary text-pitflix-primary" />
        ) : (
          <Pause className="h-3.5 w-3.5 fill-pitflix-muted text-pitflix-muted" />
        )}
      </span>
      <div className="flex min-w-0 flex-col text-left">
        <span className="text-[10px] font-medium uppercase tracking-wider text-pitflix-muted">
          {isPlaying ? "Now playing" : "Paused"}
        </span>
        <span className="max-w-[180px] truncate text-xs font-semibold text-white">
          {launchState.title}
        </span>
      </div>
      <ChevronUp className="h-4 w-4 shrink-0 text-pitflix-primary opacity-70 group-hover:opacity-100 transition-opacity" />
    </button>
  );
}
