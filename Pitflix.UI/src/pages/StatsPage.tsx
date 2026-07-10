import { useState } from "react";
import { useQuery } from "@tanstack/react-query";
import { useNavigate } from "react-router-dom";
import { getWatchStats, type WatchStats } from "../api/watchStats";
import { HorizontalScrollRow } from "../components/ui/HorizontalScrollRow";
import { MediaImage } from "../components/ui/MediaImage";
import { Spinner } from "../components/ui/Spinner";
import type { MediaCard } from "../types/media";
import { toPosterSrc } from "../utils/posterSrc";
import { cn } from "../utils/cn";

type Tab = "movies" | "series";

export function StatsPage() {
  const navigate = useNavigate();
  const [tab, setTab] = useState<Tab>("movies");
  const { data, isLoading } = useQuery({ queryKey: ["watch-stats"], queryFn: getWatchStats });

  if (isLoading || !data)
    return (
      <div className="flex justify-center py-24">
        <Spinner />
      </div>
    );

  const hoursTotal = Math.round(data.totalWatchTimeMinutes / 60);
  const mp = data.movieVsSeries.moviePercent;
  const sp = data.movieVsSeries.seriesPercent;
  const circ = 2 * Math.PI * 36;

  const movieHrs = Math.round((data.movieWatchTimeMinutes ?? 0) / 60);
  const seriesHrs = Math.round((data.seriesWatchTimeMinutes ?? 0) / 60);

  return (
    <div className="mx-auto max-w-6xl space-y-10 pb-14">
      <div>
        <button
          type="button"
          onClick={() => navigate(-1)}
          className="mb-3 text-sm text-pitflix-muted transition-colors hover:text-white"
        >
          ← Back
        </button>
        <h1 className="text-3xl font-bold tracking-tight text-white">Statistics</h1>
        <p className="mt-2 max-w-2xl text-sm text-pitflix-subtle">
          Library completion, momentum, and taste — from watch history and TMDB-backed metadata where available.
        </p>
      </div>

      <div className="grid gap-3 sm:grid-cols-2 lg:grid-cols-4">
        <StatCard
          accent="from-violet-500/20 to-transparent"
          value={`${hoursTotal}h`}
          label="Total watch time"
          sub="Estimated from session history"
        />
        <StatCard
          accent="from-rose-500/20 to-transparent"
          value={`${data.watchStreak}`}
          label="Day streak"
          sub="Consecutive days with activity"
        />
        <StatCard
          accent="from-emerald-500/15 to-transparent"
          value={String(data.currentlyWatchingCount ?? 0)}
          label="Currently watching"
          sub="Shows with progress & a next episode in library"
        />
        <StatCard
          accent="from-orange-500/15 to-transparent"
          value={String(data.rewatchSessionsApprox ?? 0)}
          label="Rewatch sessions (est.)"
          sub="Files played on 2+ separate days"
        />
      </div>

      <div className="rounded-2xl border border-pitflix-card/50 bg-gradient-to-b from-pitflix-surface/60 to-pitflix-bg/40 p-6 shadow-lg shadow-black/20">
        <h2 className="mb-1 text-lg font-semibold text-white">Movies vs series</h2>
        <p className="mb-5 text-xs text-pitflix-muted">Weighted by completed movies vs episode/series completions</p>
        <div className="flex flex-col items-center gap-6 sm:flex-row sm:justify-center sm:gap-10">
          <div className="relative h-32 w-32 shrink-0">
            <svg viewBox="0 0 80 80" className="h-full w-full -rotate-90">
              <circle cx="40" cy="40" r="36" fill="none" stroke="rgb(40,40,55)" strokeWidth="8" />
              <circle
                cx="40"
                cy="40"
                r="36"
                fill="none"
                stroke="rgb(139, 92, 246)"
                strokeWidth="8"
                strokeDasharray={`${(mp / 100) * circ} ${circ}`}
                strokeLinecap="round"
              />
              <circle
                cx="40"
                cy="40"
                r="36"
                fill="none"
                stroke="rgb(167, 139, 250)"
                strokeWidth="8"
                strokeDasharray={`${(sp / 100) * circ} ${circ}`}
                strokeDashoffset={`${-(mp / 100) * circ}`}
                strokeLinecap="round"
              />
            </svg>
            <div className="absolute inset-0 flex flex-col items-center justify-center text-center">
              <span className="text-lg font-bold text-pitflix-primary">{mp.toFixed(0)}%</span>
              <span className="text-[10px] text-pitflix-muted">movies</span>
            </div>
          </div>
          <div className="max-w-xs space-y-2 text-sm text-pitflix-muted">
            <p>
              <span className="text-pitflix-primary">●</span> Movies {mp.toFixed(0)}% · {movieHrs}h
            </p>
            <p>
              <span className="text-violet-300">●</span> Series {sp.toFixed(0)}% · {seriesHrs}h
            </p>
            <p className="border-t border-pitflix-card/40 pt-3 text-xs text-pitflix-subtle">
              Library language mix: <span className="text-white">{data.topLanguage}</span>
            </p>
          </div>
        </div>
      </div>

      <Last7DaysCard days={data.last7Days ?? []} />

      <div className="flex gap-2 rounded-full bg-pitflix-card/40 p-1.5 w-fit">
        <TabButton active={tab === "movies"} onClick={() => setTab("movies")}>
          Movies
        </TabButton>
        <TabButton active={tab === "series"} onClick={() => setTab("series")}>
          Series
        </TabButton>
      </div>

      {tab === "movies" ? (
        <MoviesTab data={data} navigate={navigate} />
      ) : (
        <SeriesTab data={data} navigate={navigate} />
      )}
    </div>
  );
}

function TabButton({
  active,
  onClick,
  children,
}: {
  active: boolean;
  onClick: () => void;
  children: React.ReactNode;
}) {
  return (
    <button
      type="button"
      onClick={onClick}
      className={cn(
        "rounded-full px-5 py-1.5 text-sm font-medium transition-colors",
        active ? "bg-pitflix-primary text-white" : "text-pitflix-muted hover:text-white",
      )}
    >
      {children}
    </button>
  );
}

function MoviesTab({
  data,
  navigate,
}: {
  data: WatchStats;
  navigate: (path: string) => void;
}) {
  const movieHrs = (((data.movieWatchTimeMinutes ?? 0)) / 60).toFixed(1);
  const movieWeekHrs = (((data.movieWatchTimeMinutesWeek ?? 0)) / 60).toFixed(1);
  const movieMonthHrs = (((data.movieWatchTimeMinutesMonth ?? 0)) / 60).toFixed(1);

  return (
    <div className="space-y-6">
      <div className="grid gap-3 sm:grid-cols-2 lg:grid-cols-4">
        <StatCard
          accent="from-amber-500/20 to-transparent"
          value={`${movieHrs}h`}
          label="Time spent watching movies"
          sub="Estimated from session history"
        />
        <StatCard
          accent="from-amber-500/15 to-transparent"
          value={String(data.totalMoviesWatched)}
          label="Movies completed"
          sub="Marked finished in library"
        />
        <StatCard
          accent="from-sky-500/15 to-transparent"
          value={`${movieWeekHrs}h`}
          label="This week"
          sub="Movie watch time (UTC)"
        />
        <StatCard
          accent="from-fuchsia-500/15 to-transparent"
          value={`${movieMonthHrs}h`}
          label="This month"
          sub="Movie watch time"
        />
      </div>

      <div className="grid gap-6 lg:grid-cols-2">
        <DecadeCard
          title="Completed by decade"
          sub="Based on release year on completed movies (library metadata)"
          decadeTop={data.decadeTopMovies ?? []}
        />
        <GenreCard title="Top genres" sub="From completed movies with genre metadata" genres={data.topMovieGenres ?? []} />
      </div>

      <RecentlyCompletedCard
        items={data.recentlyCompletedMovies ?? []}
        navigate={navigate}
        toPath={(id) => `/movie/${id}`}
        emptyText="Nothing finished recently — keep watching!"
      />

      <div className="rounded-2xl border border-pitflix-card/50 bg-pitflix-surface/35 p-6">
        <p className="text-xs text-pitflix-subtle">
          Avg TMDB rating — movies: <span className="text-white">{data.averageMovieRating.toFixed(1)}</span>
        </p>
      </div>
    </div>
  );
}

function SeriesTab({
  data,
  navigate,
}: {
  data: WatchStats;
  navigate: (path: string) => void;
}) {
  const seriesHrs = (((data.seriesWatchTimeMinutes ?? 0)) / 60).toFixed(1);
  const seriesWeekHrs = (((data.seriesWatchTimeMinutesWeek ?? 0)) / 60).toFixed(1);
  const seriesMonthHrs = (((data.seriesWatchTimeMinutesMonth ?? 0)) / 60).toFixed(1);
  const networkCounts = data.networkCounts ?? [];
  const maxNetwork = Math.max(1, ...networkCounts.map((n) => n.count));

  return (
    <div className="space-y-6">
      <div className="grid gap-3 sm:grid-cols-2 lg:grid-cols-4">
        <StatCard
          accent="from-sky-500/20 to-transparent"
          value={`${seriesHrs}h`}
          label="Time spent watching series"
          sub="Estimated from session history"
        />
        <StatCard
          accent="from-sky-500/15 to-transparent"
          value={`${data.totalEpisodesWatched}`}
          label="Episodes completed"
          sub={`${data.totalSeriesCompleted} series fully done`}
        />
        <StatCard
          accent="from-cyan-500/15 to-transparent"
          value={String(data.episodesCompletedThisWeek ?? 0)}
          label="Episodes this week"
          sub="Finished episodes (UTC week)"
        />
        <StatCard
          accent="from-rose-500/15 to-transparent"
          value={String(data.longestMarathonEpisodes ?? 0)}
          label="Longest marathon"
          sub={
            data.longestMarathonShowTitle
              ? `Episodes of "${data.longestMarathonShowTitle}" in one day`
              : "Episodes of the same show in one day"
          }
        />
      </div>

      <div className="grid gap-3 sm:grid-cols-2 lg:grid-cols-4">
        <StatCard
          accent="from-emerald-500/15 to-transparent"
          value={`${seriesWeekHrs}h`}
          label="This week"
          sub="Series watch time (UTC)"
        />
        <StatCard
          accent="from-orange-500/15 to-transparent"
          value={`${seriesMonthHrs}h`}
          label="This month"
          sub="Series watch time"
        />
        <StatCard
          accent="from-fuchsia-500/15 to-transparent"
          value={`${(data.seriesCompletionPercent ?? 0).toFixed(0)}%`}
          label="Series completion"
          sub="Matched series marked fully completed"
        />
        <StatCard
          accent="from-violet-500/15 to-transparent"
          value={String(data.showsWatchingLibrary ?? 0)}
          label="Series watching"
          sub="Library watch status “Watching”"
        />
      </div>

      <div className="grid gap-6 lg:grid-cols-2">
        <DecadeCard
          title="Completed by decade"
          sub="Based on release year on completed series (library metadata)"
          decadeTop={data.decadeTopSeries ?? []}
        />
        <GenreCard title="Top genres" sub="From completed series with genre metadata" genres={data.topSeriesGenres ?? []} />
      </div>

      <div className="rounded-2xl border border-pitflix-card/50 bg-gradient-to-b from-pitflix-surface/60 to-pitflix-bg/40 p-6 shadow-lg shadow-black/20">
        <h2 className="mb-1 text-lg font-semibold text-white">Series by network</h2>
        <p className="mb-5 text-xs text-pitflix-muted">
          Completed or in-progress matched series, grouped by originating network/streaming service (TMDB)
        </p>
        <div className="space-y-4">
          {networkCounts.length === 0 ? (
            <p className="text-sm text-pitflix-muted">
              Network data fills in gradually from TMDB as you revisit this page.
            </p>
          ) : (
            networkCounts.map((n) => (
              <div key={n.network}>
                <div className="mb-1.5 flex justify-between text-xs">
                  <span className="font-medium text-white">{n.network}</span>
                  <span className="text-pitflix-muted">{n.count} series</span>
                </div>
                <div className="h-2 w-full overflow-hidden rounded-full bg-pitflix-bg">
                  <div
                    className="h-full rounded-full bg-gradient-to-r from-pitflix-primary to-violet-400"
                    style={{ width: `${Math.min(100, (100 * n.count) / maxNetwork)}%` }}
                  />
                </div>
              </div>
            ))
          )}
        </div>
      </div>

      <RecentlyCompletedCard
        items={data.recentlyCompletedSeries ?? []}
        navigate={navigate}
        toPath={(id) => `/series/${id}`}
        emptyText="Nothing finished recently — keep watching!"
      />

      <div className="rounded-2xl border border-pitflix-card/50 bg-pitflix-surface/35 p-6">
        <p className="text-xs text-pitflix-subtle">
          Avg TMDB rating — series: <span className="text-white">{data.averageSeriesRating.toFixed(1)}</span>
        </p>
      </div>
    </div>
  );
}

function Last7DaysCard({ days }: { days: { date: string; count: number; titles: string[] }[] }) {
  const maxCount = Math.max(1, ...days.map((d) => d.count));
  const todayStr = new Date().toISOString().slice(0, 10);

  const intensityClass = (count: number) => {
    if (count <= 0) return "bg-pitflix-bg border-pitflix-card/50";
    const ratio = count / maxCount;
    if (ratio >= 0.75) return "bg-pitflix-primary border-pitflix-primary";
    if (ratio >= 0.4) return "bg-pitflix-primary/60 border-pitflix-primary/60";
    return "bg-pitflix-primary/25 border-pitflix-primary/25";
  };

  return (
    <div className="rounded-2xl border border-pitflix-card/50 bg-gradient-to-b from-pitflix-surface/60 to-pitflix-bg/40 p-6 shadow-lg shadow-black/20">
      <h2 className="mb-1 text-lg font-semibold text-white">Last 7 days</h2>
      <p className="mb-5 text-xs text-pitflix-muted">Movies and episodes finished each day</p>
      {days.length === 0 ? (
        <p className="text-sm text-pitflix-muted">No activity yet this week.</p>
      ) : (
        <div className="grid grid-cols-7 gap-2">
          {days.map((d) => {
            const dt = new Date(`${d.date}T00:00:00`);
            const dayLabel = dt.toLocaleDateString(undefined, { weekday: "short" });
            const dateLabel = dt.toLocaleDateString(undefined, { month: "short", day: "numeric" });
            const isToday = d.date === todayStr;
            return (
              <div
                key={d.date}
                className="flex flex-col items-center gap-1.5"
                title={d.titles.length > 0 ? d.titles.join(", ") : "Nothing finished"}
              >
                <p className={cn("text-[10px] font-medium uppercase tracking-wide", isToday ? "text-pitflix-primary" : "text-pitflix-subtle")}>
                  {dayLabel}
                </p>
                <div
                  className={cn(
                    "flex h-14 w-full items-center justify-center rounded-lg border text-sm font-bold text-white",
                    intensityClass(d.count),
                  )}
                >
                  {d.count > 0 ? d.count : ""}
                </div>
                <p className="text-[9px] text-pitflix-subtle">{dateLabel}</p>
                {d.titles.length > 0 ? (
                  <div className="mt-0.5 w-full space-y-0.5">
                    {d.titles.slice(0, 3).map((t) => (
                      <p key={t} className="truncate text-center text-[9px] leading-tight text-white/60" title={t}>
                        {t}
                      </p>
                    ))}
                    {d.titles.length > 3 ? (
                      <p className="text-center text-[9px] text-pitflix-subtle">+{d.titles.length - 3} more</p>
                    ) : null}
                  </div>
                ) : null}
              </div>
            );
          })}
        </div>
      )}
    </div>
  );
}

function DecadeCard({
  title,
  sub,
  decadeTop,
}: {
  title: string;
  sub: string;
  decadeTop: { decade: string; count: number }[];
}) {
  const maxD = Math.max(1, ...decadeTop.map((x) => x.count));
  return (
    <div className="rounded-2xl border border-pitflix-card/50 bg-gradient-to-b from-pitflix-surface/60 to-pitflix-bg/40 p-6 shadow-lg shadow-black/20">
      <h2 className="mb-1 text-lg font-semibold text-white">{title}</h2>
      <p className="mb-5 text-xs text-pitflix-muted">{sub}</p>
      <div className="space-y-4">
        {decadeTop.length === 0 ? (
          <p className="text-sm text-pitflix-muted">Complete a few dated titles to see decade spread.</p>
        ) : (
          decadeTop.map((d) => (
            <div key={d.decade}>
              <div className="mb-1.5 flex justify-between text-xs">
                <span className="font-medium text-white">{d.decade}</span>
                <span className="text-pitflix-muted">{d.count} completed</span>
              </div>
              <div className="h-2 w-full overflow-hidden rounded-full bg-pitflix-bg">
                <div
                  className="h-full rounded-full bg-gradient-to-r from-emerald-500/80 to-teal-400/90"
                  style={{ width: `${Math.min(100, (100 * d.count) / maxD)}%` }}
                />
              </div>
            </div>
          ))
        )}
      </div>
    </div>
  );
}

function GenreCard({
  title,
  sub,
  genres,
}: {
  title: string;
  sub: string;
  genres: { genre: string; count: number }[];
}) {
  const maxG = Math.max(1, genres[0]?.count ?? 1);
  return (
    <div className="rounded-2xl border border-pitflix-card/50 bg-gradient-to-b from-pitflix-surface/60 to-pitflix-bg/40 p-6 shadow-lg shadow-black/20">
      <h2 className="mb-1 text-lg font-semibold text-white">{title}</h2>
      <p className="mb-5 text-xs text-pitflix-muted">{sub}</p>
      <div className="space-y-4">
        {genres.length === 0 ? (
          <p className="text-sm text-pitflix-muted">Complete a few titles with genres to see this fill in.</p>
        ) : (
          genres.map((g) => (
            <div key={g.genre}>
              <div className="mb-1.5 flex justify-between text-xs">
                <span className="font-medium text-white">{g.genre}</span>
                <span className="text-pitflix-muted">{g.count} completed</span>
              </div>
              <div className="h-2 w-full overflow-hidden rounded-full bg-pitflix-bg">
                <div
                  className="h-full rounded-full bg-gradient-to-r from-pitflix-primary to-violet-400"
                  style={{ width: `${Math.min(100, (100 * g.count) / maxG)}%` }}
                />
              </div>
            </div>
          ))
        )}
      </div>
    </div>
  );
}

function RecentlyCompletedCard({
  items,
  navigate,
  toPath,
  emptyText,
}: {
  items: MediaCard[];
  navigate: (path: string) => void;
  toPath: (id: number | string) => string;
  emptyText: string;
}) {
  return (
    <div className="rounded-2xl border border-pitflix-card/50 bg-pitflix-surface/35 p-6">
      <h2 className="mb-4 text-lg font-semibold text-white">Recently completed</h2>
      {items.length === 0 ? (
        <p className="text-sm text-pitflix-muted">{emptyText}</p>
      ) : (
        <HorizontalScrollRow hideHeader className="mb-0" contentClassName="gap-3 pb-2">
          {items.map((item: MediaCard) => (
            <div key={`${item.id}-stat`} className="w-24 shrink-0">
              <button
                type="button"
                onClick={() => navigate(toPath(item.id))}
                className="w-full text-left transition-transform hover:scale-[1.02]"
              >
                <MediaImage
                  src={toPosterSrc(item.selectedPosterPath || item.posterLocalPath || item.posterRemoteUrl)}
                  alt={item.title}
                  className="aspect-[2/3] w-full rounded-lg bg-pitflix-bg ring-1 ring-white/5"
                  fallbackText={item.title.slice(0, 8)}
                />
                <p className="mt-1 truncate text-[10px] font-medium text-white">{item.title}</p>
              </button>
            </div>
          ))}
        </HorizontalScrollRow>
      )}
    </div>
  );
}

function StatCard({
  accent,
  value,
  label,
  sub,
}: {
  accent: string;
  value: string;
  label: string;
  sub: string;
}) {
  return (
    <div
      className={cn(
        "relative overflow-hidden rounded-2xl border border-pitflix-card/50 bg-pitflix-card/80 p-5 shadow-md shadow-black/20",
      )}
    >
      <div className={cn("pointer-events-none absolute inset-0 bg-gradient-to-br opacity-90", accent)} />
      <div className="relative">
        <p className="text-2xl font-bold tracking-tight text-white">{value}</p>
        <p className="mt-2 text-sm font-medium text-white/95">{label}</p>
        <p className="mt-1 text-xs text-pitflix-muted">{sub}</p>
      </div>
    </div>
  );
}
