import { useNavigate, Link } from "react-router-dom";
import { Check, ChevronRight, Play, X } from "lucide-react";
import { MediaImage } from "../../../components/ui/MediaImage";
import { HorizontalScrollRow } from "../../../components/ui/HorizontalScrollRow";
import { toPosterSrc } from "../../../utils/posterSrc";
import { trustedResumeHeadFromRow } from "../../../utils/trustedResume";
import { continueLabel, continueWatchingHeadline, episodeInfoLine } from "../ContinueWatchingHero";
import { upNextEpisodeBadge, upNextProgressPercent } from "./shared";
import type { DirectionProps } from "./types";

export function Direction1b({
  featured,
  history,
  currentIndex,
  upNext,
  onManageContinue,
  onSelectFeatured,
  onDismissUpNext,
  dismissingUpNextId,
  requestPlay,
}: DirectionProps) {
  const navigate = useNavigate();

  const backdropSrc = toPosterSrc(featured.backdropLocalPath ?? undefined);
  const posterSrc = toPosterSrc(featured.posterLocalPath ?? featured.posterRemoteUrl ?? undefined);

  const dur = featured.fileDurationSeconds ?? 0;
  const head = trustedResumeHeadFromRow(featured);
  const pct = dur > 0 ? Math.min(100, Math.round((head / dur) * 100)) : 0;

  const headline = continueWatchingHeadline(featured);
  const epInfo = episodeInfoLine(featured);
  const detailPath =
    featured.libraryMovieId != null
      ? `/movie/${featured.libraryMovieId}`
      : featured.libraryShowId != null
        ? `/series/${featured.libraryShowId}`
        : null;

  return (
    <div className="overflow-hidden rounded-2xl border border-white/5 bg-[#0d0d1c]">
      {/* ── Continue Watching — ambient wash ── */}
      <div className="relative h-[220px] overflow-hidden bg-[#0a0810]">
        <div className="absolute inset-0">
          {backdropSrc ? (
            <img src={backdropSrc} alt="" className="h-full w-full object-cover" loading="eager" />
          ) : posterSrc ? (
            <div
              className="h-full w-full scale-110 bg-cover bg-center opacity-40 blur-2xl"
              style={{ backgroundImage: `url(${posterSrc})` }}
            />
          ) : null}
        </div>
        <div className="absolute inset-0 bg-[radial-gradient(ellipse_80%_120%_at_50%_140%,rgba(124,58,237,0.55),rgba(76,29,149,0.28)_45%,transparent_75%)]" />
        <div className="absolute inset-0 bg-gradient-to-t from-black/85 via-black/25 to-black/40" />

        <div className="absolute left-6 right-6 top-5 flex items-center justify-between sm:left-[26px] sm:right-[26px]">
          <p className="text-[9.5px] font-bold uppercase tracking-[0.16em] text-pitflix-light">Continue Watching</p>
          <div className="flex items-center gap-2">
            {history.length > 1 ? (
              <div className="flex gap-1">
                {history.slice(0, 8).map((h, i) => (
                  <button
                    key={h.id}
                    type="button"
                    aria-label={`Show ${h.title}`}
                    onClick={() => onSelectFeatured(i)}
                    className={`h-[3px] rounded-full transition-all ${
                      i === currentIndex ? "w-[18px] bg-pitflix-light" : "w-1.5 bg-white/[0.18] hover:bg-white/35"
                    }`}
                  />
                ))}
              </div>
            ) : null}
            <button
              type="button"
              aria-label="Dismiss"
              onClick={() => onManageContinue(featured.id)}
              className="flex h-6 w-6 items-center justify-center rounded-full border border-white/[0.12] bg-white/[0.07] text-white/45 hover:text-white"
            >
              <X className="h-3.5 w-3.5" />
            </button>
          </div>
        </div>

        <div className="absolute inset-x-0 bottom-0 flex items-end justify-between gap-6 px-6 pb-5 sm:px-[26px]">
          <div className="min-w-0">
            <h2
              className="mb-2 line-clamp-2 text-[32px] font-extrabold leading-[0.95] tracking-[-0.035em] text-white [text-shadow:0_2px_32px_rgba(0,0,0,0.6)] sm:text-[44px]"
            >
              {headline}
            </h2>
            <p className="text-[12px] text-white/40">{epInfo ?? featured.mediaType}</p>
          </div>
          <div className="flex shrink-0 items-center gap-2.5 pb-0.5">
            <button
              type="button"
              onClick={() => requestPlay(featured)}
              className="flex items-center gap-2 rounded-lg bg-pitflix-primary px-5 py-2.5 text-[13px] font-semibold text-white shadow-[0_4px_20px_rgba(124,58,237,0.45)] transition hover:bg-pitflix-light"
            >
              <Play className="h-3.5 w-3.5 fill-current" />
              {continueLabel(featured.nextUpLabel)}
            </button>
            {detailPath ? (
              <button
                type="button"
                onClick={() => navigate(detailPath)}
                className="rounded-lg border border-white/10 bg-white/[0.07] px-4 py-2.5 text-[13px] text-white/60 hover:text-white"
              >
                Details
              </button>
            ) : null}
            <button
              type="button"
              aria-label="Mark completed"
              onClick={() => onManageContinue(featured.id)}
              className="flex h-10 w-10 items-center justify-center rounded-lg border border-white/10 bg-white/[0.07] text-white/50 hover:text-green-400"
            >
              <Check className="h-4 w-4" />
            </button>
          </div>
        </div>

        <div className="absolute inset-x-0 bottom-0 h-[2px] bg-white/[0.06]">
          <div className="h-full bg-pitflix-primary/80" style={{ width: `${pct}%` }} />
        </div>
      </div>

      {/* ── Up Next — tall poster cards ── */}
      {upNext.length > 0 ? (
        <div className="px-6 pb-6 pt-5 sm:px-[26px]">
          <div className="mb-4 flex items-baseline justify-between">
            <div className="flex items-baseline gap-2.5">
              <span className="text-[15px] font-bold text-white">Up Next</span>
              <span className="text-[12.5px] text-white/28">Shows you're still watching</span>
            </div>
            <Link
              to="/series"
              className="inline-flex items-center gap-0.5 text-[12.5px] font-semibold text-pitflix-primary hover:underline"
            >
              Browse series <ChevronRight className="h-3.5 w-3.5" />
            </Link>
          </div>
          <HorizontalScrollRow hideHeader className="mb-0" contentClassName="gap-2.5">
            <>
              {upNext.map((card) => {
                const poster = toPosterSrc(card.posterUrl ?? undefined);
                const pct = upNextProgressPercent(card);
                return (
                  <div key={card.libraryShowId} className="group relative w-[138px] shrink-0">
                    <button
                      type="button"
                      onClick={() => navigate(`/series/${card.libraryShowId}`)}
                      className="relative block h-[196px] w-[138px] overflow-hidden rounded-[9px] bg-pitflix-card text-left"
                    >
                      <MediaImage src={poster} alt="" className="h-full w-full" fallbackText={card.showTitle.slice(0, 2)} loading="lazy" />
                      <span className="pointer-events-none absolute inset-0 bg-gradient-to-t from-black/85 to-[55%] to-transparent" />
                      <span className="pointer-events-none absolute left-2 top-2 rounded-[3px] bg-black/50 px-1.5 py-0.5 text-[9px] font-bold text-white/80">
                        {upNextEpisodeBadge(card)}
                      </span>
                      <span className="pointer-events-none absolute inset-x-2.5 bottom-2.5">
                        <span className="mb-1 block truncate text-[12px] font-bold leading-tight text-white">
                          {card.showTitle}
                        </span>
                        <span className="block h-[2px] rounded-full bg-white/15">
                          <span className="block h-full rounded-full bg-white/40" style={{ width: `${pct}%` }} />
                        </span>
                      </span>
                    </button>
                    <button
                      type="button"
                      aria-label={`Drop ${card.showTitle} — stop suggesting it in Up Next`}
                      title="Drop — won't show here again (keeps your watch progress)"
                      disabled={dismissingUpNextId === card.libraryShowId}
                      onClick={() => onDismissUpNext(card.libraryShowId)}
                      className="absolute right-2 top-2 hidden h-6 w-6 items-center justify-center rounded-full bg-black/75 text-white ring-1 ring-white/15 hover:bg-red-600/90 group-hover:flex"
                    >
                      <X className="h-3.5 w-3.5" />
                    </button>
                  </div>
                );
              })}
            </>
          </HorizontalScrollRow>
        </div>
      ) : null}
    </div>
  );
}
