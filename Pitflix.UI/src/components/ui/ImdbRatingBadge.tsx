import { cn } from "../../utils/cn";
import { formatRating } from "../../utils/format";

/** Gold IMDb pill — matches library poster cards. */
export function ImdbRatingBadge({
  value,
  className,
  size = "sm",
}: {
  value: number;
  className?: string;
  size?: "xs" | "sm";
}) {
  if (!(value > 0)) return null;
  return (
    <span
      className={cn(
        "inline-flex shrink-0 items-center rounded-md bg-[#F5C518]/90 font-bold text-black shadow-sm",
        size === "xs" ? "px-1 py-0.5 text-[9px]" : "px-1.5 py-0.5 text-[10px]",
        className,
      )}
    >
      IMDb {formatRating(value)}
    </span>
  );
}
