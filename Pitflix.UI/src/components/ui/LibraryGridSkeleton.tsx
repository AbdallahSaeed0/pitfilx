import { libraryPosterGridClassName } from "./LibraryPosterGrid";
import { Skeleton } from "./Skeleton";
import { cn } from "../../utils/cn";

/** Skeleton tiles matching Movies/Series poster grid layout (first paint without spinner flash). */
export function LibraryGridSkeleton() {
  return (
    <div className={cn(libraryPosterGridClassName, "gap-x-6 gap-y-10")} aria-busy="true" aria-label="Loading">
      {Array.from({ length: 35 }).map((_, i) => (
        <div key={i} className="space-y-2">
          <Skeleton className="w-full rounded-xl" style={{ aspectRatio: "2 / 3" }} />
          <Skeleton className="h-3 w-4/5 rounded" />
          <Skeleton className="h-2.5 w-2/5 rounded" />
        </div>
      ))}
    </div>
  );
}
