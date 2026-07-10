import type { ReactNode } from "react";
import { cn } from "../../utils/cn";

/** Fills the row width; adds columns on wide viewports (min ~145px per tile). */
export const libraryPosterGridClassName =
  "grid gap-3 gap-y-7 [grid-template-columns:repeat(auto-fill,minmax(min(100%,145px),1fr))]";

export function LibraryPosterGrid({
  children,
  className,
}: {
  children: ReactNode;
  className?: string;
}) {
  return <div className={cn(libraryPosterGridClassName, className)}>{children}</div>;
}
