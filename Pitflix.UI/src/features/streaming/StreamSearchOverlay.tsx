import { AnimatePresence, motion } from "framer-motion";
import { Clock, Film, Search, Tv, X } from "lucide-react";
import { useEffect } from "react";
import { MediaImage } from "../../components/ui/MediaImage";

export type StreamSearchKind = "Both" | "Movie" | "Series";

export type StreamRecentSearch = {
  id: number;
  mediaType: "Movie" | "Series";
  title: string;
  year?: string | null;
  posterUrl?: string | null;
};

export type StreamSearchRowLike = {
  id: number;
  title: string;
  year?: string | null;
  posterUrl: string | null;
  mediaType: "Movie" | "Series";
  voteAverage: number;
};

const KIND_TABS: { id: StreamSearchKind; label: string }[] = [
  { id: "Both", label: "All" },
  { id: "Movie", label: "Movies" },
  { id: "Series", label: "TV" },
];

function ResultRow({
  item,
  onPick,
}: {
  item: StreamSearchRowLike | StreamRecentSearch;
  onPick: () => void;
}) {
  return (
    <button
      type="button"
      className="flex w-full items-center gap-3 rounded-lg px-2 py-2 text-left transition-colors hover:bg-white/[0.06]"
      onClick={onPick}
    >
      <div className="h-20 w-14 shrink-0 overflow-hidden rounded-md bg-pitflix-card/60">
        <MediaImage
          src={item.posterUrl}
          alt=""
          className="h-full w-full object-cover"
          fallbackText={item.title.slice(0, 3)}
        />
      </div>
      <span className="min-w-0 flex-1 truncate text-sm font-medium text-white">{item.title}</span>
      <span className="shrink-0 rounded bg-white/[0.06] px-1.5 py-0.5 text-[9px] font-bold uppercase text-pitflix-subtle">
        {item.mediaType === "Movie" ? "Movie" : "TV"}
      </span>
      {item.year && <span className="shrink-0 text-xs text-pitflix-subtle">{item.year}</span>}
    </button>
  );
}

export function StreamSearchOverlay({
  query,
  onQueryChange,
  kind,
  onKindChange,
  debouncedSearch,
  searchRows,
  isLoading,
  isError,
  recentSearches,
  onClearRecents,
  onPick,
  onClose,
}: {
  query: string;
  onQueryChange: (v: string) => void;
  kind: StreamSearchKind;
  onKindChange: (k: StreamSearchKind) => void;
  debouncedSearch: string;
  searchRows: StreamSearchRowLike[];
  isLoading: boolean;
  isError: boolean;
  recentSearches: StreamRecentSearch[];
  onClearRecents: () => void;
  onPick: (item: StreamSearchRowLike | StreamRecentSearch) => void;
  onClose: () => void;
}) {
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if (e.key === "Escape") onClose();
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [onClose]);

  const showResults = debouncedSearch.trim().length >= 2;
  const movies = searchRows.filter((r) => r.mediaType === "Movie");
  const shows = searchRows.filter((r) => r.mediaType === "Series");

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
          className="w-full max-w-4xl overflow-hidden rounded-2xl border border-white/10 bg-pitflix-surface/95 shadow-2xl shadow-black/70"
          onMouseDown={(e) => e.stopPropagation()}
        >
          <div className="flex items-center gap-3 border-b border-white/10 px-5 py-4">
            <Search className="h-5 w-5 shrink-0 text-pitflix-subtle" />
            <input
              autoFocus
              type="text"
              value={query}
              onChange={(e) => onQueryChange(e.target.value)}
              placeholder="Search movies and TV shows…"
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

          <div className="flex gap-1 border-b border-white/10 px-5 py-2.5">
            {KIND_TABS.map((t) => (
              <button
                key={t.id}
                type="button"
                onClick={() => onKindChange(t.id)}
                className={`rounded-lg px-3 py-1 text-xs font-semibold transition-colors ${
                  kind === t.id
                    ? "bg-pitflix-primary text-white"
                    : "text-pitflix-subtle hover:text-white"
                }`}
              >
                {t.label}
              </button>
            ))}
          </div>

          <div className="max-h-[65vh] overflow-y-auto p-5">
            {!showResults ? (
              <>
                {query.trim().length > 0 && query.trim().length < 2 ? (
                  <p className="py-6 text-center text-sm text-pitflix-muted">
                    Type at least 2 characters to search.
                  </p>
                ) : recentSearches.length > 0 ? (
                  <div>
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
                        <ResultRow key={`${r.mediaType}-${r.id}`} item={r} onPick={() => onPick(r)} />
                      ))}
                    </div>
                  </div>
                ) : (
                  <p className="py-6 text-center text-sm text-pitflix-muted">
                    Search for a movie or TV show to stream.
                  </p>
                )}
              </>
            ) : isError ? (
              <p className="py-6 text-center text-sm text-pitflix-muted">
                Search failed. Make sure your TMDB API key is saved in Settings.
              </p>
            ) : isLoading && searchRows.length === 0 ? (
              <p className="py-6 text-center text-sm text-pitflix-muted">Searching…</p>
            ) : searchRows.length === 0 ? (
              <p className="py-6 text-center text-sm text-pitflix-muted">
                No results for <span className="font-medium text-white">&ldquo;{debouncedSearch}&rdquo;</span>
              </p>
            ) : (
              <div className="grid gap-5 sm:grid-cols-2">
                {movies.length > 0 && (
                  <div>
                    <p className="mb-2 flex items-center gap-2 text-[10px] font-bold uppercase tracking-widest text-pitflix-subtle">
                      <Film className="h-3 w-3" /> Movies
                    </p>
                    <div className="space-y-1">
                      {movies.map((m) => (
                        <ResultRow key={`Movie-${m.id}`} item={m} onPick={() => onPick(m)} />
                      ))}
                    </div>
                  </div>
                )}
                {shows.length > 0 && (
                  <div>
                    <p className="mb-2 flex items-center gap-2 text-[10px] font-bold uppercase tracking-widest text-pitflix-subtle">
                      <Tv className="h-3 w-3" /> Series
                    </p>
                    <div className="space-y-1">
                      {shows.map((s) => (
                        <ResultRow key={`Series-${s.id}`} item={s} onPick={() => onPick(s)} />
                      ))}
                    </div>
                  </div>
                )}
              </div>
            )}
          </div>
        </motion.div>
      </motion.div>
    </AnimatePresence>
  );
}
