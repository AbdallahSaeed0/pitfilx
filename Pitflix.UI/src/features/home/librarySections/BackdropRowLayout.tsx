import { useMemo, useState } from "react";
import { Link, useNavigate } from "react-router-dom";
import { AnimatePresence, motion } from "framer-motion";
import { Check, ChevronRight, Play, X } from "lucide-react";
import { POSTER_WIDTHS } from "../../../utils/posterSrc";
import { cn } from "../../../utils/cn";
import { Art } from "./Art";
import {
  historyBackdropSrc,
  historyCode,
  historyDetailPath,
  historyMetaLine,
  historyPosterSrc,
  historyProgress,
  historyShowName,
  upNextCode,
  upNextCta,
  upNextEpisodeLine,
  upNextExcludingHistory,
  upNextLandscapeSrc,
  upNextPosterSrc,
  upNextProgressPercent,
  upNextRoute,
  upNextTag,
} from "./shared";
import type { DirectionProps } from "./types";

type RowItem = {
  key: string;
  historyIndex: number | null;
  historyId: number | null;
  showId: number | null;
  title: string;
  eyebrow: string;
  meta: string;
  short: string;
  pct: number;
  cta: string;
  backdrop?: string;
  poster?: string;
  detailPath: string | null;
  play: () => void;
};

/**
 * I · Row on the backdrop — one full-bleed backdrop with the Up Next row laid along its bottom
 * edge. Picking a card widens it and swaps the backdrop, title and main action.
 */
export function BackdropRowLayout({
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

  const items = useMemo<RowItem[]>(() => {
    const fromHistory = history.slice(0, 6).map<RowItem>((h, i) => {
      const { pct } = historyProgress(h);
      return {
        key: `h${h.id}`,
        historyIndex: i,
        historyId: h.id,
        showId: null,
        title: historyShowName(h, upNext),
        eyebrow: "CONTINUE WATCHING",
        meta: historyMetaLine(h),
        short: [historyCode(h), pct > 0 ? `${pct}% watched` : null].filter(Boolean).join(" · "),
        pct,
        cta: "Resume",
        backdrop: historyBackdropSrc(h),
        poster: historyPosterSrc(h, POSTER_WIDTHS.detail),
        detailPath: historyDetailPath(h),
        play: () => requestPlay(h),
      };
    });
    const fromUpNext = upNextExcludingHistory(upNext, history)
      .slice(0, 8)
      .map<RowItem>((c) => ({
        key: `u${c.libraryShowId}`,
        historyIndex: null,
        historyId: null,
        showId: c.libraryShowId,
        title: c.showTitle,
        eyebrow: upNextTag(c) ?? "UP NEXT",
        meta: `${upNextEpisodeLine(c)} · ${c.watchedEpisodes} of ${c.totalEpisodes} watched`,
        short: `${upNextCode(c)} · ${c.watchedEpisodes}/${c.totalEpisodes} eps`,
        pct: upNextProgressPercent(c),
        cta: upNextCta(c),
        backdrop: upNextLandscapeSrc(c),
        poster: upNextPosterSrc(c, POSTER_WIDTHS.detail),
        detailPath: `/series/${c.libraryShowId}`,
        play: () => navigate(upNextRoute(c)),
      }));
    return [...fromHistory, ...fromUpNext];
  }, [history, upNext, requestPlay, navigate]);

  const [pickedKey, setPickedKey] = useState<string | null>(null);
  const selected =
    items.find((it) => it.key === pickedKey) ?? items.find((it) => it.historyId === featured.id) ?? items[0];
  if (!selected) return null;

  const pick = (it: RowItem) => {
    setPickedKey(it.key);
    if (it.historyIndex != null && it.historyIndex !== currentIndex) onSelectFeatured(it.historyIndex);
  };

  return (
    <section
      aria-label="Continue watching and up next"
      className="relative h-[600px] overflow-hidden rounded-[22px] bg-pitflix-card ring-1 ring-white/10"
    >
      <AnimatePresence initial={false}>
        <motion.div
          key={selected.key}
          className="absolute inset-0"
          initial={{ opacity: 0 }}
          animate={{ opacity: 1 }}
          exit={{ opacity: 0 }}
          transition={{ duration: 0.35 }}
        >
          <Art src={selected.backdrop} fallbackPosterSrc={selected.poster} posterAlign="right" eager />
        </motion.div>
      </AnimatePresence>
      <div className="absolute inset-0 bg-gradient-to-r from-[#121214]/90 via-[#121214]/40 to-transparent" />
      <div className="absolute inset-0 bg-gradient-to-t from-[#121214] via-[#121214]/75 via-35% to-transparent to-60%" />

      <div className="absolute left-6 right-6 top-12 flex max-w-[600px] flex-col gap-3.5 sm:left-11">
        <p className="text-[11px] font-bold uppercase tracking-[0.14em] text-pitflix-light">{selected.eyebrow}</p>
        <h2 className="line-clamp-2 text-4xl font-extrabold leading-[0.95] tracking-tight text-white sm:text-[64px]">
          {selected.title}
        </h2>
        <p className="text-[16px] text-white/80">{selected.meta}</p>
        <div className="mt-2 flex flex-wrap gap-3">
          <button
            type="button"
            onClick={selected.play}
            className="flex h-12 items-center gap-2.5 rounded-xl bg-pitflix-primary px-6 text-[15px] font-bold text-white shadow-[0_4px_20px_rgba(124,58,237,0.4)] hover:bg-pitflix-light"
          >
            <Play className="h-4 w-4 fill-current" />
            {selected.cta}
          </button>
          {selected.detailPath ? (
            <button
              type="button"
              onClick={() => navigate(selected.detailPath!)}
              className="flex h-12 items-center rounded-xl border border-white/25 bg-white/[0.08] px-5 text-[15px] font-semibold text-white hover:bg-white/[0.15]"
            >
              Details
            </button>
          ) : null}
          {selected.historyId != null ? (
            <button
              type="button"
              aria-label="Mark watched"
              title="Remove or mark completed…"
              onClick={() => onManageContinue(selected.historyId!)}
              className="flex h-12 w-12 items-center justify-center rounded-xl border border-white/25 bg-white/[0.08] text-white hover:bg-white/[0.15]"
            >
              <Check className="h-[18px] w-[18px]" />
            </button>
          ) : selected.showId != null ? (
            <button
              type="button"
              aria-label="Drop from Up Next"
              title="Drop — won't show here again (keeps your watch progress)"
              disabled={dismissingUpNextId === selected.showId}
              onClick={() => {
                onDismissUpNext(selected.showId!);
                setPickedKey(null);
              }}
              className="flex h-12 w-12 items-center justify-center rounded-xl border border-white/25 bg-white/[0.08] text-white hover:bg-white/[0.15] disabled:opacity-40"
            >
              <X className="h-[18px] w-[18px]" />
            </button>
          ) : null}
        </div>
      </div>

      <div className="absolute bottom-7 left-6 right-6 flex flex-col gap-3 sm:left-11 sm:right-11">
        <div className="flex items-baseline justify-between">
          <h3 className="text-[17px] font-extrabold text-white">Up Next</h3>
          <Link to="/series" className="inline-flex items-center gap-0.5 text-[13px] font-semibold text-pitflix-light hover:underline">
            Browse series <ChevronRight className="h-3.5 w-3.5" />
          </Link>
        </div>
        <div className="-mx-1 flex gap-3.5 overflow-x-auto px-1 pb-1 [scrollbar-width:none]">
          {items.map((it) => {
            const on = it.key === selected.key;
            return (
              <button
                key={it.key}
                type="button"
                aria-pressed={on}
                aria-label={`${it.title}, ${it.short}`}
                onClick={() => pick(it)}
                className={cn(
                  "relative h-[150px] shrink-0 overflow-hidden rounded-[14px] text-left transition-[width,box-shadow] duration-300 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-pitflix-primary",
                  on ? "w-[340px] ring-2 ring-white" : "w-[190px] ring-1 ring-white/10 hover:ring-white/40",
                )}
              >
                <Art src={it.backdrop} fallbackPosterSrc={it.poster} />
                <span className="absolute inset-0 bg-gradient-to-t from-black/90 via-black/30 to-transparent" />
                <span className="absolute bottom-3.5 left-3.5 right-3.5 flex flex-col gap-0.5">
                  <span className="truncate text-[15px] font-extrabold text-white">{it.title}</span>
                  <span className="truncate text-[12px] text-white/75">{it.short}</span>
                </span>
                <span className="absolute inset-x-0 bottom-0 h-1 bg-white/15">
                  <span className="block h-full bg-pitflix-primary" style={{ width: `${it.pct}%` }} />
                </span>
              </button>
            );
          })}
        </div>
      </div>
    </section>
  );
}
