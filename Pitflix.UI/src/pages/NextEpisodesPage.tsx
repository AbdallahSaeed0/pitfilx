import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { CalendarClock, Link as LinkIcon, Search, Tv, X } from "lucide-react";
import { useMemo, useState } from "react";
import { Link } from "react-router-dom";
import { MediaImage } from "../components/ui/MediaImage";
import { toPosterSrc } from "../utils/posterSrc";
import {
  discoverTvSchedule,
  discoverTvSearch,
  getNextEpisodesAir,
  getNextEpisodesFollowed,
  getNextEpisodesPins,
  putNextEpisodesFollowed,
  putNextEpisodesPins,
  type FollowedExternalShow,
  type NextEpisodeAir,
} from "../api/homeDiscover";
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

function ScheduleRow({ r, pinned }: { r: NextEpisodeAir; pinned?: boolean }) {
  const lib = r.libraryShowId != null;
  const href = lib ? `/series/${r.libraryShowId}` : `https://www.themoviedb.org/tv/${r.showTmdbId}`;
  const className = cn(
    "block rounded-xl border px-4 py-3 transition-colors",
    pinned
      ? "border-pitflix-primary/35 bg-pitflix-primary/10 hover:border-pitflix-primary/55"
      : "border-pitflix-card/50 bg-pitflix-surface/40 hover:border-pitflix-primary/40",
  );
  const inner = (
    <div className="flex w-full items-center justify-between gap-3">
      <div className="flex min-w-0 flex-1 items-center gap-3">
        {r.posterUrl ? (
          <div className="h-14 w-10 shrink-0 overflow-hidden rounded-md bg-pitflix-card">
            <img src={r.posterUrl} alt="" className="h-full w-full object-cover" />
          </div>
        ) : null}
        <div className="min-w-0">
          <p className="truncate font-medium text-white">{r.showTitle}</p>
          <p className="truncate text-xs text-pitflix-subtle">
            {r.episodeTitle || "Episode"} · S{r.season ?? "?"}E{r.episodeNumber ?? "?"}
          </p>
          {r.kind === "followed" ? (
            <p className="text-[10px] text-amber-200/80">Followed · TMDB</p>
          ) : null}
        </div>
      </div>
      <div className="shrink-0 text-right">
        <p className="text-[11px] text-pitflix-muted">{r.airDate}</p>
        <CountdownLine airDate={r.airDate} />
      </div>
    </div>
  );
  if (!lib) {
    return (
      <a href={href} target="_blank" rel="noreferrer" className={className}>
        {inner}
      </a>
    );
  }
  return (
    <Link to={href} className={className}>
      {inner}
    </Link>
  );
}

export function NextEpisodesPage() {
  const qc = useQueryClient();
  const [librarySearch, setLibrarySearch] = useState("");
  const debouncedLib = useDebounce(librarySearch, 350);
  const [externalSearch, setExternalSearch] = useState("");
  const debouncedExternal = useDebounce(externalSearch, 350);
  const [externalPickTmdb, setExternalPickTmdb] = useState<number | null>(null);

  const pinsQ = useQuery({
    queryKey: ["home-next-episodes-pins"],
    queryFn: getNextEpisodesPins,
    staleTime: 30_000,
  });

  const followedQ = useQuery({
    queryKey: ["home-next-episodes-followed"],
    queryFn: getNextEpisodesFollowed,
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

  const externalHitsQ = useQuery({
    queryKey: ["discover-tv-search", debouncedExternal],
    queryFn: () => discoverTvSearch(debouncedExternal.trim()),
    enabled: debouncedExternal.trim().length >= 2,
    staleTime: 60_000,
  });

  const externalScheduleQ = useQuery({
    queryKey: ["discover-tv-schedule", externalPickTmdb],
    queryFn: () => discoverTvSchedule(externalPickTmdb!),
    enabled: externalPickTmdb != null && externalPickTmdb > 0,
    staleTime: 60_000,
  });

  const savePins = useMutation({
    mutationFn: putNextEpisodesPins,
    onSuccess: async () => {
      await qc.invalidateQueries({ queryKey: ["home-next-episodes-pins"] });
      await qc.invalidateQueries({ queryKey: ["home-next-episodes"] });
    },
  });

  const saveFollowed = useMutation({
    mutationFn: putNextEpisodesFollowed,
    onSuccess: async () => {
      await qc.invalidateQueries({ queryKey: ["home-next-episodes-followed"] });
      await qc.invalidateQueries({ queryKey: ["home-next-episodes"] });
    },
  });

  const pinnedIds = useMemo(() => new Set(pinsQ.data?.showIds ?? []), [pinsQ.data?.showIds]);

  const followedTmdbIds = useMemo(
    () => new Set((followedQ.data ?? []).map((f) => f.tmdbId)),
    [followedQ.data],
  );

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

  const setFollowedList = (next: FollowedExternalShow[]) => {
    void saveFollowed.mutate(next);
  };

  const addFollowed = (f: FollowedExternalShow) => {
    const list = [...(followedQ.data ?? [])];
    if (list.some((x) => x.tmdbId === f.tmdbId)) return;
    list.push(f);
    setFollowedList(list);
  };

  const removeFollowed = (tmdbId: number) => {
    setFollowedList((followedQ.data ?? []).filter((x) => x.tmdbId !== tmdbId));
  };

  const searchHits = searchQ.data?.items ?? [];
  const rows = scheduleQ.data ?? [];
  const pinnedSchedule = rows.filter((r) => r.pinned);
  const restSchedule = rows.filter((r) => !r.pinned);
  const titleByLibraryId = useMemo(() => {
    const m = new Map<number, string>();
    for (const r of rows) {
      if (r.libraryShowId != null) m.set(r.libraryShowId, r.showTitle);
    }
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

      <section className="space-y-3 rounded-2xl border border-pitflix-primary/25 bg-gradient-to-br from-pitflix-primary/10 to-pitflix-surface/30 p-5">
        <p className="text-xs font-semibold uppercase tracking-wide text-pitflix-primary/90">Look up any show (TMDB)</p>
        <p className="text-xs text-pitflix-subtle">
          Search titles not in your library — we read the next episode to air from TMDB (same source as library rows).
        </p>
        <div className="relative">
          <Search className="pointer-events-none absolute left-3 top-1/2 h-4 w-4 -translate-y-1/2 text-pitflix-muted" />
          <input
            type="search"
            value={externalSearch}
            onChange={(e) => {
              setExternalSearch(e.target.value);
              setExternalPickTmdb(null);
            }}
            placeholder="Search any TV series (e.g. Severance)…"
            className="w-full rounded-xl border border-pitflix-card bg-pitflix-bg py-2.5 pl-10 pr-3 text-sm text-white placeholder:text-pitflix-muted focus:border-pitflix-primary focus:outline-none focus:ring-1 focus:ring-pitflix-primary/40"
          />
        </div>
        {debouncedExternal.trim().length > 0 && debouncedExternal.trim().length < 2 ? (
          <p className="text-[11px] text-pitflix-muted">Type at least 2 characters.</p>
        ) : null}
        {debouncedExternal.trim().length >= 2 && externalHitsQ.isFetching ? (
          <div className="flex items-center gap-2 text-xs text-pitflix-subtle">
            <Spinner className="h-4 w-4" /> Searching TMDB…
          </div>
        ) : null}
        {debouncedExternal.trim().length >= 2 && !externalHitsQ.isFetching && (externalHitsQ.data?.length ?? 0) === 0 ? (
          <p className="text-xs text-pitflix-subtle">No TMDB TV results for that query.</p>
        ) : null}
        {(externalHitsQ.data?.length ?? 0) > 0 ? (
          <ul className="max-h-48 space-y-1 overflow-y-auto rounded-xl border border-pitflix-card/40 bg-black/20 p-2">
            {externalHitsQ.data!.map((h) => (
              <li key={h.tmdbId}>
                <button
                  type="button"
                  onClick={() => setExternalPickTmdb(h.tmdbId)}
                  className={cn(
                    "flex w-full items-center gap-3 rounded-lg px-2 py-2 text-left text-sm hover:bg-white/5",
                    externalPickTmdb === h.tmdbId ? "bg-pitflix-primary/15 ring-1 ring-pitflix-primary/35" : "",
                  )}
                >
                  <div className="h-12 w-8 shrink-0 overflow-hidden rounded bg-pitflix-card">
                    {h.posterUrl ? (
                      <img src={h.posterUrl} alt="" className="h-full w-full object-cover" />
                    ) : (
                      <div className="flex h-full items-center justify-center text-[10px] text-pitflix-muted">TV</div>
                    )}
                  </div>
                  <div className="min-w-0">
                    <p className="truncate font-medium text-white">{h.title}</p>
                    <p className="text-[11px] text-pitflix-muted">TMDB #{h.tmdbId}{h.year ? ` · ${h.year}` : ""}</p>
                  </div>
                </button>
              </li>
            ))}
          </ul>
        ) : null}
        {externalPickTmdb != null ? (
          <div className="rounded-xl border border-pitflix-card/50 bg-black/25 p-4">
            {externalScheduleQ.isLoading ? (
              <div className="flex items-center gap-2 text-sm text-pitflix-subtle">
                <Spinner className="h-4 w-4" /> Loading schedule…
              </div>
            ) : externalScheduleQ.isError ? (
              <p className="text-sm text-rose-200/90">Could not load schedule.</p>
            ) : externalScheduleQ.data?.ok ? (
              <div className="space-y-3">
                <div className="space-y-1">
                  <p className="font-semibold text-white">{externalScheduleQ.data.showTitle}</p>
                  <p className="text-sm text-pitflix-subtle">
                    {externalScheduleQ.data.episodeTitle || "Episode"} · S{externalScheduleQ.data.season ?? "?"}E
                    {externalScheduleQ.data.episodeNumber ?? "?"}
                  </p>
                  <p className="text-xs text-pitflix-muted">Airs {externalScheduleQ.data.airDate ?? "—"}</p>
                  {externalScheduleQ.data.airDate ? <CountdownLine airDate={externalScheduleQ.data.airDate} /> : null}
                </div>
                {(() => {
                  const hit = externalHitsQ.data?.find((x) => x.tmdbId === externalPickTmdb);
                  if (!hit) return null;
                  const on = followedTmdbIds.has(hit.tmdbId);
                  return (
                    <button
                      type="button"
                      disabled={saveFollowed.isPending || on}
                      onClick={() =>
                        addFollowed({
                          tmdbId: hit.tmdbId,
                          title: hit.title,
                          posterPath: hit.posterUrl ?? undefined,
                          addedAtUtc: new Date().toISOString(),
                        })
                      }
                      className="w-full rounded-xl bg-pitflix-primary/25 py-2.5 text-sm font-semibold text-pitflix-primary hover:bg-pitflix-primary/35 disabled:opacity-60"
                    >
                      {on ? "Following for schedule" : "Follow for schedule"}
                    </button>
                  );
                })()}
              </div>
            ) : (
              <p className="text-sm text-pitflix-subtle">
                {(externalScheduleQ.data as { message?: string })?.message ??
                  "No next episode scheduled in TMDB for this series."}
              </p>
            )}
          </div>
        ) : null}
      </section>

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
          <Tv className="h-5 w-5 text-amber-200/90" />
          <h2 className="font-semibold text-white">Followed (not in library)</h2>
        </div>
        {followedQ.isLoading ? (
          <Spinner className="h-5 w-5" />
        ) : (followedQ.data?.length ?? 0) === 0 ? (
          <p className="text-sm text-pitflix-subtle">
            Follow a TMDB show from the search above — it stays in your database and appears in the schedule when TMDB
            lists a next air date.
          </p>
        ) : (
          <ul className="space-y-2">
            {followedQ.data!.map((f) => (
              <li
                key={f.tmdbId}
                className="flex items-center justify-between gap-2 rounded-xl border border-pitflix-card/40 bg-black/25 px-3 py-2"
              >
                <div className="flex min-w-0 items-center gap-2">
                  <div className="h-10 w-7 shrink-0 overflow-hidden rounded bg-pitflix-card">
                    <MediaImage
                      src={toPosterSrc(f.posterPath ?? undefined)}
                      alt=""
                      className="h-full w-full object-cover"
                      fallbackText={f.title.slice(0, 2)}
                    />
                  </div>
                  <div className="min-w-0">
                    <p className="truncate text-sm text-white">{f.title}</p>
                    <p className="text-[11px] text-pitflix-muted">TMDB #{f.tmdbId}</p>
                  </div>
                </div>
                <button
                  type="button"
                  onClick={() => removeFollowed(f.tmdbId)}
                  disabled={saveFollowed.isPending}
                  className="shrink-0 rounded-lg p-1 text-pitflix-muted hover:bg-rose-500/20 hover:text-rose-100 disabled:opacity-50"
                  title="Unfollow"
                >
                  <X className="h-4 w-4" />
                </button>
              </li>
            ))}
          </ul>
        )}
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
                    <ScheduleRow key={`${r.libraryShowId}-${r.airDate}`} r={r} pinned />
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
                    <ScheduleRow
                      key={`${r.kind ?? "lib"}-${r.showTmdbId}-${r.airDate}-${r.season}-${r.episodeNumber}`}
                      r={r}
                    />
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
