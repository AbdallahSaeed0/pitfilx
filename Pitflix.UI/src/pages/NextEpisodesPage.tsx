import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { CalendarClock, Link as LinkIcon, Search, Tv, X } from "lucide-react";
import { useMemo, useState } from "react";
import { Link } from "react-router-dom";
import { getNextEpisodesAir, getNextEpisodesPins, putNextEpisodesPins } from "../api/homeDiscover";
import { getAllSeries } from "../api/series";
import type { MediaCard } from "../types/media";
import { useDebounce } from "../hooks/useDebounce";
import { Spinner } from "../components/ui/Spinner";
import { cn } from "../utils/cn";
import { airDateToUtcMs, formatCountdown, useCountdown } from "../hooks/useCountdown";

type SeriesPage = { items?: MediaCard[]; total?: number };

function CountdownLine({ airDate }: { airDate: string }) {
  const target = airDateToUtcMs(airDate, null);
  const left = useCountdown(target);
  const cd = formatCountdown(left);
  return cd ? <p className="font-mono text-[11px] text-amber-100/90">{cd}</p> : null;
}

export function NextEpisodesPage() {
  const qc = useQueryClient();
  const [librarySearch, setLibrarySearch] = useState("");
  const debouncedLib = useDebounce(librarySearch, 350);

  const pinsQ = useQuery({
    queryKey: ["home-next-episodes-pins"],
    queryFn: getNextEpisodesPins,
    staleTime: 30_000,
  });

  const scheduleQ = useQuery({
    queryKey: ["home-next-episodes"],
    queryFn: getNextEpisodesAir,
    staleTime: 60_000,
  });

  const searchQ = useQuery({
    queryKey: ["next-ep-page-series-search", debouncedLib],
    queryFn: () =>
      getAllSeries({
        search: debouncedLib.trim(),
        page: 1,
        pageSize: 35,
        lang: "en",
      }) as Promise<SeriesPage>,
    enabled: debouncedLib.trim().length >= 1,
    staleTime: 30_000,
  });

  const savePins = useMutation({
    mutationFn: putNextEpisodesPins,
    onSuccess: async () => {
      await qc.invalidateQueries({ queryKey: ["home-next-episodes-pins"] });
      await qc.invalidateQueries({ queryKey: ["home-next-episodes"] });
    },
  });

  const pinnedIds = useMemo(() => new Set(pinsQ.data?.showIds ?? []), [pinsQ.data?.showIds]);

  const setPinned = (next: Set<number>) => {
    void savePins.mutate([...next]);
  };

  const addPin = (id: number) => {
    const n = new Set(pinnedIds);
    n.add(id);
    setPinned(n);
  };

  const removePin = (id: number) => {
    const n = new Set(pinnedIds);
    n.delete(id);
    setPinned(n);
  };

  const searchHits = searchQ.data?.items ?? [];
  const rows = scheduleQ.data ?? [];
  const pinnedSchedule = rows.filter((r) => r.pinned);
  const restSchedule = rows.filter((r) => !r.pinned);
  const titleByLibraryId = useMemo(() => {
    const m = new Map<number, string>();
    for (const r of rows) m.set(r.libraryShowId, r.showTitle);
    for (const s of searchHits) m.set(s.id, s.title);
    return m;
  }, [rows, searchHits]);

  return (
    <div className="mx-auto max-w-3xl space-y-8 pb-14">
      <div className="flex flex-wrap items-start justify-between gap-4">
        <div>
          <h1 className="flex items-center gap-2 text-2xl font-bold text-white">
            <CalendarClock className="h-8 w-8 text-pitflix-primary" />
            Next episodes
          </h1>
          <p className="mt-2 max-w-xl text-sm text-pitflix-subtle">
            Pin series from your library so they are always checked for TMDB air dates (and sorted to the top). Pinned
            shows still need a valid <code className="text-pitflix-muted">next_episode_to_air</code> from TMDB.
          </p>
        </div>
        <Link to="/" className="text-sm text-pitflix-primary hover:underline">
          ← Home
        </Link>
      </div>

      <section className="space-y-3 rounded-2xl border border-pitflix-card/50 bg-pitflix-surface/40 p-5">
        <p className="text-xs font-semibold uppercase tracking-wide text-pitflix-muted">Add from library</p>
        <div className="relative">
          <Search className="pointer-events-none absolute left-3 top-1/2 h-4 w-4 -translate-y-1/2 text-pitflix-muted" />
          <input
            type="search"
            value={librarySearch}
            onChange={(e) => setLibrarySearch(e.target.value)}
            placeholder="Search your series (e.g. The Boys)…"
            className="w-full rounded-xl border border-pitflix-card bg-pitflix-bg py-2.5 pl-10 pr-3 text-sm text-white placeholder:text-pitflix-muted focus:border-pitflix-primary focus:outline-none focus:ring-1 focus:ring-pitflix-primary/40"
          />
        </div>
        {debouncedLib.trim().length >= 1 && searchQ.isFetching ? (
          <div className="flex items-center gap-2 text-xs text-pitflix-subtle">
            <Spinner className="h-4 w-4" /> Searching…
          </div>
        ) : null}
        {debouncedLib.trim().length >= 1 && !searchQ.isFetching && searchHits.length === 0 ? (
          <p className="text-xs text-pitflix-subtle">No matches in your library for that query.</p>
        ) : null}
        {searchHits.length > 0 ? (
          <ul className="max-h-56 space-y-1 overflow-y-auto rounded-xl border border-pitflix-card/40 bg-black/20 p-2">
            {searchHits.map((s) => (
              <li
                key={s.id}
                className="flex items-center justify-between gap-2 rounded-lg px-2 py-1.5 text-sm hover:bg-white/5"
              >
                <span className="min-w-0 truncate text-white">{s.title}</span>
                {pinnedIds.has(s.id) ? (
                  <span className="shrink-0 text-[11px] text-pitflix-muted">Pinned</span>
                ) : (
                  <button
                    type="button"
                    disabled={savePins.isPending}
                    onClick={() => addPin(s.id)}
                    className="shrink-0 rounded-lg bg-pitflix-primary/25 px-2 py-0.5 text-[11px] font-semibold text-pitflix-primary hover:bg-pitflix-primary/35 disabled:opacity-50"
                  >
                    Pin
                  </button>
                )}
              </li>
            ))}
          </ul>
        ) : null}
      </section>

      <section className="rounded-2xl border border-pitflix-card/50 bg-pitflix-surface/35 p-5">
        <div className="mb-3 flex items-center gap-2">
          <Tv className="h-5 w-5 text-pitflix-primary" />
          <h2 className="font-semibold text-white">Pinned shows</h2>
        </div>
        {pinsQ.isLoading ? (
          <Spinner className="h-5 w-5" />
        ) : (pinsQ.data?.showIds?.length ?? 0) === 0 ? (
          <p className="text-sm text-pitflix-subtle">No pins yet — add series above.</p>
        ) : (
          <ul className="space-y-2">
            {pinsQ.data!.showIds.map((id) => (
              <li
                key={id}
                className="flex items-center justify-between gap-2 rounded-xl border border-pitflix-card/40 bg-black/25 px-3 py-2"
              >
                <Link to={`/series/${id}`} className="min-w-0 truncate text-sm text-white hover:underline">
                  {titleByLibraryId.get(id) ?? `Series (library #${id})`}
                  <LinkIcon className="ml-1 inline h-3 w-3 opacity-60" />
                </Link>
                <button
                  type="button"
                  onClick={() => removePin(id)}
                  disabled={savePins.isPending}
                  className="shrink-0 rounded-lg p-1 text-pitflix-muted hover:bg-rose-500/20 hover:text-rose-100 disabled:opacity-50"
                  title="Remove pin"
                >
                  <X className="h-4 w-4" />
                </button>
              </li>
            ))}
          </ul>
        )}
      </section>

      <section className="rounded-2xl border border-pitflix-card/40 bg-gradient-to-b from-pitflix-surface/40 to-pitflix-bg/20 p-6">
        <h2 className="mb-4 text-lg font-bold text-white">Upcoming from TMDB</h2>
        {scheduleQ.isLoading ? (
          <div className="flex items-center gap-2 text-sm text-pitflix-subtle">
            <Spinner className="h-5 w-5" /> Loading schedule…
          </div>
        ) : scheduleQ.isError ? (
          <p className="text-sm text-rose-200/90">Could not load next episodes.</p>
        ) : rows.length === 0 ? (
          <p className="text-sm text-pitflix-subtle">
            No upcoming episodes returned — try pinning a series or verify TMDB has air dates.
          </p>
        ) : (
          <div className="space-y-4">
            {pinnedSchedule.length > 0 ? (
              <div>
                <p className="mb-2 text-[11px] font-semibold uppercase tracking-wide text-pitflix-primary/90">
                  Pinned · priority
                </p>
                <div className="space-y-2">
                  {pinnedSchedule.map((r) => (
                    <Link
                      key={`${r.libraryShowId}-${r.airDate}`}
                      to={`/series/${r.libraryShowId}`}
                      className={cn(
                        "flex items-center justify-between gap-3 rounded-xl border px-4 py-3 transition-colors",
                        "border-pitflix-primary/35 bg-pitflix-primary/10 hover:border-pitflix-primary/55",
                      )}
                    >
                      <div className="min-w-0">
                        <p className="truncate font-medium text-white">{r.showTitle}</p>
                        <p className="truncate text-xs text-pitflix-subtle">
                          {r.episodeTitle || "Episode"} · S{r.season ?? "?"}E{r.episodeNumber ?? "?"}
                        </p>
                      </div>
                      <div className="shrink-0 text-right">
                        <p className="text-[11px] text-pitflix-muted">{r.airDate}</p>
                        <CountdownLine airDate={r.airDate} />
                      </div>
                    </Link>
                  ))}
                </div>
              </div>
            ) : null}
            {restSchedule.length > 0 ? (
              <div>
                {pinnedSchedule.length > 0 ? (
                  <p className="mb-2 text-[11px] font-semibold uppercase tracking-wide text-pitflix-muted">
                    Other library shows
                  </p>
                ) : null}
                <div className="space-y-2">
                  {restSchedule.map((r) => (
                    <Link
                      key={`${r.libraryShowId}-${r.airDate}`}
                      to={`/series/${r.libraryShowId}`}
                      className="flex items-center justify-between gap-3 rounded-xl border border-pitflix-card/50 bg-pitflix-surface/40 px-4 py-3 transition-colors hover:border-pitflix-primary/40"
                    >
                      <div className="min-w-0">
                        <p className="truncate font-medium text-white">{r.showTitle}</p>
                        <p className="truncate text-xs text-pitflix-subtle">
                          {r.episodeTitle || "Episode"} · S{r.season ?? "?"}E{r.episodeNumber ?? "?"}
                        </p>
                      </div>
                      <div className="shrink-0 text-right">
                        <p className="text-[11px] text-pitflix-muted">{r.airDate}</p>
                        <CountdownLine airDate={r.airDate} />
                      </div>
                    </Link>
                  ))}
                </div>
              </div>
            ) : null}
          </div>
        )}
      </section>
    </div>
  );
}
