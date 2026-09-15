import { useInfiniteQuery } from "@tanstack/react-query";
import { ArrowLeft, Loader2 } from "lucide-react";
import { PosterGridSkeleton } from "../components/ui/Skeleton";
import { useLocation, useNavigate } from "react-router-dom";
import { getStreamStudio, type StreamStudioItem } from "../api/stream";
import { MediaImage } from "../components/ui/MediaImage";
import { lookupImdbRating, useImdbRatingsMap } from "../hooks/useImdbRatingsMap";
import type { StreamingDetailsLocationState } from "./StreamingDetailsPage";

export type StreamStudioLocationState = {
  studioId: number;
  kind: "network" | "company";
  name?: string;
  logoUrl?: string | null;
};

/** How many TMDB pages (20 items each) "Load more" is allowed to pull in total. */
const MAX_PAGES = 50;

function StudioItemCard({
  item,
  imdbRating,
  onOpen,
}: {
  item: StreamStudioItem;
  imdbRating: number | null;
  onOpen: (item: StreamStudioItem) => void;
}) {
  const hasImdb = imdbRating != null && imdbRating > 0;
  const displayRating = imdbRating ?? item.voteAverage;
  return (
    <button
      type="button"
      onClick={() => onOpen(item)}
      className="group flex flex-col overflow-hidden rounded-xl border border-pitflix-card/60 bg-pitflix-surface/60 text-left shadow transition hover:border-pitflix-primary/50"
    >
      <div className="aspect-[2/3] w-full overflow-hidden bg-pitflix-card/40">
        <MediaImage
          src={item.posterUrl}
          alt={item.title}
          className="h-full w-full object-cover transition-opacity group-hover:opacity-80"
          fallbackText={item.mediaType === "Movie" ? "Movie" : "TV"}
        />
      </div>
      <div className="flex flex-col gap-1 p-3">
        <p className="line-clamp-2 text-sm font-semibold leading-snug text-white">{item.title}</p>
        <div className="flex items-center gap-2 text-xs text-pitflix-muted">
          {item.year && <span>{item.year}</span>}
          {displayRating > 0 && (
            <span className="flex items-center gap-1">
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
      </div>
    </button>
  );
}

export function StreamStudioPage() {
  const navigate = useNavigate();
  const location = useLocation();
  const state = location.state as StreamStudioLocationState | null;
  const studioId = state?.studioId ?? 0;
  const kind = state?.kind ?? "company";

  const query = useInfiniteQuery({
    queryKey: ["stream-studio", studioId, kind],
    queryFn: ({ pageParam }) => getStreamStudio(studioId, kind, pageParam),
    enabled: studioId > 0,
    staleTime: 10 * 60_000,
    initialPageParam: 1,
    getNextPageParam: (lastPage, allPages) =>
      lastPage.hasMore && allPages.length < MAX_PAGES ? allPages.length + 1 : undefined,
  });

  const firstPage = query.data?.pages[0];
  const name = firstPage?.name ?? state?.name ?? null;
  const logoUrl = firstPage?.logoUrl ?? state?.logoUrl ?? null;
  const items = query.data?.pages.flatMap((p) => p.items ?? []) ?? [];
  const imdbRatingsMap = useImdbRatingsMap(
    items.map((i) => ({ tmdbId: i.id, mediaType: i.mediaType })),
  );

  function openItem(item: StreamStudioItem) {
    const detailState: StreamingDetailsLocationState = {
      tmdbId: item.id,
      mediaType: item.mediaType,
      title: item.title,
      posterUrl: item.posterUrl,
      year: item.year,
    };
    navigate("/stream-details", { state: detailState });
  }

  if (studioId <= 0) {
    return <div className="py-24 text-center text-pitflix-muted">No studio specified.</div>;
  }

  return (
    <div className="pb-12">
      <button
        type="button"
        onClick={() => navigate(-1)}
        className="mb-4 inline-flex items-center gap-1 text-sm text-pitflix-muted hover:text-white"
      >
        <ArrowLeft className="h-4 w-4" />
        Back
      </button>

      <div className="mb-6 flex items-center gap-4">
        {logoUrl ? (
          <div className="flex h-16 w-28 shrink-0 items-center justify-center rounded-lg bg-white/95 p-2">
            <img src={logoUrl} alt={name ?? ""} className="max-h-full max-w-full object-contain" />
          </div>
        ) : null}
        <div>
          <p className="mb-1 text-xs font-semibold uppercase tracking-widest text-pitflix-primary">
            {kind === "network" ? "Network" : "Production Company"}
          </p>
          <h1 className="text-3xl font-bold text-white">{name ?? "…"}</h1>
          {!query.isLoading && (
            <p className="mt-2 text-sm text-pitflix-subtle">
              {items.length}
              {query.hasNextPage ? "+" : ""} title{items.length === 1 ? "" : "s"}
            </p>
          )}
        </div>
      </div>

      {query.isLoading && <PosterGridSkeleton />}

      {!query.isLoading && items.length === 0 && (
        <div className="py-16 text-center">
          <p className="text-lg font-semibold text-pitflix-muted">Nothing found</p>
          <p className="mt-1 text-sm text-pitflix-subtle">
            TMDB doesn't have popular titles listed for this {kind === "network" ? "network" : "studio"}.
          </p>
        </div>
      )}

      {!query.isLoading && items.length > 0 && (
        <>
          <div className="grid grid-cols-2 gap-4 sm:grid-cols-3 md:grid-cols-4 lg:grid-cols-5 xl:grid-cols-6">
            {items.map((item) => (
              <StudioItemCard
                key={`${item.mediaType}-${item.id}`}
                item={item}
                imdbRating={lookupImdbRating(imdbRatingsMap, item.id, item.mediaType)}
                onOpen={openItem}
              />
            ))}
          </div>

          {query.hasNextPage && (
            <div className="mt-8 flex justify-center">
              <button
                type="button"
                onClick={() => void query.fetchNextPage()}
                disabled={query.isFetchingNextPage}
                className="flex items-center gap-2 rounded-lg border border-pitflix-card bg-pitflix-surface px-6 py-2.5 text-sm font-semibold text-white transition hover:border-pitflix-primary/50 hover:bg-pitflix-primary/10 disabled:cursor-not-allowed disabled:opacity-60"
              >
                {query.isFetchingNextPage ? (
                  <>
                    <Loader2 className="h-4 w-4 animate-spin" />
                    Loading…
                  </>
                ) : (
                  "Load More"
                )}
              </button>
            </div>
          )}
        </>
      )}
    </div>
  );
}
