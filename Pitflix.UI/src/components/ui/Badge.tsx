import type { ReactNode } from "react";
import { cn } from "../../utils/cn";

export function Badge({
  children,
  className,
}: {
  children: ReactNode;
  className?: string;
}) {
  return (
    <span
      className={cn(
        "inline-flex items-center rounded-md border border-pitflix-primary/40 px-2 py-0.5 text-xs text-pitflix-light",
        className,
      )}
    >
      {children}
    </span>
  );
}
