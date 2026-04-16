import { cn } from "../../utils/cn";

type ProgressStripProps = {
  progress: number;
  timePos: number;
  duration: number;
  className?: string;
};

function fmtTime(s: number) {
  if (!Number.isFinite(s) || s < 0) return "0:00";
  const h = Math.floor(s / 3600);
  const m = Math.floor((s % 3600) / 60);
  const sec = Math.floor(s % 60);
  if (h > 0) {
    return `${h}:${m.toString().padStart(2, "0")}:${sec.toString().padStart(2, "0")}`;
  }
  return `${m}:${sec.toString().padStart(2, "0")}`;
}

export function ProgressStrip({ progress, timePos, duration, className }: ProgressStripProps) {
  const remaining = duration - timePos;

  return (
    <div className={cn("space-y-2", className)}>
      <div className="flex items-center justify-between text-xs tabular-nums text-pitflix-text-muted">
        <span>{fmtTime(timePos)}</span>
        <span>{fmtTime(duration)}</span>
      </div>
      <div className="relative h-1 overflow-hidden rounded-full bg-pitflix-border-subtle">
        <div
          className="h-full rounded-full bg-pitflix-accent-primary transition-all duration-300"
          style={{ width: `${Math.min(100, Math.max(0, progress))}%` }}
        />
      </div>
      {remaining > 0 && remaining < duration && (
        <p className="text-center text-micro text-pitflix-text-subtle">
          {fmtTime(remaining)} remaining
        </p>
      )}
    </div>
  );
}
