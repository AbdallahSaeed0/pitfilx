import { useQuery, useQueryClient } from "@tanstack/react-query";
import { useCallback, useMemo, useState } from "react";
import { LayoutGrid, List } from "lucide-react";
import { Link, useSearchParams } from "react-router-dom";
import {
  bulkDeleteFromDevice,
  bulkRemoveFromLibrary,
  bulkRescanSeries,
  bulkSetWatchStatus,
} from "../api/library";
import { getListTmdbIds, getLists } from "../api/lists";
import { getStats } from "../api/stats";
import { useSeriesList } from "../hooks/useSeries";
import { useDebounce } from "../hooks/useDebounce";
import { PosterCard } from "../components/ui/PosterCard";
import { LibraryListRow } from "../components/ui/LibraryListRow";
import { Pagination } from "../components/ui/Pagination";
import { LibraryGridSkeleton } from "../components/ui/LibraryGridSkeleton";
import { LibrarySearchField } from "../components/ui/LibrarySearchField";
import { ScrollReveal } from "../components/ui/ScrollReveal";
import type { MediaCard } from "../types/media";
import { cn } from "../utils/cn";
import { isFavoritesListName } from "../utils/listMarks";
import { COMMON_GENRES } from "../data/commonGenres";

const VIEW_STORAGE_KEY = "pitflix.library.view.series";
type ViewMode = "grid" | "list";

export function SeriesPage() {
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
  const [lang, setLang] = useState<"en" | "ar">("en");
  const [search, setSearch] = useState("");
  const searchQ = useDebounce(search, 350);
  const [sort, setSort] = useState("title");
  const [genre, setGenre] = useState("");
  const [watch, setWatch] = useState("all");
  const pageSize = 40;
  const [selectionMode, setSelectionMode] = useState(false);
  const [selectedIds, setSelectedIds] = useState<Set<number>>(() => new Set());
  const [markBusy, setMarkBusy] = useState(false);
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
    queryKey: ["list-tmdb-ids", favoritesList?.id, "Series"],
    queryFn: () => getListTmdbIds(favoritesList!.id, "Series"),
    enabled: !!favoritesList,
  });
  const favoriteSet = useMemo(() => new Set(favoriteTmdbIds), [favoriteTmdbIds]);
  const englishCount = stats?.englishSeries ?? 0;
  const arabicCount = stats?.arabicSeries ?? 0;

  const { data, isPending, isPlaceholderData } = useSeriesList({
    page,
    pageSize,
    lang,
    search: searchQ || undefined,
    genre: genre || undefined,
    sort,
    watch,
  });

  const total = data?.total ?? 0;

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

  const markSelectedCompleted = async () => {
    if (selectedIds.size === 0) return;
    setMarkBusy(true);
    try {
      await bulkSetWatchStatus({
        showIds: [...selectedIds],
        watchStatus: "Completed",
      });
      exitSelection();
      void qc.invalidateQueries({ queryKey: ["series"] });
      void qc.invalidateQueries({ queryKey: ["stats"] });
      void qc.invalidateQueries({ queryKey: ["home-series"] });
    } catch (e) {
      console.error(e);
    } finally {
      setMarkBusy(false);
    }
  };

  const markSelectedUnwatched = async () => {
    if (selectedIds.size === 0) return;
    setMarkBusy(true);
    try {
      await bulkSetWatchStatus({
        showIds: [...selectedIds],
        watchStatus: "Unwatched",
      });
      exitSelection();
      void qc.invalidateQueries({ queryKey: ["series"] });
      void qc.invalidateQueries({ queryKey: ["stats"] });
      void qc.invalidateQueries({ queryKey: ["home-series"] });
    } catch (e) {
      console.error(e);
    } finally {
      setMarkBusy(false);
    }
  };

  const removeSelectedFromLibrary = async () => {
    if (selectedIds.size === 0) return;
    setMarkBusy(true);
    try {
      await bulkRemoveFromLibrary({ showIds: [...selectedIds] });
      exitSelection();
      void qc.invalidateQueries({ queryKey: ["series"] });
      void qc.invalidateQueries({ queryKey: ["stats"] });
      void qc.invalidateQueries({ queryKey: ["home-series"] });
      void qc.invalidateQueries({ queryKey: ["unmatched"] });
    } catch (e) {
      console.error(e);
    } finally {
      setMarkBusy(false);
    }
  };

  const deleteSelectedFromDevice = async () => {
    if (selectedIds.size === 0) return;
    if (
      !window.confirm(
        `Permanently delete episode files for ${selectedIds.size} series and remove them from the library? This cannot be undone.`,
      )
    )
      return;
    setMarkBusy(true);
    try {
      const r = await bulkDeleteFromDevice({ showIds: [...selectedIds] });
      exitSelection();
      void qc.invalidateQueries({ queryKey: ["series"] });
      void qc.invalidateQueries({ queryKey: ["stats"] });
      void qc.invalidateQueries({ queryKey: ["home-series"] });
      void qc.invalidateQueries({ queryKey: ["unmatched"] });
      if (r.errors?.length)
        window.alert(`Some files could not be deleted:\n${r.errors.slice(0, 8).join("\n")}`);
    } catch (e) {
      console.error(e);
    } finally {
      setMarkBusy(false);
    }
  };

  const rescanSelectedSeries = async () => {
    if (selectedIds.size === 0) return;
    if (
      !window.confirm(
        `Re-scan ${selectedIds.size} series from their folders? This will remove them from the library and match all episode files again with TMDB.`,
      )
    )
      return;
    setMarkBusy(true);
    try {
      const r = await bulkRescanSeries({ showIds: [...selectedIds] });
      exitSelection();
      void qc.invalidateQueries({ queryKey: ["series"] });
      void qc.invalidateQueries({ queryKey: ["stats"] });
      void qc.invalidateQueries({ queryKey: ["home-series"] });
      void qc.invalidateQueries({ queryKey: ["unmatched"] });
      if (r.failureCount > 0) {
        const failedShows = r.results.filter((x) => !x.success);
        const errorMsg = failedShows.slice(0, 5).map((x) => `Show ID ${x.showId}: ${x.error ?? "failed"}`).join("\n");
        window.alert(`Re-scan completed: ${r.successCount} succeeded, ${r.failureCount} failed.\n\n${errorMsg}`);
      } else {
        window.alert(`Successfully re-scanned ${r.successCount} series.`);
      }
    } catch (e) {
      console.error(e);
      window.alert("Re-scan failed. Check console for details.");
    } finally {
      setMarkBusy(false);
    }
  };

  return (
    <div>
      <div className="mb-6 flex flex-wrap items-start justify-between gap-4">
        <div>
          <h1 className="text-3xl font-bold text-white">Series</h1>
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
                className="rounded-lg border border-pitflix-primary/50 bg-pitflix-bg px-3 py-2 text-xs font-semibold text-white hover:bg-pitflix-primary/20 disabled:opacity-50"
                onClick={() => void rescanSelectedSeries()}
              >
                Rescan…
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
            onClick={() => {
              setLang(key);
              setPage(1);
            }}
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
          onChange={(v) => {
            setSearch(v);
            setPage(1);
          }}
          placeholder="Search series…"
        />
        <select
          value={sort}
          onChange={(e) => {
            setSort(e.target.value);
            setPage(1);
          }}
          className="min-w-32 cursor-pointer rounded-xl border border-pitflix-card bg-pitflix-card px-4 py-2.5 text-sm text-white focus:border-pitflix-primary focus:outline-none"
        >
          <option value="title">Sort: A-Z</option>
          <option value="year">Sort: Year</option>
          <option value="rating">Sort: Rating</option>
          <option value="dateAdded">Sort: Added</option>
        </select>
        <select
          value={genre}
          onChange={(e) => {
            setGenre(e.target.value);
            setPage(1);
          }}
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
          onChange={(e) => {
            setWatch(e.target.value);
            setPage(1);
          }}
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
          <p className="text-4xl">📺</p>
          <p className="text-lg font-semibold text-white">No series in your library yet</p>
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
              <div className="grid grid-cols-4 sm:grid-cols-5 md:grid-cols-6 lg:grid-cols-7 xl:grid-cols-8 2xl:grid-cols-10 gap-3 gap-y-7">
                {((data?.items ?? []) as MediaCard[]).map((s) => (
                  <PosterCard
                    key={s.id}
                    item={s}
                    mediaType="Series"
                    isFavorite={favoriteSet.has(s.tmdbId)}
                    selectionMode={selectionMode}
                    selected={selectedIds.has(s.id)}
                    onToggleSelect={() => toggleSelect(s.id)}
                    className="w-full"
                  />
                ))}
              </div>
            ) : (
              <div className="flex flex-col divide-y divide-pitflix-card/50">
                {((data?.items ?? []) as MediaCard[]).map((s) => (
                  <LibraryListRow
                    key={s.id}
                    item={s}
                    mediaType="Series"
                    isFavorite={favoriteSet.has(s.tmdbId)}
                    selectionMode={selectionMode}
                    selected={selectedIds.has(s.id)}
                    onToggleSelect={() => toggleSelect(s.id)}
                  />
                ))}
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
    </div>
  );
}
