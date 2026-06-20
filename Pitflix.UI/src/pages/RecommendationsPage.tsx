import { useMutation, useQuery } from "@tanstack/react-query";
import { Search, Sparkles, ChevronDown } from "lucide-react";
import { useMemo, useState } from "react";
import { useNavigate } from "react-router-dom";
import { fetchRecommendations, type RecommendationFilter, type RecommendationItem } from "../api/recommendations";
import { cn } from "../utils/cn";
import { searchUnmatched } from "../api/unmatched";
import { MediaImage } from "../components/ui/MediaImage";
import { Spinner } from "../components/ui/Spinner";
import { useDebounce } from "../hooks/useDebounce";
import { formatCount, formatRating } from "../utils/format";
import { getMovies } from "../api/movies";
import { getAllSeries } from "../api/series";
import type { MediaCard } from "../types/media";

function getMatchReasons(item: RecommendationItem): { label: string; color: string }[] {
  const reasons: { label: string; color: string }[] = [];
  if (item.voteAverage >= 8.0) reasons.push({ label: "⭐ Highly Rated", color: "bg-amber-500/20 text-amber-300" });
  if (item.voteCount >= 5000) reasons.push({ label: "🔥 Popular", color: "bg-rose-500/20 text-rose-300" });
  if (item.voteAverage >= 7.0 && item.voteCount >= 1000 && reasons.length === 0)
    reasons.push({ label: "👍 Well Reviewed", color: "bg-green-500/20 text-green-300" });
  return reasons;
}

type SearchHit = {
  id: number;
  title: string;
  year: string | null;
  overview: string | null;
  posterUrl: string | null;
  mediaType: string;
};

export function RecommendationsPage() {
  const navigate = useNavigate();
  const [q, setQ] = useState("");
  const debounced = useDebounce(q, 380);
  const [selected, setSelected] = useState<SearchHit | null>(null);
  const [filter, setFilter] = useState<RecommendationFilter>("both");
  const [showSearch, setShowSearch] = useState(true);

  const searchQ = useQuery({
    queryKey: ["rec-search", debounced],
    queryFn: () =>
      searchUnmatched({ query: debounced.trim(), mediaType: "Both" }) as Promise<SearchHit[]>,
    enabled: debounced.trim().length >= 2,
    staleTime: 30_000,
  });

  // Fetch library tmdbIds to show "In Library" badge
  const libMoviesQ = useQuery({
    queryKey: ["rec-lib-movies"],
    queryFn: () => getMovies({ limit: 500 }) as Promise<{ items?: MediaCard[] } | MediaCard[]>,
    staleTime: 10 * 60_000,
  });
  const libSeriesQ = useQuery({
    queryKey: ["rec-lib-series"],
    queryFn: () => getAllSeries({ limit: 500 }) as Promise<{ items?: MediaCard[] } | MediaCard[]>,
    staleTime: 10 * 60_000,
  });

  const libMovieTmdbIds = useMemo(() => {
    const items = Array.isArray(libMoviesQ.data) ? libMoviesQ.data : ((libMoviesQ.data as { items?: MediaCard[] })?.items ?? []);
    return new Set(items.map((m) => m.tmdbId).filter(Boolean));
  }, [libMoviesQ.data]);

  const libSeriesTmdbIds = useMemo(() => {
    const items = Array.isArray(libSeriesQ.data) ? libSeriesQ.data : ((libSeriesQ.data as { items?: MediaCard[] })?.items ?? []);
    return new Set(items.map((s) => s.tmdbId).filter(Boolean));
  }, [libSeriesQ.data]);

  const libTmdbIdMap = useMemo(() => {
    const items = Array.isArray(libMoviesQ.data) ? libMoviesQ.data : ((libMoviesQ.data as { items?: MediaCard[] })?.items ?? []);
    const sItems = Array.isArray(libSeriesQ.data) ? libSeriesQ.data : ((libSeriesQ.data as { items?: MediaCard[] })?.items ?? []);
    const map = new Map<number, { id: number; type: "Movie" | "Series" }>();
    items.forEach((m) => { if (m.tmdbId) map.set(m.tmdbId, { id: m.id, type: "Movie" }); });
    sItems.forEach((s) => { if (s.tmdbId) map.set(s.tmdbId, { id: s.id, type: "Series" }); });
    return map;
  }, [libMoviesQ.data, libSeriesQ.data]);

  const recMutation = useMutation({
    mutationFn: () =>
      fetchRecommendations({
        tmdbId: selected!.id,
        mediaType: selected!.mediaType === "Series" || selected!.mediaType === "tv" ? "tv" : "movie",
        filter,
      }),
    onSuccess: () => setShowSearch(false),
  });

  const recResult = recMutation.data;
  const recItems = recResult?.data.items ?? [];
  const recFailed =
    recResult && (recResult.status >= 400 || (recResult.data.error && recResult.data.error.length > 0));
  const recErrorMessage = recFailed
    ? recResult.data.error || (recResult.status >= 400 ? `Request failed (${recResult.status})` : null)
    : null;
  const recDetail = recResult?.data.detail;
  const recEmptyOk =
    recResult && recResult.status < 400 && !recResult.data.error && recItems.length === 0 && !recMutation.isPending;

  const hits = useMemo(() => searchQ.data ?? [], [searchQ.data]);

  return (
    <div className="mx-auto max-w-5xl space-y-8 pb-10">
      {/* Header */}
      <div className="flex flex-wrap items-start justify-between gap-4">
        <div>
          <h1 className="flex items-center gap-2 text-2xl font-bold text-white md:text-3xl">
            <Sparkles className="h-7 w-7 text-pitflix-primary" />
            Recommendations
          </h1>
          <p className="mt-1.5 max-w-2xl text-sm leading-relaxed text-pitflix-subtle">
            Pick a title you love — we&apos;ll suggest similar ones based on shared genres, themes, and popularity.
          </p>
        </div>
        {recItems.length > 0 && (
          <button
            type="button"
            onClick={() => setShowSearch((v) => !v)}
            className="flex items-center gap-1.5 rounded-xl border border-white/15 px-3 py-2 text-sm text-pitflix-muted transition hover:border-pitflix-primary/40 hover:text-white"
          >
            {showSearch ? "Hide search" : "New search"}
            <ChevronDown className={cn("h-4 w-4 transition-transform", showSearch && "rotate-180")} />
          </button>
        )}
      </div>

      {/* Search panel */}
      {showSearch && (
        <section className="rounded-2xl border border-white/10 bg-pitflix-surface/50 p-5 shadow-lg shadow-black/20">
          <label className="mb-2 flex items-center gap-2 text-sm font-semibold text-pitflix-muted">
            <Search className="h-4 w-4" />
            Title you enjoyed
          </label>

          {/* Selected indicator */}
          {selected && (
            <div className="mb-3 flex items-center gap-3 rounded-xl border border-pitflix-primary/30 bg-pitflix-primary/10 px-3 py-2">
              <MediaImage
                src={selected.posterUrl ?? undefined}
                alt=""
                className="h-10 w-7 shrink-0 rounded bg-pitflix-card object-cover"
                fallbackText={selected.title.slice(0, 2)}
              />
              <div className="min-w-0 flex-1">
                <p className="truncate text-sm font-semibold text-white">{selected.title}</p>
                <p className="text-xs text-pitflix-muted">{selected.year ?? "—"} · {selected.mediaType}</p>
              </div>
              <button
                type="button"
                onClick={() => { setSelected(null); recMutation.reset(); }}
                className="shrink-0 text-xs text-pitflix-muted hover:text-white"
              >
                ✕
              </button>
            </div>
          )}

          <input
            type="search"
            value={q}
            onChange={(e) => {
              setQ(e.target.value);
              if (!selected) recMutation.reset();
            }}
            placeholder="Search movies and series…"
            className="w-full rounded-xl border border-pitflix-card bg-pitflix-bg px-3 py-2.5 text-sm text-white placeholder:text-pitflix-subtle focus:border-pitflix-primary focus:outline-none"
          />

          {debounced.trim().length >= 2 && searchQ.isFetching && (
            <p className="mt-3 flex items-center gap-2 text-xs text-pitflix-subtle">
              <Spinner className="h-4 w-4" /> Searching…
            </p>
          )}

          {debounced.trim().length >= 2 && !searchQ.isFetching && hits.length > 0 && (
            <ul className="mt-3 max-h-64 space-y-1 overflow-y-auto rounded-xl border border-pitflix-card bg-pitflix-bg p-2">
              {hits.map((h) => {
                const inLib = libMovieTmdbIds.has(h.id) || libSeriesTmdbIds.has(h.id);
                return (
                  <li key={`${h.mediaType}-${h.id}`}>
                    <button
                      type="button"
                      onClick={() => { setSelected(h); setQ(""); recMutation.reset(); }}
                      className={cn(
                        "flex w-full items-center gap-3 rounded-lg px-2 py-2 text-left text-sm transition-colors",
                        selected?.id === h.id && selected.mediaType === h.mediaType
                          ? "bg-pitflix-primary/25 text-white"
                          : "hover:bg-pitflix-card/70 text-pitflix-muted",
                      )}
                    >
                      <MediaImage
                        src={h.posterUrl ?? undefined}
                        alt=""
                        className="h-14 w-10 shrink-0 overflow-hidden rounded bg-pitflix-card object-cover"
                        fallbackText={h.title.slice(0, 2)}
                      />
                      <span className="min-w-0 flex-1">
                        <span className="block truncate font-medium text-white">{h.title}</span>
                        <span className="text-xs text-pitflix-subtle">{h.year ?? "—"} · {h.mediaType}</span>
                      </span>
                      {inLib && (
                        <span className="shrink-0 rounded-full bg-emerald-500/20 px-2 py-0.5 text-[10px] font-semibold text-emerald-300">
                          In library
                        </span>
                      )}
                    </button>
                  </li>
                );
              })}
            </ul>
          )}

          <div className="mt-4 flex flex-wrap items-center gap-2">
            <span className="text-xs font-medium text-pitflix-muted">Show:</span>
            {(
              [
                { v: "both" as const, label: "Both" },
                { v: "movie" as const, label: "Movies" },
                { v: "tv" as const, label: "Series" },
              ] as const
            ).map((x) => (
              <button
                key={x.v}
                type="button"
                onClick={() => { setFilter(x.v); recMutation.reset(); }}
                className={cn(
                  "rounded-full px-3 py-1 text-xs font-semibold transition-colors",
                  filter === x.v
                    ? "bg-pitflix-primary text-white"
                    : "bg-pitflix-card text-pitflix-muted hover:text-white",
                )}
              >
                {x.label}
              </button>
            ))}
            <button
              type="button"
              disabled={!selected || recMutation.isPending}
              onClick={() => recMutation.mutate()}
              className="ml-auto rounded-xl bg-pitflix-primary px-5 py-2 text-sm font-bold text-white shadow-md shadow-pitflix-primary/25 hover:bg-pitflix-light disabled:opacity-50"
            >
              {recMutation.isPending ? "Building…" : "Get recommendations"}
            </button>
          </div>

          {recMutation.isError && (
            <p className="mt-3 text-sm text-rose-200/90">Could not reach the server for recommendations.</p>
          )}
          {recFailed && !recMutation.isError && (
            <div className="mt-3 rounded-xl border border-rose-500/30 bg-rose-950/25 p-3 text-sm text-rose-100/90">
              <p className="font-medium">{recErrorMessage}</p>
              {recDetail ? <p className="mt-1 text-xs text-rose-200/80">{recDetail}</p> : null}
            </div>
          )}
          {recEmptyOk && (
            <p className="mt-3 text-sm text-pitflix-subtle">
              No suggestions for this title with current filters. Try "Both" or pick another title.
            </p>
          )}
        </section>
      )}

      {/* Results */}
      {recItems.length > 0 && !recFailed && (
        <section>
          <div className="mb-5 flex items-center justify-between">
            <h2 className="text-lg font-bold text-white">
              Because you liked{" "}
              <span className="text-pitflix-primary">{selected?.title}</span>
            </h2>
            <p className="text-xs text-pitflix-muted">{recItems.length} suggestions</p>
          </div>

          <div className="grid grid-cols-2 gap-4 sm:grid-cols-3 md:grid-cols-4 lg:grid-cols-5">
            {recItems.map((item: RecommendationItem) => {
              const isMovie = item.mediaType === "movie";
              const libEntry = libTmdbIdMap.get(item.tmdbId);
              const inLib = !!libEntry;
              const reasons = getMatchReasons(item);

              return (
                <div
                  key={`${item.mediaType}-${item.tmdbId}`}
                  className="group flex flex-col overflow-hidden rounded-2xl border border-pitflix-card/60 bg-pitflix-surface/60 transition-all hover:border-pitflix-primary/50 hover:shadow-lg hover:shadow-black/30"
                >
                  <div
                    className="relative cursor-pointer"
                    onClick={() => {
                      if (inLib && libEntry) {
                        navigate(libEntry.type === "Movie" ? `/movie/${libEntry.id}` : `/series/${libEntry.id}`);
                      } else {
                        navigate("/stream-details", {
                          state: {
                            tmdbId: item.tmdbId,
                            mediaType: isMovie ? "Movie" : "Series",
                            title: item.title,
                            posterUrl: item.posterUrl,
                            year: item.year != null ? String(item.year) : null,
                          },
                        });
                      }
                    }}
                  >
                    <MediaImage
                      src={item.posterUrl ?? undefined}
                      alt=""
                      className="aspect-[2/3] w-full object-cover transition-opacity group-hover:opacity-85"
                      fallbackText={item.title.slice(0, 2)}
                    />
                    <div className="absolute left-2 top-2 flex flex-col gap-1">
                      <span className="rounded-md bg-black/80 px-1.5 py-0.5 text-[10px] font-bold text-amber-300 ring-1 ring-amber-500/40">
                        ★ {formatRating(item.voteAverage)}
                      </span>
                      {inLib && (
                        <span className="rounded-md bg-emerald-600/90 px-1.5 py-0.5 text-[10px] font-bold text-white">
                          In library
                        </span>
                      )}
                    </div>
                    <div className="absolute inset-0 flex items-center justify-center bg-black/0 opacity-0 transition-all group-hover:bg-black/20 group-hover:opacity-100">
                      <span className="flex h-10 w-10 items-center justify-center rounded-full bg-pitflix-primary shadow-lg">
                        <span className="ml-0.5 text-white">▶</span>
                      </span>
                    </div>
                  </div>

                  <div className="flex flex-1 flex-col p-3">
                    <p className="line-clamp-2 text-sm font-semibold leading-snug text-white group-hover:text-pitflix-light">
                      {item.title}
                    </p>
                    <p className="mt-1 text-[11px] text-pitflix-muted">
                      {item.year ?? "—"} · {isMovie ? "Movie" : "Series"}
                    </p>
                    {item.voteCount > 0 && (
                      <p className="text-[10px] text-pitflix-subtle">{formatCount(item.voteCount)} votes</p>
                    )}
                    {reasons.length > 0 && (
                      <div className="mt-1.5 flex flex-wrap gap-1">
                        {reasons.map((r) => (
                          <span key={r.label} className={cn("rounded px-1.5 py-0.5 text-[10px] font-semibold", r.color)}>
                            {r.label}
                          </span>
                        ))}
                      </div>
                    )}
                    {item.overview && (
                      <p className="mt-1.5 line-clamp-2 text-[11px] leading-relaxed text-pitflix-subtle">{item.overview}</p>
                    )}
                  </div>
                </div>
              );
            })}
          </div>

          <p className="mt-6 text-center text-[11px] text-pitflix-subtle">
            Based on TMDB recommendations and discover (genres, keywords). Titles in your library open the detail page; others open the streaming view.
          </p>
        </section>
      )}
    </div>
  );
}
