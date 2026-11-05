import { useEffect, useMemo, useRef, useState } from "react";
import { Link, useNavigate } from "react-router-dom";
import { useQuery } from "@tanstack/react-query";
import { Check, ChevronLeft, ChevronRight, Play, X } from "lucide-react";
import { getShowSeason } from "../../../api/series";
import { POSTER_WIDTHS, toPosterSrc } from "../../../utils/posterSrc";
import { cn } from "../../../utils/cn";
import { isPlayerCovering } from "../../../store/playerCoverStore";
import { parseSeEp } from "../ContinueWatchingHero";
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

type ShelfItem = {
  key: string;
  historyIndex: number | null;
  historyId: number | null;
  showId: number | null;
  season: number | null;
  episode: number | null;
  title: string;
  code: string;
  meta: string;
  tag: string | null;
  pct: number;
  progressText: string;
  cta: string;
  backdrop?: string;
  poster?: string;
  detailPath: string | null;
  play: () => void;
};

/** Auto-advance cadence, and how long a manual slide/pick holds it off. */
const AUTO_ADVANCE_MS = 7000;
const IDLE_RESUME_MS = 15000;

type SeasonEpisodeRow = {
  id?: number | null;
  episodeNumber: number;
  title?: string | null;
  stillLocalPath?: string | null;
  stillUrl?: string | null;
};

/**
 * J · Tall-poster shelf (Disney+ / Apple TV) — one "Continue Watching" row of tall posters; the
 * picked one opens into a wide card with backdrop and actions, and the episodes after it list below.
 */
export function PosterShelfLayout({
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

  const items = useMemo<ShelfItem[]>(() => {
    const fromHistory = history.slice(0, 6).map<ShelfItem>((h, i) => {
      const { pct } = historyProgress(h);
      const { season, episodeNumber } = parseSeEp(h.nextUpLabel);
      return {
        key: `h${h.id}`,
        historyIndex: i,
        historyId: h.id,
        showId: h.libraryShowId ?? null,
        season: season ?? null,
        episode: episodeNumber ?? null,
        title: historyShowName(h, upNext),
        code: historyCode(h) ?? (h.mediaType === "Movie" ? "Movie" : ""),
        meta: historyMetaLine(h),
        tag: "CONTINUE",
        pct,
        progressText: pct > 0 ? `${pct}% watched` : "",
        cta: "Resume",
        backdrop: historyBackdropSrc(h),
        poster: historyPosterSrc(h, POSTER_WIDTHS.detail),
        detailPath: historyDetailPath(h),
        play: () => requestPlay(h),
      };
    });
    const fromUpNext = upNextExcludingHistory(upNext, history)
      .slice(0, 10)
      .map<ShelfItem>((c) => ({
        key: `u${c.libraryShowId}`,
        historyIndex: null,
        historyId: null,
        showId: c.libraryShowId,
        season: c.nextSeason,
        episode: c.nextEpisode,
        title: c.showTitle,
        code: upNextCode(c),
        meta: upNextEpisodeLine(c),
        tag: upNextTag(c),
        pct: upNextProgressPercent(c),
        progressText: `${c.watchedEpisodes} of ${c.totalEpisodes}`,
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

  const seasonQ = useQuery({
    queryKey: ["show-season", selected?.showId, selected?.season],
    queryFn: () => getShowSeason(selected!.showId!, selected!.season!),
    enabled: !!selected && selected.showId != null && selected.showId > 0 && (selected.season ?? 0) > 0,
    staleTime: 60_000,
  });
  const nextEps = ((seasonQ.data?.episodes ?? []) as SeasonEpisodeRow[])
    .filter((e) => selected?.episode != null && e.episodeNumber > selected.episode)
    .slice(0, 4);

  const selectedIndex = selected ? items.findIndex((it) => it.key === selected.key) : -1;
  const rowRef = useRef<HTMLDivElement>(null);
  const drag = useRef<{ x: number; left: number; moved: boolean } | null>(null);
  const [hovering, setHovering] = useState(false);
  const [lastInteractAt, setLastInteractAt] = useState(0);
  const [retryTick, setRetryTick] = useState(0);

  // Auto-advance: paused while hovered, and for a while after any manual slide or pick. Skips (and
  // retries) while the window is hidden or the full player covers this kept-alive page.
  useEffect(() => {
    if (items.length < 2 || hovering || selectedIndex < 0) return;
    const wait = Math.max(AUTO_ADVANCE_MS, lastInteractAt + IDLE_RESUME_MS - Date.now());
    const t = window.setTimeout(() => {
      if (document.hidden || isPlayerCovering()) {
        setRetryTick((n) => n + 1);
        return;
      }
      setPickedKey(items[(selectedIndex + 1) % items.length]!.key);
    }, wait);
    return () => window.clearTimeout(t);
  }, [items, selectedIndex, hovering, lastInteractAt, retryTick]);

  // Keep the open card in view — after the 300ms width transition so offsets have settled.
  useEffect(() => {
    const row = rowRef.current;
    if (!row || !selected) return;
    const t = window.setTimeout(() => {
      const el = row.querySelector<HTMLElement>(`[data-shelf-key="${selected.key}"]`);
      if (el) row.scrollTo({ left: Math.max(0, el.offsetLeft - 4), behavior: "smooth" });
    }, 320);
    return () => window.clearTimeout(t);
  }, [selected?.key]);

  if (!selected) return null;

  const pick = (it: ShelfItem) => {
    setPickedKey(it.key);
    setLastInteractAt(Date.now());
    if (it.historyIndex != null && it.historyIndex !== currentIndex) onSelectFeatured(it.historyIndex);
  };
  const step = (dir: 1 | -1) => pick(items[(selectedIndex + dir + items.length) % items.length]!);

  return (
    <div className="flex flex-col gap-6">
      <div className="flex items-center justify-between">
        <div className="flex items-baseline gap-3">
          <h2 className="text-[22px] font-extrabold text-white">Continue Watching</h2>
          <span className="text-[13px] text-pitflix-muted">{items.length} titles</span>
        </div>
        <div className="flex items-center gap-4">
          <Link to="/series" className="inline-flex items-center gap-0.5 text-[13px] font-semibold text-pitflix-light hover:underline">
            Browse series <ChevronRight className="h-3.5 w-3.5" />
          </Link>
          {items.length > 1 ? (
            <div className="flex gap-2">
              <button
                type="button"
                aria-label="Previous title"
                onClick={() => step(-1)}
                className="flex h-10 w-10 items-center justify-center rounded-full border border-white/20 bg-white/[0.06] text-white transition hover:bg-white/[0.14]"
              >
                <ChevronLeft className="h-5 w-5" />
              </button>
              <button
                type="button"
                aria-label="Next title"
                onClick={() => step(1)}
                className="flex h-10 w-10 items-center justify-center rounded-full border border-white/20 bg-white/[0.06] text-white transition hover:bg-white/[0.14]"
              >
                <ChevronRight className="h-5 w-5" />
              </button>
            </div>
          ) : null}
        </div>
      </div>

      <div className="relative" onMouseEnter={() => setHovering(true)} onMouseLeave={() => setHovering(false)}>
      <div
        ref={rowRef}
        className="relative -mx-1 flex select-none gap-4 overflow-x-auto px-1 [scrollbar-width:none] [&::-webkit-scrollbar]:hidden"
        onWheel={() => setLastInteractAt(Date.now())}
        onPointerDown={(e) => {
          if (e.pointerType !== "mouse" || e.button !== 0 || !rowRef.current) return;
          drag.current = { x: e.clientX, left: rowRef.current.scrollLeft, moved: false };
        }}
        onPointerMove={(e) => {
          const d = drag.current;
          if (!d || !rowRef.current) return;
          const dx = e.clientX - d.x;
          if (Math.abs(dx) > 6) d.moved = true;
          if (d.moved) rowRef.current.scrollLeft = d.left - dx;
        }}
        onPointerUp={() => {
          if (drag.current?.moved) setLastInteractAt(Date.now());
          // Cleared after the click event so a drag doesn't also open the card under the cursor.
          window.setTimeout(() => (drag.current = null), 0);
        }}
        onPointerLeave={() => {
          drag.current = null;
        }}
        onClickCapture={(e) => {
          if (drag.current?.moved) {
            e.preventDefault();
            e.stopPropagation();
          }
        }}
      >
        {items.map((it) => {
          const on = it.key === selected.key;
          return (
            <div
              key={it.key}
              data-shelf-key={it.key}
              className={cn(
                "relative h-[400px] shrink-0 overflow-hidden rounded-2xl bg-pitflix-card transition-[width] duration-300",
                on ? "w-[min(620px,85vw)] ring-2 ring-white/90" : "w-[200px] ring-1 ring-white/10 hover:ring-white/40",
              )}
            >
              {on ? (
                <>
                  <Art src={it.backdrop} fallbackPosterSrc={it.poster} posterAlign="right" eager />
                  <div className="absolute inset-0 bg-gradient-to-r from-[#0e0e10]/95 via-[#0e0e10]/60 to-[#0e0e10]/10" />
                  <div className="absolute inset-0 bg-gradient-to-t from-[#0e0e10]/80 via-transparent to-transparent" />
                  <div className="absolute bottom-7 left-7 flex w-[min(566px,calc(85vw-56px))] flex-col gap-3">
                    {it.tag ? (
                      <span className="self-start rounded-md bg-pitflix-primary px-2 py-1 text-[10.5px] font-extrabold tracking-[0.06em] text-white">
                        {it.tag}
                      </span>
                    ) : null}
                    <h3 className="line-clamp-2 text-[40px] font-extrabold leading-none tracking-tight text-white">{it.title}</h3>
                    <p className="text-[15px] text-white/80">{it.meta}</p>
                    {it.pct > 0 ? (
                      <div className="flex max-w-[440px] items-center gap-3">
                        <div className="h-1 flex-1 overflow-hidden rounded-full bg-white/20">
                          <div className="h-full rounded-full bg-pitflix-primary" style={{ width: `${it.pct}%` }} />
                        </div>
                        <span className="text-[12px] text-white/75">{it.progressText}</span>
                      </div>
                    ) : null}
                    <div className="mt-1 flex flex-wrap gap-2.5">
                      <button
                        type="button"
                        onClick={it.play}
                        className="flex h-12 items-center gap-2 rounded-full bg-white px-6 text-[15px] font-extrabold text-[#121214] hover:bg-white/85"
                      >
                        <Play className="h-4 w-4 fill-current" />
                        {it.cta}
                      </button>
                      {it.detailPath ? (
                        <button
                          type="button"
                          onClick={() => navigate(it.detailPath!)}
                          className="flex h-12 items-center rounded-full border border-white/30 bg-white/[0.06] px-5 text-[15px] font-semibold text-white hover:bg-white/[0.14]"
                        >
                          Details
                        </button>
                      ) : null}
                      {it.historyId != null ? (
                        <button
                          type="button"
                          aria-label="Mark watched"
                          title="Remove or mark completed…"
                          onClick={() => onManageContinue(it.historyId!)}
                          className="flex h-12 w-12 items-center justify-center rounded-full border border-white/30 bg-white/[0.06] text-white hover:bg-white/[0.14]"
                        >
                          <Check className="h-[18px] w-[18px]" />
                        </button>
                      ) : it.showId != null ? (
                        <button
                          type="button"
                          aria-label="Drop from Up Next"
                          title="Drop — won't show here again (keeps your watch progress)"
                          disabled={dismissingUpNextId === it.showId}
                          onClick={() => {
                            onDismissUpNext(it.showId!);
                            setPickedKey(null);
                          }}
                          className="flex h-12 w-12 items-center justify-center rounded-full border border-white/30 bg-white/[0.06] text-white hover:bg-white/[0.14] disabled:opacity-40"
                        >
                          <X className="h-[18px] w-[18px]" />
                        </button>
                      ) : null}
                    </div>
                  </div>
                </>
              ) : (
                <button
                  type="button"
                  aria-label={`${it.title}${it.code ? `, ${it.code}` : ""}`}
                  onClick={() => pick(it)}
                  className="absolute inset-0 text-left focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-inset focus-visible:ring-pitflix-primary"
                >
                  <Art src={it.poster} fallbackPosterSrc={undefined} />
                  <span className="absolute inset-x-0 bottom-0 flex flex-col gap-1 bg-gradient-to-t from-black/95 to-transparent px-3.5 pb-4 pt-14">
                    <span className="truncate text-[15px] font-extrabold text-white">{it.title}</span>
                    <span className="text-[12px] text-white/75">{it.code}</span>
                  </span>
                </button>
              )}
              <span className="pointer-events-none absolute inset-x-0 bottom-0 h-1 bg-white/15">
                <span className="block h-full bg-pitflix-primary" style={{ width: `${it.pct}%` }} />
              </span>
            </div>
          );
        })}
      </div>
      </div>
      {items.length > 1 ? (
        <div className="-mt-2 flex justify-center gap-1.5">
          {items.map((it, i) => (
            <button
              key={it.key}
              type="button"
              aria-label={`Show ${it.title}`}
              aria-current={i === selectedIndex}
              onClick={() => pick(it)}
              className="flex h-5 items-center px-0.5"
            >
              <span
                className={cn(
                  "block h-1.5 rounded-full transition-all duration-300",
                  i === selectedIndex ? "w-6 bg-pitflix-primary" : "w-1.5 bg-white/25 hover:bg-white/50",
                )}
              />
            </button>
          ))}
        </div>
      ) : null}

      {nextEps.length > 0 && selected.showId != null ? (
        <section className="flex flex-col gap-3">
          <div className="flex items-baseline gap-2.5">
            <h3 className="text-[17px] font-extrabold text-white">Next in {selected.title}</h3>
            <span className="text-[13px] text-pitflix-muted">after {selected.code}</span>
          </div>
          <div className="grid grid-cols-2 gap-3.5 md:grid-cols-4">
            {nextEps.map((e) => (
              <button
                key={e.id ?? e.episodeNumber}
                type="button"
                onClick={() => navigate(`/series/${selected.showId}/season/${selected.season}`)}
                className="group flex flex-col gap-2 text-left"
              >
                <span className="relative block aspect-video overflow-hidden rounded-[10px] bg-pitflix-card ring-1 ring-white/10 transition group-hover:ring-white/40">
                  <Art
                    src={toPosterSrc(e.stillLocalPath ?? e.stillUrl ?? undefined, 640)}
                    fallbackPosterSrc={selected.backdrop}
                  />
                </span>
                <span className="truncate text-[13px] font-bold text-white">
                  S{selected.season} E{e.episodeNumber}
                  {e.title?.trim() ? <span className="font-medium text-pitflix-muted"> · {e.title.trim()}</span> : null}
                </span>
              </button>
            ))}
          </div>
        </section>
      ) : null}
    </div>
  );
}
