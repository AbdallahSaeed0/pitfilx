import { useQuery } from "@tanstack/react-query";
import { Search } from "lucide-react";
import { useEffect, useState } from "react";
import { useLocation, useNavigate } from "react-router-dom";
import { getStreamDiscover, getStreamGenrePreviews, STREAM_MOVIE_GENRES } from "../api/stream";
import { searchUnmatched } from "../api/unmatched";
import { ContentSection } from "../components/streaming/ContentSection";
import { HeroSection } from "../components/streaming/HeroSection";
import { HorizontalScrollRow } from "../components/ui/HorizontalScrollRow";
import { useDebounce } from "../hooks/useDebounce";
import {
  StreamSearchOverlay,
  type StreamRecentSearch,
  type StreamSearchKind,
  type StreamSearchRowLike,
} from "../features/streaming/StreamSearchOverlay";
import { cn } from "../utils/cn";
import type { StreamingDetailsLocationState } from "./StreamingDetailsPage";

const RECENT_SEARCHES_KEY = "pitflix.stream.recent_searches";

function loadRecentSearches(): StreamRecentSearch[] {
  try {
    const raw = localStorage.getItem(RECENT_SEARCHES_KEY);
    if (!raw) return [];
    return JSON.parse(raw) as StreamRecentSearch[];
  } catch {
    return [];
  }
}

function saveRecentSearches(items: StreamRecentSearch[]) {
  try {
    localStorage.setItem(RECENT_SEARCHES_KEY, JSON.stringify(items.slice(0, 8)));
  } catch {
    /* ignore */
  }
}

function addToRecentSearches(item: StreamSearchRowLike | StreamRecentSearch) {
  const prev = loadRecentSearches().filter(
    (r) => !(r.id === item.id && r.mediaType === item.mediaType),
  );
  saveRecentSearches([
    { id: item.id, mediaType: item.mediaType, title: item.title, year: item.year ?? null, posterUrl: item.posterUrl },
    ...prev,
  ]);
}

function mapSearchRows(data: unknown, fallback: StreamSearchKind): StreamSearchRowLike[] {
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
  { title: "TOP 100 MOVIES ON IMDB", category: "top-imdb-movie" as const },
  { title: "TOP 100 TV SHOWS ON IMDB", category: "top-imdb-tv" as const },
  { title: "POPULAR MOVIES", category: "popular-movie" as const },
  { title: "POPULAR TV SHOWS", category: "popular-tv" as const },
  { title: "NOW PLAYING IN THEATERS", category: "now-playing-movie" as const },
  { title: "UPCOMING MOVIES", category: "upcoming" as const },
  { title: "TV ON THE AIR", category: "on-the-air-tv" as const },
] as const;

const GENRE_TILE_ACCENTS: readonly [string, string][] = [
  ["from-red-600/30", "to-red-950/80"],
  ["from-blue-600/30", "to-blue-950/80"],
  ["from-emerald-600/30", "to-emerald-950/80"],
  ["from-yellow-500/30", "to-yellow-950/80"],
  ["from-purple-600/30", "to-purple-950/80"],
  ["from-orange-600/30", "to-orange-950/80"],
  ["from-pink-600/30", "to-pink-950/80"],
  ["from-sky-600/30", "to-sky-950/80"],
  ["from-teal-600/30", "to-teal-950/80"],
  ["from-rose-600/30", "to-rose-950/80"],
  ["from-indigo-600/30", "to-indigo-950/80"],
  ["from-cyan-600/30", "to-cyan-950/80"],
  ["from-lime-500/30", "to-lime-950/80"],
  ["from-fuchsia-600/30", "to-fuchsia-950/80"],
];

export function OnlineStreamPage() {
  const navigate = useNavigate();
  const location = useLocation();

  const [query, setQuery] = useState("");
  const [kind, setKind] = useState<StreamSearchKind>("Both");
  const debounced = useDebounce(query, 280);
  const [searchOverlayOpen, setSearchOverlayOpen] = useState(false);
  const [recentSearches, setRecentSearches] = useState<StreamRecentSearch[]>(() => loadRecentSearches());

  useEffect(() => {
    const st = location.state as { seedQuery?: string; seedKind?: StreamSearchKind } | null;
    if (!st?.seedQuery?.trim()) return;
    setQuery(st.seedQuery.trim());
    if (st.seedKind === "Movie" || st.seedKind === "Series" || st.seedKind === "Both") {
      setKind(st.seedKind);
    }
    setSearchOverlayOpen(true);
    navigate(location.pathname, { replace: true, state: {} });
  }, [location.pathname, location.state, navigate]);

  // Hero data — trending movies
  const heroQuery = useQuery({
    queryKey: ["stream-discover", "trending-movie"],
    queryFn: () => getStreamDiscover("trending-movie"),
    staleTime: 10 * 60 * 1000,
  });

  const genrePreviewsQuery = useQuery({
    queryKey: ["stream-genre-previews"],
    queryFn: () => getStreamGenrePreviews(STREAM_MOVIE_GENRES.map((g) => g.id)),
    staleTime: 24 * 60 * 60 * 1000,
  });
  const genrePosterById = new Map(
    (genrePreviewsQuery.data ?? []).map((g) => [g.id, g.posterUrl] as const),
  );

  // Search
  const searchQuery = useQuery({
    queryKey: ["online-stream-search", debounced.trim(), kind],
    queryFn: async () => {
      const raw = await searchUnmatched({ query: debounced.trim(), mediaType: kind });
      return mapSearchRows(raw, kind);
    },
    enabled: debounced.trim().length >= 2,
  });

  const searchRows = searchQuery.data ?? [];

  function openDetails(row: StreamSearchRowLike | StreamRecentSearch, autoPlay = false) {
    const state: StreamingDetailsLocationState = {
      tmdbId: row.id,
      mediaType: row.mediaType,
      title: row.title,
      posterUrl: posterDisplay(row.posterUrl ?? null),
      year: row.year ?? null,
      ...(autoPlay ? { autoPlay: true as const } : {}),
      returnSeedQuery: query,
      returnSeedKind: kind,
    };
    navigate("/stream-details", { state });
  }

  return (
    <div className="min-h-full pb-12">
      {/* ── Search bar (opens the search overlay) ── */}
      <div className="sticky top-0 z-20 -mx-4 mb-6 bg-pitflix-bg/95 px-4 pb-4 pt-4 backdrop-blur-sm">
        <button
          type="button"
          onClick={() => setSearchOverlayOpen(true)}
          className="flex w-full items-center gap-2 rounded-xl border border-pitflix-card bg-pitflix-surface px-3.5 py-2.5 text-left text-sm text-pitflix-muted transition-colors hover:border-white/20 hover:bg-pitflix-surface/80"
        >
          <Search className="h-4 w-4 shrink-0" />
          <span className={cn("truncate", query && "text-white")}>
            {query || "Search movies and TV shows…"}
          </span>
        </button>
      </div>

      {/* Hero */}
      {heroQuery.isLoading ? (
        <div className="mb-8 h-[420px] w-full animate-pulse rounded-2xl bg-pitflix-card" />
      ) : heroQuery.data?.length ? (
        <div className="mb-8">
          <HeroSection items={heroQuery.data} />
        </div>
      ) : null}

      {/* Categories */}
      <section className="mb-8">
        <h2 className="mb-3 text-xl font-bold text-white">Browse by Category</h2>
        <HorizontalScrollRow hideHeader className="mb-0" contentClassName="gap-3 pb-2">
          {STREAM_MOVIE_GENRES.map((g, i) => {
            const poster = genrePosterById.get(g.id);
            const accent = GENRE_TILE_ACCENTS[i % GENRE_TILE_ACCENTS.length]!;
            return (
              <button
                key={g.id}
                type="button"
                onClick={() =>
                  navigate("/stream-genre", { state: { genreId: g.id, genreName: g.name } })
                }
                className="group relative shrink-0 w-[140px] overflow-hidden rounded-2xl focus:outline-none focus-visible:ring-2 focus-visible:ring-pitflix-primary"
                style={{ aspectRatio: "2/3" }}
              >
                {poster ? (
                  <img
                    src={poster}
                    alt=""
                    aria-hidden
                    className="absolute inset-0 h-full w-full object-cover transition-transform duration-500 group-hover:scale-110"
                  />
                ) : (
                  <div className="absolute inset-0 animate-pulse bg-pitflix-card" />
                )}
                <div className={cn("absolute inset-0 bg-gradient-to-b", accent[0], accent[1])} />
                <div className="absolute inset-0 flex items-end p-3">
                  <p className="text-sm font-bold leading-tight text-white drop-shadow-lg">
                    {g.name}
                  </p>
                </div>
              </button>
            );
          })}
        </HorizontalScrollRow>
      </section>

      {/* Content sections */}
      {CONTENT_SECTIONS.map((s) => (
        <ContentSection key={s.category} title={s.title} category={s.category} />
      ))}

      {searchOverlayOpen && (
        <StreamSearchOverlay
          query={query}
          onQueryChange={setQuery}
          kind={kind}
          onKindChange={setKind}
          debouncedSearch={debounced}
          searchRows={searchRows}
          isLoading={searchQuery.isFetching}
          isError={searchQuery.isError}
          recentSearches={recentSearches}
          onClearRecents={() => {
            saveRecentSearches([]);
            setRecentSearches([]);
          }}
          onPick={(item) => {
            addToRecentSearches(item);
            setRecentSearches(loadRecentSearches());
            setSearchOverlayOpen(false);
            openDetails(item);
          }}
          onClose={() => setSearchOverlayOpen(false)}
        />
      )}
    </div>
  );
}
