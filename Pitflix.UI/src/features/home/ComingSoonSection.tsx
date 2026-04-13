import { useQuery } from "@tanstack/react-query";
import { useMemo } from "react";
import { CalendarClock } from "lucide-react";
import { getComingSoon, type ComingSoonItem } from "../../api/homeDiscover";
import { MediaImage } from "../../components/ui/MediaImage";
import { Spinner } from "../../components/ui/Spinner";
import { airDateToUtcMs, formatCountdown, useCountdown } from "../../hooks/useCountdown";
import { formatRating } from "../../utils/format";

function CountdownPill({ releaseDate }: { releaseDate: string }) {
  const target = airDateToUtcMs(releaseDate, null);
  const left = useCountdown(target);
  const text = formatCountdown(left);
  if (!text) return null;
  return (
    <span className="rounded-md bg-black/50 px-2 py-0.5 font-mono text-[10px] text-amber-100/95">{text}</span>
  );
}

function Card({ item }: { item: ComingSoonItem }) {
  return (
    <div className="w-[160px] shrink-0 overflow-hidden rounded-xl border border-pitflix-card/60 bg-pitflix-surface/50 shadow-md">
      <MediaImage
        src={item.posterUrl ?? undefined}
        alt=""
        className="aspect-[2/3] w-full object-cover"
        fallbackText={item.title.slice(0, 2)}
      />
      <div className="space-y-1 p-2">
        <p className="line-clamp-2 text-xs font-semibold text-white">{item.title}</p>
        <p className="text-[10px] text-pitflix-subtle">
          {item.releaseDate} · ★ {formatRating(item.voteAverage)}
        </p>
        <div className="flex flex-wrap items-center gap-1">
          <span className="text-[10px] uppercase text-pitflix-muted">{item.mediaType}</span>
          <CountdownPill releaseDate={item.releaseDate} />
        </div>
      </div>
    </div>
  );
}

type ComingSoonProps = { embedded?: boolean };

export function ComingSoonSection({ embedded = false }: ComingSoonProps) {
  const q = useQuery({
    queryKey: ["home-coming-soon"],
    queryFn: getComingSoon,
    staleTime: 120_000,
  });

  const movies = useMemo(() => {
    const list = [...(q.data?.movies ?? [])];
    list.sort((a, b) => {
      const da = a.releaseDate ?? "";
      const db = b.releaseDate ?? "";
      if (da !== db) return da.localeCompare(db);
      return a.title.localeCompare(b.title, undefined, { sensitivity: "base" });
    });
    return list;
  }, [q.data?.movies]);

  const tv = useMemo(() => {
    const list = [...(q.data?.tv ?? [])];
    list.sort((a, b) => {
      const da = a.releaseDate ?? "";
      const db = b.releaseDate ?? "";
      if (da !== db) return da.localeCompare(db);
      return a.title.localeCompare(b.title, undefined, { sensitivity: "base" });
    });
    return list;
  }, [q.data?.tv]);

  const wrapClass = embedded
    ? ""
    : "rounded-2xl border border-pitflix-card/40 bg-gradient-to-b from-pitflix-surface/40 to-pitflix-bg/20 p-6";

  if (q.isLoading)
    return (
      <div
        className={
          embedded
            ? "py-2 text-sm text-pitflix-subtle"
            : "rounded-2xl border border-pitflix-card/40 bg-pitflix-surface/30 p-6"
        }
      >
        <div className="flex items-center gap-2">
          <Spinner className="h-5 w-5" /> Loading upcoming…
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
        Could not load upcoming releases.
      </div>
    );

  if (movies.length === 0 && tv.length === 0) {
    return (
      <div
        className={
          embedded
            ? "py-2 text-sm text-pitflix-subtle"
            : "rounded-2xl border border-dashed border-pitflix-card/50 bg-pitflix-bg/40 p-6 text-sm text-pitflix-subtle"
        }
      >
        No upcoming listings from TMDB right now.
      </div>
    );
  }

  return (
    <div className={wrapClass}>
      {embedded ? null : (
        <div className="mb-4 flex items-center gap-2">
          <CalendarClock className="h-5 w-5 text-pitflix-primary" />
          <h2 className="text-lg font-bold text-white">Coming soon</h2>
          <span className="text-xs text-pitflix-subtle">Upcoming releases only — future dates, not already out</span>
        </div>
      )}
      <div className="space-y-4">
        {movies.length > 0 ? (
          <div>
            <p className="mb-2 text-xs font-semibold uppercase tracking-wide text-pitflix-muted">Movies</p>
            <div
              className="flex gap-3 overflow-x-auto pb-2 [scrollbar-color:rgba(139,92,246,0.4)_rgba(15,15,20,0.85)] [scrollbar-width:thin] [&::-webkit-scrollbar]:h-2 [&::-webkit-scrollbar-thumb]:rounded-full [&::-webkit-scrollbar-thumb]:bg-violet-500/40 [&::-webkit-scrollbar-track]:rounded-full [&::-webkit-scrollbar-track]:bg-black/40"
            >
              {movies.map((m) => (
                <Card key={`m-${m.tmdbId}`} item={m} />
              ))}
            </div>
          </div>
        ) : null}
        {tv.length > 0 ? (
          <div>
            <p className="mb-2 text-xs font-semibold uppercase tracking-wide text-pitflix-muted">Series</p>
            <div
              className="flex gap-3 overflow-x-auto pb-2 [scrollbar-color:rgba(139,92,246,0.4)_rgba(15,15,20,0.85)] [scrollbar-width:thin] [&::-webkit-scrollbar]:h-2 [&::-webkit-scrollbar-thumb]:rounded-full [&::-webkit-scrollbar-thumb]:bg-violet-500/40 [&::-webkit-scrollbar-track]:rounded-full [&::-webkit-scrollbar-track]:bg-black/40"
            >
              {tv.map((t) => (
                <Card key={`t-${t.tmdbId}`} item={t} />
              ))}
            </div>
          </div>
        ) : null}
      </div>
    </div>
  );
}
