import { cn } from "../../utils/cn";

export function ProgressBar({
  value,
  className,
}: {
  value: number;
  className?: string;
}) {
  const v = Math.max(0, Math.min(100, value));
  return (
    <div className={cn("h-2 w-full overflow-hidden rounded-full bg-pitflix-card", className)}>
      <div
        className="h-full rounded-full bg-pitflix-primary transition-all"
        style={{ width: `${v}%` }}
      />
    </div>
  );
}
