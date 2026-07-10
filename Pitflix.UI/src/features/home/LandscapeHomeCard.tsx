import { useRef, useState } from "react";
import { useNavigate } from "react-router-dom";
import type { MediaCard } from "../../types/media";
import { cn } from "../../utils/cn";
import { formatYear } from "../../utils/format";
import { toPosterSrc } from "../../utils/posterSrc";
import { usePlayback } from "../../hooks/usePlayback";
import { useHoverCard } from "../../hooks/useHoverCard";
import { MediaImage } from "../../components/ui/MediaImage";
import { MediaHoverCard } from "../../components/ui/MediaHoverCard";

/** Strip ZWSP / bidi marks that can yield "empty" titles in some fonts or flex-shrink layouts. */
function visibleTitle(raw: string | undefined | null): string {
  if (raw == null) return "";
  const cleaned = raw
    .replace(/[​-‍﻿‪-‮⁦-⁩]/g, "")
    .replace(/\s+/g, " ")
    .trim();
  if (cleaned.length > 0) return cleaned;
  const letters = [...raw.normalize("NFC")].filter((ch) => /\p{L}|\p{N}/u.test(ch)).join("");
  return letters.trim();
}

export function LandscapeHomeCard({
  item,
  mediaType,
  className,
  imdbRating,
  onContextMenu,
}: {
  item: MediaCard;
  mediaType: "Movie" | "Series";
  className?: string;
  imdbRating?: number | null;
  onContextMenu?: (e: React.MouseEvent) => void;
}) {
  const navigate = useNavigate();
  const { play } = usePlayback();
  const cardRef = useRef<HTMLDivElement>(null);
  const [anchorRect, setAnchorRect] = useState<DOMRect | null>(null);

  const { open, triggerProps, cardProps } = useHoverCard();

  const primary = item.selectedPosterPath || item.posterLocalPath;
  const remote = item.posterRemoteUrl;
  const poster = toPosterSrc((primary ?? remote) ?? undefined);
  const posterFb = primary && remote && remote !== primary ? toPosterSrc(remote) : undefined;
  const backdrop = toPosterSrc(item.selectedBackdropPath || item.backdropLocalPath || undefined);
  const playPath = item.mediaFilePath || item.filePath;
  const detailPath = mediaType === "Movie" ? `/movie/${item.id}` : `/series/${item.id}`;
  const genres = item.genresCsv?.split(",").map((g) => g.trim()).filter(Boolean).slice(0, 2) ?? [];
  const displayTitle = (() => {
    const t = visibleTitle(item.title);
    return t.length > 0 ? t : "Untitled";
  })();

  // Capture the card rect when hovering starts so the popup is positioned correctly
  const handleMouseEnter = () => {
    if (cardRef.current) setAnchorRect(cardRef.current.getBoundingClientRect());
    triggerProps.onMouseEnter();
  };

  const handleMouseLeave = () => {
    triggerProps.onMouseLeave();
  };

  return (
    <>
      <div
        ref={cardRef}
        className={cn(
          "group flex h-[120px] w-[min(100%,320px)] shrink-0 cursor-pointer overflow-hidden rounded-xl bg-pitflix-card ring-1 ring-white/10 transition-[transform,box-shadow] duration-200 hover:-translate-y-0.5 hover:shadow-xl hover:shadow-black/50 hover:ring-pitflix-primary/40",
          className,
        )}
        role="button"
        tabIndex={0}
        onClick={() => navigate(detailPath)}
        onKeyDown={(e) => {
          if (e.key !== "Enter" && e.key !== " ") return;
          e.preventDefault();
          navigate(detailPath);
        }}
        onMouseEnter={handleMouseEnter}
        onMouseLeave={handleMouseLeave}
        onContextMenu={onContextMenu}
      >
        <div className="relative h-full w-[168px] shrink-0 overflow-hidden bg-black/40">
          {backdrop ? (
            <img src={backdrop} alt="" className="h-full w-full object-cover opacity-90 transition group-hover:scale-105" />
          ) : (
            <MediaImage
              src={poster}
              fallbackSrc={posterFb}
              alt=""
              className="h-full w-full object-cover object-top"
              fallbackText={displayTitle.slice(0, 2)}
              loading="lazy"
            />
          )}
          <div className="absolute inset-0 bg-gradient-to-r from-black/85 via-black/35 to-transparent" />
          <div className="absolute bottom-2 left-2 right-2 text-[10px] font-semibold uppercase tracking-wide text-pitflix-primary">
            {mediaType}
          </div>
        </div>
        <div className="flex min-h-0 min-w-0 flex-1 flex-col justify-between gap-1 px-3 py-2">
          <div className="min-h-0 min-w-0 shrink-0">
            <p
              className="line-clamp-2 min-h-[2.25rem] break-words text-sm font-semibold leading-snug text-white"
              dir="auto"
              title={displayTitle}
            >
              {displayTitle}
            </p>
            <p className="mt-0.5 shrink-0 text-xs text-pitflix-muted">
              {formatYear(item.year)}
              {item.isArabic ? " · AR" : " · EN"}
            </p>
          </div>
          {genres.length > 0 ? (
            <div className="flex min-h-0 shrink-0 flex-wrap gap-1 overflow-hidden">
              {genres.map((g) => (
                <span
                  key={g}
                  className="max-w-full truncate rounded bg-white/10 px-1.5 py-0.5 text-[10px] text-pitflix-subtle"
                >
                  {g}
                </span>
              ))}
            </div>
          ) : null}
          <div className="flex shrink-0 gap-2 pt-0.5">
            {playPath ? (
              <button
                type="button"
                className="rounded-lg bg-pitflix-primary px-2.5 py-1 text-[11px] font-medium text-white hover:bg-pitflix-light"
                onClick={(e) => {
                  e.stopPropagation();
                  void play(
                    playPath,
                    displayTitle,
                    item.selectedPosterPath || item.posterLocalPath || null,
                    mediaType,
                    0,
                  );
                }}
              >
                ▶ Play
              </button>
            ) : null}
            <button
              type="button"
              className="rounded-lg border border-white/15 px-2.5 py-1 text-[11px] text-pitflix-muted hover:border-white/30 hover:text-white"
              onClick={(e) => {
                e.stopPropagation();
                navigate(detailPath);
              }}
            >
              Info
            </button>
          </div>
        </div>
      </div>

      {open && anchorRect ? (
        <MediaHoverCard
          item={item}
          mediaType={mediaType}
          anchorRect={anchorRect}
          imdbRating={imdbRating}
          onPlay={
            playPath
              ? () => {
                  void play(
                    playPath,
                    displayTitle,
                    item.selectedPosterPath || item.posterLocalPath || null,
                    mediaType,
                    0,
                  );
                }
              : undefined
          }
          onInfo={() => navigate(detailPath)}
          onMouseEnter={cardProps.onMouseEnter}
          onMouseLeave={cardProps.onMouseLeave}
        />
      ) : null}
    </>
  );
}
