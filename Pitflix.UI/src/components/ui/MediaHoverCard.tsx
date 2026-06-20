import { createPortal } from "react-dom";
import { Play, Info } from "lucide-react";
import type { MediaCard } from "../../types/media";
import { toPosterSrc } from "../../utils/posterSrc";
import { formatRating, formatYear } from "../../utils/format";
import { cn } from "../../utils/cn";

type Props = {
  item: MediaCard;
  mediaType: "Movie" | "Series";
  /** Bounding rect of the card that triggered the hover — used to position the popup. */
  anchorRect: DOMRect;
  onPlay?: () => void;
  onInfo?: () => void;
  /** Forwarded from useHoverCard so moving into the popup keeps it open. */
  onMouseEnter?: () => void;
  onMouseLeave?: () => void;
};

function formatRuntime(minutes?: number | null): string {
  if (!minutes || minutes <= 0) return "";
  const h = Math.floor(minutes / 60);
  const m = minutes % 60;
  if (h === 0) return `${m}m`;
  if (m === 0) return `${h}h`;
  return `${h}h ${m}m`;
}

/**
 * Netflix-style hover card rendered in a portal at the body level.
 * Appears after 3 s of hovering and is positioned based on the anchor card's rect.
 */
export function MediaHoverCard({
  item,
  mediaType,
  anchorRect,
  onPlay,
  onInfo,
  onMouseEnter,
  onMouseLeave,
}: Props) {
  const CARD_W = 280;
  const CARD_APPROX_H = 340;
  const GAP = 8;

  const primary = item.selectedPosterPath || item.posterLocalPath;
  const remote = item.posterRemoteUrl;
  const poster = toPosterSrc((primary ?? remote) ?? undefined);
  const backdrop = toPosterSrc(item.selectedBackdropPath || item.backdropLocalPath || undefined);

  const genres = item.genresCsv
    ?.split(",")
    .map((g) => g.trim())
    .filter(Boolean)
    .slice(0, 4) ?? [];

  const title = item.title ?? "Untitled";
  const runtime = formatRuntime((item as unknown as Record<string, unknown>).runtimeMinutes as number | null | undefined);

  // Horizontal: center the popup over the anchor card
  let left = anchorRect.left + anchorRect.width / 2 - CARD_W / 2;
  left = Math.max(8, Math.min(left, window.innerWidth - CARD_W - 8));

  // Vertical: center over the anchor card (Netflix "replace" style)
  let top = anchorRect.top + anchorRect.height / 2 - CARD_APPROX_H / 2;
  // Clamp to viewport
  if (top + CARD_APPROX_H > window.innerHeight - GAP) top = window.innerHeight - CARD_APPROX_H - GAP;
  if (top < GAP) top = GAP;

  const style: React.CSSProperties = {
    position: "fixed",
    top,
    left,
    width: CARD_W,
    zIndex: 9999,
  };

  const cardEl = (
    <div
      style={style}
      onMouseEnter={onMouseEnter}
      onMouseLeave={onMouseLeave}
      className="overflow-hidden rounded-2xl border border-white/[0.12] bg-pitflix-surface shadow-[0_24px_60px_rgba(0,0,0,0.8)] backdrop-blur-sm animate-fade-in"
    >
      {/* Hero image — backdrop preferred, poster fallback */}
      <div className="relative h-[158px] w-full overflow-hidden bg-pitflix-card">
        {backdrop ? (
          <img src={backdrop} alt="" className="h-full w-full object-cover" />
        ) : poster ? (
          <img src={poster} alt="" className="h-full w-full object-cover object-top" />
        ) : (
          <div className="flex h-full w-full items-center justify-center text-3xl font-bold text-white/20">
            {title.slice(0, 2).toUpperCase()}
          </div>
        )}
        <div className="absolute inset-0 bg-gradient-to-t from-pitflix-surface via-pitflix-surface/30 to-transparent" />

        {/* Play button overlay */}
        {onPlay && (
          <button
            type="button"
            onClick={onPlay}
            className="absolute inset-0 flex items-center justify-center opacity-0 hover:opacity-100 transition-opacity"
          >
            <span className="flex h-12 w-12 items-center justify-center rounded-full bg-pitflix-primary/90 shadow-lg shadow-pitflix-primary/40 backdrop-blur-sm">
              <Play className="h-5 w-5 fill-white text-white" />
            </span>
          </button>
        )}
      </div>

      {/* Content */}
      <div className="p-3 space-y-2.5">
        {/* Title row */}
        <div>
          <p className="line-clamp-2 text-sm font-bold leading-snug text-white">{title}</p>
          <div className="mt-1 flex flex-wrap items-center gap-1.5 text-[11px] text-pitflix-muted">
            {item.year ? <span>{formatYear(item.year)}</span> : null}
            {item.year && item.voteAverage ? <span className="text-pitflix-subtle">·</span> : null}
            {item.voteAverage && item.voteAverage > 0 ? (
              <span className="flex items-center gap-0.5">
                <span className="text-amber-400">★</span>
                {formatRating(item.voteAverage)}
              </span>
            ) : null}
            {runtime ? (
              <>
                <span className="text-pitflix-subtle">·</span>
                <span>{runtime}</span>
              </>
            ) : null}
            <span
              className={cn(
                "ml-auto rounded px-1.5 py-0.5 text-[10px] font-semibold uppercase tracking-wide",
                mediaType === "Movie"
                  ? "bg-sky-500/20 text-sky-300"
                  : "bg-violet-500/20 text-violet-300",
              )}
            >
              {mediaType}
            </span>
          </div>
        </div>

        {/* Overview (short) */}
        {item.overview ? (
          <p className="line-clamp-3 text-[11px] leading-relaxed text-pitflix-muted">
            {item.overview}
          </p>
        ) : null}

        {/* Genre chips */}
        {genres.length > 0 ? (
          <div className="flex flex-wrap gap-1">
            {genres.map((g) => (
              <span
                key={g}
                className="rounded-full border border-white/[0.09] px-2 py-0.5 text-[10px] text-pitflix-subtle"
              >
                {g}
              </span>
            ))}
          </div>
        ) : null}

        {/* Action buttons */}
        <div className="flex gap-2 pt-0.5">
          {onPlay ? (
            <button
              type="button"
              onClick={onPlay}
              className="flex flex-1 items-center justify-center gap-1.5 rounded-xl bg-pitflix-primary py-2 text-xs font-semibold text-white transition-colors hover:bg-pitflix-light"
            >
              <Play className="h-3.5 w-3.5 fill-white" />
              Play
            </button>
          ) : null}
          {onInfo ? (
            <button
              type="button"
              onClick={onInfo}
              className="flex flex-1 items-center justify-center gap-1.5 rounded-xl border border-white/15 py-2 text-xs font-semibold text-pitflix-muted transition-colors hover:border-white/30 hover:text-white"
            >
              <Info className="h-3.5 w-3.5" />
              More info
            </button>
          ) : null}
        </div>
      </div>
    </div>
  );

  return createPortal(cardEl, document.body);
}
