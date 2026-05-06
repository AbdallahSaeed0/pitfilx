/** Skeleton tiles matching Movies/Series poster grid layout (first paint without spinner flash). */
export function LibraryGridSkeleton() {
  return (
    <div className="grid grid-cols-2 gap-x-6 gap-y-10 sm:grid-cols-3 md:grid-cols-4 lg:grid-cols-5 xl:grid-cols-6 2xl:grid-cols-7">
      {Array.from({ length: 35 }).map((_, i) => (
        <div
          key={i}
          className="mx-auto w-[160px] animate-pulse rounded-xl bg-gradient-to-b from-pitflix-card to-pitflix-surface/80 sm:w-[160px]"
          style={{ aspectRatio: "2 / 3" }}
        />
      ))}
    </div>
  );
}
