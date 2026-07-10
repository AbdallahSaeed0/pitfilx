import { AirDateCountdown } from "./AirDateCountdown";
import { formatAirDateForDisplay } from "../../hooks/useCountdown";
import { cn } from "../../utils/cn";

type Props = {
  airDate: string | null | undefined;
  className?: string;
  align?: "left" | "right";
};

/** Shown instead of play/download when an episode has not aired yet. */
export function EpisodeAirSchedule({ airDate, className, align = "right" }: Props) {
  if (!airDate?.trim()) {
    return <p className={cn("text-xs text-pitflix-muted", className)}>Not aired yet</p>;
  }
  return (
    <div className={cn("shrink-0", align === "right" ? "text-right" : "text-left", className)}>
      <p className="text-xs font-medium text-pitflix-muted">Airs {formatAirDateForDisplay(airDate)}</p>
      <div className={cn("mt-1 flex", align === "right" ? "justify-end" : "justify-start")}>
        <AirDateCountdown airDate={airDate} layout="inline" compact />
      </div>
    </div>
  );
}
