import { Minus, Plus, Repeat } from "lucide-react";

type Props = {
  count: number;
  onChange: (next: number) => void;
  className?: string;
};

/** Compact "↻ ×N" pill with inline +/- for manually correcting a rewatch count. */
export function RewatchBadge({ count, onChange, className = "" }: Props) {
  return (
    <span
      className={`inline-flex items-center gap-1.5 rounded-full border border-violet-400/25 bg-violet-500/10 px-2 py-0.5 text-[11px] font-semibold text-violet-300 ${className}`}
    >
      <button
        type="button"
        onClick={() => onChange(Math.max(0, count - 1))}
        disabled={count === 0}
        aria-label="Decrease rewatch count"
        className="flex h-4 w-4 items-center justify-center rounded-full text-violet-300/70 transition hover:bg-violet-500/20 hover:text-violet-200 disabled:opacity-30"
      >
        <Minus className="h-2.5 w-2.5" />
      </button>
      <span className="flex items-center gap-1">
        <Repeat className="h-3 w-3" />×{count}
      </span>
      <button
        type="button"
        onClick={() => onChange(count + 1)}
        aria-label="Increase rewatch count"
        className="flex h-4 w-4 items-center justify-center rounded-full text-violet-300/70 transition hover:bg-violet-500/20 hover:text-violet-200"
      >
        <Plus className="h-2.5 w-2.5" />
      </button>
    </span>
  );
}
