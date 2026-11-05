import { Link, useNavigate } from "react-router-dom";
import { motion } from "framer-motion";
import { Check, ChevronLeft, ChevronRight, Play, X } from "lucide-react";
import { POSTER_WIDTHS } from "../../../utils/posterSrc";
import { cn } from "../../../utils/cn";
import { useAppPrefsStore } from "../../../store/appPrefsStore";
import { Art } from "./Art";
import {
  historyBackdropSrc,
  historyDetailPath,
  historyMetaLine,
  historyPosterSrc,
  historyProgress,
  historyShowName,
  upNextCode,
  upNextLandscapeSrc,
  upNextPosterSrc,
  upNextProgressPercent,
  upNextRoute,
  upNextTag,
} from "./shared";
import type { DirectionProps } from "./types";

/**
 * H · Preview window — a wide, slowly drifting backdrop "window" with the title block underneath
 * (Netflix 2025 TV layout), and labelled Up Next tiles whose art can be episode stills or posters
 * (Apple TV's Continue Watching art setting).
 */
export function PreviewLayout({
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
  const artStyle = useAppPrefsStore((s) => s.upNextArtStyle);
  const setArtStyle = useAppPrefsStore((s) => s.setUpNextArtStyle);
  const poster = artStyle === "poster";

  const { pct } = historyProgress(featured);
  const detailPath = historyDetailPath(featured);
  const shelf = upNext.filter((c) => c.libraryShowId !== featured.libraryShowId).slice(0, poster ? 16 : 10);
  const count = history.length;

  return (
    <div className="flex flex-col gap-5">
      <section className="relative h-[440px] overflow-hidden rounded-[20px] bg-pitflix-card ring-1 ring-white/10 lg:h-[480px]">
        <motion.div
          key={featured.id}
          className="absolute inset-0"
          initial={{ scale: 1, x: 0, opacity: 0 }}
          animate={{ scale: 1.09, x: -18, opacity: 1 }}
          transition={{
            opacity: { duration: 0.5 },
            scale: { duration: 22, ease: "linear", repeat: Infinity, repeatType: "reverse" },
            x: { duration: 22, ease: "linear", repeat: Infinity, repeatType: "reverse" },
          }}
        >
          <Art
            src={historyBackdropSrc(featured)}
            fallbackPosterSrc={historyPosterSrc(featured, POSTER_WIDTHS.detail)}
            posterAlign="right"
            eager
          />
        </motion.div>
        <div className="absolute inset-0 bg-gradient-to-t from-[#121214] via-[#121214]/55 via-35% to-transparent to-65%" />
        <div className="absolute inset-0 bg-gradient-to-r from-[#121214]/60 via-transparent to-transparent" />

        {count > 1 ? (
          <div className="absolute right-4 top-4 flex items-center gap-2">
            <span className="rounded-full bg-black/55 px-2.5 py-1 text-[11px] font-semibold text-white/85 backdrop-blur-sm">
              {currentIndex + 1} / {count}
            </span>
            <button
              type="button"
              aria-label="Previous title"
              onClick={() => onSelectFeatured((currentIndex - 1 + count) % count)}
              className="flex h-11 w-11 items-center justify-center rounded-full border border-white/40 bg-black/45 text-white backdrop-blur-sm hover:bg-black/70"
            >
              <ChevronLeft className="h-5 w-5" />
            </button>
            <button
              type="button"
              aria-label="Next title"
              onClick={() => onSelectFeatured((currentIndex + 1) % count)}
              className="flex h-11 w-11 items-center justify-center rounded-full border border-white/40 bg-black/45 text-white backdrop-blur-sm hover:bg-black/70"
            >
              <ChevronRight className="h-5 w-5" />
            </button>
          </div>
        ) : null}

        <div className="absolute inset-x-6 bottom-6 flex flex-wrap items-end justify-between gap-x-8 gap-y-4 sm:inset-x-8 sm:bottom-7">
          <div className="flex min-w-0 flex-col gap-2.5">
            <div className="flex flex-wrap gap-2">
              <span className="rounded-md bg-pitflix-primary px-2 py-1 text-[10.5px] font-extrabold tracking-[0.06em] text-white">
                CONTINUE WATCHING
              </span>
              <span className="rounded-md bg-black/50 px-2 py-1 text-[10.5px] font-extrabold tracking-[0.06em] text-white/85 backdrop-blur-sm">
                {featured.mediaType === "Movie" ? "MOVIE" : "SERIES"}
              </span>
            </div>
            <div className="flex flex-wrap items-baseline gap-x-4 gap-y-1">
              <h2 className="text-3xl font-extrabold leading-none tracking-tight text-white drop-shadow-lg sm:text-[44px]">
                {historyShowName(featured, upNext)}
              </h2>
              <span className="text-[15px] text-white/80">{historyMetaLine(featured)}</span>
            </div>
            {pct > 0 ? (
              <div className="flex w-[min(420px,100%)] items-center gap-3">
                <div className="h-1 flex-1 overflow-hidden rounded-full bg-white/20">
                  <div className="h-full rounded-full bg-pitflix-primary" style={{ width: `${pct}%` }} />
                </div>
                <span className="text-[12px] text-white/70">{pct}%</span>
              </div>
            ) : null}
          </div>
          <div className="flex gap-2.5">
            <button
              type="button"
              onClick={() => requestPlay(featured)}
              className="flex h-12 items-center gap-2.5 rounded-lg bg-white px-6 text-[15px] font-extrabold text-[#121214] hover:bg-white/85"
            >
              <Play className="h-4 w-4 fill-current" />
              Resume
            </button>
            {detailPath ? (
              <button
                type="button"
                onClick={() => navigate(detailPath)}
                className="flex h-12 items-center rounded-lg bg-white/[0.16] px-5 text-[15px] font-bold text-white backdrop-blur-sm hover:bg-white/[0.26]"
              >
                More info
              </button>
            ) : null}
            <button
              type="button"
              aria-label="Remove or mark completed"
              title="Remove or mark completed…"
              onClick={() => onManageContinue(featured.id)}
              className="flex h-12 w-12 items-center justify-center rounded-full border-[1.5px] border-white/50 bg-black/30 text-white backdrop-blur-sm hover:border-white"
            >
              <Check className="h-[18px] w-[18px]" />
            </button>
          </div>
        </div>
      </section>

      {shelf.length > 0 ? (
        <section className="mt-2 flex flex-col gap-3">
          <div className="flex flex-wrap items-center justify-between gap-3">
            <h2 className="text-[19px] font-extrabold text-white">Up Next</h2>
            <div className="flex items-center gap-4">
              <div role="group" aria-label="Card art" className="flex rounded-lg border border-white/10 bg-white/[0.03] p-0.5">
                {(["still", "poster"] as const).map((s) => (
                  <button
                    key={s}
                    type="button"
                    aria-pressed={artStyle === s}
                    onClick={() => setArtStyle(s)}
                    className={cn(
                      "rounded-md px-2.5 py-1 text-[12px] font-semibold",
                      artStyle === s ? "bg-white/[0.12] text-white" : "text-white/55 hover:text-white",
                    )}
                  >
                    {s === "still" ? "Stills" : "Posters"}
                  </button>
                ))}
              </div>
              <Link to="/series" className="inline-flex items-center gap-0.5 text-[13px] font-semibold text-pitflix-light hover:underline">
                Browse series <ChevronRight className="h-3.5 w-3.5" />
              </Link>
            </div>
          </div>
          <div
            className={cn(
              "grid gap-3.5",
              poster
                ? "grid-cols-[repeat(auto-fill,minmax(130px,1fr))]"
                : "grid-cols-[repeat(auto-fill,minmax(210px,1fr))]",
            )}
          >
            {shelf.map((card) => {
              const tag = upNextTag(card);
              return (
                <div key={card.libraryShowId} className="group relative flex flex-col gap-2">
                  <button
                    type="button"
                    aria-label={`${card.showTitle}, ${upNextCode(card)}`}
                    onClick={() => navigate(upNextRoute(card))}
                    className={cn(
                      "relative overflow-hidden rounded-[10px] bg-pitflix-card ring-1 ring-white/10 transition group-hover:scale-[1.03] group-hover:ring-white/40 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-pitflix-primary",
                      poster ? "aspect-[2/3]" : "aspect-video",
                    )}
                  >
                    {poster ? (
                      <Art src={upNextPosterSrc(card)} />
                    ) : (
                      <Art src={upNextLandscapeSrc(card, 640)} fallbackPosterSrc={upNextPosterSrc(card)} />
                    )}
                    {tag ? (
                      <span className="absolute bottom-2 left-0 rounded-r-[5px] bg-red-700 px-2 py-1 text-[10px] font-extrabold tracking-[0.06em] text-white">
                        {tag}
                      </span>
                    ) : null}
                    <span className="absolute inset-x-0 bottom-0 h-1 bg-white/15">
                      <span className="block h-full bg-pitflix-primary" style={{ width: `${upNextProgressPercent(card)}%` }} />
                    </span>
                  </button>
                  <button
                    type="button"
                    aria-label={`Drop ${card.showTitle} from Up Next`}
                    title="Drop — won't show here again (keeps your watch progress)"
                    disabled={dismissingUpNextId === card.libraryShowId}
                    onClick={() => onDismissUpNext(card.libraryShowId)}
                    className="absolute right-1.5 top-1.5 z-[1] flex h-7 w-7 items-center justify-center rounded-full bg-black/75 text-white opacity-0 ring-1 ring-white/15 transition hover:bg-red-600/90 group-hover:opacity-100 disabled:opacity-40"
                  >
                    <X className="h-3.5 w-3.5" />
                  </button>
                  <div className="min-w-0">
                    <p className="truncate text-[13px] font-bold text-white">{card.showTitle}</p>
                    <p className="text-[12px] text-pitflix-muted">
                      {upNextCode(card)} · {card.watchedEpisodes}/{card.totalEpisodes}
                    </p>
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
