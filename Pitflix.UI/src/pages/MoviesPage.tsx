import { useQuery, useQueryClient } from "@tanstack/react-query";
import { useCallback, useEffect, useMemo, useState } from "react";
import { LayoutGrid, List } from "lucide-react";
import { Link, useSearchParams } from "react-router-dom";
import {
  bulkDeleteFromDevice,
  bulkRemoveFromLibrary,
  bulkSetWatchStatus,
} from "../api/library";
import { getListTmdbIds, getLists } from "../api/lists";
import { getStats } from "../api/stats";
import { useMovies } from "../hooks/useMovies";
import { useDebounce } from "../hooks/useDebounce";
import { useScrollRestoration } from "../hooks/useScrollRestoration";
import { LibraryContextMenuLayer } from "../features/library/LibraryContextMenuLayer";
import { useLibraryPosterCards } from "../features/library/useLibraryPosterCards";
import { PosterCard } from "../components/ui/PosterCard";
import { LibraryListRow } from "../components/ui/LibraryListRow";
import { Pagination } from "../components/ui/Pagination";
import { LibraryGridSkeleton } from "../components/ui/LibraryGridSkeleton";
import { LibraryPosterGrid } from "../components/ui/LibraryPosterGrid";
import { LibrarySearchField } from "../components/ui/LibrarySearchField";
import { ScrollReveal } from "../components/ui/ScrollReveal";
import type { MediaCard } from "../types/media";
import { cn } from "../utils/cn";
import { isFavoritesListName } from "../utils/listMarks";
import { COMMON_GENRES } from "../data/commonGenres";

const VIEW_STORAGE_KEY = "pitflix.library.view.movies";
type ViewMode = "grid" | "list";

export function MoviesPage() {
  const qc = useQueryClient();
  const [searchParams, setSearchParams] = useSearchParams();
  const page = Math.max(1, parseInt(searchParams.get("page") ?? "1", 10) || 1);
  const setPage = useCallback(
    (next: number) => {
      setSearchParams(
        (prev) => {
          const n = new URLSearchParams(prev);
          if (next <= 1) n.delete("page");
          else n.set("page", String(next));
          return n;
        },
        { replace: true },
      );
    },
    [setSearchParams],
  );
  // Filters live in the URL (not local state) so they survive navigating into a detail page and back.
  const updateFilterParam = useCallback(
    (key: string, value: string, defaultValue: string) => {
      setSearchParams(
        (prev) => {
          const n = new URLSearchParams(prev);
          if (value === defaultValue) n.delete(key);
          else n.set(key, value);
          n.delete("page");
          return n;
        },
        { replace: true },
      );
    },
    [setSearchParams],
  );

  const lang = (searchParams.get("lang") === "ar" ? "ar" : "en") as "en" | "ar";
  const setLang = (v: "en" | "ar") => updateFilterParam("lang", v, "en");
  const search = searchParams.get("q") ?? "";
  const setSearch = (v: string) => updateFilterParam("q", v, "");
  const searchQ = useDebounce(search, 350);
  const sort = searchParams.get("sort") ?? "title";
  const setSort = (v: string) => updateFilterParam("sort", v, "title");
  const genre = searchParams.get("genre") ?? "";
  const setGenre = (v: string) => updateFilterParam("genre", v, "");
  const watch = searchParams.get("watch") ?? "all";
  const setWatch = (v: string) => updateFilterParam("watch", v, "all");
  const pageSize = 40;
  const [selectionMode, setSelectionMode] = useState(false);
  const [selectedIds, setSelectedIds] = useState<Set<number>>(() => new Set());
  const [markBusy, setMarkBusy] = useState(false);
  const [bulkError, setBulkError] = useState<string | null>(null);
  const [viewMode, setViewMode] = useState<ViewMode>(() => {
    try { return (localStorage.getItem(VIEW_STORAGE_KEY) as ViewMode) || "grid"; } catch { return "grid"; }
  });
  const setView = (v: ViewMode) => {
    setViewMode(v);
    try { localStorage.setItem(VIEW_STORAGE_KEY, v); } catch {}
  };

  const { data: stats } = useQuery({
    queryKey: ["stats"],
    queryFn: getStats,
    staleTime: 900_000,
    refetchOnMount: false,
    refetchOnWindowFocus: false,
  });
  const { data: lists } = useQuery({
    queryKey: ["lists"],
    queryFn: getLists,
    staleTime: 900_000,
    refetchOnMount: false,
    refetchOnWindowFocus: false,
  });
  const favoritesList = lists?.find((l) => isFavoritesListName(l.name));
  const { data: favoriteTmdbIds = [] } = useQuery({
    queryKey: ["list-tmdb-ids", favoritesList?.id, "Movie"],
    queryFn: () => getListTmdbIds(favoritesList!.id, "Movie"),
    enabled: !!favoritesList,
  });
  const favoriteSet = useMemo(() => new Set(favoriteTmdbIds), [favoriteTmdbIds]);
  const englishCount = stats?.englishMovies ?? 0;
  const arabicCount = stats?.arabicMovies ?? 0;

  const { data, isPending, isPlaceholderData } = useMovies({
    page,
    pageSize,
    lang,
    search: searchQ || undefined,
    genre: genre || undefined,
    sort,
    watch,
  });

  useScrollRestoration(searchParams.toString(), !isPending);

  const total = data?.total ?? 0;
  const pageItems = (data?.items ?? []) as MediaCard[];
  const { menu, closeMenu, runAction, cardExtras } = useLibraryPosterCards(pageItems);

  const toggleSelect = (id: number) => {
    setSelectedIds((prev) => {
      const next = new Set(prev);
      if (next.has(id)) next.delete(id);
      else next.add(id);
      return next;
    });
  };

  const exitSelection = () => {
    setSelectionMode(false);
    setSelectedIds(new Set());
  };

  useEffect(() => {
    if (!bulkError) return;
    const t = setTimeout(() => setBulkError(null), 8000);
    return () => clearTimeout(t);
  }, [bulkError]);

  const reportBulkError = (e: unknown) => {
    console.error(e);
    setBulkError(e instanceof Error ? e.message : "Bulk action failed. Please try again.");
  };

  const markSelectedCompleted = async () => {
    if (selectedIds.size === 0) return;
    setMarkBusy(true);
    try {
      await bulkSetWatchStatus({
        movieIds: [...selectedIds],
        watchStatus: "Completed",
      });
      exitSelection();
      void qc.invalidateQueries({ queryKey: ["movies"] });
      void qc.invalidateQueries({ queryKey: ["stats"] });
      void qc.invalidateQueries({ queryKey: ["home-movies"] });
    } catch (e) {
      reportBulkError(e);
    } finally {
      setMarkBusy(false);
    }
  };

  const markSelectedUnwatched = async () => {
    if (selectedIds.size === 0) return;
    setMarkBusy(true);
    try {
      await bulkSetWatchStatus({
        movieIds: [...selectedIds],
        watchStatus: "Unwatched",
      });
      exitSelection();
      void qc.invalidateQueries({ queryKey: ["movies"] });
      void qc.invalidateQueries({ queryKey: ["stats"] });
      void qc.invalidateQueries({ queryKey: ["home-movies"] });
    } catch (e) {
      reportBulkError(e);
    } finally {
      setMarkBusy(false);
    }
  };

  const removeSelectedFromLibrary = async () => {
    if (selectedIds.size === 0) return;
    setMarkBusy(true);
    try {
      await bulkRemoveFromLibrary({ movieIds: [...selectedIds] });
      exitSelection();
      void qc.invalidateQueries({ queryKey: ["movies"] });
      void qc.invalidateQueries({ queryKey: ["stats"] });
      void qc.invalidateQueries({ queryKey: ["home-movies"] });
      void qc.invalidateQueries({ queryKey: ["unmatched"] });
    } catch (e) {
      reportBulkError(e);
    } finally {
      setMarkBusy(false);
    }
  };

  const deleteSelectedFromDevice = async () => {
    if (selectedIds.size === 0) return;
    if (
      !window.confirm(
        `Permanently delete ${selectedIds.size} movie file(s) from this device and remove them from the library? This cannot be undone.`,
      )
    )
      return;
    setMarkBusy(true);
    try {
      const r = await bulkDeleteFromDevice({ movieIds: [...selectedIds] });
      exitSelection();
      void qc.invalidateQueries({ queryKey: ["movies"] });
      void qc.invalidateQueries({ queryKey: ["stats"] });
      void qc.invalidateQueries({ queryKey: ["home-movies"] });
      void qc.invalidateQueries({ queryKey: ["unmatched"] });
      if (r.errors?.length)
        window.alert(`Some files could not be deleted:\n${r.errors.slice(0, 8).join("\n")}`);
    } catch (e) {
      reportBulkError(e);
    } finally {
      setMarkBusy(false);
    }
  };

  return (
    <div>
      {bulkError ? (
        <div
          role="alert"
          className="mb-4 flex items-start justify-between gap-3 rounded-lg border border-red-900/60 bg-red-950/40 px-4 py-3 text-sm text-red-200"
        >
          <span>{bulkError}</span>
          <button
            type="button"
            className="shrink-0 text-red-300/80 hover:text-red-100"
            onClick={() => setBulkError(null)}
            aria-label="Dismiss"
          >
            ×
          </button>
        </div>
      ) : null}
      <div className="mb-6 flex flex-wrap items-start justify-between gap-4">
        <div>
          <h1 className="text-3xl font-bold text-white">Movies</h1>
          <p className="mt-1 text-sm text-pitflix-muted">{total} titles in your library</p>
        </div>
        <div className="flex flex-wrap items-center gap-2">
          {/* View toggle */}
          <div className="flex items-center gap-0.5 rounded-lg border border-pitflix-card bg-pitflix-card p-0.5">
            <button
              type="button"
              title="Grid view"
              onClick={() => setView("grid")}
              className={cn("rounded-md p-1.5 transition-colors", viewMode === "grid" ? "bg-pitflix-primary text-white" : "text-pitflix-muted hover:text-white")}
            >
              <LayoutGrid className="h-4 w-4" />
            </button>
            <button
              type="button"
              title="List view"
              onClick={() => setView("list")}
              className={cn("rounded-md p-1.5 transition-colors", viewMode === "list" ? "bg-pitflix-primary text-white" : "text-pitflix-muted hover:text-white")}
            >
              <List className="h-4 w-4" />
            </button>
          </div>
          {selectionMode ? (
            <>
              <span className="text-xs text-pitflix-muted">{selectedIds.size} selected</span>
              <button
                type="button"
                disabled={markBusy || selectedIds.size === 0}
                className="rounded-lg bg-green-600/90 px-3 py-2 text-xs font-semibold text-white hover:bg-green-500 disabled:opacity-50"
                onClick={() => void markSelectedCompleted()}
              >
                {markBusy ? "…" : "Mark watched"}
              </button>
              <button
                type="button"
                disabled={markBusy || selectedIds.size === 0}
                className="rounded-lg border border-pitflix-card px-3 py-2 text-xs text-pitflix-muted hover:text-white disabled:opacity-50"
                onClick={() => void markSelectedUnwatched()}
              >
                Mark unwatched
              </button>
              <button
                type="button"
                disabled={markBusy || selectedIds.size === 0}
                className="rounded-lg border border-pitflix-card px-3 py-2 text-xs text-pitflix-muted hover:text-white disabled:opacity-50"
                onClick={() => void removeSelectedFromLibrary()}
              >
                Remove from library
              </button>
              <button
                type="button"
                disabled={markBusy || selectedIds.size === 0}
                className="rounded-lg bg-red-900/80 px-3 py-2 text-xs font-semibold text-red-100 hover:bg-red-800 disabled:opacity-50"
                onClick={() => void deleteSelectedFromDevice()}
              >
                Delete from device…
              </button>
              <button
                type="button"
                className="rounded-lg border border-pitflix-card px-3 py-2 text-xs text-pitflix-muted hover:text-white"
                onClick={exitSelection}
              >
                Cancel
              </button>
            </>
          ) : (
            <button
              type="button"
              className="rounded-lg border border-pitflix-primary/50 px-3 py-2 text-xs font-medium text-white hover:bg-pitflix-primary/20"
              onClick={() => setSelectionMode(true)}
            >
              Select titles
            </button>
          )}
        </div>
      </div>

      <div className="mb-6 flex w-fit gap-1 rounded-xl bg-pitflix-card p-1">
        {(
          [
            { key: "en" as const, label: "English", count: englishCount },
            { key: "ar" as const, label: "Arabic", count: arabicCount },
          ] as const
        ).map(({ key, label, count }) => (
          <button
            key={key}
            type="button"
            onClick={() => setLang(key)}
            className={cn(
              "rounded-lg px-6 py-2 text-sm font-medium transition-all",
              lang === key
                ? "bg-pitflix-primary text-white shadow-lg"
                : "text-pitflix-muted hover:text-white",
            )}
          >
            {label}
            <span className="ml-2 text-xs opacity-70">{count}</span>
          </button>
        ))}
      </div>

      <div className="mb-6 flex flex-wrap gap-3">
        <LibrarySearchField
          value={search}
          onChange={(v) => setSearch(v)}
          placeholder="Search movies…"
        />
        <select
          value={sort}
          onChange={(e) => setSort(e.target.value)}
          className="min-w-32 cursor-pointer rounded-xl border border-pitflix-card bg-pitflix-card px-4 py-2.5 text-sm text-white focus:border-pitflix-primary focus:outline-none"
        >
          <option value="title">Sort: A-Z</option>
          <option value="year">Sort: Year</option>
          <option value="rating">Sort: Rating</option>
          <option value="dateAdded">Sort: Added</option>
          <option value="imdbDesc">IMDb: High to Low</option>
          <option value="imdbAsc">IMDb: Low to High</option>
        </select>
        <select
          value={genre}
          onChange={(e) => setGenre(e.target.value)}
          className="min-w-32 cursor-pointer rounded-xl border border-pitflix-card bg-pitflix-card px-4 py-2.5 text-sm text-white focus:border-pitflix-primary focus:outline-none"
        >
          <option value="">All Genres</option>
          {COMMON_GENRES.map((g) => (
            <option key={g} value={g}>
              {g}
            </option>
          ))}
        </select>
        <select
          value={watch}
          onChange={(e) => setWatch(e.target.value)}
          className="min-w-36 cursor-pointer rounded-xl border border-pitflix-card bg-pitflix-card px-4 py-2.5 text-sm text-white focus:border-pitflix-primary focus:outline-none"
        >
          <option value="all">All</option>
          <option value="unwatched">Unwatched</option>
          <option value="watching">Watching</option>
          <option value="completed">Completed</option>
        </select>
      </div>

      {isPending && !isPlaceholderData ? (
        <LibraryGridSkeleton />
      ) : !isPending && total === 0 && !search && !genre && watch === "all" ? (
        <div className="flex flex-col items-center gap-4 py-24 text-center">
          <p className="text-4xl">🎬</p>
          <p className="text-lg font-semibold text-white">No movies in your library yet</p>
          <p className="max-w-sm text-sm text-pitflix-subtle">
            Add a library folder in Settings, then run a scan to import your files.
          </p>
          <Link
            to="/settings"
            className="mt-2 rounded-lg bg-pitflix-primary px-5 py-2.5 text-sm font-semibold text-white hover:bg-pitflix-light"
          >
            Open Settings
          </Link>
        </div>
      ) : (
        <>
          <ScrollReveal>
            {viewMode === "grid" ? (
              <LibraryPosterGrid>
                {pageItems.map((m) => {
                  const extras = cardExtras(m);
                  return (
                  <PosterCard
                    key={m.id}
                    item={m}
                    mediaType={extras.mediaType}
                    isFavorite={favoriteSet.has(m.tmdbId)}
                    selectionMode={selectionMode}
                    selected={selectedIds.has(m.id)}
                    onToggleSelect={() => toggleSelect(m.id)}
                    imdbRating={extras.imdbRating}
                    onContextMenu={extras.onContextMenu}
                  />
                  );
                })}
              </LibraryPosterGrid>
            ) : (
              <div className="flex flex-col divide-y divide-pitflix-card/50">
                {pageItems.map((m) => {
                  const extras = cardExtras(m);
                  return (
                  <LibraryListRow
                    key={m.id}
                    item={m}
                    mediaType={extras.mediaType}
                    isFavorite={favoriteSet.has(m.tmdbId)}
                    selectionMode={selectionMode}
                    selected={selectedIds.has(m.id)}
                    onToggleSelect={() => toggleSelect(m.id)}
                    onContextMenu={extras.onContextMenu}
                  />
                  );
                })}
              </div>
            )}
          </ScrollReveal>
          <ScrollReveal className="mt-8">
            <Pagination
              currentPage={data?.currentPage ?? page}
              totalPages={data?.totalPages ?? 1}
              totalItems={data?.total ?? 0}
              pageSize={pageSize}
              onPageChange={setPage}
            />
          </ScrollReveal>
        </>
      )}
      {menu ? (
        <LibraryContextMenuLayer menu={menu} onClose={closeMenu} onAction={(a) => void runAction(a)} />
      ) : null}
    </div>
  );
}
