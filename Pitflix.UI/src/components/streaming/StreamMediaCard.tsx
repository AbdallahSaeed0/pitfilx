import { Play } from "lucide-react";
import { useNavigate } from "react-router-dom";
import type { StreamDiscoverItem } from "../../api/stream";
import type { StreamingDetailsLocationState } from "../../pages/StreamingDetailsPage";
import { MediaImage } from "../ui/MediaImage";
import { cn } from "../../utils/cn";

type Props = {
  item: StreamDiscoverItem;
  className?: string;
  returnSeedQuery?: string;
  returnSeedKind?: "Both" | "Movie" | "Series";
};

export function StreamMediaCard({ item, className, returnSeedQuery, returnSeedKind }: Props) {
  const navigate = useNavigate();

  const goToDetails = (autoPlay = false) => {
    const state: StreamingDetailsLocationState = {
      tmdbId: item.id,
      mediaType: item.mediaType,
      title: item.title,
      posterUrl: item.posterUrl,
      year: item.year,
      ...(autoPlay ? { autoPlay: true as const } : {}),
      ...(returnSeedQuery ? { returnSeedQuery } : {}),
      ...(returnSeedKind ? { returnSeedKind } : {}),
    };
    navigate("/stream-details", { state });
  };

  return (
    <div
      className={cn("group relative shrink-0 w-[140px] cursor-pointer", className)}
      onClick={() => goToDetails(false)}
    >
      <div className="relative overflow-hidden rounded-xl bg-pitflix-card aspect-[2/3] transition-[transform,box-shadow] duration-200 group-hover:scale-[1.05] group-hover:shadow-2xl group-hover:shadow-black/60">
        <MediaImage
          src={item.posterUrl}
          alt={item.title}
          className="h-full w-full"
          fallbackText={item.title.slice(0, 2)}
        />

        {/* Type badge */}
        <span className="absolute left-1.5 top-1.5 rounded bg-black/70 px-1.5 py-0.5 text-[9px] font-bold uppercase tracking-wide text-white">
          {item.mediaType === "Movie" ? "Movie" : "TV"}
        </span>

        {/* Rating badge */}
        {item.voteAverage > 0 ? (
          <span className="absolute right-1.5 top-1.5 rounded bg-black/70 px-1.5 py-0.5 text-[9px] font-semibold text-yellow-400">
            ★ {item.voteAverage.toFixed(1)}
          </span>
        ) : null}

        {/* Hover overlay with play button */}
        <div className="absolute inset-0 flex items-center justify-center bg-black/0 transition-all duration-200 group-hover:bg-black/40">
          <button
            type="button"
            onClick={(e) => {
              e.stopPropagation();
              goToDetails(true);
            }}
            className="flex h-10 w-10 items-center justify-center rounded-full bg-pitflix-primary opacity-0 transition-opacity duration-200 group-hover:opacity-100 hover:bg-pitflix-light"
          >
            <Play className="h-4 w-4 fill-white text-white" />
          </button>
        </div>
      </div>

      <p className="mt-1.5 truncate text-xs font-medium text-white">{item.title}</p>
      {item.year ? <p className="truncate text-[10px] text-pitflix-subtle">{item.year}</p> : null}
    </div>
  );
}
