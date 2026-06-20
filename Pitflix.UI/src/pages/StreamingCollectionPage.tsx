import { useQuery } from "@tanstack/react-query";
import { useLocation, useNavigate } from "react-router-dom";
import { getStreamCollection } from "../api/browse";
import { MediaImage } from "../components/ui/MediaImage";
import { Spinner } from "../components/ui/Spinner";
import type { StreamingDetailsLocationState } from "./StreamingDetailsPage";

export type StreamingCollectionLocationState = {
  collectionId: number;
  collectionName?: string;
};

function CollectionPartCard({
  part,
  onPlay,
}: {
  part: { tmdbId: number; title: string; posterUrl: string | null; year: string | null; voteAverage: number };
  onPlay: (tmdbId: number, title: string, posterUrl: string | null, year: string | null) => void;
}) {
  return (
    <button
      type="button"
      onClick={() => onPlay(part.tmdbId, part.title, part.posterUrl, part.year)}
      className="group flex flex-col overflow-hidden rounded-xl border border-pitflix-card/60 bg-pitflix-surface/60 text-left shadow transition hover:border-pitflix-primary/50"
    >
      <div className="aspect-[2/3] w-full overflow-hidden bg-pitflix-card/40">
        <MediaImage
          src={part.posterUrl}
          alt={part.title}
          className="h-full w-full object-cover transition-opacity group-hover:opacity-80"
          fallbackText={part.title}
        />
      </div>
      <div className="flex flex-col gap-1 p-3">
        <p className="line-clamp-2 text-sm font-semibold leading-snug text-white">{part.title}</p>
        <div className="flex items-center gap-2 text-xs text-pitflix-muted">
          {part.year && <span>{part.year}</span>}
          {part.voteAverage > 0 && <span>★ {part.voteAverage.toFixed(1)}</span>}
        </div>
        <span className="mt-1 inline-flex items-center gap-1 text-xs font-medium text-pitflix-primary opacity-0 transition-opacity group-hover:opacity-100">
          ▶ Watch
        </span>
      </div>
    </button>
  );
}

export function StreamingCollectionPage() {
  const navigate = useNavigate();
  const location = useLocation();
  const state = location.state as StreamingCollectionLocationState | null;
  const collectionId = state?.collectionId ?? 0;

  const { data, isLoading } = useQuery({
    queryKey: ["stream-collection", collectionId],
    queryFn: () => getStreamCollection(collectionId),
    enabled: collectionId > 0,
    staleTime: 10 * 60_000,
  });

  function handlePlayPart(
    tmdbId: number,
    title: string,
    posterUrl: string | null,
    _year: string | null,
  ) {
    const detailState: StreamingDetailsLocationState = {
      tmdbId,
      mediaType: "Movie",
      title,
      posterUrl,
    };
    navigate("/stream-details", { state: detailState });
  }

  if (collectionId <= 0) {
    return (
      <div className="py-24 text-center text-pitflix-muted">
        No collection specified.
      </div>
    );
  }

  return (
    <div className="pb-12">
      {/* Backdrop hero */}
      {data?.backdropUrl && (
        <div className="relative -mx-4 mb-8 h-[220px] overflow-hidden rounded-2xl sm:-mx-6 md:-mx-8 md:h-[260px]">
          <img
            src={data.backdropUrl}
            alt=""
            className="absolute inset-0 h-full w-full object-cover object-center opacity-40"
          />
          <div className="absolute inset-0 bg-gradient-to-t from-pitflix-bg via-pitflix-bg/60 to-transparent" />
          <div className="absolute inset-0 bg-gradient-to-r from-pitflix-bg/80 via-transparent to-transparent" />
        </div>
      )}

      <button
        type="button"
        onClick={() => navigate(-1)}
        className="mb-4 inline-flex items-center gap-1 text-sm text-pitflix-muted hover:text-white"
      >
        ← Back
      </button>

      {isLoading && (
        <div className="flex justify-center py-24">
          <Spinner />
        </div>
      )}

      {!isLoading && data && (
        <>
          <div className="mb-6 flex items-start gap-4">
            {data.posterUrl && (
              <img
                src={data.posterUrl}
                alt={data.name}
                className="hidden w-24 shrink-0 rounded-lg shadow-xl sm:block"
              />
            )}
            <div>
              <p className="mb-1 text-xs font-semibold uppercase tracking-widest text-pitflix-primary">
                Collection
              </p>
              <h1 className="text-3xl font-bold text-white">{data.name}</h1>
              {data.overview && (
                <p className="mt-2 max-w-2xl text-sm text-pitflix-muted">{data.overview}</p>
              )}
              <p className="mt-2 text-sm text-pitflix-subtle">
                {data.parts.length} film{data.parts.length === 1 ? "" : "s"}
              </p>
            </div>
          </div>

          <div className="grid grid-cols-2 gap-4 sm:grid-cols-3 md:grid-cols-4 lg:grid-cols-5 xl:grid-cols-6">
            {data.parts.map((part) => (
              <CollectionPartCard key={part.tmdbId} part={part} onPlay={handlePlayPart} />
            ))}
          </div>
        </>
      )}
    </div>
  );
}
