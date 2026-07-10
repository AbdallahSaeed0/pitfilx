import { Clock } from "lucide-react";
import { formatRuntimeMinutes } from "../../utils/format";
import { cn } from "../../utils/cn";

type Props = {
  minutes?: number | null;
  className?: string;
  /** Compact pill on thumbnails — no icon. */
  variant?: "badge" | "thumb";
};

export function EpisodeRuntimeBadge({ minutes, className, variant = "badge" }: Props) {
  const label = formatRuntimeMinutes(minutes);
  if (!label) return null;

  if (variant === "thumb") {
    return (
      <span
        className={cn(
          "rounded bg-black/75 px-1.5 py-0.5 text-[10px] font-semibold tabular-nums text-white backdrop-blur-sm",
          className,
        )}
      >
        {label}
      </span>
    );
  }

  return (
    <span
      className={cn(
        "inline-flex items-center gap-1 rounded bg-white/10 px-1.5 py-0.5 text-[10px] font-medium tabular-nums text-pitflix-muted",
        className,
      )}
    >
      <Clock className="h-2.5 w-2.5 shrink-0 opacity-70" aria-hidden />
      {label}
    </span>
  );
}
