import { useInfiniteQuery } from "@tanstack/react-query";
import { ArrowLeft, Loader2 } from "lucide-react";
import { PosterGridSkeleton } from "../components/ui/Skeleton";
import { useEffect, useRef, useState } from "react";
import { useLocation, useNavigate } from "react-router-dom";
import { getStreamDiscoverPage, type StreamDiscoverItem, type StreamDiscoverSort } from "../api/stream";
import { MediaImage } from "../components/ui/MediaImage";
import { lookupImdbRating, useImdbRatingsMap } from "../hooks/useImdbRatingsMap";
import { cn } from "../utils/cn";
import type { StreamingDetailsLocationState } from "./StreamingDetailsPage";

export type StreamGenreLocationState = {
  genreId: number;
  genreName: string;
};

/** How many TMDB pages (20 items each) "Load more" is allowed to pull in total. */
const MAX_PAGES = 50;

const SORT_TABS: { id: StreamDiscoverSort; label: string }[] = [
  { id: "popularity", label: "Most Popular" },
  { id: "rating", label: "Top Rated" },
  { id: "newest", label: "Newest" },
];

function GenreItemCard({
  item,
  imdbRating,
  onOpen,
}: {
  item: StreamDiscoverItem;
  imdbRating: number | null;
  onOpen: (item: StreamDiscoverItem) => void;
}) {
  const hasImdb = imdbRating != null && imdbRating > 0;
  const displayRating = imdbRating ?? item.voteAverage;
  return (
    <button
      type="button"
      onClick={() => onOpen(item)}
      className="group flex flex-col overflow-hidden rounded-xl border border-pitflix-card/60 bg-pitflix-surface/60 text-left shadow transition hover:-translate-y-0.5 hover:border-pitflix-primary/50 hover:shadow-lg hover:shadow-black/40"
    >
      <div className="relative aspect-[2/3] w-full overflow-hidden bg-pitflix-card/40">
        <MediaImage
          src={item.posterUrl}
          alt={item.title}
          className="h-full w-full object-cover transition-transform duration-300 group-hover:scale-105"
          fallbackText={item.mediaType === "Movie" ? "Movie" : "TV"}
        />
        <span className="absolute left-1.5 top-1.5 rounded bg-black/65 px-1.5 py-0.5 text-[9px] font-bold uppercase text-white">
          {item.mediaType === "Movie" ? "Movie" : "TV"}
        </span>
        {displayRating > 0 && (
          <span className="absolute right-1.5 top-1.5 flex items-center gap-1 rounded bg-black/70 px-1.5 py-0.5 text-[9px] font-semibold text-yellow-400">
            {hasImdb ? (
              <span className="rounded-[2px] bg-yellow-400 px-1 text-[8px] font-extrabold text-black">
                IMDb
              </span>
            ) : (
              "★"
            )}
            {displayRating.toFixed(1)}
          </span>
        )}
      </div>
      <div className="flex flex-col gap-1 p-3">
        <p className="line-clamp-2 text-sm font-semibold leading-snug text-white">{item.title}</p>
        {item.year && <p className="text-xs text-pitflix-muted">{item.year}</p>}
      </div>
    </button>
  );
}

export function StreamGenrePage() {
  const navigate = useNavigate();
  const location = useLocation();
  const state = location.state as StreamGenreLocationState | null;
  const genreId = state?.genreId ?? 0;
  const genreName = state?.genreName ?? "";

  const [sort, setSort] = useState<StreamDiscoverSort>("popularity");

  const query = useInfiniteQuery({
    queryKey: ["stream-genre-browse", genreId, sort],
    queryFn: ({ pageParam }) => getStreamDiscoverPage(`genre-movie-${genreId}`, { page: pageParam, sort }),
    enabled: genreId > 0,
    staleTime: 10 * 60_000,
    initialPageParam: 1,
    getNextPageParam: (lastPage, allPages) =>
      lastPage.hasMore && allPages.length < MAX_PAGES ? allPages.length + 1 : undefined,
  });

  const items = query.data?.pages.flatMap((p) => p.items ?? []) ?? [];
  const heroBackdrop = items.find((i) => i?.backdropUrl)?.backdropUrl ?? null;
  const imdbRatingsMap = useImdbRatingsMap(
    items.map((i) => ({ tmdbId: i.id, mediaType: i.mediaType })),
  );

  const sentinelRef = useRef<HTMLDivElement | null>(null);

  useEffect(() => {
    const sentinel = sentinelRef.current;
    if (!sentinel || !query.hasNextPage) return;

    const observer = new IntersectionObserver(
      (entries) => {
        if (entries[0]?.isIntersecting && !query.isFetchingNextPage) {
          void query.fetchNextPage();
        }
      },
      { rootMargin: "600px" },
    );
    observer.observe(sentinel);
    return () => observer.disconnect();
  }, [query.hasNextPage, query.isFetchingNextPage, query.fetchNextPage]);

  function openItem(item: StreamDiscoverItem) {
    const detailState: StreamingDetailsLocationState = {
      tmdbId: item.id,
      mediaType: item.mediaType,
      title: item.title,
      posterUrl: item.posterUrl,
      year: item.year,
    };
    navigate("/stream-details", { state: detailState });
  }

  if (genreId <= 0) {
    return <div className="py-24 text-center text-pitflix-muted">No category specified.</div>;
  }

  return (
    <div className="pb-12">
      {/* Backdrop hero */}
      <div className="relative -mx-4 -mt-12 mb-8 h-[220px] overflow-hidden sm:-mx-6 md:-mx-8 md:h-[280px] rounded-2xl">
        {heroBackdrop ? (
          <img
            src={heroBackdrop}
            alt=""
            className="absolute inset-0 h-full w-full object-cover object-center opacity-50"
          />
        ) : (
          <div className="absolute inset-0 bg-gradient-to-br from-pitflix-primary/30 to-pitflix-card" />
        )}
        <div className="absolute inset-0 bg-gradient-to-t from-pitflix-bg via-pitflix-bg/60 to-transparent" />
        <div className="absolute inset-0 bg-gradient-to-r from-pitflix-bg/80 via-transparent to-transparent" />

        <button
          type="button"
          onClick={() => navigate(-1)}
          className="absolute left-6 top-6 z-20 flex items-center gap-1.5 rounded-lg border border-white/10 bg-black/[0.32] px-[18px] py-2 text-[13px] font-medium text-white shadow-lg backdrop-blur-xl transition hover:bg-black/55"
        >
          <ArrowLeft className="h-4 w-4" />
          Back
        </button>

        <div className="absolute bottom-0 left-0 p-6">
          <p className="mb-1 text-xs font-semibold uppercase tracking-widest text-pitflix-primary">Category</p>
          <h1 className="text-4xl font-bold tracking-tight text-white drop-shadow-lg md:text-5xl">
            {genreName || "Movies"}
          </h1>
          {!query.isLoading && (
            <p className="mt-1 text-sm text-pitflix-muted">
              {items.length}+ title{items.length === 1 ? "" : "s"}
            </p>
          )}
        </div>
      </div>

      {/* Sort tabs */}
      <div className="mb-6 flex gap-1 rounded-xl border border-white/10 bg-pitflix-surface/60 p-1 w-fit">
        {SORT_TABS.map((t) => (
          <button
            key={t.id}
            type="button"
            onClick={() => setSort(t.id)}
            className={cn(
              "rounded-lg px-4 py-2 text-sm font-semibold transition-all",
              sort === t.id
                ? "bg-pitflix-primary text-white shadow-md shadow-pitflix-primary/30"
                : "text-pitflix-muted hover:text-white",
            )}
          >
            {t.label}
          </button>
        ))}
      </div>

      {query.isLoading && <PosterGridSkeleton />}

      {!query.isLoading && items.length === 0 && (
        <div className="py-16 text-center">
          <p className="text-lg font-semibold text-pitflix-muted">Nothing found</p>
          <p className="mt-1 text-sm text-pitflix-subtle">No titles available for this category right now.</p>
        </div>
      )}

      {!query.isLoading && items.length > 0 && (
        <>
          <div className="grid grid-cols-2 gap-4 sm:grid-cols-3 md:grid-cols-4 lg:grid-cols-5 xl:grid-cols-6">
            {items.map((item) => (
              <GenreItemCard
                key={`${item.mediaType}-${item.id}`}
                item={item}
                imdbRating={lookupImdbRating(imdbRatingsMap, item.id, item.mediaType)}
                onOpen={openItem}
              />
            ))}
          </div>

          {query.hasNextPage && (
            <div ref={sentinelRef} className="mt-8 flex justify-center">
              {query.isFetchingNextPage && (
                <div className="flex items-center gap-2 text-sm font-semibold text-pitflix-muted">
                  <Loader2 className="h-4 w-4 animate-spin" />
                  Loading…
                </div>
              )}
            </div>
          )}
        </>
      )}
    </div>
  );
}
