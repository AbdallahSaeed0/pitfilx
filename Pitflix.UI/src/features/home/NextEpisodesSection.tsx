import { useQuery } from "@tanstack/react-query";
import { Link } from "react-router-dom";
import { CalendarClock, Search, Tv } from "lucide-react";
import { useMemo, useState } from "react";
import { getNextEpisodesAir } from "../../api/homeDiscover";
import { Spinner } from "../../components/ui/Spinner";
import { airDateToUtcMs, formatCountdown, useCountdown } from "../../hooks/useCountdown";
import { cn } from "../../utils/cn";
import { useDebounce } from "../../hooks/useDebounce";

function Row({
  title,
  sub,
  href,
  external,
  releaseDate,
}: {
  title: string;
  sub: string;
  href: string;
  external?: boolean;
  releaseDate: string;
}) {
  const target = airDateToUtcMs(releaseDate, null);
  const left = useCountdown(target);
  const cd = formatCountdown(left);
  const className =
    "flex items-center justify-between gap-3 rounded-xl border border-pitflix-card/50 bg-pitflix-surface/40 px-4 py-3 transition-colors hover:border-pitflix-primary/40";
  const inner = (
    <>
      <div className="min-w-0">
        <p className="truncate font-medium text-white">{title}</p>
        <p className="truncate text-xs text-pitflix-subtle">{sub}</p>
      </div>
      <div className="shrink-0 text-right">
        <p className="text-[11px] text-pitflix-muted">{releaseDate}</p>
        {cd ? <p className={cn("font-mono text-[11px] text-amber-100/90")}>{cd}</p> : null}
      </div>
    </>
  );
  if (external)
    return (
      <a href={href} target="_blank" rel="noreferrer" className={className}>
        {inner}
      </a>
    );
  return (
    <Link to={href} className={className}>
      {inner}
    </Link>
  );
}

type NextEpisodesProps = { embedded?: boolean };

export function NextEpisodesSection({ embedded = false }: NextEpisodesProps) {
  const [filterQ, setFilterQ] = useState("");
  const debouncedFilter = useDebounce(filterQ, 200);

  const q = useQuery({
    queryKey: ["home-next-episodes"],
    queryFn: getNextEpisodesAir,
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
    : "rounded-2xl border border-pitflix-card/40 bg-gradient-to-b from-pitflix-surface/40 to-pitflix-bg/20 p-6";

  if (q.isLoading)
    return (
      <div className={embedded ? "py-2" : "rounded-2xl border border-pitflix-card/40 bg-pitflix-surface/30 p-6"}>
        <div className="flex items-center gap-2 text-sm text-pitflix-subtle">
          <Spinner className="h-5 w-5" /> Checking your library for air dates…
        </div>
      </div>
    );

  if (q.isError)
    return (
      <div
        className={
          embedded ? "py-2 text-sm text-rose-100/90" : "rounded-2xl border border-rose-500/30 bg-rose-950/20 p-6 text-sm text-rose-100/90"
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
            : "rounded-2xl border border-dashed border-pitflix-card/50 bg-pitflix-bg/40 p-6 text-sm text-pitflix-subtle"
        }
      >
        <p>No upcoming episodes from TMDB for series in your library (or none scheduled).</p>
        <Link
          to="/next-episodes"
          className="mt-3 inline-flex items-center gap-1 text-xs font-semibold text-pitflix-primary hover:underline"
        >
          <CalendarClock className="h-3.5 w-3.5" />
          Pin series to prioritize in the next check
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
              <Tv className="h-5 w-5 text-pitflix-primary" />
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
            className="w-full rounded-lg border border-pitflix-card bg-pitflix-bg py-2 pl-9 pr-3 text-xs text-white placeholder:text-pitflix-muted focus:border-pitflix-primary focus:outline-none"
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
          <div className="flex min-w-0 flex-1 items-center gap-2">
            <Tv className="h-5 w-5 shrink-0 text-pitflix-primary" />
            <h2 className="text-lg font-bold text-white">Next episodes</h2>
            <span className="hidden text-xs text-pitflix-subtle sm:inline">Library + TMDB</span>
          </div>
          <Link
            to="/next-episodes"
            className="inline-flex items-center gap-1 text-xs font-semibold text-pitflix-primary hover:underline"
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
          className="w-full rounded-lg border border-pitflix-card bg-pitflix-bg py-2 pl-9 pr-3 text-xs text-white placeholder:text-pitflix-muted focus:border-pitflix-primary focus:outline-none"
        />
      </div>
      <div className="space-y-2">
        {rows.map((r) => {
          const lib = r.libraryShowId != null;
          const href = lib ? `/series/${r.libraryShowId}` : `https://www.themoviedb.org/tv/${r.showTmdbId}`;
          return (
            <Row
              key={`${r.kind ?? "lib"}-${r.showTmdbId}-${r.airDate}-${r.season}-${r.episodeNumber}`}
              title={r.showTitle}
              sub={`${r.episodeTitle || "Episode"} · S${r.season ?? "?"}E${r.episodeNumber ?? "?"}`}
              href={href}
              external={!lib}
              releaseDate={r.airDate}
            />
          );
        })}
      </div>
    </div>
  );
}
