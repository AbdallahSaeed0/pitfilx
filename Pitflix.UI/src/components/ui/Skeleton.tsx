import type { CSSProperties } from "react";
import { cn } from "../../utils/cn";
import { libraryPosterGridClassName } from "./LibraryPosterGrid";

/**
 * A single shimmering placeholder block. Compose these into the shape of whatever is loading —
 * the point is that the page keeps its layout while data arrives, instead of collapsing to a
 * spinner and then jumping when content lands.
 */
export function Skeleton({ className, style }: { className?: string; style?: CSSProperties }) {
  return <div aria-hidden className={cn("pitflix-skeleton rounded-md", className)} style={style} />;
}

/** Poster tiles (2:3) on the shared library grid — Movies, Series, browse and list pages. */
export function PosterGridSkeleton({ count = 24, className }: { count?: number; className?: string }) {
  return (
    <div className={cn(libraryPosterGridClassName, className)} aria-busy="true" aria-label="Loading">
      {Array.from({ length: count }).map((_, i) => (
        <div key={i} className="space-y-2">
          <Skeleton className="w-full rounded-xl" style={{ aspectRatio: "2 / 3" }} />
          <Skeleton className="h-3 w-4/5 rounded" />
          <Skeleton className="h-2.5 w-2/5 rounded" />
        </div>
      ))}
    </div>
  );
}

/** Wide 16:9 cards with a title/subtitle pair — trailers, episodes, stream results. */
export function CardGridSkeleton({ count = 10, className }: { count?: number; className?: string }) {
  return (
    <div
      className={cn("grid grid-cols-2 gap-4 sm:grid-cols-3 md:grid-cols-4 lg:grid-cols-5", className)}
      aria-busy="true"
      aria-label="Loading"
    >
      {Array.from({ length: count }).map((_, i) => (
        <div key={i} className="overflow-hidden rounded-xl border border-pitflix-card/40 bg-pitflix-surface/30">
          <Skeleton className="aspect-video w-full rounded-none" />
          <div className="space-y-2 p-2">
            <Skeleton className="h-3.5 w-11/12 rounded" />
            <Skeleton className="h-2.5 w-2/3 rounded" />
          </div>
        </div>
      ))}
    </div>
  );
}

/** Stacked full-width rows — duplicates, unmatched, episode lists. */
export function RowListSkeleton({ count = 8, className }: { count?: number; className?: string }) {
  return (
    <div className={cn("space-y-2", className)} aria-busy="true" aria-label="Loading">
      {Array.from({ length: count }).map((_, i) => (
        <div
          key={i}
          className="flex items-center gap-3 rounded-xl border border-pitflix-card/40 bg-pitflix-surface/30 p-3"
        >
          <Skeleton className="h-12 w-20 shrink-0 rounded-lg" />
          <div className="min-w-0 flex-1 space-y-2">
            <Skeleton className="h-3.5 w-1/3 rounded" />
            <Skeleton className="h-2.5 w-1/2 rounded" />
          </div>
          <Skeleton className="h-8 w-20 shrink-0 rounded-lg" />
        </div>
      ))}
    </div>
  );
}

/**
 * Movie/show detail placeholder: backdrop hero with the poster and title block pinned bottom-left,
 * then the action row and content below — matching the real hero's geometry so the page doesn't
 * jump when data lands.
 */
export function DetailSkeleton() {
  return (
    <div className="w-full pb-12" aria-busy="true" aria-label="Loading">
      <div className="relative h-[420px] w-full overflow-hidden rounded-b-2xl">
        <Skeleton className="absolute inset-0 rounded-none" />
        <div className="absolute bottom-0 left-0 right-0 flex items-end gap-9 px-12 pb-9">
          <Skeleton className="h-[228px] w-[152px] shrink-0 rounded-[9px]" />
          <div className="min-w-0 flex-1 space-y-3 pb-1">
            <Skeleton className="h-9 w-1/2 rounded-lg" />
            <Skeleton className="h-3.5 w-64 rounded" />
            <Skeleton className="h-3 w-full max-w-2xl rounded" />
            <Skeleton className="h-3 w-4/5 max-w-xl rounded" />
          </div>
        </div>
      </div>

      <div className="mt-6 flex flex-wrap gap-3 px-12">
        <Skeleton className="h-10 w-32 rounded-xl" />
        <Skeleton className="h-10 w-28 rounded-xl" />
        <Skeleton className="h-10 w-10 rounded-xl" />
        <Skeleton className="h-10 w-10 rounded-xl" />
      </div>

      <div className="mt-8 space-y-3 px-12">
        <Skeleton className="h-4 w-40 rounded" />
        <RowListSkeleton count={5} />
      </div>
    </div>
  );
}

/**
 * Whole-page placeholder used while a route's code is still loading, when we don't yet know what
 * the page contains: a title bar, a row of controls, then a poster grid. Close enough to most
 * pages that the layout doesn't lurch when the real content takes over.
 */
export function PageSkeleton() {
  return (
    <div className="w-full space-y-5 pb-12">
      <Skeleton className="h-7 w-44 rounded-lg" />
      <div className="flex flex-wrap gap-2">
        <Skeleton className="h-8 w-24 rounded-full" />
        <Skeleton className="h-8 w-20 rounded-full" />
        <Skeleton className="h-8 w-28 rounded-full" />
      </div>
      <PosterGridSkeleton count={18} />
    </div>
  );
}
