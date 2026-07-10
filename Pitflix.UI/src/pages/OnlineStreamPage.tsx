import { useQuery } from "@tanstack/react-query";
import { Info, Play, Search, Settings } from "lucide-react";
import { useEffect, useRef, useState } from "react";
import { Link, useLocation, useNavigate } from "react-router-dom";
import { getStreamDiscover } from "../api/stream";
import { searchUnmatched } from "../api/unmatched";
import { ContentSection } from "../components/streaming/ContentSection";
import { HeroSection } from "../components/streaming/HeroSection";
import { MediaImage } from "../components/ui/MediaImage";
import { Spinner } from "../components/ui/Spinner";
import { useDebounce } from "../hooks/useDebounce";
import { cn } from "../utils/cn";
import type { StreamingDetailsLocationState } from "./StreamingDetailsPage";

type SearchKind = "Both" | "Movie" | "Series";

type StreamSearchRow = {
  id: number;
  title: string;
  year?: string;
  posterUrl: string | null;
  mediaType: "Movie" | "Series";
  voteAverage: number;
};

function mapSearchRows(data: unknown, fallback: SearchKind): StreamSearchRow[] {
  const rows = (Array.isArray(data) ? data : []).map((raw) => {
    const r = raw as Record<string, unknown>;
    const id = Number(r.id ?? r.Id ?? 0);
    const title = String(r.title ?? r.Title ?? "");
    const year =
      typeof r.year === "string" && r.year.length >= 4 ? r.year.slice(0, 4) : undefined;
    const posterUrl =
      typeof r.posterUrl === "string"
        ? r.posterUrl
        : typeof r.poster_url === "string"
          ? r.poster_url
          : null;
    const mtRaw = typeof r.mediaType === "string" ? r.mediaType : "";
    let mediaType: "Movie" | "Series";
    if (mtRaw === "Movie" || mtRaw === "Series") {
      mediaType = mtRaw;
    } else if (fallback === "Movie" || fallback === "Series") {
      mediaType = fallback;
    } else {
      mediaType = "Movie";
    }
    const voteAverage = Number(r.voteAverage ?? r.vote_average ?? 0) || 0;
    return { id, title, year, posterUrl, mediaType, voteAverage };
  });
  return rows.filter((x) => x.id > 0 && x.title);
}

function posterDisplay(url: string | null): string | null {
  if (!url) return null;
  return url.includes("/w92") ? url.replace("/w92", "/w342") : url;
}

const CONTENT_SECTIONS = [
  { title: "TRENDING MOVIES", category: "trending-movie" as const },
  { title: "TRENDING TV SHOWS", category: "trending-tv" as const },
  { title: "POPULAR MOVIES", category: "popular-movie" as const },
  { title: "POPULAR TV SHOWS", category: "popular-tv" as const },
  { title: "TOP RATED MOVIES", category: "top-rated-movie" as const },
  { title: "TOP RATED TV SHOWS", category: "top-rated-tv" as const },
] as const;

export function OnlineStreamPage() {
  const navigate = useNavigate();
  const location = useLocation();
  const searchRef = useRef<HTMLInputElement>(null);

  const [query, setQuery] = useState("");
  const [kind, setKind] = useState<SearchKind>("Both");
  const debounced = useDebounce(query, 280);

  useEffect(() => {
    const st = location.state as { seedQuery?: string; seedKind?: SearchKind } | null;
    if (!st?.seedQuery?.trim()) return;
    setQuery(st.seedQuery.trim());
    if (st.seedKind === "Movie" || st.seedKind === "Series" || st.seedKind === "Both") {
      setKind(st.seedKind);
    }
    navigate(location.pathname, { replace: true, state: {} });
  }, [location.pathname, location.state, navigate]);

  // Hero data — trending movies
  const heroQuery = useQuery({
    queryKey: ["stream-discover", "trending-movie"],
    queryFn: () => getStreamDiscover("trending-movie"),
    staleTime: 10 * 60 * 1000,
  });

  // Search
  const searchQuery = useQuery({
    queryKey: ["online-stream-search", debounced.trim(), kind],
    queryFn: async () => {
      const raw = await searchUnmatched({ query: debounced.trim(), mediaType: kind });
      return mapSearchRows(raw, kind);
    },
    enabled: debounced.trim().length >= 2,
  });

  const isSearching = debounced.trim().length >= 2;
  const searchRows = searchQuery.data ?? [];

  const openDetails = (row: StreamSearchRow, autoPlay = false) => {
    const state: StreamingDetailsLocationState = {
      tmdbId: row.id,
      mediaType: row.mediaType,
      title: row.title,
      posterUrl: posterDisplay(row.posterUrl),
      year: row.year ?? null,
      ...(autoPlay ? { autoPlay: true as const } : {}),
      returnSeedQuery: query,
      returnSeedKind: kind,
    };
    navigate("/stream-details", { state });
  };

  const kindTabs: { id: SearchKind; label: string }[] = [
    { id: "Both", label: "All" },
    { id: "Movie", label: "Movies" },
    { id: "Series", label: "TV" },
  ];

  return (
    <div className="min-h-full pb-12">
      {/* ── Search bar ── */}
      <div className="sticky top-0 z-20 -mx-4 mb-6 bg-pitflix-bg/95 px-4 pb-4 pt-4 backdrop-blur-sm">
        <div className="flex flex-col gap-3 sm:flex-row sm:items-center">
          <div className="relative flex-1">
            <Search className="pointer-events-none absolute left-3.5 top-1/2 h-4 w-4 -translate-y-1/2 text-pitflix-muted" />
            <input
              ref={searchRef}
              type="search"
              value={query}
              onChange={(e) => setQuery(e.target.value)}
              placeholder="Search movies and TV shows..."
              className="w-full rounded-xl border border-pitflix-card bg-pitflix-surface py-2.5 pl-10 pr-4 text-sm text-white placeholder:text-pitflix-muted/60 focus:border-pitflix-primary focus:outline-none focus:ring-1 focus:ring-pitflix-primary/50 transition-colors"
              autoComplete="off"
            />
          </div>
          <div className="flex gap-1 rounded-xl border border-pitflix-card bg-pitflix-bg p-1 shrink-0">
            {kindTabs.map((t) => (
              <button
                key={t.id}
                type="button"
                onClick={() => setKind(t.id)}
                className={cn(
                  "rounded-lg px-3 py-1.5 text-xs font-semibold transition-colors",
                  kind === t.id
                    ? "bg-pitflix-primary text-white"
                    : "text-pitflix-muted hover:text-white",
                )}
              >
                {t.label}
              </button>
            ))}
          </div>
        </div>
      </div>

      {/* ── Browse mode (no active search) ── */}
      {!isSearching ? (
        <>
          {/* Hero */}
          {heroQuery.isLoading ? (
            <div className="mb-8 h-[420px] w-full animate-pulse rounded-2xl bg-pitflix-card" />
          ) : heroQuery.data?.length ? (
            <div className="mb-8">
              <HeroSection items={heroQuery.data} />
            </div>
          ) : null}

          {/* Content sections */}
          {CONTENT_SECTIONS.map((s) => (
            <ContentSection key={s.category} title={s.title} category={s.category} />
          ))}
        </>
      ) : (
        /* ── Search results ── */
        <>
          {debounced.trim().length > 0 && debounced.trim().length < 2 ? (
            <p className="text-sm text-pitflix-muted">Type at least 2 characters to search.</p>
          ) : null}

          {searchQuery.isFetching ? (
            <div className="flex justify-center py-20">
              <Spinner />
            </div>
          ) : searchQuery.isError ? (
            <div className="flex flex-col items-center gap-4 py-20 text-center">
              <p className="text-4xl">🔑</p>
              <p className="text-base font-semibold text-white">Search failed</p>
              <p className="max-w-sm text-sm text-pitflix-subtle">
                Make sure your TMDB API key is saved in Settings and the API is running.
              </p>
              <Link
                to="/settings"
                className="mt-2 inline-flex items-center gap-2 rounded-lg bg-pitflix-primary px-5 py-2.5 text-sm font-semibold text-white hover:bg-pitflix-light"
              >
                <Settings className="h-4 w-4" />
                Open Settings
              </Link>
            </div>
          ) : searchRows.length === 0 && isSearching ? (
            <div className="flex flex-col items-center gap-3 py-20 text-center">
              <Search className="h-12 w-12 text-pitflix-card" />
              <p className="text-base font-semibold text-white">No results found</p>
              <p className="text-sm text-pitflix-subtle">
                Try a different title or check your spelling.
              </p>
            </div>
          ) : (
            <>
              <p className="mb-4 text-xs font-semibold uppercase tracking-widest text-white/50">
                Search results · {searchRows.length} found
              </p>
              <div className="grid grid-cols-3 gap-4 sm:grid-cols-4 md:grid-cols-5 lg:grid-cols-6 xl:grid-cols-7">
                {searchRows.map((row) => {
                  const poster = posterDisplay(row.posterUrl);
                  return (
                    <article
                      key={`${row.mediaType}-${row.id}`}
                      className="group flex flex-col overflow-hidden rounded-xl border border-pitflix-card/50 bg-pitflix-surface/80 shadow-lg shadow-black/30 transition-transform duration-200 hover:scale-[1.03]"
                    >
                      <button
                        type="button"
                        onClick={() => openDetails(row)}
                        className="relative aspect-[2/3] w-full bg-pitflix-card/40"
                      >
                        <MediaImage
                          src={poster}
                          alt=""
                          className="h-full w-full object-cover"
                          fallbackText={row.mediaType === "Movie" ? "Movie" : "TV"}
                        />
                        <span className="absolute left-1.5 top-1.5 rounded bg-black/65 px-1.5 py-0.5 text-[9px] font-bold uppercase text-white">
                          {row.mediaType === "Movie" ? "Movie" : "TV"}
                        </span>
                        {row.voteAverage > 0 && (
                          <span className="absolute right-1.5 top-1.5 rounded bg-black/70 px-1.5 py-0.5 text-[9px] font-semibold text-yellow-400">
                            ★ {row.voteAverage.toFixed(1)}
                          </span>
                        )}
                      </button>

                      <div className="flex flex-1 flex-col gap-1.5 p-2.5">
                        <h3 className="line-clamp-2 text-xs font-semibold leading-snug text-white">
                          {row.title}
                        </h3>
                        <p className="text-[10px] text-pitflix-muted">{row.year ?? "—"}</p>
                        <div className="mt-auto flex flex-col gap-1">
                          <button
                            type="button"
                            onClick={() => openDetails(row, true)}
                            className="inline-flex items-center justify-center gap-1.5 rounded-lg bg-pitflix-primary py-1.5 text-[11px] font-semibold text-white hover:bg-pitflix-light transition-colors"
                          >
                            <Play className="h-3 w-3" />
                            Play
                          </button>
                          <button
                            type="button"
                            onClick={() => openDetails(row)}
                            className="inline-flex items-center justify-center gap-1.5 rounded-lg border border-pitflix-card bg-pitflix-card/60 py-1.5 text-[11px] font-semibold text-white hover:border-pitflix-primary/50 hover:bg-pitflix-primary/20 transition-colors"
                          >
                            <Info className="h-3 w-3" />
                            Details
                          </button>
                        </div>
                      </div>
                    </article>
                  );
                })}
              </div>
            </>
          )}
        </>
      )}
    </div>
  );
}
