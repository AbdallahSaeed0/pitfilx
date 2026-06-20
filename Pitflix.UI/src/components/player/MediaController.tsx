import { Pause, Play, SkipBack, SkipForward } from "lucide-react";
import { useEffect, useRef, useState } from "react";
import { cn } from "../../utils/cn";

// ─── Helpers ──────────────────────────────────────────────────────────────────

function formatTime(secs: number): string {
  if (!Number.isFinite(secs) || secs < 0) secs = 0;
  const h = Math.floor(secs / 3600);
  const m = Math.floor((secs % 3600) / 60);
  const s = Math.floor(secs % 60);
  if (h > 0)
    return `${h}:${String(m).padStart(2, "0")}:${String(s).padStart(2, "0")}`;
  return `${m}:${String(s).padStart(2, "0")}`;
}

// ─── Props ────────────────────────────────────────────────────────────────────

type MediaControllerProps = {
  /** Current playback position in seconds (from server/IPC — may update infrequently). */
  position: number;
  /** Total duration in seconds. */
  duration: number;
  paused: boolean;
  onPlayPause: () => void;
  /** Absolute seek — called with a position in seconds. */
  onSeek: (seconds: number) => void;
  /**
   * Callback for the Prev button.
   * Pass `null` or `undefined` to render the button disabled.
   * Omit `prevLabel` to show the default "−10 s" label.
   */
  onPrev: (() => void) | null | undefined;
  /** Callback for the Next button. Same rules as `onPrev`. */
  onNext: (() => void) | null | undefined;
  /** Label shown below the Prev icon (e.g. "S05E01"). Defaults to "−10 s". */
  prevLabel?: string;
  /** Label shown below the Next icon (e.g. "S05E03"). Defaults to "+10 s". */
  nextLabel?: string;
};

// ─── Component ────────────────────────────────────────────────────────────────

export function MediaController({
  position,
  duration,
  paused,
  onPlayPause,
  onSeek,
  onPrev,
  onNext,
  prevLabel,
  nextLabel,
}: MediaControllerProps) {
  const [isSeeking, setIsSeeking] = useState(false);
  const [seekValue, setSeekValue] = useState(0);

  // ── Local smooth position ──────────────────────────────────────────────────
  // The `position` prop may update only every 1-2 s (polling) in companion mode
  // but every ~200 ms in the remote-player IPC path.  We keep a local copy that
  // is advanced by a 100 ms interval when playing so the timeline and time-
  // display are always live, regardless of how often the prop updates.
  const [localPos, setLocalPos] = useState(position);
  const localPosRef = useRef(position);

  // After a seek, mpv may fire IPC state events with the OLD position for up to
  // ~500 ms before the seek is reflected. Snapping localPos to those stale values
  // would cause the display to jump backwards.  We suppress position-prop snaps
  // for 1 s after each commit so only the post-seek IPC values are accepted.
  const seekCooldownRef = useRef(false);
  const seekCooldownTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null);

  // Snap to server position when prop changes (corrects any drift),
  // but skip the snap during the post-seek cooldown window.
  useEffect(() => {
    if (seekCooldownRef.current) return;
    localPosRef.current = position;
    setLocalPos(position);
  }, [position]);

  // Advance locally at 10 fps while playing.
  useEffect(() => {
    if (paused || duration <= 0) return;
    const id = setInterval(() => {
      const next = Math.min(localPosRef.current + 0.1, duration);
      localPosRef.current = next;
      setLocalPos(next);
    }, 100);
    return () => clearInterval(id);
  }, [paused, duration]);

  // ── Display position ───────────────────────────────────────────────────────
  const displayPos = isSeeking ? seekValue : localPos;
  const pct = duration > 0 ? Math.min(100, Math.max(0, (displayPos / duration) * 100)) : 0;

  // ── Seek handlers ──────────────────────────────────────────────────────────
  const handleRangeChange = (e: React.ChangeEvent<HTMLInputElement>) => {
    const val = Number(e.target.value);
    setIsSeeking(true);
    setSeekValue(val);
  };

  const commitSeek = (e: React.SyntheticEvent<HTMLInputElement>) => {
    const val = Number((e.target as HTMLInputElement).value);
    localPosRef.current = val;
    setLocalPos(val);
    setIsSeeking(false);
    // Start cooldown: suppress position-prop snaps for 1 s so stale IPC
    // responses (fired with the pre-seek position) don't jump the display back.
    seekCooldownRef.current = true;
    if (seekCooldownTimerRef.current) clearTimeout(seekCooldownTimerRef.current);
    seekCooldownTimerRef.current = setTimeout(() => {
      seekCooldownRef.current = false;
    }, 1000);
    onSeek(val);
  };

  return (
    <div className="flex w-full flex-col items-center gap-4">
      {/* Time display */}
      <div className="flex items-baseline gap-2.5 font-mono tabular-nums">
        <span className="text-3xl font-bold text-white">{formatTime(displayPos)}</span>
        {duration > 0 && (
          <>
            <span className="text-lg text-white/30">/</span>
            <span className="text-lg text-white/50">{formatTime(duration)}</span>
          </>
        )}
      </div>

      {/* Seekbar — custom styled track + transparent range overlay */}
      <div className="relative w-full max-w-md">
        {/* Visual track */}
        <div
          className="relative h-2 w-full overflow-hidden rounded-full"
          style={{ background: "rgba(255,255,255,0.10)" }}
        >
          {/* Purple fill — no CSS transition; localPos updates fast enough (10fps) */}
          <div
            className="absolute inset-y-0 left-0 rounded-full"
            style={{
              width: `${pct}%`,
              background: "linear-gradient(90deg, #7c6cf0, #a78bfa)",
              boxShadow: "0 0 10px rgba(124,108,240,0.45)",
            }}
          />
        </div>

        {/* White thumb dot */}
        {duration > 0 && pct > 0.5 && pct < 99.5 && (
          <div
            className="pointer-events-none absolute top-1/2 h-3.5 w-3.5 -translate-x-1/2 -translate-y-1/2 rounded-full bg-white shadow-md"
            style={{ left: `${pct}%` }}
          />
        )}

        {/* Transparent range input — all user interaction */}
        {duration > 0 ? (
          <input
            type="range"
            min={0}
            max={Math.floor(duration)}
            step={1}
            value={Math.floor(displayPos)}
            onChange={handleRangeChange}
            onMouseUp={commitSeek}
            onTouchEnd={commitSeek}
            className="absolute inset-0 w-full cursor-pointer opacity-0"
            style={{ height: "100%", margin: 0 }}
          />
        ) : null}
      </div>

      {/* Transport controls */}
      <div className="flex items-center gap-4">
        {/* Prev / −10 s */}
        <button
          type="button"
          disabled={onPrev == null}
          onClick={() => onPrev?.()}
          className={cn(
            "flex flex-col items-center gap-0.5 rounded-xl border px-3 py-2 text-white transition active:scale-95",
            onPrev != null
              ? "border-white/20 bg-white/[0.06] hover:bg-white/[0.12]"
              : "border-white/10 bg-white/[0.03] opacity-40 cursor-not-allowed",
          )}
        >
          <SkipBack className="h-5 w-5" />
          <span className="max-w-[60px] truncate text-[10px] leading-tight">
            {prevLabel ?? "−10 s"}
          </span>
        </button>

        {/* Play / Pause */}
        <button
          type="button"
          onClick={onPlayPause}
          className="flex h-16 w-16 items-center justify-center rounded-full border border-white/30 bg-white/[0.10] text-white transition hover:bg-white/[0.18] active:scale-95"
          title={paused ? "Resume" : "Pause"}
        >
          {paused ? (
            <Play className="h-7 w-7 translate-x-0.5" />
          ) : (
            <Pause className="h-7 w-7" />
          )}
        </button>

        {/* Next / +10 s */}
        <button
          type="button"
          disabled={onNext == null}
          onClick={() => onNext?.()}
          className={cn(
            "flex flex-col items-center gap-0.5 rounded-xl border px-3 py-2 text-white transition active:scale-95",
            onNext != null
              ? "border-white/20 bg-white/[0.06] hover:bg-white/[0.12]"
              : "border-white/10 bg-white/[0.03] opacity-40 cursor-not-allowed",
          )}
        >
          <SkipForward className="h-5 w-5" />
          <span className="max-w-[60px] truncate text-[10px] leading-tight">
            {nextLabel ?? "+10 s"}
          </span>
        </button>
      </div>
    </div>
  );
}
