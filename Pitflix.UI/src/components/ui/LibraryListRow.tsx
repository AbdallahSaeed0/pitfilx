import { Heart } from "lucide-react";
import { useNavigate } from "react-router-dom";
import type { MediaCard } from "../../types/media";
import { cn } from "../../utils/cn";
import { formatRating, formatYear } from "../../utils/format";
import { toPosterSrc } from "../../utils/posterSrc";
import { MediaImage } from "./MediaImage";

type Props = {
  item: MediaCard;
  mediaType: "Movie" | "Series";
  isFavorite?: boolean;
  selectionMode?: boolean;
  selected?: boolean;
  onToggleSelect?: () => void;
};

export function LibraryListRow({
  item,
  mediaType,
  isFavorite = false,
  selectionMode = false,
  selected = false,
  onToggleSelect,
}: Props) {
  const navigate = useNavigate();
  const primary = item.selectedPosterPath || item.posterLocalPath;
  const remote = item.posterRemoteUrl;
  const src = toPosterSrc((primary ?? remote) ?? undefined);

  const detailPath = mediaType === "Movie" ? `/movie/${item.id}` : `/series/${item.id}`;

  const handleClick = () => {
    if (selectionMode && onToggleSelect) onToggleSelect();
    else navigate(detailPath);
  };

  const watchBadge =
    item.watchStatus === "Completed"
      ? { label: "Watched", cls: "bg-green-600/20 text-green-400" }
      : item.watchStatus === "Watching"
        ? { label: "Watching", cls: "bg-pitflix-primary/20 text-pitflix-primary" }
        : null;

  return (
    <div
      role="button"
      tabIndex={0}
      onClick={handleClick}
      onKeyDown={(e) => {
        if (e.key !== "Enter" && e.key !== " ") return;
        e.preventDefault();
        handleClick();
      }}
      className={cn(
        "group flex cursor-pointer items-center gap-4 rounded-xl px-3 py-2.5 transition-colors",
        "hover:bg-pitflix-card/70",
        selected && "bg-pitflix-primary/10 ring-1 ring-pitflix-primary/40",
      )}
    >
      {/* Selection checkbox */}
      {selectionMode && onToggleSelect ? (
        <label
          className="shrink-0"
          onClick={(e) => e.stopPropagation()}
          onPointerDown={(e) => e.stopPropagation()}
        >
          <input
            type="checkbox"
            checked={selected}
            onChange={onToggleSelect}
            className="h-4 w-4 rounded border-2 border-white/50 bg-pitflix-bg accent-pitflix-primary"
          />
        </label>
      ) : null}

      {/* Poster cover */}
      <div className="h-24 w-16 shrink-0 overflow-hidden rounded-lg bg-pitflix-card shadow-md ring-1 ring-white/10">
        <MediaImage
          src={src}
          alt={item.title}
          className="h-full w-full object-cover"
          fallbackText={item.title.slice(0, 2).toUpperCase()}
          loading="lazy"
        />
      </div>

      {/* Title + meta */}
      <div className="min-w-0 flex-1">
        <p className="truncate text-sm font-semibold text-white group-hover:text-pitflix-primary">
          {item.title}
        </p>
        <p className="mt-0.5 truncate text-xs text-pitflix-subtle">
          {formatYear(item.year)}
          {item.voteAverage ? ` · ★ ${formatRating(item.voteAverage)}` : ""}
          {item.genresCsv ? ` · ${item.genresCsv.split(",")[0]?.trim()}` : ""}
        </p>
      </div>

      {/* Right-side badges */}
      <div className="flex shrink-0 items-center gap-2">
        {item.isArabic ? (
          <span className="rounded-md bg-pitflix-card px-2 py-0.5 text-[10px] font-medium text-pitflix-muted">
            AR
          </span>
        ) : null}
        {watchBadge ? (
          <span className={cn("rounded-md px-2 py-0.5 text-[10px] font-semibold", watchBadge.cls)}>
            {watchBadge.label}
          </span>
        ) : null}
        {isFavorite ? (
          <Heart className="h-3.5 w-3.5 fill-red-500 text-red-500" strokeWidth={2} />
        ) : null}
      </div>
    </div>
  );
}
