import { Link, useNavigate } from "react-router-dom";
import { Check, ChevronRight, Info, Play, X } from "lucide-react";
import { POSTER_WIDTHS } from "../../../utils/posterSrc";
import { cn } from "../../../utils/cn";
import { Art } from "./Art";
import {
  historyBackdropSrc,
  historyDetailPath,
  historyMetaLine,
  historyPosterSrc,
  historyProgress,
  historyShowName,
  upNextEpisodeLine,
  upNextLandscapeSrc,
  upNextPosterSrc,
  upNextProgressPercent,
  upNextRoute,
  upNextCode,
  upNextTag,
} from "./shared";
import type { DirectionProps } from "./types";

/** A · Cinematic billboard — full-bleed hero with a thumbnail rail, landscape episode cards below. */
export function BillboardLayout({
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
  const { pct } = historyProgress(featured);
  const detailPath = historyDetailPath(featured);
  const shelf = upNext.filter((c) => c.libraryShowId !== featured.libraryShowId).slice(0, 8);
  const rail = history.slice(0, 5);

  return (
    <div className="flex flex-col gap-9">
      <section
        aria-label={`Continue watching ${historyShowName(featured, upNext)}`}
        className="relative h-[440px] overflow-hidden rounded-2xl bg-pitflix-card ring-1 ring-white/10"
      >
        <div className="absolute inset-0">
          <Art
            key={featured.id}
            src={historyBackdropSrc(featured)}
            fallbackPosterSrc={historyPosterSrc(featured, POSTER_WIDTHS.detail)}
            posterAlign="right"
            eager
          />
        </div>
        <div className="absolute inset-0 bg-gradient-to-r from-[#121214]/95 via-[#121214]/70 to-transparent" />
        <div className="absolute inset-0 bg-gradient-to-t from-[#121214]/90 via-transparent to-transparent" />

        <button
          type="button"
          aria-label="Remove or mark completed"
          title="Remove or mark completed…"
          onClick={() => onManageContinue(featured.id)}
          className="absolute right-4 top-4 z-[2] flex h-9 w-9 items-center justify-center rounded-full border border-white/15 bg-black/50 text-white/70 backdrop-blur-sm hover:text-white"
        >
          <X className="h-4 w-4" />
        </button>

        <div className="absolute bottom-10 left-6 right-6 z-[1] flex max-w-[560px] flex-col gap-3.5 sm:left-12">
          <p className="text-[11px] font-bold uppercase tracking-[0.14em] text-pitflix-light">Continue watching</p>
          <h2 className="line-clamp-2 text-4xl font-extrabold leading-none tracking-tight text-white sm:text-[56px]">
            {historyShowName(featured, upNext)}
          </h2>
          <p className="text-[15px] text-white/75">{historyMetaLine(featured)}</p>
          <div className="mt-2 flex flex-wrap items-center gap-3">
            <button
              type="button"
              onClick={() => requestPlay(featured)}
              className="relative flex h-12 items-center gap-2.5 overflow-hidden rounded-xl bg-pitflix-primary px-6 text-[15px] font-bold text-white shadow-[0_4px_20px_rgba(124,58,237,0.4)] hover:bg-pitflix-light"
            >
              <Play className="h-4 w-4 fill-current" />
              Resume
              {pct > 0 ? (
                <>
                  <span className="absolute inset-x-0 bottom-0 h-1 bg-white/25" />
                  <span className="absolute bottom-0 left-0 h-1 bg-white" style={{ width: `${pct}%` }} />
                </>
              ) : null}
            </button>
            {detailPath ? (
              <button
                type="button"
                onClick={() => navigate(detailPath)}
                className="flex h-12 items-center gap-2 rounded-xl border border-white/20 bg-white/[0.08] px-5 text-[15px] font-semibold text-white hover:bg-white/[0.14]"
              >
                <Info className="h-4 w-4" />
                Details
              </button>
            ) : null}
            <button
              type="button"
              onClick={() => onManageContinue(featured.id)}
              className="flex h-12 items-center gap-2 rounded-xl border border-white/20 bg-white/[0.08] px-4 text-[14px] font-semibold text-white hover:bg-white/[0.14]"
            >
              <Check className="h-4 w-4" />
              Mark watched
            </button>
          </div>
        </div>

        {rail.length > 1 ? (
          <div className="absolute right-16 top-4 z-[1] hidden flex-col items-end gap-2 lg:flex">
            <p className="text-[11px] tracking-[0.06em] text-white/70">
              {currentIndex + 1} / {history.length} IN PROGRESS
            </p>
            <div className="flex gap-2.5">
              {rail.map((h, i) => (
                <button
                  key={h.id}
                  type="button"
                  aria-label={`Show ${historyShowName(h, upNext)}`}
                  aria-pressed={i === currentIndex}
                  onClick={() => onSelectFeatured(i)}
                  className={cn(
                    "relative h-[68px] w-[120px] overflow-hidden rounded-[10px] transition",
                    i === currentIndex ? "ring-2 ring-white" : "opacity-70 ring-1 ring-white/15 hover:opacity-100",
                  )}
                >
                  <Art src={historyBackdropSrc(h, 640)} fallbackPosterSrc={historyPosterSrc(h, POSTER_WIDTHS.thumb)} />
                  <span className="absolute inset-0 bg-gradient-to-t from-black/85 to-transparent" />
                  <span className="absolute bottom-1.5 left-2 right-2 truncate text-left text-[11px] font-semibold text-white">
                    {historyShowName(h, upNext)}
                  </span>
                </button>
              ))}
            </div>
          </div>
        ) : null}
      </section>

      {shelf.length > 0 ? (
        <section className="flex flex-col gap-4">
          <div className="flex items-baseline justify-between">
            <div className="flex items-baseline gap-3">
              <h2 className="text-[20px] font-extrabold text-white">Up Next</h2>
              <span className="hidden text-[13px] text-pitflix-muted sm:inline">
                The next episode of each show you're watching
              </span>
            </div>
            <Link to="/series" className="inline-flex items-center gap-0.5 text-[13px] font-semibold text-pitflix-light hover:underline">
              Browse series <ChevronRight className="h-3.5 w-3.5" />
            </Link>
          </div>
          <div className="grid grid-cols-[repeat(auto-fill,minmax(230px,1fr))] gap-5">
            {shelf.map((card) => {
              const tag = upNextTag(card);
              const cardPct = upNextProgressPercent(card);
              return (
                <div key={card.libraryShowId} className="group relative flex flex-col gap-2.5">
                  <button
                    type="button"
                    aria-label={`${card.showTitle}, ${upNextCode(card)}`}
                    onClick={() => navigate(upNextRoute(card))}
                    className="relative aspect-video overflow-hidden rounded-xl bg-pitflix-card text-left ring-1 ring-white/10 transition group-hover:ring-pitflix-primary/60 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-pitflix-primary"
                  >
                    <Art src={upNextLandscapeSrc(card, 640)} fallbackPosterSrc={upNextPosterSrc(card)} />
                    <span className="absolute right-2.5 top-2.5 rounded-md bg-black/80 px-2 py-1 text-[11px] font-bold text-white">
                      {upNextCode(card)}
                    </span>
                    {tag ? (
                      <span className="absolute left-0 top-2.5 rounded-r-md bg-pitflix-primary px-2 py-1 text-[10px] font-extrabold tracking-[0.06em] text-white">
                        {tag}
                      </span>
                    ) : null}
                    <span className="absolute left-1/2 top-1/2 flex h-11 w-11 -translate-x-1/2 -translate-y-1/2 items-center justify-center rounded-full border border-white/35 bg-black/60 opacity-0 transition group-hover:opacity-100">
                      <Play className="h-4 w-4 translate-x-0.5 fill-white text-white" />
                    </span>
                    <span className="absolute inset-x-0 bottom-0 h-1 bg-white/15">
                      <span className="block h-full bg-pitflix-primary" style={{ width: `${cardPct}%` }} />
                    </span>
                  </button>
                  <button
                    type="button"
                    aria-label={`Drop ${card.showTitle} from Up Next`}
                    title="Drop — won't show here again (keeps your watch progress)"
                    disabled={dismissingUpNextId === card.libraryShowId}
                    onClick={() => onDismissUpNext(card.libraryShowId)}
                    className="absolute left-2 top-11 z-[1] flex h-7 w-7 items-center justify-center rounded-full bg-black/75 text-white opacity-0 ring-1 ring-white/15 transition hover:bg-red-600/90 group-hover:opacity-100 disabled:opacity-40"
                  >
                    <X className="h-3.5 w-3.5" />
                  </button>
                  <div className="flex justify-between gap-2">
                    <div className="min-w-0">
                      <p className="truncate text-[14px] font-bold text-white">{card.showTitle}</p>
                      <p className="truncate text-[12.5px] text-pitflix-muted">{upNextEpisodeLine(card)}</p>
                    </div>
                    <span className="shrink-0 pt-0.5 text-[12px] text-pitflix-muted">
                      {card.episodesRemaining} left
                    </span>
                  </div>
                </div>
              );
            })}
          </div>
        </section>
      ) : null}
    </div>
  );
}
