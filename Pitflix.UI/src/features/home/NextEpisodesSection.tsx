import { useQuery } from "@tanstack/react-query";
import { Link } from "react-router-dom";
import { CalendarClock, Search, Tv } from "lucide-react";
import { useMemo, useState } from "react";
import { getNextEpisodesAirScoped } from "../../api/homeDiscover";
import { NextEpisodeAirRowLink } from "../nextEpisodes/nextEpisodeAirUi";
import { Spinner } from "../../components/ui/Spinner";
import { useDebounce } from "../../hooks/useDebounce";

type NextEpisodesProps = { embedded?: boolean; variant?: "priority" | "all" };

export function NextEpisodesSection({ embedded = false, variant = "priority" }: NextEpisodesProps) {
  const [filterQ, setFilterQ] = useState("");
  const debouncedFilter = useDebounce(filterQ, 200);

  const q = useQuery({
    queryKey: ["home-next-episodes", variant],
    queryFn: () => getNextEpisodesAirScoped({ view: variant, limit: variant === "all" ? 160 : 56 }),
    staleTime: 120_000,
  });

  const rowsAll = q.data ?? [];
  const rows = useMemo(() => {
    const t = debouncedFilter.trim().toLowerCase();
    if (!t) return rowsAll;
    return rowsAll.filter(
      (r) =>
        r.showTitle.toLowerCase().includes(t) ||
        (r.episodeTitle && r.episodeTitle.toLowerCase().includes(t)),
    );
  }, [rowsAll, debouncedFilter]);

  const shell = embedded
    ? "space-y-3"
    : "rounded-2xl border border-white/[0.07] bg-gradient-to-b from-zinc-950/85 to-pitflix-bg/25 p-6 shadow-[inset_0_1px_0_0_rgba(255,255,255,0.04)] backdrop-blur-sm";

  const filterInput =
    "w-full rounded-xl border border-white/10 bg-black/25 py-2.5 pl-10 pr-3 text-xs text-white placeholder:text-pitflix-muted shadow-inner backdrop-blur-sm transition-colors focus:border-pitflix-primary/70 focus:outline-none focus:ring-2 focus:ring-pitflix-primary/25";

  if (q.isLoading)
    return (
      <div className={embedded ? "py-2" : "rounded-2xl border border-white/[0.07] bg-pitflix-surface/35 p-6"}>
        <div className="flex items-center gap-2 text-sm text-pitflix-subtle">
          <Spinner className="h-5 w-5" /> Checking your library for air dates…
        </div>
      </div>
    );

  if (q.isError)
    return (
      <div
        className={
          embedded
            ? "py-2 text-sm text-rose-100/90"
            : "rounded-2xl border border-rose-500/30 bg-rose-950/25 p-6 text-sm text-rose-100/90"
        }
      >
        Could not load next episodes.
      </div>
    );

  if (rowsAll.length === 0) {
    return (
      <div
        className={
          embedded
            ? "py-2 text-sm text-pitflix-subtle"
            : "rounded-2xl border border-dashed border-white/15 bg-pitflix-bg/40 p-6 text-sm text-pitflix-subtle"
        }
      >
        <p>No upcoming episodes from TMDB for series in your library (or none scheduled).</p>
        <Link
          to="/next-episodes"
          className="mt-3 inline-flex items-center gap-1.5 text-xs font-semibold text-pitflix-primary hover:underline"
        >
          <CalendarClock className="h-3.5 w-3.5" />
          Open schedule &amp; pins
        </Link>
      </div>
    );
  }

  if (rows.length === 0 && debouncedFilter.trim()) {
    return (
      <div className={embedded ? "space-y-3" : shell}>
        {embedded ? null : (
          <div className="mb-4 flex flex-wrap items-center gap-3">
            <div className="flex items-center gap-2">
              <span className="flex h-9 w-9 items-center justify-center rounded-xl bg-pitflix-primary/15 ring-1 ring-pitflix-primary/30">
                <Tv className="h-5 w-5 text-pitflix-primary" aria-hidden />
              </span>
              <h2 className="text-lg font-bold text-white">Next episodes</h2>
            </div>
            <Link
              to="/next-episodes"
              className="ml-auto inline-flex items-center gap-1 text-xs font-semibold text-pitflix-primary hover:underline"
            >
              <CalendarClock className="h-3.5 w-3.5" />
              Manage pins
            </Link>
          </div>
        )}
        <div className="relative mb-3">
          <Search className="pointer-events-none absolute left-3 top-1/2 h-3.5 w-3.5 -translate-y-1/2 text-pitflix-muted" />
          <input
            type="search"
            value={filterQ}
            onChange={(e) => setFilterQ(e.target.value)}
            placeholder="Filter list…"
            className={filterInput}
          />
        </div>
        <p className="text-sm text-pitflix-subtle">No rows match this filter.</p>
      </div>
    );
  }

  return (
    <div className={shell}>
      {embedded ? null : (
        <div className="mb-4 flex flex-wrap items-center gap-3">
          <div className="flex min-w-0 flex-1 items-center gap-3">
            <span className="flex h-9 w-9 shrink-0 items-center justify-center rounded-xl bg-pitflix-primary/15 ring-1 ring-pitflix-primary/30">
              <Tv className="h-5 w-5 text-pitflix-primary" aria-hidden />
            </span>
            <div className="min-w-0">
              <h2 className="text-lg font-bold text-white md:text-xl">
                {variant === "all" ? "All upcoming episodes" : "Next episodes"}
              </h2>
              <p className="hidden text-xs text-pitflix-subtle sm:block">Library + TMDB air dates</p>
            </div>
          </div>
          <Link
            to="/next-episodes"
            className="inline-flex shrink-0 items-center gap-1 text-xs font-semibold text-pitflix-primary hover:underline"
          >
            <CalendarClock className="h-3.5 w-3.5" />
            Manage pins
          </Link>
        </div>
      )}
      <div className="relative mb-3">
        <Search className="pointer-events-none absolute left-3 top-1/2 h-3.5 w-3.5 -translate-y-1/2 text-pitflix-muted" />
        <input
          type="search"
          value={filterQ}
          onChange={(e) => setFilterQ(e.target.value)}
          placeholder="Filter by show or episode…"
          className={filterInput}
        />
      </div>
      <div className="max-h-[min(420px,52vh)] space-y-2.5 overflow-y-auto scroll-smooth pr-1">
        {rows.map((r) => (
            <NextEpisodeAirRowLink
              key={`${r.kind ?? "lib"}-${r.showTmdbId}-${r.airDate}-${r.season}-${r.episodeNumber}`}
              showTitle={r.showTitle}
              episodeTitle={r.episodeTitle}
              season={r.season}
              episodeNumber={r.episodeNumber}
              airDate={r.airDate}
              posterUrl={r.posterUrl}
              pinned={!!r.pinned}
              kind={r.kind === "followed" ? "followed" : undefined}
              libraryShowId={r.libraryShowId}
              showTmdbId={r.showTmdbId}
            />
          ))}
      </div>
    </div>
  );
}
