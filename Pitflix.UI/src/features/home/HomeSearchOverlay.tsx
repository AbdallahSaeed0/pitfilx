import { AnimatePresence, motion } from "framer-motion";
import {
  BarChart3,
  CalendarClock,
  Clock,
  Compass,
  Film,
  Globe,
  Home as HomeIcon,
  ListVideo,
  Search,
  Settings as SettingsIcon,
  Sparkles,
  Trophy,
  Tv,
  X,
} from "lucide-react";
import { useEffect, type ReactNode } from "react";
import { Link } from "react-router-dom";
import type { LibraryTitleRow } from "../../api/library";
import { COMMON_GENRES } from "../../data/commonGenres";
import { formatRating } from "../../utils/format";
import { toPosterSrc } from "../../utils/posterSrc";

export type RecentSearch = {
  id: number;
  kind: "movie" | "series";
  title: string;
  year?: number | null;
  posterUrl?: string | null;
};

const JUMP_TO: { to: string; label: string; icon: ReactNode }[] = [
  { to: "/", label: "Home", icon: <HomeIcon className="h-3.5 w-3.5" /> },
  { to: "/movies", label: "Movies", icon: <Film className="h-3.5 w-3.5" /> },
  { to: "/series", label: "Series", icon: <Tv className="h-3.5 w-3.5" /> },
  { to: "/recommendations", label: "Recommendations", icon: <Sparkles className="h-3.5 w-3.5" /> },
  { to: "/online-stream", label: "Online Streaming", icon: <Globe className="h-3.5 w-3.5" /> },
  { to: "/next-episodes", label: "Next episodes", icon: <CalendarClock className="h-3.5 w-3.5" /> },
  { to: "/awards", label: "Awards", icon: <Trophy className="h-3.5 w-3.5" /> },
  { to: "/lists", label: "My Lists", icon: <ListVideo className="h-3.5 w-3.5" /> },
  { to: "/stats", label: "Statistics", icon: <BarChart3 className="h-3.5 w-3.5" /> },
  { to: "/settings", label: "Settings", icon: <SettingsIcon className="h-3.5 w-3.5" /> },
];

const GENRE_PILLS = COMMON_GENRES.slice(0, 18);

function ResultRow({ item, onPick }: { item: LibraryTitleRow; onPick: () => void }) {
  const posterSrc = toPosterSrc(item.posterUrl ?? undefined);

  return (
    <button
      type="button"
      className="flex w-full items-center gap-3 rounded-lg px-2 py-2 text-left transition-colors hover:bg-white/[0.06]"
      onClick={onPick}
    >
      <div className="h-20 w-14 shrink-0 overflow-hidden rounded-md bg-pitflix-card/60">
        {posterSrc ? (
          <img src={posterSrc} alt="" className="h-full w-full object-cover" />
        ) : (
          <div className="flex h-full w-full items-center justify-center">
            <span className="text-[10px] font-bold uppercase text-pitflix-subtle/80">{item.title.slice(0, 3)}</span>
          </div>
        )}
      </div>
      <span className="min-w-0 flex-1 truncate text-sm font-medium text-white">{item.title}</span>
      {item.year && <span className="shrink-0 text-xs text-pitflix-subtle">{item.year}</span>}
    </button>
  );
}

function TopMatchCard({ item, onOpen }: { item: LibraryTitleRow; onOpen: () => void }) {
  const posterSrc = toPosterSrc(item.posterUrl ?? undefined);
  const overview = item.overview ?? undefined;
  const voteAverage = item.voteAverage ?? undefined;

  return (
    <div className="flex gap-4 rounded-xl border border-white/10 bg-white/[0.03] p-4">
      <div className="h-32 w-[88px] shrink-0 overflow-hidden rounded-lg bg-pitflix-card/60">
        {posterSrc ? (
          <img src={posterSrc} alt="" className="h-full w-full object-cover" />
        ) : null}
      </div>
      <div className="min-w-0 flex-1">
        <h3 className="text-lg font-bold leading-snug text-white">{item.title}</h3>
        <p className="mt-1 flex items-center gap-2 text-xs text-pitflix-subtle">
          <span className="capitalize">{item.kind === "series" ? "Series" : "Movie"}</span>
          {item.year && (
            <>
              <span aria-hidden="true">•</span>
              <span>{item.year}</span>
            </>
          )}
          {voteAverage != null && voteAverage > 0 && (
            <>
              <span aria-hidden="true">•</span>
              <span className="text-amber-400">★ {formatRating(voteAverage)}</span>
            </>
          )}
        </p>
        {overview && (
          <p className="mt-2 line-clamp-2 text-xs leading-relaxed text-pitflix-subtle">{overview}</p>
        )}
        <button
          type="button"
          className="mt-3 rounded-full bg-white px-4 py-1.5 text-xs font-semibold text-black transition-colors hover:bg-white/90"
          onClick={onOpen}
        >
          Open
        </button>
      </div>
    </div>
  );
}

export function HomeSearchOverlay({
  query,
  onQueryChange,
  debouncedSearch,
  searchResults,
  isLoading,
  recentSearches,
  onClearRecents,
  onPick,
  onClose,
}: {
  query: string;
  onQueryChange: (v: string) => void;
  debouncedSearch: string;
  searchResults?: { movies: LibraryTitleRow[]; shows: LibraryTitleRow[] };
  isLoading: boolean;
  recentSearches: RecentSearch[];
  onClearRecents: () => void;
  onPick: (item: LibraryTitleRow) => void;
  onClose: () => void;
}) {
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if (e.key === "Escape") onClose();
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [onClose]);

  const showResults = debouncedSearch.length >= 2;
  const hasResults = (searchResults?.movies.length ?? 0) > 0 || (searchResults?.shows.length ?? 0) > 0;
  const topMatch: LibraryTitleRow | null = showResults
    ? searchResults?.movies[0] ?? searchResults?.shows[0] ?? null
    : null;

  return (
    <AnimatePresence>
      <motion.div
        className="fixed inset-0 z-[300] flex items-start justify-center overflow-y-auto bg-black/75 p-4 pt-[8vh] backdrop-blur-sm"
        initial={{ opacity: 0 }}
        animate={{ opacity: 1 }}
        exit={{ opacity: 0 }}
        transition={{ duration: 0.15 }}
        onMouseDown={onClose}
      >
        <motion.div
          initial={{ opacity: 0, scale: 0.97, y: -6 }}
          animate={{ opacity: 1, scale: 1, y: 0 }}
          exit={{ opacity: 0, scale: 0.97, y: -6 }}
          transition={{ type: "spring", damping: 28, stiffness: 320 }}
          className="w-full max-w-2xl overflow-hidden rounded-2xl border border-white/10 bg-pitflix-surface/95 shadow-2xl shadow-black/70"
          onMouseDown={(e) => e.stopPropagation()}
        >
          <div className="flex items-center gap-3 border-b border-white/10 px-5 py-4">
            <Search className="h-5 w-5 shrink-0 text-pitflix-subtle" />
            <input
              autoFocus
              type="text"
              value={query}
              onChange={(e) => onQueryChange(e.target.value)}
              placeholder="Search movies, shows, people, genres, years…"
              className="min-w-0 flex-1 bg-transparent text-base text-white placeholder:text-pitflix-subtle focus:outline-none"
            />
            {query && (
              <button
                type="button"
                aria-label="Clear search"
                onClick={() => onQueryChange("")}
                className="shrink-0 text-pitflix-subtle transition-colors hover:text-white"
              >
                <X className="h-4 w-4" />
              </button>
            )}
            <kbd className="shrink-0 rounded-md border border-white/15 px-2 py-1 text-[10px] font-semibold text-pitflix-subtle">
              ESC
            </kbd>
          </div>

          <div className="max-h-[70vh] overflow-y-auto p-5">
            {!showResults ? (
              <>
                {recentSearches.length > 0 && (
                  <div className="mb-5">
                    <div className="mb-2 flex items-center justify-between">
                      <p className="flex items-center gap-2 text-[10px] font-bold uppercase tracking-widest text-pitflix-subtle">
                        <Clock className="h-3 w-3" /> Recent searches
                      </p>
                      <button
                        type="button"
                        className="text-[10px] text-pitflix-subtle transition-colors hover:text-white"
                        onClick={onClearRecents}
                      >
                        Clear
                      </button>
                    </div>
                    <div className="space-y-1">
                      {recentSearches.map((r) => (
                        <ResultRow key={`${r.kind}-${r.id}`} item={r} onPick={() => onPick(r)} />
                      ))}
                    </div>
                  </div>
                )}

                <div className="mb-5">
                  <p className="mb-2 flex items-center gap-2 text-[10px] font-bold uppercase tracking-widest text-pitflix-subtle">
                    <Compass className="h-3 w-3" /> Jump to
                  </p>
                  <div className="flex flex-wrap gap-2">
                    {JUMP_TO.map((j) => (
                      <Link
                        key={j.to}
                        to={j.to}
                        onClick={onClose}
                        className="flex items-center gap-1.5 rounded-full border border-white/10 bg-white/[0.04] px-3.5 py-1.5 text-xs font-medium text-white transition-colors hover:border-pitflix-primary/50 hover:bg-pitflix-primary/15"
                      >
                        {j.icon}
                        {j.label}
                      </Link>
                    ))}
                  </div>
                </div>

                <div>
                  <p className="mb-2 flex items-center gap-2 text-[10px] font-bold uppercase tracking-widest text-pitflix-subtle">
                    <Sparkles className="h-3 w-3" /> Try a genre
                  </p>
                  <div className="flex flex-wrap gap-2">
                    {GENRE_PILLS.map((g) => (
                      <Link
                        key={g}
                        to={`/genre/${encodeURIComponent(g)}`}
                        onClick={onClose}
                        className="rounded-full border border-white/10 bg-white/[0.04] px-3.5 py-1.5 text-xs font-medium text-white transition-colors hover:border-pitflix-primary/50 hover:bg-pitflix-primary/15"
                      >
                        {g}
                      </Link>
                    ))}
                  </div>
                </div>
              </>
            ) : isLoading && !hasResults ? (
              <p className="py-6 text-center text-sm text-pitflix-muted">Searching…</p>
            ) : !hasResults ? (
              <p className="py-6 text-center text-sm text-pitflix-muted">
                No results for <span className="font-medium text-white">&ldquo;{debouncedSearch}&rdquo;</span>
              </p>
            ) : (
              <>
                {topMatch && (
                  <div className="mb-5">
                    <p className="mb-2 text-[10px] font-bold uppercase tracking-widest text-amber-400">Top match</p>
                    <TopMatchCard item={topMatch} onOpen={() => onPick(topMatch)} />
                  </div>
                )}

                <div className="grid gap-5 sm:grid-cols-2">
                  {(searchResults?.movies.length ?? 0) > 0 && (
                    <div>
                      <p className="mb-2 flex items-center gap-2 text-[10px] font-bold uppercase tracking-widest text-pitflix-subtle">
                        <Film className="h-3 w-3" /> Movies
                      </p>
                      <div className="space-y-1">
                        {searchResults!.movies.map((m) => (
                          <ResultRow key={m.id} item={m} onPick={() => onPick(m)} />
                        ))}
                      </div>
                    </div>
                  )}

                  {(searchResults?.shows.length ?? 0) > 0 && (
                    <div>
                      <p className="mb-2 flex items-center gap-2 text-[10px] font-bold uppercase tracking-widest text-pitflix-subtle">
                        <Tv className="h-3 w-3" /> Series
                      </p>
                      <div className="space-y-1">
                        {searchResults!.shows.map((s) => (
                          <ResultRow key={s.id} item={s} onPick={() => onPick(s)} />
                        ))}
                      </div>
                    </div>
                  )}
                </div>
              </>
            )}
          </div>
        </motion.div>
      </motion.div>
    </AnimatePresence>
  );
}
