import { useNavigate, Link } from "react-router-dom";
import { ChevronRight, Play, X } from "lucide-react";
import { MediaImage } from "../../../components/ui/MediaImage";
import { HorizontalScrollRow } from "../../../components/ui/HorizontalScrollRow";
import { toPosterSrc } from "../../../utils/posterSrc";
import { trustedResumeHeadFromRow } from "../../../utils/trustedResume";
import { continueWatchingHeadline, episodeInfoLine } from "../ContinueWatchingHero";
import { upNextEpisodeBadge, upNextProgressPercent } from "./shared";
import type { DirectionProps } from "./types";

export function Direction1a({
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

  const posterSrc = toPosterSrc(featured.posterLocalPath ?? featured.posterRemoteUrl ?? undefined);
  const posterFallback =
    featured.posterLocalPath && featured.posterRemoteUrl ? toPosterSrc(featured.posterRemoteUrl) : undefined;

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
      {/* ── Continue Watching ── */}
      <div className="px-6 pb-5 pt-[22px] sm:px-[26px]">
        <p className="mb-3.5 text-[9.5px] font-bold uppercase tracking-[0.16em] text-pitflix-primary">
          Continue Watching
        </p>
        <div className="relative flex items-stretch overflow-hidden rounded-[10px] border border-white/[0.07] bg-white/[0.03]">
          <div className="w-[3px] shrink-0 bg-gradient-to-b from-pitflix-primary to-violet-950" />
          <MediaImage
            src={posterSrc}
            fallbackSrc={posterFallback}
            alt=""
            className="h-[118px] w-[78px] shrink-0 bg-pitflix-card"
            fallbackText={featured.title.slice(0, 2).toUpperCase()}
            loading="eager"
          />
          <div className="flex min-w-0 flex-1 flex-col justify-center gap-2.5 px-5 py-3.5">
            <div>
              <h3 className="truncate text-[19px] font-bold tracking-[-0.02em] text-white">{headline}</h3>
              <p className="mt-0.5 text-[12.5px] text-white/40">{epInfo ?? featured.mediaType}</p>
            </div>
            <div>
              <div className="mb-1 h-[3px] overflow-hidden rounded-full bg-white/[0.08]">
                <div className="h-full rounded-full bg-pitflix-primary" style={{ width: `${pct}%` }} />
              </div>
              <p className="text-[11px] text-white/25">{pct}% watched</p>
            </div>
          </div>
          <div className="flex shrink-0 items-center gap-2.5 px-5">
            <button
              type="button"
              aria-label={`Continue: ${featured.title}`}
              onClick={() =>
                requestPlay(featured)
              }
              className="flex h-[50px] w-[50px] items-center justify-center rounded-full bg-pitflix-primary text-white shadow-[0_4px_22px_rgba(124,58,237,0.48)] transition hover:bg-pitflix-light active:scale-95"
            >
              <Play className="h-4 w-4 translate-x-0.5 fill-current" />
            </button>
            <div className="flex flex-col gap-1.5">
              {detailPath ? (
                <button
                  type="button"
                  onClick={() => navigate(detailPath)}
                  className="rounded-md border border-white/[0.09] bg-white/5 px-3 py-1 text-[11.5px] text-white/60 transition hover:border-pitflix-primary/40 hover:text-white"
                >
                  Details
                </button>
              ) : null}
              <button
                type="button"
                onClick={() => onManageContinue(featured.id)}
                className="rounded-md border border-white/[0.09] bg-white/5 px-3 py-1 text-[11.5px] text-white/40 transition hover:border-red-400/40 hover:text-white"
              >
                Dismiss
              </button>
            </div>
          </div>
          {history.length > 1 ? (
            <div className="absolute right-3.5 top-2.5 flex gap-1">
              {history.slice(0, 8).map((h, i) => (
                <button
                  key={h.id}
                  type="button"
                  aria-label={`Show ${h.title}`}
                  onClick={() => onSelectFeatured(i)}
                  className={`h-[3px] rounded-full transition-all ${
                    i === currentIndex ? "w-4 bg-pitflix-primary" : "w-[5px] bg-white/[0.18] hover:bg-white/35"
                  }`}
                />
              ))}
            </div>
          ) : null}
        </div>
      </div>

      {/* ── Up Next ── */}
      {upNext.length > 0 ? (
        <div className="px-6 pb-[22px] sm:px-[26px]">
          <div className="mb-3.5 flex items-baseline justify-between">
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
          <HorizontalScrollRow hideHeader className="mb-0" contentClassName="gap-3">
            <>
              {upNext.map((card) => {
                const poster = toPosterSrc(card.posterUrl ?? undefined);
                const pct = upNextProgressPercent(card);
                return (
                  <div key={card.libraryShowId} className="group relative w-[196px] shrink-0">
                    <button
                      type="button"
                      onClick={() => navigate(`/series/${card.libraryShowId}`)}
                      className="group relative block h-[110px] w-[196px] overflow-hidden rounded-[7px] bg-pitflix-card text-left"
                    >
                      <MediaImage src={poster} alt="" className="h-full w-full" fallbackText={card.showTitle.slice(0, 2)} loading="lazy" />
                      <span className="pointer-events-none absolute left-1.5 top-1.5 rounded bg-black/50 px-1.5 py-0.5 text-[9.5px] font-bold text-white/85">
                        {upNextEpisodeBadge(card)}
                      </span>
                      <span className="pointer-events-none absolute bottom-1.5 right-1.5 flex h-[26px] w-[26px] items-center justify-center rounded-full bg-black/55 text-white">
                        <Play className="h-3 w-3 translate-x-0.5 fill-current" />
                      </span>
                      <span className="absolute inset-x-0 bottom-0 h-[3px] bg-white/10">
                        <span className="block h-full bg-pitflix-primary" style={{ width: `${pct}%` }} />
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
                    <p className="mt-[7px] truncate text-[12.5px] font-semibold text-white">{card.showTitle}</p>
                    <p className="text-[11px] text-white/30">
                      {card.watchedEpisodes ?? 0} / {card.totalEpisodes ?? 0} eps
                    </p>
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
