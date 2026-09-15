import { AnimatePresence, motion } from "framer-motion";
import { ArrowLeft, Check, Dices, Library, ListVideo, Play, RotateCcw, Search, Shuffle, X } from "lucide-react";
import { useEffect, useMemo, useRef, useState } from "react";
import { useNavigate } from "react-router-dom";
import { useQuery } from "@tanstack/react-query";
import { getWatchingCurrently, type WatchingCurrentlyCard } from "../../api/homeDiscover";
import { searchLibraryTitles, type LibraryTitleRow } from "../../api/library";
import { getLists, getListItems, type UserListSummary } from "../../api/lists";
import { getMovies } from "../../api/movies";
import { getAllSeries } from "../../api/series";
import { getStats } from "../../api/stats";
import type { MediaCard } from "../../types/media";
import type { StreamingDetailsLocationState } from "../../pages/StreamingDetailsPage";
import { formatListMenuLabel } from "../../utils/listMarks";
import { MediaImage } from "../../components/ui/MediaImage";
import { POSTER_WIDTHS, toPosterSrc } from "../../utils/posterSrc";
import { cn } from "../../utils/cn";

export type RouletteModalProps = {
  open: boolean;
  onClose: () => void;
};

const UP_NEXT_SOURCE_ID = "up-next";
const LIBRARY_SOURCE_ID = "library";
const CUSTOM_SOURCE_ID = "custom";
type TypeFilter = "all" | "movie" | "series";

/** One candidate the reel can land on, normalized from either an Up Next card or a list's MediaCard. */
type RouletteItem = {
  key: string;
  title: string;
  subtitle: string | null;
  posterUrl: string | null;
  mediaKind: "movie" | "series";
  goTo: () => void;
};

// Slider geometry — fixed pixel sizes keep the centering math simple and predictable.
const SLIDER_ITEM_W = 132;
const SLIDER_ITEM_H = 198;
const SLIDER_GAP = 14;
const SLIDER_STEP = SLIDER_ITEM_W + SLIDER_GAP;
const SLIDER_VIEWPORT_W = 700;
const SLIDER_CENTER_OFFSET = SLIDER_VIEWPORT_W / 2 - SLIDER_ITEM_W / 2;
const SLIDE_DURATION_MS = 3800;

function sliderOffsetForIndex(index: number): number {
  return SLIDER_CENTER_OFFSET - index * SLIDER_STEP;
}

function continueSeasonRoute(card: WatchingCurrentlyCard): string {
  let s = card.nextSeason;
  if (!Number.isFinite(s) || s <= 0) {
    const m = /^S(\d+)/i.exec((card.nextLabel ?? "").trim());
    if (m) s = parseInt(m[1]!, 10);
  }
  if (Number.isFinite(s) && s > 0) return `/series/${card.libraryShowId}/season/${s}`;
  return `/series/${card.libraryShowId}`;
}

function listItemMediaType(item: MediaCard): "Movie" | "Series" {
  const raw = item.tmdbMediaType ?? (item.mediaFilePath || item.filePath ? "Movie" : "Series");
  return raw === "Series" ? "Series" : "Movie";
}

function customItemKey(row: LibraryTitleRow): string {
  return row.kind === "movie" ? `lib-movie-${row.id}` : `lib-series-${row.id}`;
}

export function RouletteModal({ open, onClose }: RouletteModalProps) {
  const navigate = useNavigate();
  const [phase, setPhase] = useState<"choose" | "rolling">("choose");
  const [selectedSourceIds, setSelectedSourceIds] = useState<Set<string>>(new Set([UP_NEXT_SOURCE_ID]));
  const [typeFilter, setTypeFilter] = useState<TypeFilter>("all");
  const [buildingPool, setBuildingPool] = useState(false);
  const [customItems, setCustomItems] = useState<Map<string, RouletteItem>>(new Map());
  const [customQuery, setCustomQuery] = useState("");
  const [debouncedCustomQuery, setDebouncedCustomQuery] = useState("");
  const [pool, setPool] = useState<RouletteItem[] | null>(null);
  const [activeKey, setActiveKey] = useState<string | null>(null);
  const [spinning, setSpinning] = useState(false);
  const [error, setError] = useState<string | null>(null);

  // Slider reel state — a (possibly repeated) run of items long enough to land exactly on the winner.
  const [sliderItems, setSliderItems] = useState<RouletteItem[]>([]);
  const [sliderOffset, setSliderOffset] = useState(0);
  const [sliderAnimate, setSliderAnimate] = useState(false);

  const timeoutRef = useRef<number | null>(null);
  const rafRef = useRef<number | null>(null);

  const watchingQ = useQuery({
    queryKey: ["home-watching-currently"],
    queryFn: getWatchingCurrently,
    enabled: open,
    staleTime: 45_000,
  });

  const listsQ = useQuery({
    queryKey: ["lists"],
    queryFn: getLists,
    enabled: open,
    staleTime: 60_000,
  });

  const statsQ = useQuery({
    queryKey: ["stats"],
    queryFn: getStats,
    enabled: open,
    staleTime: 60_000,
  });

  useEffect(() => {
    const t = setTimeout(() => setDebouncedCustomQuery(customQuery.trim()), 200);
    return () => clearTimeout(t);
  }, [customQuery]);

  const customSearchQ = useQuery({
    queryKey: ["roulette-custom-search", debouncedCustomQuery],
    queryFn: ({ signal }) => searchLibraryTitles(debouncedCustomQuery, signal),
    enabled: open && selectedSourceIds.has(CUSTOM_SOURCE_ID) && debouncedCustomQuery.length >= 2,
    staleTime: 30_000,
  });

  function clearSpinTimer() {
    if (timeoutRef.current != null) {
      window.clearTimeout(timeoutRef.current);
      timeoutRef.current = null;
    }
    if (rafRef.current != null) {
      window.cancelAnimationFrame(rafRef.current);
      rafRef.current = null;
    }
  }

  function reset() {
    clearSpinTimer();
    setPhase("choose");
    setPool(null);
    setActiveKey(null);
    setSpinning(false);
    setBuildingPool(false);
    setError(null);
    setSliderItems([]);
    setSliderOffset(0);
    setSliderAnimate(false);
    setCustomQuery("");
    setDebouncedCustomQuery("");
  }

  useEffect(() => {
    if (!open) reset();
  }, [open]);

  useEffect(() => () => clearSpinTimer(), []);

  useEffect(() => {
    if (!open) return;
    const onKey = (e: KeyboardEvent) => {
      if (e.key === "Escape") onClose();
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [open, onClose]);

  function toggleSource(id: string) {
    setSelectedSourceIds((prev) => {
      const next = new Set(prev);
      if (next.has(id)) next.delete(id);
      else next.add(id);
      return next;
    });
  }

  function addCustomItem(row: LibraryTitleRow) {
    const key = customItemKey(row);
    setCustomItems((prev) => {
      if (prev.has(key)) return prev;
      const next = new Map(prev);
      next.set(key, {
        key,
        title: row.title,
        subtitle: row.year != null ? String(row.year) : null,
        posterUrl: row.posterUrl ?? null,
        mediaKind: row.kind,
        goTo: () => navigate(row.kind === "movie" ? `/movie/${row.id}` : `/series/${row.id}`),
      });
      return next;
    });
    setSelectedSourceIds((prev) => {
      if (prev.has(CUSTOM_SOURCE_ID)) return prev;
      const next = new Set(prev);
      next.add(CUSTOM_SOURCE_ID);
      return next;
    });
  }

  function removeCustomItem(key: string) {
    setCustomItems((prev) => {
      if (!prev.has(key)) return prev;
      const next = new Map(prev);
      next.delete(key);
      return next;
    });
  }

  function goToMediaCardItem(item: MediaCard): () => void {
    return () => {
      if (item.id > 0) {
        const mediaType = listItemMediaType(item);
        navigate(mediaType === "Movie" ? `/movie/${item.id}` : `/series/${item.id}`);
        return;
      }
      if (item.tmdbId > 0) {
        const mediaType = listItemMediaType(item);
        const state: StreamingDetailsLocationState = {
          tmdbId: item.tmdbId,
          mediaType,
          title: item.title,
          posterUrl: item.posterRemoteUrl ?? null,
          year: item.year != null ? String(item.year) : null,
          imdbId: item.imdbId ?? null,
        };
        navigate("/stream-details", { state });
      }
    };
  }

  async function buildPool(): Promise<RouletteItem[]> {
    const parts: RouletteItem[] = [];

    if (selectedSourceIds.has(UP_NEXT_SOURCE_ID)) {
      const rows = watchingQ.data ?? (await getWatchingCurrently());
      for (const card of rows) {
        parts.push({
          key: `upnext-${card.libraryShowId}`,
          title: card.showTitle,
          subtitle: card.nextLabel || null,
          posterUrl: card.posterUrl,
          mediaKind: "series",
          goTo: () => navigate(continueSeasonRoute(card)),
        });
      }
    }

    const listIds = [...selectedSourceIds]
      .filter((id) => id.startsWith("list-"))
      .map((id) => Number(id.slice("list-".length)));

    if (listIds.length > 0) {
      const results = await Promise.all(listIds.map((id) => getListItems(id)));
      results.forEach((raw) => {
        (raw as MediaCard[])
          .filter((i) => i.id > 0 || i.tmdbId > 0)
          .forEach((item) => {
            const mediaKind = listItemMediaType(item) === "Movie" ? "movie" : "series";
            parts.push({
              key: `list-${item.id}-${item.tmdbId}`,
              title: item.title,
              subtitle: item.year != null ? String(item.year) : null,
              posterUrl: item.selectedPosterPath || item.posterLocalPath || item.posterRemoteUrl || null,
              mediaKind,
              goTo: goToMediaCardItem(item),
            });
          });
      });
    }

    if (selectedSourceIds.has(CUSTOM_SOURCE_ID)) {
      for (const item of customItems.values()) parts.push(item);
    }

    if (selectedSourceIds.has(LIBRARY_SOURCE_ID)) {
      const wantMovies = typeFilter !== "series";
      const wantSeries = typeFilter !== "movie";
      const [movieItems, seriesItems] = await Promise.all([
        wantMovies ? getMovies({ pageSize: 5000, sort: "title" }) : Promise.resolve({ items: [] }),
        wantSeries ? getAllSeries({ pageSize: 5000, sort: "title" }) : Promise.resolve({ items: [] }),
      ]);
      for (const item of (movieItems.items ?? []) as MediaCard[]) {
        parts.push({
          key: `lib-movie-${item.id}`,
          title: item.title,
          subtitle: item.year != null ? String(item.year) : null,
          posterUrl: item.selectedPosterPath || item.posterLocalPath || item.posterRemoteUrl || null,
          mediaKind: "movie",
          goTo: () => navigate(`/movie/${item.id}`),
        });
      }
      for (const item of (seriesItems.items ?? []) as MediaCard[]) {
        parts.push({
          key: `lib-series-${item.id}`,
          title: item.title,
          subtitle: item.year != null ? String(item.year) : null,
          posterUrl: item.selectedPosterPath || item.posterLocalPath || item.posterRemoteUrl || null,
          mediaKind: "series",
          goTo: () => navigate(`/series/${item.id}`),
        });
      }
    }

    // De-dupe titles that appear in more than one selected source (e.g. Up Next + a list).
    const seen = new Set<string>();
    const deduped = parts.filter((p) => {
      if (seen.has(p.key)) return false;
      seen.add(p.key);
      return true;
    });

    return typeFilter === "all" ? deduped : deduped.filter((p) => p.mediaKind === typeFilter);
  }

  async function startRoll() {
    setError(null);
    setBuildingPool(true);
    try {
      const items = await buildPool();
      setBuildingPool(false);
      if (items.length === 0) {
        setError(
          typeFilter === "all"
            ? "Nothing to choose from — pick at least one source with items."
            : `No ${typeFilter === "movie" ? "movies" : "series"} found in the selected sources.`,
        );
        return;
      }
      setPool(items);
      setPhase("rolling");
      runSpin(items);
    } catch {
      setBuildingPool(false);
      setError("Could not load items. Is Pitflix.API running?");
    }
  }

  function runSpin(items: RouletteItem[]) {
    if (items.length === 0) return;
    clearSpinTimer();
    setSpinning(true);
    setActiveKey(null);

    const winnerIndex = Math.floor(Math.random() * items.length);
    const winner = items[winnerIndex]!;

    if (items.length === 1) {
      setSliderItems(items);
      setSliderAnimate(false);
      setSliderOffset(sliderOffsetForIndex(0));
      setSpinning(false);
      setActiveKey(winner.key);
      return;
    }

    // Build a long strip that repeats the pool a few laps' worth, ending exactly on the winner, plus
    // a short trailing run so a few "next" posters are still visible past the landing spot.
    const laps = items.length <= 6 ? 5 : items.length <= 20 ? 3 : items.length <= 60 ? 2 : 1;
    const targetIndex = laps * items.length + winnerIndex;
    const trailing = Math.min(items.length - 1, 6);
    const extendedLen = targetIndex + trailing + 1;
    const extended = Array.from({ length: extendedLen }, (_, i) => items[i % items.length]!);

    setSliderItems(extended);
    setSliderAnimate(false);
    setSliderOffset(sliderOffsetForIndex(0));

    // Two rAFs: the first commits the "snapped to start, no transition" frame, the second flips the
    // transition on and moves the target offset — guarantees the browser paints the reset before sliding.
    rafRef.current = window.requestAnimationFrame(() => {
      rafRef.current = window.requestAnimationFrame(() => {
        setSliderAnimate(true);
        setSliderOffset(sliderOffsetForIndex(targetIndex));
      });
    });

    timeoutRef.current = window.setTimeout(() => {
      setSpinning(false);
      setActiveKey(winner.key);
    }, SLIDE_DURATION_MS + 80);
  }

  function spinAgain() {
    if (pool) runSpin(pool);
  }

  function backToChoose() {
    clearSpinTimer();
    setPhase("choose");
    setPool(null);
    setActiveKey(null);
    setSpinning(false);
    setError(null);
    setSliderItems([]);
    setSliderOffset(0);
    setSliderAnimate(false);
  }

  const upNextCount = watchingQ.data?.length ?? null;
  const lists = listsQ.data ?? [];
  const stats = statsQ.data;
  const libraryCount = stats ? stats.totalMovies + stats.totalSeries : null;

  const landed = useMemo(() => {
    if (spinning || !pool || !activeKey) return null;
    return pool.find((p) => p.key === activeKey) ?? null;
  }, [spinning, pool, activeKey]);

  const anySourceSelected = selectedSourceIds.size > 0;

  return (
    <AnimatePresence>
      {open ? (
        <motion.div
          className="fixed inset-0 z-[240] flex items-center justify-center bg-black/70 p-4 backdrop-blur-[2px]"
          initial={{ opacity: 0 }}
          animate={{ opacity: 1 }}
          exit={{ opacity: 0 }}
          transition={{ duration: 0.15 }}
          onClick={spinning ? undefined : onClose}
        >
          <motion.div
            role="dialog"
            aria-modal="true"
            aria-labelledby="roulette-dialog-title"
            initial={{ opacity: 0, scale: 0.97, y: 6 }}
            animate={{ opacity: 1, scale: 1, y: 0 }}
            exit={{ opacity: 0, scale: 0.97, y: 6 }}
            transition={{ type: "spring", damping: 28, stiffness: 320 }}
            className="flex w-full max-w-[780px] flex-col rounded-2xl border border-pitflix-primary/25 bg-pitflix-surface shadow-2xl shadow-black/70 ring-1 ring-white/5"
            onClick={(e) => e.stopPropagation()}
          >
            <div className="border-b border-pitflix-card px-7 py-5">
              <h2 id="roulette-dialog-title" className="flex items-center gap-2.5 text-2xl font-semibold text-white">
                <Dices className="h-7 w-7 text-pitflix-primary" />
                Roulette
              </h2>
              <p className="mt-1.5 text-base leading-relaxed text-pitflix-muted">
                {phase === "choose"
                  ? "Can't decide what to watch? Pick one or more sources and let Pitflix choose for you."
                  : spinning
                    ? "Spinning…"
                    : "Here's what it landed on."}
              </p>
            </div>

            {phase === "choose" ? (
              <div className="space-y-5 px-7 py-5">
                {/* Type filter */}
                <div>
                  <p className="mb-2 text-xs font-semibold uppercase tracking-wide text-pitflix-subtle">Type</p>
                  <div className="inline-flex rounded-lg border border-pitflix-card bg-pitflix-bg p-1">
                    {(["all", "movie", "series"] as TypeFilter[]).map((t) => (
                      <button
                        key={t}
                        type="button"
                        onClick={() => setTypeFilter(t)}
                        className={cn(
                          "rounded-md px-4 py-2 text-sm font-semibold transition-colors",
                          typeFilter === t
                            ? "bg-pitflix-primary text-white"
                            : "text-pitflix-muted hover:text-white",
                        )}
                      >
                        {t === "all" ? "All" : t === "movie" ? "Movies" : "Series"}
                      </button>
                    ))}
                  </div>
                </div>

                {/* Sources */}
                <div>
                  <p className="mb-2 text-xs font-semibold uppercase tracking-wide text-pitflix-subtle">
                    Sources — pick any number
                  </p>
                  <div className="max-h-[42vh] space-y-2.5 overflow-y-auto pr-1">
                    <SourceRow
                      icon={<Shuffle className="h-5 w-5 shrink-0 text-pitflix-primary" />}
                      title="Up Next"
                      subtitle={upNextCount == null ? "Shows you're still watching" : `${upNextCount} show${upNextCount === 1 ? "" : "s"} in progress`}
                      disabled={(upNextCount ?? 1) === 0}
                      checked={selectedSourceIds.has(UP_NEXT_SOURCE_ID)}
                      onToggle={() => toggleSource(UP_NEXT_SOURCE_ID)}
                    />

                    <SourceRow
                      icon={<Library className="h-5 w-5 shrink-0 text-pitflix-primary" />}
                      title="Whole Library"
                      subtitle={
                        libraryCount == null
                          ? "Anything you own — not just lists or Up Next"
                          : `${stats?.totalMovies ?? 0} movies · ${stats?.totalSeries ?? 0} series`
                      }
                      disabled={libraryCount === 0}
                      checked={selectedSourceIds.has(LIBRARY_SOURCE_ID)}
                      onToggle={() => toggleSource(LIBRARY_SOURCE_ID)}
                    />

                    <div className="rounded-lg border border-pitflix-card bg-pitflix-bg">
                      <SourceRow
                        icon={<Search className="h-5 w-5 shrink-0 text-pitflix-primary" />}
                        title="Custom"
                        subtitle={
                          customItems.size === 0
                            ? "Search your library and pick your own titles"
                            : `${customItems.size} title${customItems.size === 1 ? "" : "s"} picked`
                        }
                        checked={selectedSourceIds.has(CUSTOM_SOURCE_ID)}
                        onToggle={() => toggleSource(CUSTOM_SOURCE_ID)}
                        bare
                      />

                      {selectedSourceIds.has(CUSTOM_SOURCE_ID) ? (
                        <div className="space-y-3 border-t border-pitflix-card px-5 py-4">
                          <div className="relative">
                            <Search className="pointer-events-none absolute left-3 top-1/2 h-4 w-4 -translate-y-1/2 text-pitflix-subtle" />
                            <input
                              type="text"
                              value={customQuery}
                              onChange={(e) => setCustomQuery(e.target.value)}
                              placeholder="Search movies and series…"
                              className="w-full rounded-lg border border-pitflix-card bg-pitflix-surface py-2.5 pl-9 pr-3 text-sm text-white placeholder:text-pitflix-subtle focus:border-pitflix-primary/50 focus:outline-none"
                            />
                          </div>

                          {debouncedCustomQuery.length >= 2 ? (
                            <div className="max-h-48 space-y-1 overflow-y-auto rounded-lg border border-pitflix-card bg-pitflix-surface p-1.5">
                              {customSearchQ.isLoading ? (
                                <div className="py-2 text-center text-xs text-pitflix-subtle">Searching…</div>
                              ) : (customSearchQ.data?.movies.length ?? 0) + (customSearchQ.data?.shows.length ?? 0) === 0 ? (
                                <div className="py-2 text-center text-xs text-pitflix-subtle">No matches found.</div>
                              ) : (
                                [...(customSearchQ.data?.movies ?? []), ...(customSearchQ.data?.shows ?? [])].map((row) => {
                                  const key = customItemKey(row);
                                  const picked = customItems.has(key);
                                  return (
                                    <button
                                      key={key}
                                      type="button"
                                      disabled={picked}
                                      onClick={() => addCustomItem(row)}
                                      className="flex w-full items-center gap-3 rounded-md px-2.5 py-2 text-left transition-colors hover:bg-pitflix-card disabled:cursor-default disabled:opacity-50"
                                    >
                                      <div className="h-11 w-8 shrink-0 overflow-hidden rounded bg-pitflix-card">
                                        <MediaImage
                                          src={toPosterSrc(row.posterUrl ?? undefined, POSTER_WIDTHS.thumb)}
                                          alt=""
                                          className="h-full w-full"
                                          imgClassName="h-full w-full object-cover"
                                          fallbackText={row.title.slice(0, 3)}
                                        />
                                      </div>
                                      <span className="min-w-0 flex-1">
                                        <span className="block truncate text-sm font-medium text-white">{row.title}</span>
                                        <span className="block text-xs text-pitflix-subtle">
                                          {row.kind === "movie" ? "Movie" : "Series"}
                                          {row.year != null ? ` · ${row.year}` : ""}
                                        </span>
                                      </span>
                                      {picked ? <Check className="h-4 w-4 shrink-0 text-pitflix-primary" strokeWidth={3} /> : null}
                                    </button>
                                  );
                                })
                              )}
                            </div>
                          ) : null}

                          {customItems.size > 0 ? (
                            <div className="flex flex-wrap gap-1.5">
                              {[...customItems.values()].map((item) => (
                                <span
                                  key={item.key}
                                  className="flex items-center gap-1.5 rounded-full border border-pitflix-primary/30 bg-pitflix-primary/10 py-1 pl-3 pr-1.5 text-xs font-medium text-white"
                                >
                                  {item.title}
                                  <button
                                    type="button"
                                    onClick={() => removeCustomItem(item.key)}
                                    className="rounded-full p-0.5 text-pitflix-subtle hover:bg-white/10 hover:text-white"
                                    aria-label={`Remove ${item.title}`}
                                  >
                                    <X className="h-3 w-3" />
                                  </button>
                                </span>
                              ))}
                            </div>
                          ) : null}
                        </div>
                      ) : null}
                    </div>

                    {listsQ.isLoading ? (
                      <div className="py-3 text-center text-sm text-pitflix-subtle">Loading your lists…</div>
                    ) : lists.length === 0 ? (
                      <div className="py-1 text-center text-xs text-pitflix-subtle">You don't have any lists yet.</div>
                    ) : (
                      lists.map((list: UserListSummary) => (
                        <SourceRow
                          key={list.id}
                          icon={<ListVideo className="h-5 w-5 shrink-0 text-pitflix-primary" />}
                          title={formatListMenuLabel(list.name)}
                          subtitle={`${list.itemCount} item${list.itemCount === 1 ? "" : "s"}`}
                          disabled={list.itemCount === 0}
                          checked={selectedSourceIds.has(`list-${list.id}`)}
                          onToggle={() => toggleSource(`list-${list.id}`)}
                        />
                      ))
                    )}
                  </div>
                </div>

                {error ? <p className="text-center text-xs text-red-300">{error}</p> : null}
              </div>
            ) : (
              <div className="flex flex-col items-center px-7 py-6">
                {landed ? (
                  <div className="mb-5 flex w-full items-center gap-4 rounded-xl border border-pitflix-primary/40 bg-pitflix-primary/10 px-4 py-3.5">
                    <div className="h-20 w-14 shrink-0 overflow-hidden rounded-md bg-pitflix-card ring-1 ring-white/10">
                      <MediaImage
                        src={toPosterSrc(landed.posterUrl ?? undefined, POSTER_WIDTHS.thumb)}
                        alt=""
                        className="h-full w-full"
                        imgClassName="h-full w-full object-cover"
                        fallbackText={landed.title.slice(0, 3)}
                      />
                    </div>
                    <div className="min-w-0 flex-1">
                      <p className="truncate text-lg font-semibold text-white">{landed.title}</p>
                      {landed.subtitle ? <p className="truncate text-sm text-pitflix-subtle">{landed.subtitle}</p> : null}
                    </div>
                    <button
                      type="button"
                      onClick={() => {
                        landed.goTo();
                        onClose();
                      }}
                      className="flex shrink-0 items-center gap-2 rounded-lg bg-pitflix-primary px-5 py-3 text-base font-semibold text-white transition-colors hover:bg-pitflix-light"
                    >
                      <Play className="h-4 w-4 fill-white" />
                      Watch
                    </button>
                  </div>
                ) : (
                  <div className="mb-5 h-[4.75rem] w-full" />
                )}

                {/* Slot-machine style reel — slides through the pool and decelerates onto the winner. */}
                <div
                  className="relative mx-auto overflow-hidden rounded-xl bg-black/30 ring-1 ring-white/10"
                  style={{ width: SLIDER_VIEWPORT_W, height: SLIDER_ITEM_H + 20 }}
                >
                  {/* Center landing marker */}
                  <div
                    className={cn(
                      "pointer-events-none absolute top-1/2 z-20 -translate-y-1/2 rounded-lg ring-2 transition-colors duration-200",
                      spinning ? "ring-white/30" : "ring-pitflix-primary shadow-[0_0_24px_rgba(139,92,246,0.55)]",
                    )}
                    style={{ left: SLIDER_CENTER_OFFSET - 3, width: SLIDER_ITEM_W + 6, height: SLIDER_ITEM_H + 6 }}
                  />
                  {/* Edge fades so the reel reads as continuous, not clipped */}
                  <div className="pointer-events-none absolute inset-y-0 left-0 z-10 w-20 bg-gradient-to-r from-pitflix-surface to-transparent" />
                  <div className="pointer-events-none absolute inset-y-0 right-0 z-10 w-20 bg-gradient-to-l from-pitflix-surface to-transparent" />

                  <div
                    className="flex h-full items-center"
                    style={{
                      transform: `translateX(${sliderOffset}px)`,
                      transition: sliderAnimate ? `transform ${SLIDE_DURATION_MS}ms cubic-bezier(0.1,0.7,0.15,1)` : "none",
                      gap: SLIDER_GAP,
                    }}
                  >
                    {sliderItems.map((item, i) => (
                      <div
                        key={`${item.key}-${i}`}
                        className="shrink-0 overflow-hidden rounded-lg bg-pitflix-card"
                        style={{ width: SLIDER_ITEM_W, height: SLIDER_ITEM_H }}
                      >
                        <MediaImage
                          src={toPosterSrc(item.posterUrl ?? undefined, POSTER_WIDTHS.thumb)}
                          alt=""
                          className="h-full w-full"
                          imgClassName="h-full w-full object-cover"
                          fallbackText={item.title.slice(0, 3)}
                        />
                      </div>
                    ))}
                  </div>
                </div>
              </div>
            )}

            <div className="flex items-center justify-between gap-2 border-t border-pitflix-card px-7 py-5">
              {phase === "rolling" ? (
                <button
                  type="button"
                  disabled={spinning}
                  onClick={backToChoose}
                  className="flex items-center gap-2 rounded-lg border border-pitflix-card bg-pitflix-bg px-4 py-3 text-base font-medium text-pitflix-muted transition-colors hover:border-pitflix-primary/40 hover:text-white disabled:cursor-not-allowed disabled:opacity-50"
                >
                  <ArrowLeft className="h-5 w-5" />
                  Sources
                </button>
              ) : (
                <span />
              )}

              <div className="flex gap-2.5">
                {phase === "rolling" ? (
                  <button
                    type="button"
                    disabled={spinning}
                    onClick={spinAgain}
                    className="flex items-center gap-2 rounded-lg border border-pitflix-card bg-pitflix-bg px-4 py-3 text-base font-medium text-pitflix-muted transition-colors hover:border-pitflix-primary/40 hover:text-white disabled:cursor-not-allowed disabled:opacity-50"
                  >
                    <RotateCcw className="h-5 w-5" />
                    Spin again
                  </button>
                ) : null}
                <button
                  type="button"
                  disabled={spinning}
                  className="rounded-lg border border-pitflix-card bg-pitflix-bg px-5 py-3 text-base font-medium text-pitflix-muted transition-colors hover:border-pitflix-primary/40 hover:text-white disabled:cursor-not-allowed disabled:opacity-50"
                  onClick={onClose}
                >
                  {phase === "choose" ? "Cancel" : "Close"}
                </button>
                {phase === "choose" ? (
                  <button
                    type="button"
                    disabled={!anySourceSelected || buildingPool}
                    onClick={() => void startRoll()}
                    className="flex items-center gap-2 rounded-lg bg-pitflix-primary px-5 py-3 text-base font-semibold text-white transition-colors hover:bg-pitflix-light disabled:cursor-not-allowed disabled:opacity-50"
                  >
                    <Dices className="h-5 w-5" />
                    {buildingPool ? "Loading…" : "Spin"}
                  </button>
                ) : null}
              </div>
            </div>
          </motion.div>
        </motion.div>
      ) : null}
    </AnimatePresence>
  );
}

function SourceRow({
  icon,
  title,
  subtitle,
  checked,
  disabled,
  onToggle,
  bare,
}: {
  icon: React.ReactNode;
  title: string;
  subtitle: string;
  checked: boolean;
  disabled?: boolean;
  onToggle: () => void;
  bare?: boolean;
}) {
  return (
    <button
      type="button"
      disabled={disabled}
      onClick={onToggle}
      className={cn(
        "flex w-full items-center gap-4 px-5 py-4 text-left transition-colors disabled:cursor-not-allowed disabled:opacity-50",
        bare ? "rounded-t-lg" : "rounded-lg border border-pitflix-card bg-pitflix-bg hover:border-pitflix-primary/40",
      )}
    >
      {icon}
      <span className="min-w-0 flex-1">
        <span className="block truncate text-base font-medium text-white">{title}</span>
        <span className="block text-sm text-pitflix-subtle">{subtitle}</span>
      </span>
      <span
        className={cn(
          "flex h-6 w-6 shrink-0 items-center justify-center rounded-md border transition-colors",
          checked ? "border-pitflix-primary bg-pitflix-primary" : "border-white/20 bg-transparent",
        )}
      >
        {checked ? <Check className="h-4 w-4 text-white" strokeWidth={3} /> : null}
      </span>
    </button>
  );
}
