import { cn } from "../../utils/cn";

function fmtClock(s: number) {
  if (!Number.isFinite(s) || s < 0) return "0:00";
  const h = Math.floor(s / 3600);
  const m = Math.floor((s % 3600) / 60);
  const sec = Math.floor(s % 60);
  if (h > 0) {
    return `${h}:${m.toString().padStart(2, "0")}:${sec.toString().padStart(2, "0")}`;
  }
  return `${m}:${sec.toString().padStart(2, "0")}`;
}

type PlayerTimelineBarProps = {
  progressPct: number;
  elapsedSec: number;
  durationSec: number;
  /** If set, shows a subtle marker on the bar (e.g. resume point). */
  resumeFromSec?: number | null;
  className?: string;
};

/**
 * Companion-player timeline: elapsed / remaining, gradient progress, optional resume marker.
 */
export function PlayerTimelineBar({
  progressPct,
  elapsedSec,
  durationSec,
  resumeFromSec,
  className,
}: PlayerTimelineBarProps) {
  const dur = Math.max(0, durationSec);
  const elapsed = Math.min(Math.max(0, elapsedSec), dur || elapsedSec);
  const remaining = Math.max(0, dur - elapsed);
  const pct = dur > 0 ? Math.min(100, Math.max(0, progressPct)) : 0;
  const resumePct =
    resumeFromSec != null && dur > 0.5
      ? Math.min(100, Math.max(0, (Math.min(resumeFromSec, dur) / dur) * 100))
      : null;

  return (
    <div className={cn("space-y-2", className)}>
      {/* Progress bar */}
      <div className="relative">
        <div
          className="relative h-2 overflow-hidden rounded-full bg-white/[0.08] ring-1 ring-white/[0.06]"
          title="Progress"
        >
          {/* Playback progress */}
          <div
            className="absolute inset-y-0 left-0 rounded-full bg-gradient-to-r from-pitflix-accent-primary via-violet-500 to-fuchsia-500 shadow-[0_0_16px_rgba(139,92,246,0.35)] transition-[width] duration-500 ease-out"
            style={{ width: `${pct}%` }}
          />

          {/* Resume marker */}
          {resumePct != null && resumePct > 1 && resumePct < 99 ? (
            <div
              className="pointer-events-none absolute top-1/2 z-10 h-3.5 w-0.5 -translate-y-1/2 rounded-full bg-amber-300 shadow-[0_0_6px_rgba(252,211,77,0.6)]"
              style={{ left: `calc(${resumePct}% - 1px)` }}
              title="Resumed from here"
            />
          ) : null}
        </div>
      </div>

      {/* Compact time row */}
      <div className="flex items-center justify-between tabular-nums text-xs text-pitflix-text-subtle">
        <span className="font-medium text-pitflix-text-muted">{fmtClock(elapsed)}</span>
        <span>{dur > 0 ? `${Math.round(pct)}%` : "loading…"}</span>
        <span>−{fmtClock(remaining)}</span>
      </div>
    </div>
  );
}
