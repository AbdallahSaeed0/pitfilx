import { useQuery } from "@tanstack/react-query";
import { CirclePlay, Search } from "lucide-react";
import { useEffect, useMemo, useState } from "react";
import { Link, useSearchParams } from "react-router-dom";
import {
  browseTrailers,
  getLatestTrailers,
  type TrailerBrowseFilter,
  type TrailerCard,
} from "../api/homeDiscover";
import { TrailerModal } from "../components/trailers/TrailerModal";
import { MediaImage } from "../components/ui/MediaImage";
import { Pagination } from "../components/ui/Pagination";
import { useDebounce } from "../hooks/useDebounce";
import { cn } from "../utils/cn";

type PageMode = "latest" | "trending" | "upcoming";

const defaultMode: PageMode = "latest";

const modes: { id: PageMode; label: string }[] = [
  { id: "latest", label: "Latest" },
  { id: "trending", label: "Trending" },
  { id: "upcoming", label: "Upcoming" },
];

const filters: { id: TrailerBrowseFilter; label: string }[] = [
  { id: "all", label: "All" },
  { id: "movie", label: "Movies" },
  { id: "tv", label: "Series" },
];

function modeFromParams(modeParam: string | null): PageMode {
  const m = (modeParam ?? "").trim().toLowerCase();
  if (m === "trending") return "trending";
  if (m === "upcoming" || m === "all-upcoming" || m === "upcoming-movies" || m === "upcoming-tv") return "upcoming";
  if (m === "latest") return "latest";
  return defaultMode;
}

function filterTrailersLocal(
  cards: TrailerCard[],
  media: TrailerBrowseFilter,
  search: string,
): TrailerCard[] {
  const q = search.trim().toLowerCase();
  return cards.filter((t) => {
    const mt = (t.mediaType || "").toLowerCase();
    if (media === "movie" && mt !== "movie") return false;
    if (media === "tv" && mt !== "tv") return false;
    if (q.length >= 2) {
      const title = (t.title || "").toLowerCase();
      const clip = (t.trailerTitle || "").toLowerCase();
      if (!title.includes(q) && !clip.includes(q)) return false;
    }
    return true;
  });
}

function TrailerGridSkeleton({ count = 10 }: { count?: number }) {
  return (
    <div className="grid grid-cols-2 gap-4 sm:grid-cols-3 md:grid-cols-4 lg:grid-cols-5">
      {Array.from({ length: count }).map((_, i) => (
        <div
          key={i}
          className="overflow-hidden rounded-xl border border-pitflix-card/40 bg-pitflix-surface/30 animate-pulse"
        >
          <div className="aspect-video w-full bg-pitflix-card/60" />
          <div className="space-y-2 p-2">
            <div className="h-3.5 rounded bg-pitflix-card/50" />
            <div className="h-2.5 w-2/3 rounded bg-pitflix-card/40" />
          </div>
        </div>
      ))}
    </div>
  );
}

export function TrailersPage() {
  const [searchParams, setSearchParams] = useSearchParams();
  const mode = useMemo(() => modeFromParams(searchParams.get("mode")), [searchParams]);
  const [currentPage, setCurrentPage] = useState(1);
  const itemsPerPage = 20;

  useEffect(() => {
    if (searchParams.get("mode")) return;
    const p = new URLSearchParams(searchParams);
    p.set("mode", defaultMode);
    setSearchParams(p, { replace: true });
  }, [searchParams, setSearchParams]);

  useEffect(() => {
    const raw = searchParams.get("mode")?.trim().toLowerCase() ?? "";
    if (raw === "all-upcoming" || raw === "upcoming-movies" || raw === "upcoming-tv") {
      const p = new URLSearchParams(searchParams);
      p.set("mode", "upcoming");
      setSearchParams(p, { replace: true });
      if (raw === "upcoming-movies") setFilter("movie");
      else if (raw === "upcoming-tv") setFilter("tv");
    }
  }, [searchParams, setSearchParams]);

  const [filter, setFilter] = useState<TrailerBrowseFilter>("all");
  const [active, setActive] = useState<TrailerCard | null>(null);
  const [searchDraft, setSearchDraft] = useState("");
  const debouncedSearch = useDebounce(searchDraft, 420);

  const setMode = (next: PageMode) => {
    const p = new URLSearchParams(searchParams);
    p.set("mode", next);
    setSearchParams(p, { replace: true });
  };

  const latestQ = useQuery({
    queryKey: ["trailers", "latest-persisted"],
    queryFn: getLatestTrailers,
    staleTime: 5 * 60_000,
    gcTime: 30 * 60_000,
    enabled: mode === "latest",
  });

  const searchActive = debouncedSearch.trim().length >= 2;
  const browseQ = useQuery({
    queryKey: ["trailers", "browse", mode, filter, debouncedSearch.trim()],
    queryFn: () => {
      if (mode !== "trending" && mode !== "upcoming") throw new Error("browse query enabled only for TMDB modes");
      return browseTrailers(mode, filter, searchActive ? debouncedSearch.trim() : undefined);
    },
    staleTime: mode === "trending" ? 3 * 60_000 : 2 * 60_000,
    enabled: mode === "trending" || mode === "upcoming",
  });

  const list = useMemo(() => {
    if (mode === "latest") {
      const raw = latestQ.data ?? [];
      return filterTrailersLocal(raw, filter, debouncedSearch);
    }
    return browseQ.data ?? [];
  }, [mode, latestQ.data, browseQ.data, filter, debouncedSearch]);

  const loading = mode === "latest" ? latestQ.isLoading : browseQ.isLoading;
  const error = mode === "latest" ? latestQ.isError : browseQ.isError;

  // Reset to page 1 when filters change
  useEffect(() => {
    setCurrentPage(1);
  }, [mode, filter, debouncedSearch]);

  // Paginate results
  const totalPages = Math.ceil(list.length / itemsPerPage);
  const paginatedList = useMemo(() => {
    const start = (currentPage - 1) * itemsPerPage;
    const end = start + itemsPerPage;
    return list.slice(start, end);
  }, [list, currentPage]);

  return (
    <div className="mx-auto max-w-6xl space-y-5 pb-12">
      <div className="flex flex-wrap items-center justify-between gap-3">
        <h1 className="flex items-center gap-2 text-xl font-bold text-white md:text-2xl">
          <CirclePlay className="h-7 w-7 shrink-0 text-pitflix-primary md:h-8 md:w-8" />
          Trailers
        </h1>
        <Link to="/" className="text-sm text-pitflix-primary hover:underline">
          ← Home
        </Link>
      </div>

      <div className="flex flex-wrap gap-2 rounded-xl border border-pitflix-card/50 bg-pitflix-surface/40 p-3">
        {modes.map((m) => (
          <button
            key={m.id}
            type="button"
            onClick={() => setMode(m.id)}
            className={cn(
              "rounded-full px-4 py-1.5 text-xs font-semibold transition-colors",
              mode === m.id ? "bg-pitflix-primary text-white" : "bg-pitflix-card text-pitflix-muted hover:text-white",
            )}
          >
            {m.label}
          </button>
        ))}
        <div className="ml-auto flex flex-wrap items-center gap-1.5">
          <span className="text-[10px] font-medium uppercase tracking-wide text-pitflix-muted">Type</span>
          {filters.map((f) => (
            <button
              key={f.id}
              type="button"
              onClick={() => setFilter(f.id)}
              className={cn(
                "rounded-full px-2.5 py-1 text-[11px] font-semibold",
                filter === f.id
                  ? "bg-pitflix-primary/30 text-white ring-1 ring-pitflix-primary/40"
                  : "bg-pitflix-bg text-pitflix-muted hover:text-white",
              )}
            >
              {f.label}
            </button>
          ))}
        </div>
      </div>

      <div className="relative">
        <Search className="pointer-events-none absolute left-3 top-1/2 h-4 w-4 -translate-y-1/2 text-pitflix-muted" />
        <input
          type="search"
          value={searchDraft}
          onChange={(e) => setSearchDraft(e.target.value)}
          placeholder={
            mode === "latest"
              ? "Search this feed by title…"
              : "Search TMDB (trending / upcoming) — min 2 characters…"
          }
          className="w-full rounded-xl border border-pitflix-card bg-pitflix-surface/50 py-2.5 pl-10 pr-3 text-sm text-white placeholder:text-pitflix-muted focus:border-pitflix-primary focus:outline-none focus:ring-1 focus:ring-pitflix-primary/40"
        />
        {mode !== "latest" && searchDraft.trim().length > 0 && searchDraft.trim().length < 2 ? (
          <p className="mt-1 text-[11px] text-pitflix-muted">Type at least 2 characters to search TMDB.</p>
        ) : null}
      </div>

      {loading ? <TrailerGridSkeleton /> : null}

      {error ? (
        <p className="text-sm text-rose-200/90">Could not load trailers. Is the API running?</p>
      ) : null}

      {!loading && !error && list.length === 0 ? (
        <p className="text-sm text-pitflix-subtle">No trailers matched this filter right now.</p>
      ) : null}

      {!loading && list.length > 0 ? (
        <>
          <div className="grid grid-cols-2 gap-4 sm:grid-cols-3 md:grid-cols-4 lg:grid-cols-5">
            {paginatedList.map((t) => {
              const youtubeThumb = `https://img.youtube.com/vi/${t.youtubeKey}/hqdefault.jpg`;
              const thumb = youtubeThumb || t.posterUrl || t.backdropUrl;
              return (
                <button
                  key={`${t.mediaType}-${t.tmdbId}-${t.youtubeKey}`}
                  type="button"
                  onClick={() => setActive(t)}
                  className="group overflow-hidden rounded-xl border border-pitflix-card/60 bg-black/30 text-left shadow-lg transition-all hover:border-pitflix-primary/45"
                >
                  <div className="relative aspect-video w-full">
                    <MediaImage src={thumb} alt="" className="h-full w-full object-cover" fallbackText="▶" />
                    <div className="absolute inset-0 flex items-center justify-center bg-black/30 opacity-90 transition-opacity group-hover:bg-black/45">
                      <CirclePlay className="h-10 w-10 text-white drop-shadow-md" />
                    </div>
                  </div>
                  <div className="space-y-0.5 p-2">
                    <p className="line-clamp-2 text-xs font-semibold text-white">{t.title}</p>
                    <p className="line-clamp-1 text-[10px] text-pitflix-subtle">{t.trailerTitle}</p>
                  </div>
                </button>
              );
            })}
          </div>
          {totalPages > 1 ? (
            <div className="mt-8">
              <Pagination
                currentPage={currentPage}
                totalPages={totalPages}
                totalItems={list.length}
                pageSize={itemsPerPage}
                onPageChange={setCurrentPage}
              />
            </div>
          ) : null}
        </>
      ) : null}

      <TrailerModal open={!!active} onClose={() => setActive(null)} trailer={active} />
    </div>
  );
}
