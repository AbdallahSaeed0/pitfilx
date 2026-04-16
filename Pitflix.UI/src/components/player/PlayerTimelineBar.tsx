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
 * Thumbnail sprites can later replace the lower track without changing call sites.
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
    <div className={cn("space-y-3", className)}>
      <div className="flex items-end justify-between gap-4 tabular-nums">
        <div>
          <p className="text-micro uppercase tracking-wider text-pitflix-text-subtle">Elapsed</p>
          <p className="text-lg font-semibold text-pitflix-text-primary">{fmtClock(elapsed)}</p>
        </div>
        <div className="text-right">
          <p className="text-micro uppercase tracking-wider text-pitflix-text-subtle">Remaining</p>
          <p className="text-lg font-semibold text-pitflix-text-muted">−{fmtClock(remaining)}</p>
        </div>
      </div>

      <div className="relative pt-1">
        <div
          className="relative h-2.5 overflow-hidden rounded-full bg-white/[0.08] ring-1 ring-white/[0.06]"
          title="Progress"
        >
          <div
            className="absolute inset-y-0 left-0 rounded-full bg-gradient-to-r from-pitflix-accent-primary via-violet-500 to-fuchsia-500 shadow-[0_0_20px_rgba(139,92,246,0.35)] transition-[width] duration-500 ease-out"
            style={{ width: `${pct}%` }}
          />
          {resumePct != null && resumePct > 1 && resumePct < 99 ? (
            <div
              className="pointer-events-none absolute top-1/2 z-10 h-4 w-0.5 -translate-y-1/2 rounded-full bg-amber-300 shadow-[0_0_8px_rgba(252,211,77,0.6)]"
              style={{ left: `calc(${resumePct}% - 1px)` }}
              title="Resumed from here"
            />
          ) : null}
        </div>
        <p className="mt-2 text-center text-micro text-pitflix-text-subtle">
          {dur > 0 ? `${Math.round(pct)}% watched` : "Duration loading…"}
        </p>
      </div>
    </div>
  );
}
