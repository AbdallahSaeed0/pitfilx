import { useMemo, useState } from "react";
import {
  addMonths,
  eachDayOfInterval,
  endOfMonth,
  endOfWeek,
  format,
  isSameDay,
  isSameMonth,
  isToday,
  startOfMonth,
  startOfWeek,
  subMonths,
} from "date-fns";
import { CalendarDays, ChevronLeft, ChevronRight, Clapperboard, Tv } from "lucide-react";
import { useNavigate } from "react-router-dom";
import type { ComingSoonItem } from "../../api/homeDiscover";
import type { NextEpisodeAir } from "../../api/homeDiscover";
import { MediaImage } from "../../components/ui/MediaImage";
import { cn } from "../../utils/cn";
import type { StreamingDetailsLocationState } from "../../pages/StreamingDetailsPage";

type CalendarItem = {
  key: string;
  tmdbId: number;
  mediaType: "movie" | "tv";
  title: string;
  posterUrl: string | null;
  episodeLabel?: string | null;
};

function toDateKey(raw: string): string | null {
  const s = raw.trim().slice(0, 10);
  return /^\d{4}-\d{2}-\d{2}$/.test(s) ? s : null;
}

function buildItemsByDate(
  comingSoon: { movies: ComingSoonItem[]; tv: ComingSoonItem[] } | undefined,
  scheduleRows: NextEpisodeAir[],
): Map<string, CalendarItem[]> {
  const map = new Map<string, CalendarItem[]>();
  const add = (dateKey: string | null, item: CalendarItem) => {
    if (!dateKey) return;
    const list = map.get(dateKey) ?? [];
    // De-dupe the same title+day (coming-soon and the followed/pinned schedule can overlap).
    if (list.some((x) => x.tmdbId === item.tmdbId && x.mediaType === item.mediaType)) return;
    list.push(item);
    map.set(dateKey, list);
  };

  for (const m of comingSoon?.movies ?? []) {
    add(toDateKey(m.releaseDate), {
      key: `movie-${m.tmdbId}`,
      tmdbId: m.tmdbId,
      mediaType: "movie",
      title: m.title,
      posterUrl: m.posterUrl,
    });
  }
  for (const t of comingSoon?.tv ?? []) {
    add(toDateKey(t.releaseDate), {
      key: `tv-${t.tmdbId}`,
      tmdbId: t.tmdbId,
      mediaType: "tv",
      title: t.title,
      posterUrl: t.posterUrl,
      episodeLabel: t.seasonNumber ? `Season ${t.seasonNumber} premiere` : "New series",
    });
  }
  for (const r of scheduleRows) {
    add(toDateKey(r.airDate), {
      key: `ep-${r.showTmdbId}-${r.season}-${r.episodeNumber}`,
      tmdbId: r.showTmdbId,
      mediaType: "tv",
      title: r.showTitle,
      posterUrl: r.posterUrl ?? null,
      episodeLabel:
        r.season != null && r.episodeNumber != null ? `S${r.season}E${r.episodeNumber}` : r.episodeTitle,
    });
  }

  return map;
}

export function ReleaseCalendarSection({
  comingSoon,
  scheduleRows,
  isLoading,
}: {
  comingSoon: { movies: ComingSoonItem[]; tv: ComingSoonItem[] } | undefined;
  scheduleRows: NextEpisodeAir[];
  isLoading: boolean;
}) {
  const navigate = useNavigate();
  const [monthCursor, setMonthCursor] = useState(() => startOfMonth(new Date()));
  const [selectedDate, setSelectedDate] = useState<Date>(() => new Date());

  const itemsByDate = useMemo(() => buildItemsByDate(comingSoon, scheduleRows), [comingSoon, scheduleRows]);

  const gridDays = useMemo(() => {
    const start = startOfWeek(startOfMonth(monthCursor));
    const end = endOfWeek(endOfMonth(monthCursor));
    return eachDayOfInterval({ start, end });
  }, [monthCursor]);

  const selectedKey = format(selectedDate, "yyyy-MM-dd");
  const selectedItems = itemsByDate.get(selectedKey) ?? [];

  function openTitle(item: CalendarItem) {
    const state: StreamingDetailsLocationState = {
      tmdbId: item.tmdbId,
      mediaType: item.mediaType === "movie" ? "Movie" : "Series",
      title: item.title,
      posterUrl: item.posterUrl,
    };
    navigate("/stream-details", { state });
  }

  return (
    <section className="rounded-3xl border border-white/[0.08] bg-gradient-to-b from-pitflix-surface/70 via-pitflix-bg/40 to-pitflix-bg/20 p-6 shadow-[inset_0_1px_0_0_rgba(255,255,255,0.05)] backdrop-blur-sm sm:p-8">
      <div className="mb-6 flex flex-wrap items-center justify-between gap-3">
        <div className="flex items-center gap-2.5">
          <span className="flex h-10 w-10 items-center justify-center rounded-xl bg-pitflix-primary/20 ring-1 ring-pitflix-primary/35">
            <CalendarDays className="h-5 w-5 text-pitflix-primary" aria-hidden />
          </span>
          <div>
            <h2 className="text-xl font-bold tracking-tight text-white">Release calendar</h2>
            <p className="mt-1 text-sm text-pitflix-subtle">Every day movies and TV episodes are releasing</p>
          </div>
        </div>
        <div className="flex items-center gap-1.5">
          <button
            type="button"
            onClick={() => setMonthCursor((m) => subMonths(m, 1))}
            className="flex h-8 w-8 items-center justify-center rounded-lg border border-white/10 text-pitflix-muted hover:border-white/25 hover:text-white"
            aria-label="Previous month"
          >
            <ChevronLeft className="h-4 w-4" />
          </button>
          <p className="w-32 text-center text-sm font-semibold text-white">{format(monthCursor, "MMMM yyyy")}</p>
          <button
            type="button"
            onClick={() => setMonthCursor((m) => addMonths(m, 1))}
            className="flex h-8 w-8 items-center justify-center rounded-lg border border-white/10 text-pitflix-muted hover:border-white/25 hover:text-white"
            aria-label="Next month"
          >
            <ChevronRight className="h-4 w-4" />
          </button>
          <button
            type="button"
            onClick={() => {
              setMonthCursor(startOfMonth(new Date()));
              setSelectedDate(new Date());
            }}
            className="ml-1 rounded-lg border border-white/10 px-2.5 py-1.5 text-xs font-semibold text-pitflix-muted hover:border-white/25 hover:text-white"
          >
            Today
          </button>
        </div>
      </div>

      <div className="mb-2 grid grid-cols-7 gap-1.5 text-center text-[11px] font-semibold uppercase tracking-wide text-pitflix-muted">
        {["Sun", "Mon", "Tue", "Wed", "Thu", "Fri", "Sat"].map((d) => (
          <span key={d}>{d}</span>
        ))}
      </div>

      <div className="grid grid-cols-7 gap-1.5">
        {gridDays.map((day) => {
          const key = format(day, "yyyy-MM-dd");
          const items = itemsByDate.get(key) ?? [];
          const inMonth = isSameMonth(day, monthCursor);
          const selected = isSameDay(day, selectedDate);
          const movieCount = items.filter((i) => i.mediaType === "movie").length;
          const tvCount = items.filter((i) => i.mediaType === "tv").length;

          return (
            <button
              key={key}
              type="button"
              onClick={() => setSelectedDate(day)}
              className={cn(
                "flex min-h-[4.25rem] flex-col items-start gap-1 rounded-xl border p-1.5 text-left transition-colors sm:min-h-[5rem] sm:p-2",
                selected
                  ? "border-pitflix-primary/60 bg-pitflix-primary/[0.14]"
                  : "border-white/[0.06] bg-black/15 hover:border-white/20 hover:bg-white/[0.04]",
                !inMonth && "opacity-35",
              )}
            >
              <span
                className={cn(
                  "text-xs font-semibold",
                  isToday(day) ? "flex h-5 w-5 items-center justify-center rounded-full bg-pitflix-primary text-white" : "text-white/80",
                )}
              >
                {format(day, "d")}
              </span>
              {items.length > 0 ? (
                <div className="flex flex-wrap gap-0.5">
                  {movieCount > 0 ? (
                    <span className="flex items-center gap-0.5 rounded bg-sky-500/20 px-1 py-0.5 text-[9px] font-bold text-sky-200">
                      <Clapperboard className="h-2.5 w-2.5" />
                      {movieCount}
                    </span>
                  ) : null}
                  {tvCount > 0 ? (
                    <span className="flex items-center gap-0.5 rounded bg-violet-500/20 px-1 py-0.5 text-[9px] font-bold text-violet-200">
                      <Tv className="h-2.5 w-2.5" />
                      {tvCount}
                    </span>
                  ) : null}
                </div>
              ) : null}
            </button>
          );
        })}
      </div>

      <div className="mt-6 border-t border-white/[0.06] pt-5">
        <p className="mb-3 text-sm font-semibold text-white">
          {format(selectedDate, "EEEE, MMMM d")}
          {isToday(selectedDate) ? <span className="ml-2 text-xs font-normal text-pitflix-primary">Today</span> : null}
        </p>
        {isLoading ? (
          <p className="text-sm text-pitflix-subtle">Loading releases…</p>
        ) : selectedItems.length === 0 ? (
          <p className="text-sm text-pitflix-subtle">Nothing releasing on this day.</p>
        ) : (
          <div className="grid grid-cols-2 gap-2.5 sm:grid-cols-3 md:grid-cols-4 lg:grid-cols-5">
            {selectedItems.map((item) => (
              <button
                key={item.key}
                type="button"
                onClick={() => openTitle(item)}
                className="group flex items-center gap-2.5 rounded-xl border border-white/[0.07] bg-black/20 p-2 text-left transition-colors hover:border-pitflix-primary/40 hover:bg-white/[0.05]"
              >
                <div className="h-14 w-10 shrink-0 overflow-hidden rounded bg-pitflix-card">
                  <MediaImage
                    src={item.posterUrl}
                    alt=""
                    className="h-full w-full object-cover"
                    fallbackText={item.title.slice(0, 2)}
                  />
                </div>
                <div className="min-w-0">
                  <p className="truncate text-xs font-semibold text-white group-hover:text-pitflix-primary">
                    {item.title}
                  </p>
                  <p className="mt-0.5 flex items-center gap-1 text-[10px] text-pitflix-muted">
                    {item.mediaType === "movie" ? (
                      <Clapperboard className="h-2.5 w-2.5" />
                    ) : (
                      <Tv className="h-2.5 w-2.5" />
                    )}
                    {item.episodeLabel ?? (item.mediaType === "movie" ? "Movie" : "Series")}
                  </p>
                </div>
              </button>
            ))}
          </div>
        )}
      </div>
    </section>
  );
}
