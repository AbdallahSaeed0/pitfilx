import { libraryPosterGridClassName } from "./LibraryPosterGrid";
import { cn } from "../../utils/cn";

/** Skeleton tiles matching Movies/Series poster grid layout (first paint without spinner flash). */
export function LibraryGridSkeleton() {
  return (
    <div className={cn(libraryPosterGridClassName, "gap-x-6 gap-y-10")}>
      {Array.from({ length: 35 }).map((_, i) => (
        <div
          key={i}
          className="w-full animate-pulse rounded-xl bg-gradient-to-b from-pitflix-card to-pitflix-surface/80"
          style={{ aspectRatio: "2 / 3" }}
        />
      ))}
    </div>
  );
}
