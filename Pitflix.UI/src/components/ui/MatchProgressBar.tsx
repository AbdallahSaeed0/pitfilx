import { cn } from "../../utils/cn";

/** Shown while a single TMDB match request is in flight. */
export function IndeterminateMatchBar({ label = "Matching…" }: { label?: string }) {
  return (
    <div className="mt-3">
      <div className="h-1.5 w-full overflow-hidden rounded-full bg-pitflix-surface">
        <div
          className="h-full w-1/3 rounded-full bg-pitflix-primary shadow-[0_0_12px_rgba(123,47,190,0.6)] animate-match-indeterminate"
          aria-hidden
        />
      </div>
      <p className="mt-1.5 text-xs text-pitflix-muted">{label}</p>
    </div>
  );
}

export function DeterminateMatchBar({
  current,
  total,
  label,
  className,
}: {
  current: number;
  total: number;
  label: string;
  className?: string;
}) {
  const pct = total > 0 ? Math.min(100, Math.round((current / total) * 100)) : 0;
  return (
    <div className={cn("w-full", className)}>
      <div className="h-2 w-full overflow-hidden rounded-full bg-pitflix-surface">
        <div
          className="h-2 rounded-full bg-pitflix-primary transition-[width] duration-300 ease-out"
          style={{ width: `${pct}%` }}
          role="progressbar"
          aria-valuenow={current}
          aria-valuemin={0}
          aria-valuemax={total}
        />
      </div>
      <p className="mt-1.5 text-xs text-pitflix-muted">
        {label} ({current} / {total})
      </p>
    </div>
  );
}
