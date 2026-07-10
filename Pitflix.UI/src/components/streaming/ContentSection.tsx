import { useQuery } from "@tanstack/react-query";
import { getWatchedTmdbIds } from "../../api/history";
import { getStreamDiscover, type DiscoverCategory } from "../../api/stream";
import { HorizontalScrollRow } from "../ui/HorizontalScrollRow";
import { StreamMediaCard } from "./StreamMediaCard";

type Props = {
  title: string;
  category: DiscoverCategory;
};

const SKELETON_COUNT = 7;
const EMPTY_IDS: number[] = [];

export function ContentSection({ title, category }: Props) {
  const { data, isLoading } = useQuery({
    queryKey: ["stream-discover", category],
    queryFn: () => getStreamDiscover(category),
    staleTime: 10 * 60 * 1000,
  });
  const { data: watchedMovieIds } = useQuery({
    queryKey: ["watched-tmdb-ids", "Movie"],
    queryFn: () => getWatchedTmdbIds("Movie"),
    staleTime: 5 * 60 * 1000,
  });
  const { data: watchedSeriesIds } = useQuery({
    queryKey: ["watched-tmdb-ids", "Series"],
    queryFn: () => getWatchedTmdbIds("Series"),
    staleTime: 5 * 60 * 1000,
  });
  const watchedMovieSet = new Set(watchedMovieIds ?? EMPTY_IDS);
  const watchedSeriesSet = new Set(watchedSeriesIds ?? EMPTY_IDS);

  return (
    <div className="mb-8">
      <h3 className="mb-3 text-xs font-bold uppercase tracking-widest text-white/70">{title}</h3>

      {isLoading ? (
        <div className="flex gap-3">
          {Array.from({ length: SKELETON_COUNT }).map((_, i) => (
            <div
              key={i}
              className="h-[213px] w-[140px] shrink-0 animate-pulse rounded-xl bg-pitflix-card"
            />
          ))}
        </div>
      ) : !data?.length ? null : (
        <HorizontalScrollRow hideHeader className="mb-0" contentClassName="gap-3 pb-1">
          {data.map((item) => (
            <StreamMediaCard
              key={`${item.mediaType}-${item.id}`}
              item={item}
              isWatched={
                item.mediaType === "Movie" ? watchedMovieSet.has(item.id) : watchedSeriesSet.has(item.id)
              }
            />
          ))}
        </HorizontalScrollRow>
      )}
    </div>
  );
}
