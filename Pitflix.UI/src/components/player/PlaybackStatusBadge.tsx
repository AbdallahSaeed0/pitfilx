import type { PlaybackStatus } from "../../utils/playbackStatus";
import { getStatusInfo } from "../../utils/playbackStatus";
import { cn } from "../../utils/cn";

type PlaybackStatusBadgeProps = {
  status: PlaybackStatus;
  className?: string;
};

export function PlaybackStatusBadge({ status, className }: PlaybackStatusBadgeProps) {
  const info = getStatusInfo(status);

  return (
    <span
      className={cn(
        "inline-flex items-center rounded-full px-3 py-1.5 text-xs font-medium transition-colors",
        info.bgColor,
        info.textColor,
        className
      )}
    >
      {info.label}
    </span>
  );
}
