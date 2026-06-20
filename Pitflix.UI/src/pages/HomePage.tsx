import {
  DndContext,
  type DragEndEvent,
  KeyboardSensor,
  PointerSensor,
  closestCenter,
  useSensor,
  useSensors,
} from "@dnd-kit/core";
import { SortableContext, sortableKeyboardCoordinates, verticalListSortingStrategy } from "@dnd-kit/sortable";
import { useMutation, useQuery, useQueryClient, keepPreviousData } from "@tanstack/react-query";
import { useEffect, useMemo, useRef, useState } from "react";
import { Clock, Film, LayoutDashboard, Plus, Search, SlidersHorizontal, Tv, X } from "lucide-react";
import { Link, useNavigate } from "react-router-dom";
import { searchLibraryTitles, type LibraryTitleRow } from "../api/library";
import { getMovie } from "../api/movies";
import { getShow } from "../api/series";
import { toPosterSrc } from "../utils/posterSrc";
import { fetchFeaturedFallback, fetchHomeLayout, saveHomeLayout } from "../api/homeLayout";
import { GenreCategorySection } from "../features/home/GenreCategorySection";
import { getWatchingCurrently } from "../api/homeDiscover";
import { dismissHistoryEntry, getHistory } from "../api/history";
import { getStats } from "../api/stats";
import { ContinueWatchingHero, ContinueWatchingMenuDialog, FeaturedFallbackHero } from "../features/home/ContinueWatchingHero";
import { WatchingCurrentlySection } from "../features/home/WatchingCurrentlySection";
import { HomeSectionRenderer } from "../features/home/HomeSectionRenderer";
import { HomeSectionSlot } from "../features/home/HomeSectionSlot";
import { QuickActionsStrip } from "../features/home/QuickActionsStrip";
import { SectionEditorModal } from "../features/home/SectionEditorModal";
import { normalizeSectionOrders } from "../features/home/defaultHomeLayout";
import { useHomeCustomizeStore } from "../store/homeCustomizeStore";
import type { HomeSectionConfig, WatchHistoryRow } from "../types/homeSection";
import { cn } from "../utils/cn";

const FOLDERS_BANNER_KEY = "pitflix_banner_add_folders";
const RECENT_SEARCHES_KEY = "pitflix.home.recent_searches";

type RecentSearch = { id: number; kind: "movie" | "series"; title: string; year?: number | null; posterUrl?: string | null };

function loadRecentSearches(): RecentSearch[] {
  try {
    const raw = localStorage.getItem(RECENT_SEARCHES_KEY);
    if (!raw) return [];
    return JSON.parse(raw) as RecentSearch[];
  } catch { return []; }
}

function saveRecentSearches(items: RecentSearch[]) {
  try { localStorage.setItem(RECENT_SEARCHES_KEY, JSON.stringify(items.slice(0, 5))); } catch {}
}

function addToRecentSearches(item: LibraryTitleRow) {
  const prev = loadRecentSearches().filter((r) => !(r.id === item.id && r.kind === item.kind));
  saveRecentSearches([{ id: item.id, kind: item.kind, title: item.title, year: item.year, posterUrl: item.posterUrl }, ...prev]);
}


/**
 * Shows the poster for a search result row.
 *
 * Uses the SAME React Query cache keys as the detail pages — ["movie", id] and
 * ["show", id] — so any movie or show the user has already opened loads its
 * poster instantly from cache with zero network requests.  For items not yet in
 * cache the query fires once and populates the shared cache, meaning the detail
 * page itself will be a cache-hit the next time the user visits it.
 */
/**
 * Extract poster URL from getMovie / getShow response.
 * getMovie returns { movie: {...}, cast, ... }
 * getShow  returns { show:  {...}, seasonsSummary, ... }
 */
function extractPosterSrc(kind: "movie" | "series", data: unknown): string | undefined {
  if (!data || typeof data !== "object") return undefined;
  const root = data as Record<string, unknown>;
  const item = (kind === "movie" ? root.movie : root.show) as
    | { selectedPosterPath?: string | null; posterLocalPath?: string | null; posterRemoteUrl?: string | null }
    | undefined;
  return toPosterSrc(item?.selectedPosterPath || item?.posterLocalPath || item?.posterRemoteUrl || undefined);
}

function SearchResultPoster({ kind, id, title }: { kind: "movie" | "series"; id: number; title: string }) {
  const { data } = useQuery({
    // Matches the detail-page cache keys — cache hit if the user already opened
    // the detail page; populated here otherwise (shared with the detail page).
    queryKey: [kind === "movie" ? "movie" : "show", id],
    queryFn: () => (kind === "movie" ? getMovie(id) : getShow(id)),
    // Posters never change within a session; 1-hour stale time avoids any
    // redundant refetch even if the user revisits the detail page.
    staleTime: 60 * 60_000,
    retry: false,
  });
  const posterSrc = extractPosterSrc(kind, data);

  if (posterSrc) {
    return <img src={posterSrc} alt="" className="h-full w-full object-cover" />;
  }
  return (
    <div className="flex h-full w-full items-center justify-center bg-pitflix-card/60">
      <span className="text-[11px] font-bold uppercase text-pitflix-subtle/80 leading-none text-center px-0.5">
        {title.slice(0, 3)}
      </span>
    </div>
  );
}

function HeroSkeleton() {
  return <div className="mb-10 h-[280px] w-full animate-pulse rounded-2xl bg-pitflix-card" />;
}

export function HomePage() {
  const [showFoldersBanner, setShowFoldersBanner] = useState(
    () => typeof sessionStorage !== "undefined" && sessionStorage.getItem(FOLDERS_BANNER_KEY) === "1",
  );
  const qc = useQueryClient();
  const navigate = useNavigate();
  const [continueMenuId, setContinueMenuId] = useState<number | null>(null);
  const [continueError, setContinueError] = useState<string | null>(null);
  const [featuredIndex, setFeaturedIndex] = useState(0);
  const [searchQuery, setSearchQuery] = useState("");
  const [debouncedSearch, setDebouncedSearch] = useState("");
  const [searchFocused, setSearchFocused] = useState(false);
  const [recentSearches, setRecentSearches] = useState<RecentSearch[]>(() => loadRecentSearches());
  const [menuOpen, setMenuOpen] = useState(false);
  const menuRef = useRef<HTMLDivElement>(null);
  const searchRef = useRef<HTMLDivElement>(null);

  const isEditing = useHomeCustomizeStore((s) => s.isEditing);
  const draftSections = useHomeCustomizeStore((s) => s.draftSections);
  const setEditing = useHomeCustomizeStore((s) => s.setEditing);
  const beginEdit = useHomeCustomizeStore((s) => s.beginEdit);
  const cancelEdit = useHomeCustomizeStore((s) => s.cancelEdit);
  const reorderDraft = useHomeCustomizeStore((s) => s.reorderDraft);
  const updateSection = useHomeCustomizeStore((s) => s.updateSection);
  const removeSection = useHomeCustomizeStore((s) => s.removeSection);
  const addSection = useHomeCustomizeStore((s) => s.addSection);
  const editorTargetId = useHomeCustomizeStore((s) => s.editorTargetId);
  const openEditor = useHomeCustomizeStore((s) => s.openEditor);
  const closeEditor = useHomeCustomizeStore((s) => s.closeEditor);

  const sensors = useSensors(
    useSensor(PointerSensor, { activationConstraint: { distance: 6 } }),
    useSensor(KeyboardSensor, { coordinateGetter: sortableKeyboardCoordinates }),
  );

  useEffect(() => {
    if (!continueError) return;
    const t = window.setTimeout(() => setContinueError(null), 4500);
    return () => window.clearTimeout(t);
  }, [continueError]);

  // Close the options dropdown when the user clicks outside it.
  useEffect(() => {
    if (!menuOpen) return;
    const handler = (e: MouseEvent) => {
      if (menuRef.current && !menuRef.current.contains(e.target as Node)) {
        setMenuOpen(false);
      }
    };
    document.addEventListener("mousedown", handler);
    return () => document.removeEventListener("mousedown", handler);
  }, [menuOpen]);

  // Debounce search input — 200 ms feels responsive; cleanup cancels the timer
  // so rapid keystrokes never enqueue more than one pending state update.
  useEffect(() => {
    const t = setTimeout(() => setDebouncedSearch(searchQuery.trim()), 200);
    return () => clearTimeout(t);
  }, [searchQuery]);

  // Close search results when clicking outside the search bar.
  useEffect(() => {
    if (!debouncedSearch) return;
    const handler = (e: MouseEvent) => {
      if (searchRef.current && !searchRef.current.contains(e.target as Node)) {
        setDebouncedSearch("");
        setSearchQuery("");
      }
    };
    document.addEventListener("mousedown", handler);
    return () => document.removeEventListener("mousedown", handler);
  }, [debouncedSearch]);

  const layoutQ = useQuery({
    queryKey: ["home-layout"],
    queryFn: fetchHomeLayout,
    staleTime: 10 * 60_000,
  });

  const historyQ = useQuery({
    queryKey: ["home-history"],
    queryFn: () => getHistory(14),
    staleTime: 0,
    refetchOnMount: "always",
  });

  const featuredQ = useQuery({
    queryKey: ["home-featured-fallback"],
    queryFn: fetchFeaturedFallback,
    enabled: (historyQ.data?.length ?? 0) === 0 && !historyQ.isLoading,
    staleTime: 120_000,
  });

  const watchingQ = useQuery({
    queryKey: ["home-watching-currently"],
    queryFn: getWatchingCurrently,
    staleTime: 2 * 60_000,
  });

  useQuery({ queryKey: ["stats"], queryFn: getStats, staleTime: 60_000 });

  const searchQ = useQuery({
    queryKey: ["home-search", debouncedSearch],
    // React Query v5 passes { signal } so axios cancels the in-flight XHR the
    // moment the debounced query string changes — no stale responses rendered.
    queryFn: ({ signal }) => searchLibraryTitles(debouncedSearch, signal),
    enabled: debouncedSearch.length >= 2,
    // Keep previous results visible while the new fetch is in flight so the
    // dropdown never flickers blank between keystrokes.
    placeholderData: keepPreviousData,
    // Library titles are stable — cache for 5 min, keep in memory for 15 min.
    staleTime: 5 * 60_000,
    gcTime: 15 * 60_000,
  });
  const searchResults = searchQ.data;
  const hasSearchResults =
    (searchResults?.movies.length ?? 0) > 0 || (searchResults?.shows.length ?? 0) > 0;
  const showSearchDropdown = debouncedSearch.length >= 2;

  // Pre-fetch every poster as soon as results arrive so images are already
  // in-flight before the dropdown even renders them.
  useEffect(() => {
    if (!searchResults) return;
    const items = [
      ...searchResults.movies.map((m) => ({ key: "movie" as const, id: m.id })),
      ...searchResults.shows.map((s) => ({ key: "show" as const, id: s.id })),
    ];
    for (const { key, id } of items) {
      void qc.prefetchQuery({
        queryKey: [key, id],
        queryFn: () => (key === "movie" ? getMovie(id) : getShow(id)),
        staleTime: 60 * 60_000,
      });
    }
  }, [searchResults, qc]);


  const saveMutation = useMutation({
    mutationFn: saveHomeLayout,
    onSuccess: async () => {
      await qc.invalidateQueries({ queryKey: ["home-layout"] });
      await qc.invalidateQueries({
        predicate: (q) => q.queryKey[0] === "home-section",
      });
      cancelEdit();
      setEditing(false);
    },
  });

  const liveSections = layoutQ.data ?? [];
  const displaySections = useMemo(() => {
    const base = isEditing && draftSections ? draftSections : liveSections;
    return normalizeSectionOrders(base).filter((s) => s.enabled || isEditing);
  }, [isEditing, draftSections, liveSections]);

  const sortableIds = useMemo(() => displaySections.map((s) => s.id), [displaySections]);

  const invalidateAfterDismiss = (markCompleted: boolean) => {
    void qc.invalidateQueries({ queryKey: ["home-history"] });
    void qc.invalidateQueries({ queryKey: ["home-featured-fallback"] });
    if (markCompleted) {
      void qc.invalidateQueries({ queryKey: ["stats"] });
      void qc.invalidateQueries({ queryKey: ["movies"] });
      void qc.invalidateQueries({ queryKey: ["series"] });
      void qc.invalidateQueries({ queryKey: ["home-movies"] });
      void qc.invalidateQueries({ queryKey: ["home-series"] });
    }
    void qc.invalidateQueries({ predicate: (q) => q.queryKey[0] === "home-section" });
    void qc.invalidateQueries({ queryKey: ["home-watching-currently"] });
  };

  const dismissContinueOnly = () => {
    if (continueMenuId == null) return;
    const id = continueMenuId;
    setContinueMenuId(null);
    void dismissHistoryEntry(id, false)
      .then(() => invalidateAfterDismiss(false))
      .catch(() => setContinueError("Could not update. Is Pitflix.API running?"));
  };

  const dismissContinueAndMarkCompleted = () => {
    if (continueMenuId == null) return;
    const id = continueMenuId;
    setContinueMenuId(null);
    void dismissHistoryEntry(id, true)
      .then(() => invalidateAfterDismiss(true))
      .catch(() => setContinueError("Could not update. Is Pitflix.API running?"));
  };

  const history = (historyQ.data ?? []) as WatchHistoryRow[];
  // Clamp index whenever the history list shrinks (e.g. after dismissing an entry).
  const clampedIndex = Math.min(featuredIndex, Math.max(0, history.length - 1));
  const featured = history[clampedIndex];

  const editingSection: HomeSectionConfig | null = useMemo(() => {
    if (editorTargetId == null) return null;
    const pool = draftSections ?? liveSections;
    if (editorTargetId === "new") return null;
    return pool.find((s) => s.id === editorTargetId) ?? null;
  }, [editorTargetId, draftSections, liveSections]);

  const onDragEnd = (e: DragEndEvent) => {
    const { active, over } = e;
    if (!over || active.id === over.id) return;
    reorderDraft(String(active.id), String(over.id));
  };

  const handleSaveLayout = () => {
    const toSave = draftSections ?? liveSections;
    saveMutation.mutate(normalizeSectionOrders(toSave));
  };

  const handleSaveSection = (s: HomeSectionConfig) => {
    if (editorTargetId === "new") addSection(s);
    else updateSection(s.id, s);
    closeEditor();
  };

  return (
    <div className="pb-10">
      {/* ── Header ──────────────────────────────────────────────────── */}
      <div className="mb-6 space-y-3">

        {/* Row 1: title + action controls */}
        <div className="flex items-start justify-between gap-3 pr-32">
          <div>
            <h1 className="text-2xl font-bold text-white md:text-3xl">Home</h1>
            <p className="mt-1 text-sm text-pitflix-subtle">Your library — tuned the way you like it</p>
          </div>

          <div className="flex shrink-0 items-center gap-2 pt-0.5">
            {isEditing ? (
              <>
                <button
                  type="button"
                  className="rounded-xl border border-white/15 px-4 py-2 text-sm font-medium text-white hover:border-pitflix-primary/50"
                  onClick={() => { cancelEdit(); setEditing(false); }}
                >
                  Cancel
                </button>
                <button
                  type="button"
                  disabled={saveMutation.isPending}
                  className="rounded-xl bg-pitflix-primary px-4 py-2 text-sm font-semibold text-white hover:bg-pitflix-light disabled:opacity-50"
                  onClick={() => handleSaveLayout()}
                >
                  {saveMutation.isPending ? "Saving…" : "Save layout"}
                </button>
              </>
            ) : (
              /* Sliders icon → dropdown */
              <div className="relative" ref={menuRef}>
                <button
                  type="button"
                  title="Home options"
                  onClick={() => setMenuOpen((o) => !o)}
                  className={cn(
                    "flex h-9 w-9 items-center justify-center rounded-xl border transition-colors duration-150",
                    menuOpen
                      ? "border-pitflix-primary/50 bg-pitflix-primary/20 text-white"
                      : "border-white/15 bg-white/[0.04] text-pitflix-muted hover:border-white/30 hover:text-white",
                  )}
                >
                  <SlidersHorizontal className="h-4 w-4" />
                </button>

                {menuOpen && (
                  <div className="absolute right-0 top-full z-50 mt-1.5 min-w-[192px] overflow-hidden rounded-xl border border-white/10 bg-pitflix-surface py-1 shadow-xl shadow-black/60">
                    <button
                      type="button"
                      className="flex w-full items-center gap-3 px-4 py-2.5 text-left text-sm text-pitflix-muted transition-colors hover:bg-white/[0.06] hover:text-white"
                      onClick={() => {
                        beginEdit(normalizeSectionOrders(liveSections));
                        setEditing(true);
                        setMenuOpen(false);
                      }}
                    >
                      <LayoutDashboard className="h-4 w-4 shrink-0" />
                      Customize Home
                    </button>
                    <button
                      type="button"
                      className="flex w-full items-center gap-3 px-4 py-2.5 text-left text-sm text-pitflix-muted transition-colors hover:bg-white/[0.06] hover:text-white"
                      onClick={() => {
                        beginEdit(normalizeSectionOrders(liveSections));
                        setEditing(true);
                        openEditor("new");
                        setMenuOpen(false);
                      }}
                    >
                      <Plus className="h-4 w-4 shrink-0" />
                      Add section
                    </button>
                  </div>
                )}
              </div>
            )}
          </div>
        </div>

        {/* Row 2: search bar — hidden while editing */}
        {!isEditing && (
          <div className="relative" ref={searchRef}>
            <Search className="pointer-events-none absolute left-3 top-1/2 h-4 w-4 -translate-y-1/2 text-pitflix-subtle" />
            <input
              type="text"
              value={searchQuery}
              onChange={(e) => setSearchQuery(e.target.value)}
              onFocus={() => setSearchFocused(true)}
              onBlur={() => {
                // Small delay so click events inside the dropdown fire before hiding
                setTimeout(() => setSearchFocused(false), 150);
              }}
              onKeyDown={(e) => {
                if (e.key === "Escape") { setSearchQuery(""); setDebouncedSearch(""); }
              }}
              placeholder="Search your library…"
              className="w-full rounded-xl border border-white/10 bg-white/[0.04] py-2.5 pl-9 pr-9 text-sm text-white placeholder:text-pitflix-subtle transition-colors focus:border-pitflix-primary/50 focus:bg-white/[0.06] focus:outline-none focus:ring-1 focus:ring-pitflix-primary/25"
            />
            {searchQuery && (
              <button
                type="button"
                aria-label="Clear search"
                onClick={() => { setSearchQuery(""); setDebouncedSearch(""); }}
                className="absolute right-3 top-1/2 -translate-y-1/2 rounded text-pitflix-subtle transition-colors hover:text-white"
              >
                <X className="h-4 w-4" />
              </button>
            )}

            {/* ── Dropdown: recent searches OR live results ──────── */}
            {searchFocused && (showSearchDropdown || (!searchQuery && recentSearches.length > 0)) && (
              <div
                className="absolute left-0 right-0 top-full z-50 mt-1.5 overflow-hidden rounded-xl border border-white/10 bg-pitflix-surface shadow-2xl shadow-black/60"
                style={{ maxHeight: "min(60vh, 480px)", overflowY: "auto" }}
              >
                {/* Recent searches — shown when input is empty */}
                {!searchQuery && recentSearches.length > 0 && (
                  <div>
                    <div className="flex items-center justify-between px-4 py-2">
                      <p className="flex items-center gap-2 text-[10px] font-bold uppercase tracking-widest text-pitflix-subtle">
                        <Clock className="h-3 w-3" /> Recent searches
                      </p>
                      <button
                        type="button"
                        className="text-[10px] text-pitflix-subtle transition-colors hover:text-white"
                        onClick={() => { saveRecentSearches([]); setRecentSearches([]); }}
                      >
                        Clear
                      </button>
                    </div>
                    {recentSearches.map((r) => (
                      <button
                        key={`${r.kind}-${r.id}`}
                        type="button"
                        className="flex w-full items-center gap-3 px-4 py-2 text-left transition-colors hover:bg-white/[0.06]"
                        onClick={() => {
                          navigate(r.kind === "movie" ? `/movie/${r.id}` : `/series/${r.id}`);
                        }}
                      >
                        {/* Poster thumbnail */}
                        <div className="h-10 w-7 shrink-0 overflow-hidden rounded">
                          <SearchResultPoster kind={r.kind} id={r.id} title={r.title} />
                        </div>
                        <span className="min-w-0 flex-1 truncate text-sm font-medium text-white">{r.title}</span>
                        {r.year && <span className="shrink-0 text-xs text-pitflix-subtle">{r.year}</span>}
                      </button>
                    ))}
                  </div>
                )}

                {/* Live search results */}
                {showSearchDropdown && (
                  <>
                    {searchQ.isLoading && (
                      <p className="px-4 py-3 text-sm text-pitflix-muted">Searching…</p>
                    )}
                    {!searchQ.isLoading && !hasSearchResults && (
                      <p className="px-4 py-3 text-sm text-pitflix-muted">
                        No results for <span className="font-medium text-white">"{debouncedSearch}"</span>
                      </p>
                    )}

                    {/* Movies */}
                    {(searchResults?.movies.length ?? 0) > 0 && (
                      <div>
                        <p className="sticky top-0 flex items-center gap-2 bg-pitflix-surface px-4 py-2 text-[10px] font-bold uppercase tracking-widest text-pitflix-subtle">
                          <Film className="h-3 w-3" /> Movies
                        </p>
                        {searchResults!.movies.map((m) => (
                          <button
                            key={m.id}
                            type="button"
                            className="flex w-full items-center gap-3 px-4 py-2 text-left transition-colors hover:bg-white/[0.06]"
                            onClick={() => {
                              addToRecentSearches(m);
                              setRecentSearches(loadRecentSearches());
                              navigate(`/movie/${m.id}`);
                              setSearchQuery(""); setDebouncedSearch("");
                            }}
                          >
                            <div className="h-10 w-7 shrink-0 overflow-hidden rounded">
                              <SearchResultPoster kind="movie" id={m.id} title={m.title} />
                            </div>
                            <span className="min-w-0 flex-1 truncate text-sm font-medium text-white">{m.title}</span>
                            {m.year && <span className="shrink-0 text-xs text-pitflix-subtle">{m.year}</span>}
                          </button>
                        ))}
                      </div>
                    )}

                    {/* Shows */}
                    {(searchResults?.shows.length ?? 0) > 0 && (
                      <div>
                        <p className="sticky top-0 flex items-center gap-2 bg-pitflix-surface px-4 py-2 text-[10px] font-bold uppercase tracking-widest text-pitflix-subtle">
                          <Tv className="h-3 w-3" /> Series
                        </p>
                        {searchResults!.shows.map((s) => (
                          <button
                            key={s.id}
                            type="button"
                            className="flex w-full items-center gap-3 px-4 py-2 text-left transition-colors hover:bg-white/[0.06]"
                            onClick={() => {
                              addToRecentSearches(s);
                              setRecentSearches(loadRecentSearches());
                              navigate(`/series/${s.id}`);
                              setSearchQuery(""); setDebouncedSearch("");
                            }}
                          >
                            <div className="h-10 w-7 shrink-0 overflow-hidden rounded">
                              <SearchResultPoster kind="series" id={s.id} title={s.title} />
                            </div>
                            <span className="min-w-0 flex-1 truncate text-sm font-medium text-white">{s.title}</span>
                            {s.year && <span className="shrink-0 text-xs text-pitflix-subtle">{s.year}</span>}
                          </button>
                        ))}
                      </div>
                    )}
                  </>
                )}
              </div>
            )}
          </div>
        )}
      </div>

      {showFoldersBanner ? (
        <div className="mb-6 flex flex-wrap items-center gap-3 rounded-xl border border-amber-500/35 bg-amber-500/10 px-4 py-3 text-sm text-amber-100">
          <span>Add media folders in Settings to get started.</span>
          <Link
            to="/settings"
            className="font-semibold text-white underline-offset-2 hover:underline"
          >
            Open Settings
          </Link>
          <button
            type="button"
            className="ml-auto text-xs text-amber-100/85 hover:text-white"
            onClick={() => {
              sessionStorage.removeItem(FOLDERS_BANNER_KEY);
              setShowFoldersBanner(false);
            }}
          >
            Dismiss
          </button>
        </div>
      ) : null}

      {/* ── Continue Watching hero ── */}
      {historyQ.isLoading ? (
        <HeroSkeleton />
      ) : featured ? (
        <ContinueWatchingHero
          featured={featured}
          onManageContinue={(id) => {
            setContinueMenuId(id);
            // Step back if dismissing the last item in the list
            if (clampedIndex > 0 && clampedIndex === history.length - 1) {
              setFeaturedIndex(clampedIndex - 1);
            }
          }}
          currentIndex={clampedIndex}
          totalCount={history.length}
          onPrev={() => setFeaturedIndex((i) => (i - 1 + history.length) % history.length)}
          onNext={() => setFeaturedIndex((i) => (i + 1) % history.length)}
        />
      ) : (watchingQ.data?.length ?? 0) === 0 && featuredQ.data ? (
        <FeaturedFallbackHero card={featuredQ.data} />
      ) : null}

      {/* ── Up Next carousel (other in-progress shows) ── */}
      <WatchingCurrentlySection />

      <QuickActionsStrip />

      <GenreCategorySection />

      {layoutQ.isLoading && !isEditing ? (
        <div className="space-y-8">
          {Array.from({ length: 4 }).map((_, i) => (
            <div key={i} className="h-48 animate-pulse rounded-2xl bg-pitflix-card/60" />
          ))}
        </div>
      ) : isEditing ? (
        <DndContext sensors={sensors} collisionDetection={closestCenter} onDragEnd={onDragEnd}>
          <SortableContext items={sortableIds} strategy={verticalListSortingStrategy}>
            <div className={cn("space-y-2", isEditing && "rounded-2xl border border-dashed border-white/15 p-3")}>
              {displaySections.map((section) => (
                <HomeSectionSlot
                  key={section.id}
                  section={section}
                  history={history}
                  onEdit={() => openEditor(section.id)}
                  onToggleEnabled={() =>
                    updateSection(section.id, { enabled: !section.enabled })
                  }
                  onContinueManage={setContinueMenuId}
                />
              ))}
            </div>
          </SortableContext>
        </DndContext>
      ) : (
        <div className="space-y-2">
          {displaySections.map((section) => (
            <HomeSectionRenderer
              key={section.id}
              section={section}
              isEditing={false}
              history={history}
              onContinueManage={setContinueMenuId}
            />
          ))}
        </div>
      )}

      <SectionEditorModal
        open={editorTargetId != null}
        existing={editorTargetId === "new" ? null : editingSection}
        onClose={closeEditor}
        onSave={handleSaveSection}
        onDelete={
          editorTargetId && editorTargetId !== "new"
            ? (id) => {
                removeSection(id);
                closeEditor();
              }
            : undefined
        }
      />

      <ContinueWatchingMenuDialog
        open={continueMenuId != null}
        onRemoveOnly={dismissContinueOnly}
        onMarkCompleted={dismissContinueAndMarkCompleted}
        onCancel={() => setContinueMenuId(null)}
      />

      {continueError ? (
        <div
          className="fixed bottom-5 left-1/2 z-[235] max-w-md -translate-x-1/2 rounded-xl border border-red-500/40 bg-pitflix-surface px-4 py-3 text-sm text-red-200 shadow-lg shadow-black/50"
          role="status"
        >
          {continueError}
        </div>
      ) : null}
    </div>
  );
}
