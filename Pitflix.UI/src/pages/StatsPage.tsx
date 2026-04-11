import { useQuery } from "@tanstack/react-query";
import { useNavigate } from "react-router-dom";
import { getWatchStats } from "../api/watchStats";
import { MediaImage } from "../components/ui/MediaImage";
import { Spinner } from "../components/ui/Spinner";
import type { MediaCard } from "../types/media";
import { toPosterSrc } from "../utils/posterSrc";

export function StatsPage() {
  const navigate = useNavigate();
  const { data, isLoading } = useQuery({ queryKey: ["watch-stats"], queryFn: getWatchStats });

  if (isLoading || !data)
    return (
      <div className="flex justify-center py-24">
        <Spinner />
      </div>
    );

  const hoursTotal = Math.round(data.totalWatchTimeMinutes / 60);
  const weekHrs = (data.thisWeekMinutes / 60).toFixed(1);
  const monthHrs = (data.thisMonthMinutes / 60).toFixed(1);
  const mp = data.movieVsSeries.moviePercent;
  const sp = data.movieVsSeries.seriesPercent;
  const circ = 2 * Math.PI * 36;

  return (
    <div>
      <button
        type="button"
        onClick={() => navigate(-1)}
        className="mb-4 text-sm text-pitflix-muted hover:text-white"
      >
        ← Back
      </button>
      <h1 className="mb-8 text-3xl font-bold text-white">📊 Statistics</h1>

      <div className="mb-6 grid gap-4 sm:grid-cols-2 xl:grid-cols-4">
        <StatCard emoji="🕐" value={`${hoursTotal}h`} label="Total watched" sub="Approx. from history" />
        <StatCard emoji="🎬" value={String(data.totalMoviesWatched)} label="Movies watched" sub="Completed" />
        <StatCard
          emoji="📺"
          value={`${data.totalEpisodesWatched} eps`}
          label="Episodes watched"
          sub={`${data.totalSeriesCompleted} series done`}
        />
        <StatCard emoji="🔥" value={`${data.watchStreak}`} label="Day streak" sub="Activity days in a row" />
      </div>

      <div className="mb-6 grid gap-6 lg:grid-cols-2">
        <div className="rounded-xl bg-pitflix-card p-5">
          <h2 className="mb-4 text-lg font-semibold text-white">Top genres</h2>
          <div className="space-y-3">
            {data.topGenres.length === 0 ? (
              <p className="text-sm text-pitflix-muted">No completed titles with genres yet.</p>
            ) : (
              data.topGenres.map((g) => (
                <div key={g.genre}>
                  <div className="mb-1 flex justify-between text-xs text-pitflix-muted">
                    <span className="text-white">{g.genre}</span>
                    <span>{g.count}</span>
                  </div>
                  <div className="h-2 w-full overflow-hidden rounded-full bg-pitflix-bg">
                    <div
                      className="h-full rounded-full bg-pitflix-primary"
                      style={{
                        width: `${Math.min(100, (100 * g.count) / Math.max(1, data.topGenres[0]?.count ?? 1))}%`,
                      }}
                    />
                  </div>
                </div>
              ))
            )}
          </div>
        </div>

        <div className="rounded-xl bg-pitflix-card p-5">
          <h2 className="mb-4 text-lg font-semibold text-white">Movies vs series</h2>
          <div className="flex flex-col items-center gap-4 sm:flex-row sm:justify-center">
            <div className="relative h-28 w-28 shrink-0">
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
                <span className="text-xs font-bold text-pitflix-primary">{mp.toFixed(0)}%</span>
                <span className="text-[10px] text-pitflix-muted">movies</span>
              </div>
            </div>
            <div className="text-sm text-pitflix-muted">
              <p>
                <span className="text-pitflix-primary">●</span> Movies {mp.toFixed(0)}%
              </p>
              <p>
                <span className="text-violet-300">●</span> Series {sp.toFixed(0)}%
              </p>
              <p className="mt-2 text-xs">Language mix: {data.topLanguage}</p>
            </div>
          </div>
        </div>
      </div>

      <div className="grid gap-6 lg:grid-cols-2">
        <div className="rounded-xl bg-pitflix-card p-5">
          <h2 className="mb-4 text-lg font-semibold text-white">Time</h2>
          <div className="flex flex-wrap gap-8">
            <div>
              <p className="text-3xl font-bold text-pitflix-primary">{weekHrs}h</p>
              <p className="text-xs text-pitflix-muted">This week</p>
            </div>
            <div>
              <p className="text-3xl font-bold text-pitflix-primary">{monthHrs}h</p>
              <p className="text-xs text-pitflix-muted">This month</p>
            </div>
          </div>
          <p className="mt-4 text-xs text-pitflix-subtle">
            Most-watched genre: <span className="text-white">{data.mostWatchedGenre || "—"}</span> · Avg movie ★{" "}
            {data.averageMovieRating.toFixed(1)} · Avg series ★ {data.averageSeriesRating.toFixed(1)}
          </p>
        </div>

        <div className="rounded-xl bg-pitflix-card p-5">
          <h2 className="mb-4 text-lg font-semibold text-white">Recently completed</h2>
          <div className="scrollbar-hide flex gap-3 overflow-x-auto pb-2">
            {(data.recentlyCompleted ?? []).map((item: MediaCard) => (
              <div key={`${item.id}-stat`} className="w-24 shrink-0">
                <button
                  type="button"
                  onClick={() =>
                    navigate(item.mediaFilePath || item.filePath ? `/movie/${item.id}` : `/series/${item.id}`)
                  }
                  className="w-full text-left"
                >
                  <MediaImage
                    src={toPosterSrc(item.selectedPosterPath || item.posterLocalPath || item.posterRemoteUrl)}
                    alt={item.title}
                    className="aspect-[2/3] w-full rounded-lg bg-pitflix-bg"
                    fallbackText={item.title.slice(0, 8)}
                  />
                  <p className="mt-1 truncate text-[10px] font-medium text-white">{item.title}</p>
                </button>
              </div>
            ))}
          </div>
        </div>
      </div>
    </div>
  );
}

function StatCard({
  emoji,
  value,
  label,
  sub,
}: {
  emoji: string;
  value: string;
  label: string;
  sub: string;
}) {
  return (
    <div className="rounded-xl bg-pitflix-card p-5">
      <span className="text-2xl">{emoji}</span>
      <p className="mt-2 text-2xl font-bold text-pitflix-primary">{value}</p>
      <p className="text-sm font-medium text-white">{label}</p>
      <p className="mt-1 text-xs text-pitflix-muted">{sub}</p>
    </div>
  );
}
