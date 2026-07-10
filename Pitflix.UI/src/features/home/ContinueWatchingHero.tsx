import { useEffect } from "react";
import { AnimatePresence, motion } from "framer-motion";
import { ChevronLeft, ChevronRight, Info, Play } from "lucide-react";
import { useNavigate } from "react-router-dom";
import { MediaImage } from "../../components/ui/MediaImage";
import type { MediaCard } from "../../types/media";
import type { WatchHistoryRow } from "../../types/homeSection";
import { toPosterSrc } from "../../utils/posterSrc";
import { usePlayback } from "../../hooks/usePlayback";
import type { PlayContext } from "../../hooks/usePlayback";
import { useResumeBeforePlay } from "../../hooks/useResumeBeforePlay";
import { trustedResumeHeadFromRow } from "../../utils/trustedResume";
import { cn } from "../../utils/cn";

// ─── Helpers ────────────────────────────────────────────────────────────────

export function continueLabel(nextUpLabel?: string | null) {
  const m = (nextUpLabel ?? "").match(/S\s*(\d+)\s*E\s*(\d+)/i);
  if (m) return `Continue S${m[1]}E${m[2]}`;
  return "Continue watching";
}

/** Parse S##E## from a nextUpLabel string like "S1 E5 — Title" → { season: 1, episodeNumber: 5 }. */
export function parseSeEp(label: string | null | undefined): { season?: number; episodeNumber?: number } {
  if (!label) return {};
  const m = label.match(/S\s*(\d+)\s*E\s*(\d+)/i);
  if (!m) return {};
  return { season: Number(m[1]), episodeNumber: Number(m[2]) };
}

export function continueReturnContext(item: WatchHistoryRow): PlayContext {
  // Do NOT hardcode returnTo — let usePlayback capture the current location
  // (home page / wherever the user is) so closing the player returns them here.
  const { season, episodeNumber } = parseSeEp(item.nextUpLabel);
  return {
    libraryMovieId: item.libraryMovieId ?? undefined,
    libraryShowId: item.libraryShowId ?? undefined,
    libraryEpisodeId: item.libraryEpisodeId ?? undefined,
    ...(season != null ? { season } : {}),
    ...(episodeNumber != null ? { episodeNumber } : {}),
  };
}

export function episodeInfoLine(item: WatchHistoryRow): string | null {
  const label = item.nextUpLabel;
  if (!label) return null;
  // "S1 E5 — Next up" → "S1 E5"  or  "S1E5 — Title" → "S1E5 · Title"
  const dashIdx = label.indexOf("—");
  if (dashIdx > -1) {
    const ep = label.slice(0, dashIdx).trim();
    const title = label.slice(dashIdx + 1).trim();
    return title ? `${ep} · ${title}` : ep;
  }
  return label;
}

export function continueWatchingHeadline(item: WatchHistoryRow): string {
  if (item.mediaType !== "Series") return item.title;

  const fromApi = item.episodeTitle?.trim();
  if (fromApi) return fromApi;

  const parts = item.title.split(/\s*[·•]\s*/).map((p) => p.trim()).filter(Boolean);
  const seIdx = parts.findIndex((p) => /S\s*\d+\s*E\s*\d+/i.test(p));
  if (seIdx >= 0 && seIdx + 1 < parts.length) {
    return parts.slice(seIdx + 1).join(" · ");
  }

  const m =
    item.title.match(/S\s*(\d+)\s*E\s*(\d+)/i) ??
    item.nextUpLabel?.match(/S\s*(\d+)\s*E\s*(\d+)/i);
  if (m) return `Episode ${m[2]}`;

  return item.title;
}

// ─── Manage dialog (kept from old design) ───────────────────────────────────

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
                Remove this title from Continue watching, or mark it finished in your library and clear the row.
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

// ─── Featured fallback (shown when no history) ───────────────────────────────

export function FeaturedFallbackHero({ card }: { card: MediaCard }) {
  const navigate = useNavigate();
  const { play } = usePlayback();
  const mediaType = card.tmdbMediaType === "Series" ? "Series" : "Movie";
  const posterSrc = toPosterSrc(card.selectedPosterPath || card.posterLocalPath || card.posterRemoteUrl || undefined);
  const posterFb =
    card.posterLocalPath && card.posterRemoteUrl ? toPosterSrc(card.posterRemoteUrl) : undefined;
  const backdropSrc = toPosterSrc(card.selectedBackdropPath || card.backdropLocalPath || undefined);
  const playPath = card.mediaFilePath || card.filePath;
  const detailPath = mediaType === "Movie" ? `/movie/${card.id}` : `/series/${card.id}`;

  return (
    <section
      aria-label={`Featured: ${card.title}`}
      className="relative mb-8 min-h-[320px] w-full overflow-hidden rounded-2xl ring-1 ring-white/10"
    >
      {/* Backdrop */}
      <div className="absolute inset-0">
        {backdropSrc ? (
          <img
            src={backdropSrc}
            alt=""
            className="h-full w-full object-cover object-center opacity-60"
            loading="eager"
          />
        ) : (
          <div className="h-full w-full bg-pitflix-card" />
        )}
        <div className="absolute inset-0 bg-gradient-to-r from-black/95 via-black/65 to-transparent" />
        <div className="absolute inset-0 bg-gradient-to-t from-black/80 via-transparent to-black/20" />
      </div>

      {/* Content */}
      <div className="relative z-[1] flex min-h-[320px] items-end p-6 sm:p-10">
        <div className="flex w-full items-end gap-6">
          <div className="min-w-0 flex-1 max-w-2xl">
            <p className="mb-2 text-[10px] font-bold uppercase tracking-widest text-amber-200/90">
              Featured in your library
            </p>
            <h2 className="line-clamp-2 text-3xl font-bold text-white sm:text-4xl">
              {card.title}
            </h2>
            <p className="mt-2 text-sm text-pitflix-muted">
              {mediaType} · Highly rated picks you own
            </p>
            <div className="mt-5 flex flex-wrap gap-2">
              {playPath ? (
                <button
                  type="button"
                  className="inline-flex items-center gap-2 rounded-xl bg-pitflix-primary px-6 py-3 text-sm font-bold text-white shadow-lg shadow-pitflix-primary/30 transition hover:bg-pitflix-light active:scale-95"
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
                  <Play className="h-4 w-4 fill-current" />
                  Play
                </button>
              ) : null}
              <button
                type="button"
                className="inline-flex items-center gap-2 rounded-xl border border-white/20 px-5 py-3 text-sm font-semibold text-white transition hover:border-pitflix-primary/50 hover:bg-white/5"
                onClick={() => navigate(detailPath)}
              >
                <Info className="h-4 w-4" />
                Details
              </button>
            </div>
          </div>

          {/* Poster — hidden on small screens */}
          <div className="hidden shrink-0 md:block">
            <MediaImage
              src={posterSrc}
              fallbackSrc={posterFb}
              alt=""
              className="aspect-[2/3] h-48 w-32 rounded-xl bg-pitflix-card object-cover shadow-2xl ring-1 ring-white/15"
              fallbackText={card.title.slice(0, 2).toUpperCase()}
              loading="eager"
            />
          </div>
        </div>
      </div>
    </section>
  );
}

// ─── Main hero ───────────────────────────────────────────────────────────────

export function ContinueWatchingHero({
  featured,
  onManageContinue,
  currentIndex = 0,
  totalCount = 1,
  onPrev,
  onNext,
}: {
  featured: WatchHistoryRow;
  onManageContinue: (historyId: number) => void;
  currentIndex?: number;
  totalCount?: number;
  onPrev?: () => void;
  onNext?: () => void;
}) {
  const navigate = useNavigate();
  const { requestPlay, ResumePromptModal } = useResumeBeforePlay();

  const posterSrc = toPosterSrc(featured.posterLocalPath ?? featured.posterRemoteUrl ?? undefined);
  const posterFallback =
    featured.posterLocalPath && featured.posterRemoteUrl
      ? toPosterSrc(featured.posterRemoteUrl)
      : undefined;
  const backdropSrc = toPosterSrc(featured.backdropLocalPath ?? undefined);

  const dur = featured.fileDurationSeconds ?? 0;
  const head = trustedResumeHeadFromRow(featured);
  const pct = dur > 0 ? Math.min(100, Math.round((head / dur) * 100)) : 0;
  const showProgress = head > 30 && dur > 0;

  const epInfo = episodeInfoLine(featured);
  const headline = continueWatchingHeadline(featured);

  const detailPath =
    featured.libraryMovieId != null
      ? `/movie/${featured.libraryMovieId}`
      : featured.libraryShowId != null
        ? `/series/${featured.libraryShowId}`
        : null;

  return (
    <>
    {ResumePromptModal}
    <motion.section
      initial={{ opacity: 0, y: 8 }}
      animate={{ opacity: 1, y: 0 }}
      transition={{ duration: 0.4, ease: "easeOut" }}
      aria-label={`Continue watching: ${featured.title}`}
      className="relative mb-8 min-h-[360px] w-full overflow-hidden rounded-2xl ring-1 ring-white/10"
    >
      {/* ── Backdrop ── */}
      <div className="absolute inset-0">
        {backdropSrc ? (
          <img
            src={backdropSrc}
            alt=""
            className="h-full w-full object-cover object-center"
            loading="eager"
          />
        ) : (
          <div
            className={cn(
              "h-full w-full",
              posterSrc
                ? "scale-110 bg-cover bg-center opacity-25 blur-2xl"
                : "bg-pitflix-card",
            )}
            style={posterSrc ? { backgroundImage: `url(${posterSrc})` } : undefined}
          />
        )}
        {/* Gradient: strong on left, fades right */}
        <div className="absolute inset-0 bg-gradient-to-r from-black/95 via-black/70 to-black/20" />
        {/* Bottom fade for readability */}
        <div className="absolute inset-0 bg-gradient-to-t from-black/75 via-transparent to-black/15" />
      </div>

      {/* ── Top-right: dismiss + dot indicators ── */}
      <div className="absolute right-3 top-3 z-[2] flex items-center gap-2">
        {/* Dot indicators — only shown when there are multiple in-progress items */}
        {totalCount > 1 ? (
          <div className="flex items-center gap-1.5" aria-label={`Item ${currentIndex + 1} of ${totalCount}`}>
            {Array.from({ length: Math.min(totalCount, 8) }).map((_, i) => (
              <span
                key={i}
                className={cn(
                  "block rounded-full transition-all duration-300",
                  i === currentIndex
                    ? "h-1.5 w-4 bg-pitflix-primary"
                    : "h-1.5 w-1.5 bg-white/30",
                )}
              />
            ))}
          </div>
        ) : null}
        <button
          type="button"
          aria-label="Remove or mark completed"
          title="Remove or mark completed…"
          className="flex h-7 w-7 items-center justify-center rounded-full border border-white/15 bg-black/55 text-xs text-pitflix-muted backdrop-blur-sm transition hover:border-pitflix-primary/50 hover:text-white"
          onClick={() => onManageContinue(featured.id)}
        >
          ✕
        </button>
      </div>

      {/* ── Prev / Next arrows (only when multiple items) ── */}
      {totalCount > 1 ? (
        <>
          <button
            type="button"
            aria-label="Previous title"
            onClick={onPrev}
            className="absolute left-3 top-1/2 z-[2] -translate-y-1/2 flex h-9 w-9 items-center justify-center rounded-full border border-white/15 bg-black/55 text-white backdrop-blur-sm transition hover:border-pitflix-primary/50 hover:bg-black/75"
          >
            <ChevronLeft className="h-5 w-5" />
          </button>
          <button
            type="button"
            aria-label="Next title"
            onClick={onNext}
            className="absolute right-12 top-1/2 z-[2] -translate-y-1/2 flex h-9 w-9 items-center justify-center rounded-full border border-white/15 bg-black/55 text-white backdrop-blur-sm transition hover:border-pitflix-primary/50 hover:bg-black/75"
          >
            <ChevronRight className="h-5 w-5" />
          </button>
        </>
      ) : null}

      {/* ── Content ── */}
      <AnimatePresence mode="wait">
      <motion.div
        key={featured.id}
        initial={{ opacity: 0, x: 18 }}
        animate={{ opacity: 1, x: 0 }}
        exit={{ opacity: 0, x: -18 }}
        transition={{ duration: 0.22, ease: "easeOut" }}
        className="relative z-[1] flex min-h-[360px] items-end p-6 sm:p-10"
      >
        <div className="flex w-full items-end gap-6">
          {/* Left: text + actions */}
          <div className="min-w-0 flex-1 max-w-2xl">
            {/* Label */}
            <p className="mb-2 text-[10px] font-bold uppercase tracking-widest text-pitflix-primary">
              Continue watching
            </p>

            {/* Title */}
            <h2 className="line-clamp-2 text-3xl font-bold leading-tight text-white sm:text-4xl md:text-[42px]">
              {headline}
            </h2>

            {/* Episode / movie info */}
            {epInfo ? (
              <p className="mt-2 text-sm text-pitflix-muted">
                {epInfo}
              </p>
            ) : (
              <p className="mt-2 text-sm capitalize text-pitflix-muted">
                {featured.mediaType?.toLowerCase() ?? ""}
              </p>
            )}

            {/* Progress bar */}
            {showProgress ? (
              <div className="mt-4 max-w-sm">
                <div
                  className="h-1.5 overflow-hidden rounded-full bg-white/20"
                  role="progressbar"
                  aria-valuenow={pct}
                  aria-valuemin={0}
                  aria-valuemax={100}
                  aria-label={`${pct}% watched`}
                >
                  <div
                    className="h-full rounded-full bg-gradient-to-r from-pitflix-primary to-violet-400 transition-[width] duration-700"
                    style={{ width: `${pct}%` }}
                  />
                </div>
                <p className="mt-1 text-[11px] text-pitflix-muted">{pct}% watched</p>
              </div>
            ) : null}

            {/* Action buttons */}
            <div className="mt-5 flex flex-wrap items-center gap-2">
              <button
                type="button"
                aria-label={`Continue: ${featured.title}`}
                className="inline-flex items-center gap-2 rounded-xl bg-pitflix-primary px-6 py-3 text-sm font-bold text-white shadow-lg shadow-pitflix-primary/30 transition hover:bg-pitflix-light active:scale-95"
                onClick={() =>
                  void requestPlay({
                    filePath: featured.filePath,
                    title: featured.title,
                    posterPath: featured.posterLocalPath ?? null,
                    mediaType: featured.mediaType || "Movie",
                    durationSeconds: dur,
                    context: continueReturnContext(featured),
                  })
                }
              >
                <Play className="h-4 w-4 fill-current" />
                {continueLabel(featured.nextUpLabel)}
              </button>

              {detailPath ? (
                <button
                  type="button"
                  aria-label={`Details for ${featured.title}`}
                  className="inline-flex items-center gap-1.5 rounded-xl border border-white/20 px-5 py-3 text-sm font-semibold text-white transition hover:border-pitflix-primary/50 hover:bg-white/5"
                  onClick={() => navigate(detailPath)}
                >
                  <Info className="h-4 w-4" />
                  Details
                </button>
              ) : null}

              <button
                type="button"
                aria-label="Mark as watched or remove"
                title="Mark as watched or remove…"
                className="inline-flex h-10 w-10 items-center justify-center rounded-xl border border-white/15 text-lg text-pitflix-muted transition hover:border-green-500/50 hover:text-green-400"
                onClick={() => onManageContinue(featured.id)}
              >
                ✓
              </button>
            </div>
          </div>

          {/* Right: small poster — hidden on mobile/tablet */}
          <div className="hidden shrink-0 xl:block">
            <MediaImage
              src={posterSrc}
              fallbackSrc={posterFallback}
              alt=""
              className="aspect-[2/3] h-52 w-[138px] rounded-xl bg-pitflix-card object-cover shadow-2xl ring-1 ring-white/15"
              fallbackText={featured.title.slice(0, 2).toUpperCase()}
              loading="eager"
            />
          </div>
        </div>
      </motion.div>
      </AnimatePresence>
    </motion.section>
    </>
  );
}
