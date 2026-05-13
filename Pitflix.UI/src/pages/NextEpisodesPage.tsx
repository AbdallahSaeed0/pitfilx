import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import {
  ArrowLeft,
  CalendarClock,
  Globe,
  Library,
  Link as LinkIcon,
  Search,
  Sparkles,
  Tv,
  X,
} from "lucide-react";
import { useMemo, useState } from "react";
import { Link } from "react-router-dom";
import { MediaImage } from "../components/ui/MediaImage";
import { AirDateCountdown } from "../components/ui/AirDateCountdown";
import { NextEpisodeAirRowInteractive, SeasonEpisodeBadge } from "../features/nextEpisodes/nextEpisodeAirUi";
import { toPosterSrc } from "../utils/posterSrc";
import {
  discoverTvSchedule,
  discoverTvSearch,
  getNextEpisodesAirScoped,
  getNextEpisodesFollowed,
  getNextEpisodesPins,
  putNextEpisodesFollowed,
  putNextEpisodesPins,
  type FollowedExternalShow,
} from "../api/homeDiscover";
import { getAllSeries } from "../api/series";
import type { MediaCard } from "../types/media";
import { useDebounce } from "../hooks/useDebounce";
import { Spinner } from "../components/ui/Spinner";
import { cn } from "../utils/cn";
type SeriesPage = { items?: MediaCard[]; total?: number };

const sectionCard =
  "rounded-2xl border border-white/[0.07] bg-gradient-to-b from-pitflix-surface/80 to-pitflix-bg/30 p-5 shadow-[inset_0_1px_0_0_rgba(255,255,255,0.04)] backdrop-blur-sm sm:p-6";

const sectionCardAccent =
  "rounded-2xl border border-pitflix-primary/25 bg-gradient-to-br from-pitflix-primary/[0.14] via-pitflix-surface/50 to-pitflix-bg/25 p-5 shadow-[inset_0_1px_0_0_rgba(255,255,255,0.06)] backdrop-blur-sm sm:p-6";

const searchInputClass =
  "w-full rounded-xl border border-white/10 bg-black/25 py-2.5 pl-10 pr-3 text-sm text-white placeholder:text-pitflix-muted shadow-inner backdrop-blur-sm transition-colors focus:border-pitflix-primary/70 focus:outline-none focus:ring-2 focus:ring-pitflix-primary/25";

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
    queryKey: ["home-next-episodes", "all"],
    queryFn: () => getNextEpisodesAirScoped({ view: "all", limit: 200 }),
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
    <div className="mx-auto max-w-4xl space-y-8 pb-14">
      <header className="relative overflow-hidden rounded-3xl border border-white/[0.08] bg-gradient-to-br from-pitflix-primary/15 via-pitflix-surface/40 to-pitflix-bg/60 px-5 py-6 sm:px-8 sm:py-8">
        <div className="pointer-events-none absolute -right-16 -top-16 h-48 w-48 rounded-full bg-pitflix-primary/20 blur-3xl" aria-hidden />
        <div className="relative flex flex-col gap-5 sm:flex-row sm:items-start sm:justify-between">
          <div className="min-w-0 space-y-3">
            <Link
              to="/"
              className="inline-flex items-center gap-1.5 text-xs font-medium text-pitflix-muted transition-colors hover:text-white"
            >
              <ArrowLeft className="h-3.5 w-3.5" />
              Home
            </Link>
            <div className="flex items-center gap-3">
              <span className="flex h-12 w-12 shrink-0 items-center justify-center rounded-2xl bg-pitflix-primary/25 ring-1 ring-pitflix-primary/35">
                <CalendarClock className="h-7 w-7 text-pitflix-primary" aria-hidden />
              </span>
              <div>
                <h1 className="text-2xl font-bold tracking-tight text-white sm:text-3xl">Next episodes</h1>
                <p className="mt-1 max-w-xl text-sm leading-relaxed text-pitflix-subtle">
                  Track air dates from TMDB. Pin library shows to keep them at the top of your schedule; each show still
                  needs a published next air date in TMDB.
                </p>
              </div>
            </div>
          </div>
        </div>
      </header>

      <div className="grid gap-6 lg:grid-cols-2">
      <section className={`space-y-4 ${sectionCardAccent}`}>
        <div className="flex items-start gap-3">
          <span className="mt-0.5 flex h-9 w-9 shrink-0 items-center justify-center rounded-xl bg-black/20 ring-1 ring-white/10">
            <Globe className="h-4 w-4 text-pitflix-primary" aria-hidden />
          </span>
          <div>
            <p className="text-sm font-semibold text-white">Discover on TMDB</p>
            <p className="mt-1 text-xs leading-relaxed text-pitflix-subtle">
              Look up any series, see the next scheduled episode, and follow it even when it is not in your library.
            </p>
          </div>
        </div>
        <div className="relative">
          <Search className="pointer-events-none absolute left-3 top-1/2 h-4 w-4 -translate-y-1/2 text-pitflix-muted" />
          <input
            type="search"
            value={externalSearch}
            onChange={(e) => {
              setExternalSearch(e.target.value);
              setExternalPickTmdb(null);
            }}
            placeholder="Search TV series (e.g. Severance)…"
            className={searchInputClass}
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
          <div className="rounded-2xl border border-white/10 bg-black/30 p-4 shadow-inner backdrop-blur-sm">
            {externalScheduleQ.isLoading ? (
              <div className="flex items-center gap-2 text-sm text-pitflix-subtle">
                <Spinner className="h-4 w-4" /> Loading schedule…
              </div>
            ) : externalScheduleQ.isError ? (
              <p className="text-sm text-rose-200/90">Could not load schedule.</p>
            ) : externalScheduleQ.data?.ok ? (
              <div className="space-y-3">
                <div className="space-y-2">
                  <p className="font-semibold text-white">{externalScheduleQ.data.showTitle}</p>
                  <p className="flex flex-wrap items-center gap-2 text-sm text-pitflix-subtle">
                    <span>{externalScheduleQ.data.episodeTitle || "Episode"}</span>
                    <SeasonEpisodeBadge
                      season={externalScheduleQ.data.season}
                      episodeNumber={externalScheduleQ.data.episodeNumber}
                    />
                  </p>
                  <div className="flex flex-wrap items-center gap-2">
                    <p className="text-xs text-pitflix-muted">Airs {externalScheduleQ.data.airDate ?? "—"}</p>
                    {externalScheduleQ.data.airDate ? (
                      <AirDateCountdown airDate={externalScheduleQ.data.airDate} layout="segments" size="md" />
                    ) : null}
                  </div>
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

      <section className={`space-y-4 ${sectionCard}`}>
        <div className="flex items-start gap-3">
          <span className="mt-0.5 flex h-9 w-9 shrink-0 items-center justify-center rounded-xl bg-white/5 ring-1 ring-white/10">
            <Library className="h-4 w-4 text-pitflix-primary" aria-hidden />
          </span>
          <div>
            <p className="text-sm font-semibold text-white">Pin from your library</p>
            <p className="mt-1 text-xs leading-relaxed text-pitflix-subtle">
              Search a show you already own and pin it so it is prioritized in the combined schedule.
            </p>
          </div>
        </div>
        <div className="relative">
          <Search className="pointer-events-none absolute left-3 top-1/2 h-4 w-4 -translate-y-1/2 text-pitflix-muted" />
          <input
            type="search"
            value={librarySearch}
            onChange={(e) => setLibrarySearch(e.target.value)}
            placeholder="Search your series (e.g. The Boys)…"
            className={searchInputClass}
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
          <ul className="max-h-56 space-y-1 overflow-y-auto rounded-xl border border-white/10 bg-black/25 p-2 shadow-inner">
            {searchHits.map((s) => (
              <li
                key={s.id}
                className="flex items-center justify-between gap-2 rounded-lg px-2 py-2 text-sm transition-colors hover:bg-white/5"
              >
                <span className="min-w-0 truncate font-medium text-white">{s.title}</span>
                {pinnedIds.has(s.id) ? (
                  <span className="shrink-0 rounded-md bg-white/10 px-2 py-0.5 text-[11px] font-medium text-pitflix-muted">
                    Pinned
                  </span>
                ) : (
                  <button
                    type="button"
                    disabled={savePins.isPending}
                    onClick={() => addPin(s.id)}
                    className="shrink-0 rounded-lg bg-pitflix-primary/25 px-2.5 py-1 text-[11px] font-semibold text-pitflix-primary hover:bg-pitflix-primary/35 disabled:opacity-50"
                  >
                    Pin
                  </button>
                )}
              </li>
            ))}
          </ul>
        ) : null}
      </section>
      </div>

      <div className="grid gap-6 lg:grid-cols-2">
      <section className={sectionCard}>
        <div className="mb-4 flex items-center gap-2.5">
          <span className="flex h-10 w-10 items-center justify-center rounded-xl bg-violet-500/15 ring-1 ring-violet-400/25">
            <Tv className="h-5 w-5 text-violet-200/95" aria-hidden />
          </span>
          <div>
            <h2 className="font-semibold text-white">Followed</h2>
            <p className="text-xs text-pitflix-muted">TMDB-only shows you follow for air dates</p>
          </div>
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
                className="flex items-center justify-between gap-2 rounded-xl border border-white/[0.07] bg-black/20 px-3 py-2.5 shadow-[inset_0_1px_0_0_rgba(255,255,255,0.04)]"
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

      <section className={sectionCard}>
        <div className="mb-4 flex items-center gap-2.5">
          <span className="flex h-10 w-10 items-center justify-center rounded-xl bg-pitflix-primary/20 ring-1 ring-pitflix-primary/35">
            <Sparkles className="h-5 w-5 text-pitflix-primary" aria-hidden />
          </span>
          <div>
            <h2 className="font-semibold text-white">Pinned shows</h2>
            <p className="text-xs text-pitflix-muted">Library series boosted in your schedule</p>
          </div>
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
                className="flex items-center justify-between gap-2 rounded-xl border border-white/[0.07] bg-black/20 px-3 py-2.5 shadow-[inset_0_1px_0_0_rgba(255,255,255,0.04)]"
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
      </div>

      <section className="rounded-3xl border border-white/[0.08] bg-gradient-to-b from-pitflix-surface/70 via-pitflix-bg/40 to-pitflix-bg/20 p-6 shadow-[inset_0_1px_0_0_rgba(255,255,255,0.05)] backdrop-blur-sm sm:p-8">
        <div className="mb-6 flex flex-wrap items-end justify-between gap-3">
          <div>
            <h2 className="text-xl font-bold tracking-tight text-white">Upcoming schedule</h2>
            <p className="mt-1 text-sm text-pitflix-subtle">Merged list from your library, pins, and followed shows</p>
          </div>
          <p className="text-xs tabular-nums text-pitflix-muted">{rows.length} entr{rows.length === 1 ? "y" : "ies"}</p>
        </div>
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
                <p className="mb-3 flex items-center gap-2 text-[11px] font-semibold uppercase tracking-[0.12em] text-pitflix-primary/95">
                  <span className="h-px flex-1 bg-gradient-to-r from-transparent to-pitflix-primary/35" aria-hidden />
                  Pinned first
                  <span className="h-px flex-1 bg-gradient-to-l from-transparent to-pitflix-primary/35" aria-hidden />
                </p>
                <div className="space-y-3">
                  {pinnedSchedule.map((r) => (
                    <NextEpisodeAirRowInteractive
                      key={`${r.kind ?? "lib"}-${r.showTmdbId}-${r.airDate}-${r.season}-${r.episodeNumber}`}
                      libraryShowId={r.libraryShowId}
                      showTmdbId={r.showTmdbId}
                      showTitle={r.showTitle}
                      episodeTitle={r.episodeTitle}
                      season={r.season}
                      episodeNumber={r.episodeNumber}
                      airDate={r.airDate}
                      posterUrl={r.posterUrl}
                      pinned
                      kind={r.kind === "followed" ? "followed" : undefined}
                      onTogglePin={(id, pin) => (pin ? addPin(id) : removePin(id))}
                    />
                  ))}
                </div>
              </div>
            ) : null}
            {restSchedule.length > 0 ? (
              <div>
                {pinnedSchedule.length > 0 ? (
                  <p className="mb-3 mt-6 flex items-center gap-2 text-[11px] font-semibold uppercase tracking-[0.12em] text-pitflix-muted">
                    <span className="h-px flex-1 bg-gradient-to-r from-transparent to-white/15" aria-hidden />
                    Everything else
                    <span className="h-px flex-1 bg-gradient-to-l from-transparent to-white/15" aria-hidden />
                  </p>
                ) : null}
                <div className="space-y-3">
                  {restSchedule.map((r) => (
                    <NextEpisodeAirRowInteractive
                      key={`${r.kind ?? "lib"}-${r.showTmdbId}-${r.airDate}-${r.season}-${r.episodeNumber}`}
                      libraryShowId={r.libraryShowId}
                      showTmdbId={r.showTmdbId}
                      showTitle={r.showTitle}
                      episodeTitle={r.episodeTitle}
                      season={r.season}
                      episodeNumber={r.episodeNumber}
                      airDate={r.airDate}
                      posterUrl={r.posterUrl}
                      pinned={!!(r.libraryShowId && pinnedIds.has(r.libraryShowId))}
                      kind={r.kind === "followed" ? "followed" : undefined}
                      onTogglePin={(id, pin) => (pin ? addPin(id) : removePin(id))}
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
