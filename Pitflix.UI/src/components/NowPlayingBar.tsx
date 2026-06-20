import { Pause, Play, Square } from "lucide-react";
import { useEffect } from "react";
import { openPlayerWindow, sendCommand, stopPlayer } from "../api/player";
import { usePlayerSession } from "../hooks/usePlayerSession";

// Listen for player3_error events emitted by Tauri when PitflixPlayer.exe
// cannot be found or launched. Imported lazily so the component still mounts
// correctly in non-Tauri (browser dev) environments.
async function subscribePlayer3Error(): Promise<(() => void) | undefined> {
  try {
    const { listen } = await import("@tauri-apps/api/event");
    const unlisten = await listen<string>("player3_error", (event) => {
      // eslint-disable-next-line no-alert
      window.alert(`PitflixPlayer launch error:\n\n${event.payload}`);
    });
    return unlisten;
  } catch {
    // Not in a Tauri context — ignore silently.
    return undefined;
  }
}

function formatTime(seconds: number): string {
  const s = Math.max(0, Math.floor(seconds));
  const m = Math.floor(s / 60);
  const rem = s % 60;
  return `${String(m).padStart(2, "0")}:${String(rem).padStart(2, "0")}`;
}

function fileBasename(filePath: string): string {
  const name = filePath.split(/[/\\]/).pop() ?? filePath;
  return name.replace(/\.[^.]+$/, "");
}

export function NowPlayingBar() {
  const { session } = usePlayerSession();
  const isVisible = !!(session && !session.isStopped);

  // Subscribe to player3_error Tauri events once on mount so any launch failure
  // from player3_open (including when opened via SettingsPage) surfaces as an alert.
  useEffect(() => {
    let unlisten: (() => void) | undefined;
    void subscribePlayer3Error().then((fn) => { unlisten = fn; });
    return () => { unlisten?.(); };
  }, []);

  // Push the main scroll container down so content isn't hidden behind the bar.
  // Done via direct style rather than modifying MainLayout, keeping this change
  // entirely self-contained in this new file.
  useEffect(() => {
    const main = document.querySelector("main") as HTMLElement | null;
    if (!main) return;
    const prev = main.style.paddingBottom;
    if (isVisible) main.style.paddingBottom = "80px";
    return () => {
      main.style.paddingBottom = prev;
    };
  }, [isVisible]);

  if (!isVisible || !session) return null;

  const title = fileBasename(session.filePath);
  const position = session.position;
  const duration = session.duration > 0 ? session.duration : 0;

  const handleSeek = (e: React.ChangeEvent<HTMLInputElement>) => {
    void sendCommand("seek", Number(e.target.value));
  };

  const handlePauseResume = () => {
    // If resuming from NowPlayingBar, open the WPF companion window so the user
    // can see and control playback.  The WPF app finds the session on its own.
    if (session?.isPaused) {
      void openPlayerWindow();
    }
    void sendCommand("pause");
  };

  const handleStop = () => {
    void stopPlayer();
  };

  return (
    <div
      className="fixed bottom-0 left-0 right-0 flex items-center gap-4 border-t border-pitflix-border-subtle px-4"
      style={{ height: 64, zIndex: 9999, backgroundColor: "#0f0f0f" }}
    >
      {/* Left: title */}
      <div className="w-44 shrink-0 min-w-0">
        <p className="truncate text-xs font-semibold text-white" title={title}>
          {title}
        </p>
      </div>

      {/* Centre: timestamps + seek bar */}
      <div className="flex min-w-0 flex-1 items-center gap-2">
        <span className="w-10 shrink-0 text-right text-[11px] tabular-nums text-pitflix-muted">
          {formatTime(position)}
        </span>
        <input
          type="range"
          min={0}
          max={duration > 0 ? Math.floor(duration) : 100}
          step={1}
          value={Math.floor(position)}
          onChange={handleSeek}
          className="h-1 flex-1 cursor-pointer accent-pitflix-accent"
          aria-label="Seek"
        />
        <span className="w-10 shrink-0 text-[11px] tabular-nums text-pitflix-muted">
          {formatTime(duration)}
        </span>
      </div>

      {/* Right: Pause/Resume + Stop */}
      <div className="flex shrink-0 items-center gap-2">
        <button
          type="button"
          onClick={handlePauseResume}
          aria-label={session.isPaused ? "Resume" : "Pause"}
          className="flex h-8 w-8 items-center justify-center rounded-full bg-pitflix-surface transition-colors hover:bg-pitflix-card"
        >
          {session.isPaused ? (
            <Play className="h-4 w-4 fill-white text-white" />
          ) : (
            <Pause className="h-4 w-4 fill-white text-white" />
          )}
        </button>
        <button
          type="button"
          onClick={handleStop}
          aria-label="Stop"
          className="flex h-8 w-8 items-center justify-center rounded-full bg-pitflix-surface transition-colors hover:bg-pitflix-card"
        >
          <Square className="h-4 w-4 fill-white text-white" />
        </button>
      </div>
    </div>
  );
}
