import { useEffect } from "react";
import { AnimatePresence, motion } from "framer-motion";
import { useNavigate } from "react-router-dom";
import { MediaImage } from "../../components/ui/MediaImage";
import type { MediaCard } from "../../types/media";
import type { WatchHistoryRow } from "../../types/homeSection";
import { toPosterSrc } from "../../utils/posterSrc";
import { usePlayback } from "../../hooks/usePlayback";
import { cn } from "../../utils/cn";

export function continueLabel(nextUpLabel?: string | null) {
  const m = (nextUpLabel ?? "").match(/S\s*(\d+)\s*E\s*(\d+)/i);
  if (m) return `▶ Continue S${m[1]}E${m[2]}`;
  return "▶ Continue watching";
}

export function ContinueWatchingMenuDialog({
  open,
  onRemoveOnly,
  onMarkCompleted,
  onCancel,
}: {
  open: boolean;
  onRemoveOnly: () => void;
  onMarkCompleted: () => void;
  onCancel: () => void;
}) {
  useEffect(() => {
    if (!open) return;
    const onKey = (e: KeyboardEvent) => {
      if (e.key === "Escape") onCancel();
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [open, onCancel]);

  return (
    <AnimatePresence>
      {open ? (
        <motion.div
          className="fixed inset-0 z-[240] flex items-center justify-center bg-black/70 p-4 backdrop-blur-[2px]"
          initial={{ opacity: 0 }}
          animate={{ opacity: 1 }}
          exit={{ opacity: 0 }}
          transition={{ duration: 0.15 }}
          onClick={onCancel}
        >
          <motion.div
            role="alertdialog"
            aria-modal="true"
            initial={{ opacity: 0, scale: 0.97, y: 6 }}
            animate={{ opacity: 1, scale: 1, y: 0 }}
            exit={{ opacity: 0, scale: 0.97, y: 6 }}
            transition={{ type: "spring", damping: 28, stiffness: 320 }}
            className="w-full max-w-[440px] rounded-xl border border-pitflix-primary/25 bg-pitflix-surface shadow-2xl shadow-black/70 ring-1 ring-white/5"
            onClick={(e) => e.stopPropagation()}
          >
            <div className="border-b border-pitflix-card px-5 py-4">
              <h2 className="text-lg font-semibold text-white">Continue watching</h2>
              <p className="mt-2 text-sm leading-relaxed text-pitflix-muted">
                Remove this title from Continue watching, or mark it finished in your library (movie or episode) and
                clear the row.
              </p>
            </div>
            <div className="flex flex-col gap-2 px-5 py-4">
              <button
                type="button"
                className="w-full rounded-lg bg-pitflix-primary px-4 py-2.5 text-sm font-semibold text-white transition-colors hover:bg-pitflix-light"
                onClick={onMarkCompleted}
              >
                Mark completed and remove
              </button>
              <button
                type="button"
                className="w-full rounded-lg border border-white/15 bg-pitflix-bg px-4 py-2.5 text-sm font-medium text-white transition-colors hover:border-pitflix-primary/40"
                onClick={onRemoveOnly}
              >
                Remove from Continue watching only
              </button>
              <button
                type="button"
                className="w-full rounded-lg py-2 text-sm text-pitflix-muted transition-colors hover:text-white"
                onClick={onCancel}
              >
                Cancel
              </button>
            </div>
          </motion.div>
        </motion.div>
      ) : null}
    </AnimatePresence>
  );
}

function SideHistoryThumb({
  item,
  onManageContinue,
}: {
  item: WatchHistoryRow;
  onManageContinue: (historyId: number) => void;
}) {
  const { play } = usePlayback();
  const src = toPosterSrc(item.posterLocalPath ?? item.posterRemoteUrl ?? undefined);
  const fallbackSrc =
    item.posterLocalPath && item.posterRemoteUrl ? toPosterSrc(item.posterRemoteUrl) : undefined;
  return (
    <div className="flex shrink-0 items-stretch gap-1 rounded-lg bg-black/25 p-1 ring-1 ring-white/10 md:w-full">
      <button
        type="button"
        onClick={() =>
          void play(
            item.filePath,
            item.title,
            item.posterLocalPath ?? null,
            item.mediaType || "Movie",
            item.fileDurationSeconds ?? 0,
          )
        }
        className="flex min-w-0 flex-1 gap-2 rounded-md p-0.5 text-left transition hover:bg-black/30"
      >
        <MediaImage
          src={src}
          fallbackSrc={fallbackSrc}
          alt=""
          className="h-16 w-11 shrink-0 rounded-md bg-pitflix-card object-cover"
          fallbackText=""
          loading="lazy"
        />
        <span className="line-clamp-2 w-24 pt-0.5 text-[11px] leading-snug text-white md:w-auto md:flex-1">
          {item.title}
        </span>
      </button>
      <button
        type="button"
        className="shrink-0 rounded-md px-2 text-[11px] text-pitflix-muted hover:bg-white/10 hover:text-white"
        title="Remove or mark completed…"
        aria-label="Continue watching options"
        onClick={() => onManageContinue(item.id)}
      >
        ✕
      </button>
    </div>
  );
}

export function FeaturedFallbackHero({ card }: { card: MediaCard }) {
  const navigate = useNavigate();
  const { play } = usePlayback();
  const mediaType = card.tmdbMediaType === "Series" ? "Series" : "Movie";
  const posterSrc = toPosterSrc(card.selectedPosterPath || card.posterLocalPath || card.posterRemoteUrl || undefined);
  const posterFb =
    card.posterLocalPath && card.posterRemoteUrl ? toPosterSrc(card.posterRemoteUrl) : undefined;
  const backdropOnly = toPosterSrc(card.selectedBackdropPath || card.backdropLocalPath || undefined);
  const playPath = card.mediaFilePath || card.filePath;
  const detailPath = mediaType === "Movie" ? `/movie/${card.id}` : `/series/${card.id}`;

  return (
    <section className="relative mb-10 min-h-[240px] w-full overflow-hidden rounded-2xl ring-1 ring-white/10">
      {backdropOnly ? (
        <div
          className="pointer-events-none absolute inset-0 scale-110 bg-cover bg-center opacity-[0.18] blur-2xl"
          style={{ backgroundImage: `url(${backdropOnly})` }}
          aria-hidden
        />
      ) : null}
      <div className="absolute inset-0 bg-gradient-to-br from-pitflix-bg via-pitflix-bg to-pitflix-surface/90" />
      <div className="relative z-[1] flex flex-col gap-5 p-5 md:flex-row md:items-stretch md:gap-8 md:p-8">
        <div className="flex shrink-0 justify-center md:justify-start">
          <MediaImage
            src={posterSrc}
            fallbackSrc={posterFb}
            alt=""
            className="aspect-[2/3] h-44 w-[118px] rounded-xl bg-pitflix-card object-cover shadow-xl ring-1 ring-white/10 md:h-52 md:w-[138px]"
            fallbackText={card.title.slice(0, 2).toUpperCase()}
            loading="eager"
          />
        </div>
        <div className="flex min-w-0 flex-1 flex-col justify-center">
          <p className="mb-1 text-[10px] font-semibold uppercase tracking-wider text-amber-200/90">
            Featured in your library
          </p>
          <h2 className="line-clamp-2 text-2xl font-bold text-white md:text-3xl">{card.title}</h2>
          <p className="mt-1 text-sm text-pitflix-muted">
            {mediaType === "Series" ? "Series" : "Movie"} · Highly rated picks you own
          </p>
          <div className="mt-4 flex flex-wrap gap-2">
            {playPath ? (
              <button
                type="button"
                className="rounded-xl bg-pitflix-primary px-5 py-2.5 text-sm font-semibold text-white hover:bg-pitflix-light"
                onClick={() =>
                  void play(
                    playPath,
                    card.title,
                    card.selectedPosterPath || card.posterLocalPath || null,
                    mediaType,
                    0,
                  )
                }
              >
                ▶ Play
              </button>
            ) : null}
            <button
              type="button"
              className="rounded-xl border border-white/20 px-4 py-2.5 text-sm text-pitflix-muted hover:border-pitflix-primary/40 hover:text-white"
              onClick={() => navigate(detailPath)}
            >
              Details
            </button>
          </div>
        </div>
      </div>
    </section>
  );
}

export function ContinueWatchingHero({
  featured,
  side,
  onManageContinue,
}: {
  featured: WatchHistoryRow;
  side: WatchHistoryRow[];
  onManageContinue: (historyId: number) => void;
}) {
  const { play } = usePlayback();
  const posterSrc = toPosterSrc(featured.posterLocalPath ?? featured.posterRemoteUrl ?? undefined);
  const posterFallback =
    featured.posterLocalPath && featured.posterRemoteUrl
      ? toPosterSrc(featured.posterRemoteUrl)
      : undefined;
  const backdropOnly = toPosterSrc(featured.backdropLocalPath ?? undefined);
  const dur = featured.fileDurationSeconds ?? 0;
  const est = featured.estimatedSeconds ?? 0;
  const pct = dur > 0 ? Math.min(100, (est / dur) * 100) : 0;
  const showProgress = est > 30 && dur > 0;

  return (
    <section className="relative mb-10 min-h-[240px] w-full overflow-hidden rounded-2xl ring-1 ring-white/10">
      {backdropOnly ? (
        <div
          className="pointer-events-none absolute inset-0 scale-110 bg-cover bg-center opacity-[0.14] blur-2xl"
          style={{ backgroundImage: `url(${backdropOnly})` }}
          aria-hidden
        />
      ) : null}
      <div className="absolute inset-0 bg-gradient-to-br from-pitflix-bg via-pitflix-bg to-pitflix-surface/90" />
      <button
        type="button"
        className="absolute right-3 top-3 z-[2] rounded-lg border border-white/15 bg-black/50 px-2.5 py-1 text-xs font-medium text-pitflix-muted backdrop-blur-sm transition hover:border-pitflix-primary/50 hover:text-white"
        title="Remove or mark completed…"
        onClick={() => onManageContinue(featured.id)}
      >
        ✕
      </button>
      <div className="relative z-[1] flex flex-col gap-5 p-5 md:flex-row md:items-stretch md:gap-8 md:p-8">
        <div className="flex shrink-0 justify-center md:justify-start">
          <MediaImage
            src={posterSrc}
            fallbackSrc={posterFallback}
            alt=""
            className="aspect-[2/3] h-44 w-[118px] rounded-xl bg-pitflix-card object-cover shadow-xl ring-1 ring-white/10 md:h-52 md:w-[138px]"
            fallbackText={featured.title.slice(0, 2).toUpperCase()}
            loading="eager"
          />
        </div>
        <div className="flex min-w-0 flex-1 flex-col justify-center">
          <p className="mb-1 text-[10px] font-semibold uppercase tracking-wider text-pitflix-primary">
            Continue watching
          </p>
          <h2 className="line-clamp-2 text-2xl font-bold text-white md:text-3xl">{featured.title}</h2>
          <p className="mt-1 text-sm text-pitflix-muted">
            {featured.nextUpLabel?.replace(/—.*/, "").trim() || featured.mediaType}
          </p>
          {showProgress ? (
            <div className="mt-4 h-1.5 max-w-md overflow-hidden rounded-full bg-white/15">
              <div className={cn("h-full rounded-full bg-pitflix-primary")} style={{ width: `${pct}%` }} />
            </div>
          ) : null}
          <div className="mt-4 flex flex-wrap gap-2">
            <button
              type="button"
              className="rounded-xl bg-pitflix-primary px-5 py-2.5 text-sm font-semibold text-white hover:bg-pitflix-light"
              onClick={() =>
                void play(
                  featured.filePath,
                  featured.title,
                  featured.posterLocalPath ?? null,
                  featured.mediaType || "Movie",
                  dur,
                )
              }
            >
              {continueLabel(featured.nextUpLabel)}
            </button>
            <button
              type="button"
              className="rounded-xl border border-white/20 px-4 py-2.5 text-sm text-pitflix-muted hover:border-pitflix-primary/40 hover:text-white"
              onClick={() => onManageContinue(featured.id)}
            >
              Done…
            </button>
          </div>
        </div>
        <div className="flex shrink-0 gap-2 overflow-x-auto pb-1 md:w-[220px] md:flex-col md:overflow-y-auto md:pb-0">
          {side.map((h) => (
            <SideHistoryThumb key={h.id} item={h} onManageContinue={onManageContinue} />
          ))}
        </div>
      </div>
    </section>
  );
}
