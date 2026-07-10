import { List, Pin, Square, Maximize, X } from "lucide-react";
import { cn } from "../../utils/cn";

type Props = {
  alwaysOnTop: boolean;
  onToggleAlwaysOnTop: () => void;
  hasPlaylist: boolean;
  playlistOpen: boolean;
  onTogglePlaylist: () => void;
  isMaximized: boolean;
  onToggleMaximize: () => void;
  isFullscreen: boolean;
  onToggleFullscreen: () => void;
  onClose: () => void;
};

const chromeBtn =
  "flex h-8 w-8 items-center justify-center rounded-md text-white/80 transition hover:bg-white/15 hover:text-white";

/** Top-right window controls: pin, playlist, maximize, fullscreen, close. */
export function PlayerWindowChrome({
  alwaysOnTop,
  onToggleAlwaysOnTop,
  hasPlaylist,
  playlistOpen,
  onTogglePlaylist,
  isMaximized,
  onToggleMaximize,
  isFullscreen,
  onToggleFullscreen,
  onClose,
}: Props) {
  return (
    <div className="flex shrink-0 items-center gap-0.5">
      <button
        type="button"
        title={alwaysOnTop ? "Unpin window" : "Keep on top"}
        className={cn(chromeBtn, alwaysOnTop && "bg-white/15 text-pitflix-primary")}
        onClick={onToggleAlwaysOnTop}
      >
        <Pin className={cn("h-4 w-4", alwaysOnTop && "fill-current")} />
      </button>
      {hasPlaylist ? (
        <button
          type="button"
          title={playlistOpen ? "Hide playlist (L)" : "Show playlist (L)"}
          className={cn(chromeBtn, playlistOpen && "bg-white/15 text-pitflix-primary")}
          onClick={onTogglePlaylist}
        >
          <List className="h-4 w-4" />
        </button>
      ) : null}
      <button
        type="button"
        title={isMaximized ? "Restore window" : "Maximize (keep taskbar visible)"}
        className={cn(chromeBtn, isMaximized && "bg-white/15")}
        onClick={onToggleMaximize}
      >
        <Square className="h-4 w-4" />
      </button>
      <button
        type="button"
        title={isFullscreen ? "Exit fullscreen" : "Fullscreen"}
        className={cn(chromeBtn, isFullscreen && "bg-white/15 text-pitflix-primary")}
        onClick={onToggleFullscreen}
      >
        <Maximize className="h-4 w-4" />
      </button>
      <button type="button" title="Close player" className={cn(chromeBtn, "hover:bg-red-500/25 hover:text-red-200")} onClick={onClose}>
        <X className="h-4 w-4" />
      </button>
    </div>
  );
}
