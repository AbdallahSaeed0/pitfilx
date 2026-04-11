import { useQuery } from "@tanstack/react-query";
import { CirclePlay, Search } from "lucide-react";
import { useEffect, useMemo, useState } from "react";
import { Link, useSearchParams } from "react-router-dom";
import {
  browseTrailers,
  type TrailerBrowseFilter,
  type TrailerBrowseMode,
  type TrailerCard,
} from "../api/homeDiscover";
import { TrailerModal } from "../components/trailers/TrailerModal";
import { MediaImage } from "../components/ui/MediaImage";
import { Spinner } from "../components/ui/Spinner";
import { useDebounce } from "../hooks/useDebounce";
import { cn } from "../utils/cn";

const defaultMode: TrailerBrowseMode = "all-upcoming";

const modes: { id: TrailerBrowseMode; label: string; hint: string }[] = [
  { id: "all-upcoming", label: "All upcoming", hint: "Movies and TV that have not aired or released yet — use Type to narrow." },
  { id: "upcoming-movies", label: "Movies", hint: "Theatrical releases with a future date." },
  { id: "upcoming-tv", label: "Series", hint: "First air dates in the future (or today)." },
  {
    id: "latest",
    label: "Latest",
    hint: "Recent-window titles plus trending / in theaters. Includes official trailers and teasers as separate clips when TMDB has both.",
  },
];

const filters: { id: TrailerBrowseFilter; label: string }[] = [
  { id: "all", label: "All" },
  { id: "movie", label: "Movies" },
  { id: "tv", label: "Series" },
];

function modeFromParams(modeParam: string | null): TrailerBrowseMode {
  if (!modeParam) return defaultMode;
  const m = modeParam.trim().toLowerCase();
  return modes.some((x) => x.id === m) ? (m as TrailerBrowseMode) : defaultMode;
}

export function TrailersPage() {
  const [searchParams, setSearchParams] = useSearchParams();
  const mode = useMemo(() => modeFromParams(searchParams.get("mode")), [searchParams]);

  useEffect(() => {
    if (searchParams.get("mode")) return;
    const p = new URLSearchParams(searchParams);
    p.set("mode", defaultMode);
    setSearchParams(p, { replace: true });
  }, [searchParams, setSearchParams]);
  const [filter, setFilter] = useState<TrailerBrowseFilter>("all");
  const [active, setActive] = useState<TrailerCard | null>(null);
  const [searchDraft, setSearchDraft] = useState("");
  const debouncedSearch = useDebounce(searchDraft, 320);

  const setMode = (next: TrailerBrowseMode) => {
    const p = new URLSearchParams(searchParams);
    p.set("mode", next);
    setSearchParams(p, { replace: true });
  };

  useEffect(() => {
    if (mode === "upcoming-movies") setFilter("movie");
    else if (mode === "upcoming-tv") setFilter("tv");
  }, [mode]);

  const showTypeFilter = mode === "latest" || mode === "all-upcoming";

  const searchActive = debouncedSearch.trim().length >= 2;
  const q = useQuery({
    queryKey: ["trailers-browse", mode, filter, debouncedSearch.trim()],
    queryFn: () =>
      browseTrailers(mode, filter, searchActive ? debouncedSearch.trim() : undefined),
    staleTime: 120_000,
  });

  const list = q.data ?? [];
  const modeMeta = useMemo(() => modes.find((m) => m.id === mode), [mode]);

  return (
    <div className="mx-auto max-w-6xl space-y-8 pb-12">
      <div className="flex flex-wrap items-start justify-between gap-4">
        <div>
          <h1 className="flex items-center gap-2 text-2xl font-bold text-white">
            <CirclePlay className="h-8 w-8 text-pitflix-primary" />
            Trailers
          </h1>
          <p className="mt-2 max-w-2xl text-sm text-pitflix-subtle">
            <span className="font-medium text-white/90">Latest</span> loads a wide TMDB discover sweep for movies and
            series with a release or first air from roughly the <strong>last four months</strong> through upcoming
            titles, mixed with weekly trending and now playing / on-the-air. When TMDB lists both, you&apos;ll see
            separate cards for an official <strong>trailer</strong> and a <strong>teaser</strong>. Other tabs focus on
            unreleased slate. Search queries TMDB directly anytime.
          </p>
        </div>
        <Link to="/" className="text-sm text-pitflix-primary hover:underline">
          ← Home
        </Link>
      </div>

      <div className="relative">
        <Search className="pointer-events-none absolute left-3 top-1/2 h-4 w-4 -translate-y-1/2 text-pitflix-muted" />
        <input
          type="search"
          value={searchDraft}
          onChange={(e) => setSearchDraft(e.target.value)}
          placeholder="Search trailers by title (e.g. Dune)…"
          className="w-full rounded-xl border border-pitflix-card bg-pitflix-surface/50 py-2.5 pl-10 pr-3 text-sm text-white placeholder:text-pitflix-muted focus:border-pitflix-primary focus:outline-none focus:ring-1 focus:ring-pitflix-primary/40"
        />
        {searchDraft.trim().length > 0 && searchDraft.trim().length < 2 ? (
          <p className="mt-1 text-[11px] text-pitflix-muted">Type at least 2 characters to search TMDB.</p>
        ) : null}
      </div>

      <div className="space-y-3 rounded-2xl border border-pitflix-card/50 bg-pitflix-surface/40 p-5">
        <p className="text-xs font-semibold uppercase tracking-wide text-pitflix-muted">Browse</p>
        <div className="flex flex-wrap gap-2">
          {modes.map((m) => (
            <button
              key={m.id}
              type="button"
              title={m.hint}
              onClick={() => setMode(m.id)}
              disabled={searchActive}
              className={cn(
                "rounded-full px-4 py-1.5 text-xs font-semibold transition-colors",
                searchActive && "opacity-40",
                mode === m.id
                  ? "bg-pitflix-primary text-white"
                  : "bg-pitflix-card text-pitflix-muted hover:text-white",
              )}
            >
              {m.label}
            </button>
          ))}
        </div>
        <p className="text-[11px] text-pitflix-subtle">
          {searchActive
            ? "Search is active — browse tabs are disabled until you clear the search box."
            : modeMeta?.hint}
        </p>

        {showTypeFilter && !searchActive ? (
          <div className="flex flex-wrap items-center gap-2 border-t border-pitflix-card/40 pt-4">
            <span className="text-xs font-medium text-pitflix-muted">Type:</span>
            {filters.map((f) => (
              <button
                key={f.id}
                type="button"
                onClick={() => setFilter(f.id)}
                className={cn(
                  "rounded-full px-3 py-1 text-xs font-semibold",
                  filter === f.id
                    ? "bg-pitflix-primary/30 text-white ring-1 ring-pitflix-primary/40"
                    : "bg-pitflix-bg text-pitflix-muted hover:text-white",
                )}
              >
                {f.label}
              </button>
            ))}
          </div>
        ) : !searchActive ? (
          <p className="border-t border-pitflix-card/40 pt-4 text-[11px] text-pitflix-muted">
            Media type is fixed by the tab above (no extra filter needed).
          </p>
        ) : null}
      </div>

      {q.isLoading ? (
        <div className="flex justify-center py-16">
          <Spinner />
        </div>
      ) : null}

      {q.isError ? (
        <p className="text-sm text-rose-200/90">Could not load trailers. Is the API running?</p>
      ) : null}

      {!q.isLoading && !q.isError && list.length === 0 ? (
        <p className="text-sm text-pitflix-subtle">No trailers matched this filter right now.</p>
      ) : null}

      {!q.isLoading && list.length > 0 ? (
        <div className="grid grid-cols-2 gap-4 sm:grid-cols-3 md:grid-cols-4 lg:grid-cols-5">
          {list.map((t) => {
            // Trailer cards should look like trailers: prefer the YouTube thumbnail over generic backdrops.
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
      ) : null}

      <TrailerModal open={!!active} onClose={() => setActive(null)} trailer={active} />
    </div>
  );
}
