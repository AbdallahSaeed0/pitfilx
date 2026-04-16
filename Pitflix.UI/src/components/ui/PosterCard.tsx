import { useEffect, useRef, useState } from "react";
import { AnimatePresence, motion } from "framer-motion";
import { Heart } from "lucide-react";
import { useNavigate } from "react-router-dom";
import type { MediaCard } from "../../types/media";
import { cn } from "../../utils/cn";
import { formatRating, formatYear } from "../../utils/format";
import { toPosterSrc } from "../../utils/posterSrc";
import { usePlayback } from "../../hooks/usePlayback";
import { MediaImage } from "./MediaImage";

export type PosterCardMetaHints = {
  showTitle?: boolean;
  showDetailsLine?: boolean;
  showPosterRatingOnHover?: boolean;
};

export type PosterCardProps = {
  item: MediaCard;
  mediaType: "Movie" | "Series";
  className?: string;
  /** Show filled heart when this title is in the Favorites list. */
  isFavorite?: boolean;
  /** When set, shows a checkbox to build multi-select lists (e.g. mark completed). */
  selectionMode?: boolean;
  selected?: boolean;
  onToggleSelect?: () => void;
  /** Optional rank badge (e.g. ranked-row layouts). */
  rank?: number;
  /** `compact` tightens width/typography for dense rows. */
  size?: "md" | "sm";
  metaHints?: PosterCardMetaHints;
};

export function PosterCard({
  item,
  mediaType,
  className,
  isFavorite = false,
  selectionMode = false,
  selected = false,
  onToggleSelect,
  rank,
  size = "md",
  metaHints,
}: PosterCardProps) {
  const navigate = useNavigate();
  const { play } = usePlayback();
  const primary = item.selectedPosterPath || item.posterLocalPath;
  const remote = item.posterRemoteUrl;
  const src = toPosterSrc((primary ?? remote) ?? undefined);
  const fallbackSrc =
    primary && remote && remote !== primary ? toPosterSrc(remote) : undefined;
  const backdropSrc = toPosterSrc(item.selectedBackdropPath || item.backdropLocalPath || undefined);
  const playPath = item.mediaFilePath || item.filePath;

  const [hovered, setHovered] = useState(false);
  const [position, setPosition] = useState<"above" | "below">("above");
  const cardRef = useRef<HTMLDivElement>(null);
  const timerRef = useRef<ReturnType<typeof setTimeout> | null>(null);

  useEffect(
    () => () => {
      if (timerRef.current) clearTimeout(timerRef.current);
    },
    [],
  );

  const handleMouseEnter = () => {
    timerRef.current = setTimeout(() => {
      if (cardRef.current) {
        const rect = cardRef.current.getBoundingClientRect();
        // Pick the direction that leaves more room for the popover.
        // This prevents the hover card from going outside the viewport near top/bottom edges.
        const estimatedPopoverHeight = 260;
        const canPlaceBelow = rect.bottom + 8 + estimatedPopoverHeight < window.innerHeight;
        setPosition(canPlaceBelow ? "below" : "above");
      }
      setHovered(true);
    }, 500);
  };

  const handleMouseLeave = () => {
    if (timerRef.current) {
      clearTimeout(timerRef.current);
      timerRef.current = null;
    }
    setHovered(false);
  };

  const detailPath = mediaType === "Movie" ? `/movie/${item.id}` : `/series/${item.id}`;
  const rating = item.voteAverage ?? 0;
  const yearLabel = formatYear(item.year);
  const genres = item.genresCsv?.split(",").map((g) => g.trim()).filter(Boolean) ?? [];

  const openDetail = () => navigate(detailPath);

  const handleMainActivate = () => {
    if (selectionMode && onToggleSelect) onToggleSelect();
    else openDetail();
  };

  const showTitle = metaHints?.showTitle !== false;
  const showDetailsLine = metaHints?.showDetailsLine !== false;
  const showPosterRatingOnHover = metaHints?.showPosterRatingOnHover !== false;

  return (
    <div
      ref={cardRef}
      className={cn(
        "group relative shrink-0 cursor-pointer text-left",
        size === "sm" ? "w-[136px]" : "w-[160px]",
        "rounded-xl transition-[transform,filter] duration-200 hover:-translate-y-1",
        // Popover must paint above cards in following grid rows (stacking order).
        hovered ? "z-[400]" : "z-0",
        className,
      )}
      onMouseEnter={handleMouseEnter}
      onMouseLeave={handleMouseLeave}
    >
      <div
        role="button"
        tabIndex={0}
        onClick={handleMainActivate}
        onKeyDown={(e) => {
          if (e.key !== "Enter" && e.key !== " ") return;
          e.preventDefault();
          handleMainActivate();
        }}
        className="block w-full rounded-lg border-0 bg-transparent p-0 text-left outline-none ring-pitflix-primary focus-visible:ring-2"
      >
        <div
          className={cn(
            "relative overflow-hidden rounded-xl bg-pitflix-card",
            "ring-2 ring-transparent ring-offset-2 ring-offset-pitflix-bg",
            "transition-[transform,box-shadow,ring-color] duration-200",
            "group-hover:scale-[1.04] group-hover:shadow-2xl group-hover:shadow-black/55",
            "group-hover:ring-pitflix-primary/60",
          )}
        >
          {rank != null && rank > 0 ? (
            <div className="pointer-events-none absolute left-2 top-2 z-30 flex h-8 w-8 items-center justify-center rounded-full bg-pitflix-primary text-sm font-bold text-white shadow-lg shadow-black/40 ring-2 ring-white/20">
              {rank}
            </div>
          ) : null}
          {selectionMode && onToggleSelect ? (
            <label
              className="absolute left-2 top-2 z-20 flex cursor-pointer items-center justify-center rounded-md bg-black/85 p-1 shadow-md"
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
      <MediaImage
        key={`${item.id}-${src ?? ""}-${fallbackSrc ?? ""}`}
        src={src}
        fallbackSrc={fallbackSrc}
        alt={item.title}
        className="aspect-[2/3] w-full bg-gradient-to-b from-pitflix-card to-pitflix-surface"
        fallbackText={item.title.slice(0, 24)}
        loading="eager"
      />
          {showPosterRatingOnHover ? (
            <div
              className={cn(
                "pointer-events-none absolute top-2 rounded-md bg-black/70 px-1.5 py-0.5 text-xs font-medium opacity-0 transition-opacity group-hover:opacity-100",
                rank != null && rank > 0 ? "right-2" : "left-2",
              )}
            >
              ★ {formatRating(rating)}
            </div>
          ) : null}
          {item.watchStatus === "Completed" ? (
            <div className="pointer-events-none absolute bottom-2 left-2 rounded-md bg-green-500/90 px-1.5 py-0.5 text-xs text-white">
              ✓ Watched
            </div>
          ) : null}
          {isFavorite ? (
            <Heart
              className="pointer-events-none absolute right-2 top-2 z-10 h-5 w-5 fill-red-500 text-red-500 drop-shadow-md"
              strokeWidth={2}
            />
          ) : !selectionMode ? (
            <Heart
              className="absolute right-2 top-2 z-10 h-4 w-4 text-white opacity-0 drop-shadow-md transition-opacity group-hover:opacity-100"
              strokeWidth={2}
            />
          ) : null}
        </div>
        {showTitle ? (
          <p className={cn("mt-2 truncate font-medium text-white", size === "sm" ? "text-xs" : "text-sm")}>
            {item.title}
          </p>
        ) : null}
        {showDetailsLine ? (
          <p className="truncate text-xs text-pitflix-subtle">
            {yearLabel} · ★ {formatRating(rating)}
            {item.isArabic ? " · AR" : " · EN"}
          </p>
        ) : null}
      </div>
      {selectionMode && onToggleSelect ? (
        <button
          type="button"
          className="mt-1 text-left text-xs text-pitflix-primary hover:underline"
          onClick={(e) => {
            e.stopPropagation();
            openDetail();
          }}
        >
          Open details
        </button>
      ) : null}

      <AnimatePresence>
        {hovered ? (
          <motion.div
            initial={{ opacity: 0, y: position === "above" ? 8 : -8, scale: 0.96 }}
            animate={{ opacity: 1, y: 0, scale: 1 }}
            exit={{ opacity: 0, scale: 0.96 }}
            transition={{ duration: 0.15 }}
            className={cn(
              "absolute z-[410] w-64 max-w-[calc(100vw-32px)] overflow-hidden rounded-xl border border-white/10 bg-pitflix-surface shadow-2xl shadow-black/90",
              "left-1/2 -translate-x-1/2",
              position === "above" ? "bottom-[calc(100%+8px)]" : "top-[calc(100%+8px)]",
              "max-h-[70vh] overflow-y-auto",
            )}
            style={{ isolation: "isolate" }}
            // If the hover card is on top, the underlying PosterCard click won't fire.
            // Make clicks on the hover card navigate to the selected title.
            onClick={() => navigate(detailPath)}
          >
            <div className="relative h-32 bg-pitflix-card">
              {backdropSrc ? (
                <img src={backdropSrc} alt="" className="h-full w-full object-cover" />
              ) : src ? (
                <img src={src} alt="" className="h-full w-full object-cover object-top" />
              ) : null}
              <div className="absolute inset-0 bg-gradient-to-t from-pitflix-surface to-transparent" />
              {rating > 0 ? (
                <div className="absolute right-2 top-2 rounded-md bg-black/70 px-2 py-0.5 text-xs font-medium text-white backdrop-blur-sm">
                  ⭐ {formatRating(rating)}
                </div>
              ) : null}
            </div>

            <div className="p-3">
              <h3 className="mb-1 text-sm font-bold leading-tight text-white">{item.title}</h3>
              <div className="mb-2 flex flex-wrap items-center gap-2 text-xs text-pitflix-muted">
                <span>{yearLabel}</span>
                {genres.slice(0, 2).map((g) => (
                  <span key={g} className="rounded bg-pitflix-card px-1.5 py-0.5 text-pitflix-subtle">
                    {g}
                  </span>
                ))}
              </div>
              {item.overview ? (
                <p className="mb-3 line-clamp-2 text-xs leading-relaxed text-pitflix-muted">{item.overview}</p>
              ) : null}
              <div className="flex gap-2">
                {playPath ? (
                  <button
                    type="button"
                    onClick={(e) => {
                      e.stopPropagation();
                      void play(
                        playPath,
                        item.title,
                        item.selectedPosterPath || item.posterLocalPath || null,
                        mediaType,
                        0,
                        mediaType === "Movie"
                          ? { libraryMovieId: item.id }
                          : { libraryShowId: item.id },
                      );
                    }}
                    className="flex flex-1 items-center justify-center gap-1.5 rounded-lg bg-pitflix-primary py-2 text-xs font-medium text-white transition-colors hover:bg-pitflix-light"
                  >
                    ▶ Play
                  </button>
                ) : null}
                <button
                  type="button"
                  onClick={(e) => {
                    e.stopPropagation();
                    navigate(detailPath);
                  }}
                  className={cn(
                    "rounded-lg border border-white/20 px-3 py-2 text-xs text-white transition-colors hover:border-white/40",
                    playPath ? "" : "flex-1",
                  )}
                >
                  Info
                </button>
              </div>
            </div>
          </motion.div>
        ) : null}
      </AnimatePresence>
    </div>
  );
}
