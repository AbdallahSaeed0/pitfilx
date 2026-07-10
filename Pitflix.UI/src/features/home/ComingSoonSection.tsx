import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { useMemo, useState } from "react";
import { CalendarClock, Clapperboard, Pin, PinOff, X } from "lucide-react";
import { useNavigate } from "react-router-dom";
import { getComingSoon, type ComingSoonItem } from "../../api/homeDiscover";
import { getComingSoon as getPinnedItems, pinComingSoon, unpinComingSoon } from "../../api/comingSoon";
import { getTrailerEmbedUrl } from "../../api/trailers";
import type { StreamPlayerLocationState } from "../../pages/StreamPlayerPage";
import type { StreamingDetailsLocationState } from "../../pages/StreamingDetailsPage";
import { AirDateCountdown } from "../../components/ui/AirDateCountdown";
import { HorizontalScrollRow } from "../../components/ui/HorizontalScrollRow";
import { MediaImage } from "../../components/ui/MediaImage";
import { Spinner } from "../../components/ui/Spinner";
import { formatRating } from "../../utils/format";

const DISMISSED_KEY = "coming-soon-dismissed";

function useDismissed() {
  const [dismissed, setDismissed] = useState<Set<string>>(() => {
    try {
      const raw = localStorage.getItem(DISMISSED_KEY);
      return raw ? new Set(JSON.parse(raw) as string[]) : new Set();
    } catch {
      return new Set();
    }
  });

  const dismiss = (key: string) => {
    setDismissed((prev) => {
      const next = new Set(prev);
      next.add(key);
      try { localStorage.setItem(DISMISSED_KEY, JSON.stringify([...next])); } catch { /* ignore */ }
      return next;
    });
  };

  return { dismissed, dismiss };
}

function dismissKey(item: ComingSoonItem) {
  return `${item.mediaType}-${item.tmdbId}`;
}

function Card({ item, pinnedId, onDismiss }: { item: ComingSoonItem; pinnedId: number | undefined; onDismiss: () => void }) {
  const qc = useQueryClient();
  const navigate = useNavigate();
  const isPinned = pinnedId !== undefined;
  const [trailerBusy, setTrailerBusy] = useState(false);

  const pinMut = useMutation({
    mutationFn: () =>
      pinComingSoon({
        tmdbId: item.tmdbId,
        mediaType: item.mediaType,
        title: item.title,
        posterUrl: item.posterUrl,
        releaseDate: item.releaseDate,
        overview: item.overview,
      }),
    onSuccess: () => void qc.invalidateQueries({ queryKey: ["pinned-coming-soon"] }),
  });

  const unpinMut = useMutation({
    mutationFn: () => unpinComingSoon(pinnedId!),
    onSuccess: () => void qc.invalidateQueries({ queryKey: ["pinned-coming-soon"] }),
  });

  const busy = pinMut.isPending || unpinMut.isPending;

  const handleTrailer = async (e: React.MouseEvent) => {
    e.stopPropagation();
    if (trailerBusy) return;
    setTrailerBusy(true);
    try {
      const res = await getTrailerEmbedUrl(item.tmdbId, item.mediaType);
      const embedUrl = res.trailers?.[0]?.embedUrl ?? res.embedUrl;
      if (!embedUrl) return;
      const state: StreamPlayerLocationState = {
        streamUrl: embedUrl,
        title: `${item.title} — Trailer`,
        posterUrl: item.posterUrl ?? undefined,
      };
      navigate("/stream-player", { state });
    } catch {
      // silently ignore — trailer not available
    } finally {
      setTrailerBusy(false);
    }
  };

  const openDetails = () => {
    const mediaType = item.mediaType.toLowerCase() === "movie" ? "Movie" : "Series";
    const state: StreamingDetailsLocationState = {
      tmdbId: item.tmdbId,
      mediaType,
      title: item.title,
      posterUrl: item.posterUrl,
      year: item.releaseDate?.slice(0, 4) ?? null,
    };
    navigate("/stream-details", { state });
  };

  return (
    <div
      role="button"
      tabIndex={0}
      onClick={openDetails}
      onKeyDown={(e) => e.key === "Enter" && openDetails()}
      className="group relative w-[160px] shrink-0 cursor-pointer overflow-hidden rounded-xl border border-pitflix-card/60 bg-pitflix-surface/50 shadow-md transition hover:border-pitflix-primary/50"
    >
      <div className="relative">
        <MediaImage
          src={item.posterUrl ?? undefined}
          alt=""
          className="aspect-[2/3] w-full object-cover"
          fallbackText={item.title.slice(0, 2)}
        />
        <button
          type="button"
          disabled={busy}
          title={isPinned ? "Unpin from Coming Soon" : "Pin to Coming Soon"}
          onClick={(e) => {
            e.stopPropagation();
            isPinned ? unpinMut.mutate() : pinMut.mutate();
          }}
          className="absolute right-1 top-1 z-10 flex h-6 w-6 items-center justify-center rounded-full bg-black/70 opacity-0 transition-opacity hover:bg-pitflix-primary/80 group-hover:opacity-100 disabled:opacity-40"
        >
          {isPinned
            ? <PinOff className="h-3 w-3 text-pitflix-primary" />
            : <Pin className="h-3 w-3 text-white" />
          }
        </button>
        <button
          type="button"
          title="Hide from Coming Soon"
          onClick={(e) => {
            e.stopPropagation();
            onDismiss();
          }}
          className="absolute left-1 top-1 z-10 flex h-6 w-6 items-center justify-center rounded-full bg-black/70 opacity-0 transition-opacity hover:bg-rose-600/80 group-hover:opacity-100"
        >
          <X className="h-3 w-3 text-white" />
        </button>
      </div>
      <div className="space-y-1 p-2">
        <div className="flex items-start justify-between gap-1">
          <p className="line-clamp-2 text-xs font-semibold text-white">{item.title}</p>
          {item.seasonNumber != null && (
            <span className="shrink-0 rounded bg-pitflix-primary/20 px-1.5 py-0.5 text-[9px] font-bold uppercase tracking-wide text-pitflix-primary">
              S{item.seasonNumber}
            </span>
          )}
        </div>
        <p className="text-[10px] text-pitflix-subtle">
          {item.releaseDate} · ★ {formatRating(item.voteAverage)}
        </p>
        <p className="text-[10px] uppercase text-pitflix-muted">{item.mediaType}</p>
        <div className="w-full min-w-0">
          <AirDateCountdown airDate={item.releaseDate} layout="inline" compact />
        </div>
        {/* Trailer button */}
        <button
          type="button"
          disabled={trailerBusy}
          onClick={(e) => void handleTrailer(e)}
          className="mt-1 flex w-full items-center justify-center gap-1 rounded-lg border border-pitflix-primary/40 bg-pitflix-primary/10 py-1 text-[10px] font-semibold text-pitflix-primary transition-colors hover:bg-pitflix-primary/25 disabled:opacity-50"
        >
          {trailerBusy ? (
            <Spinner className="h-3 w-3" />
          ) : (
            <Clapperboard className="h-3 w-3" />
          )}
          {trailerBusy ? "Loading…" : "Trailer"}
        </button>
      </div>
    </div>
  );
}

/** Returns today's date at midnight (local time) as a Date object. */
function todayMidnight() {
  const d = new Date();
  d.setHours(0, 0, 0, 0);
  return d;
}

type ComingSoonProps = { embedded?: boolean };

export function ComingSoonSection({ embedded = false }: ComingSoonProps) {
  const { dismissed, dismiss } = useDismissed();

  const q = useQuery({
    queryKey: ["home-coming-soon"],
    queryFn: getComingSoon,
    staleTime: 120_000,
  });

  const pinnedQ = useQuery({
    queryKey: ["pinned-coming-soon"],
    queryFn: getPinnedItems,
    staleTime: 30_000,
  });

  const pinnedMap = useMemo(() => {
    const m = new Map<number, number>();
    for (const p of pinnedQ.data ?? []) m.set(p.tmdbId, p.id);
    return m;
  }, [pinnedQ.data]);

  /** Filter helper: only items releasing today → +30 days, sorted by date then title, excluding dismissed. */
  function filterAndSort(list: ComingSoonItem[]) {
    const today = todayMidnight();
    const cutoff = new Date(today);
    cutoff.setDate(cutoff.getDate() + 30);

    return [...list]
      .filter((item) => {
        if (!item.releaseDate) return false;
        if (dismissed.has(dismissKey(item))) return false;
        const d = new Date(item.releaseDate);
        return d >= today && d <= cutoff;
      })
      .sort((a, b) => {
        const da = a.releaseDate ?? "";
        const db = b.releaseDate ?? "";
        if (da !== db) return da.localeCompare(db);
        return a.title.localeCompare(b.title, undefined, { sensitivity: "base" });
      });
  }

  const movies = useMemo(() => filterAndSort(q.data?.movies ?? []), [q.data?.movies, dismissed]);
  const tv = useMemo(() => filterAndSort(q.data?.tv ?? []), [q.data?.tv, dismissed]);

  const wrapClass = embedded
    ? ""
    : "rounded-2xl border border-pitflix-card/40 bg-gradient-to-b from-zinc-950/80 to-pitflix-bg/20 p-6";

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
        Nothing releasing in the next 30 days.
      </div>
    );
  }

  return (
    <div className={wrapClass}>
      {embedded ? null : (
        <div className="mb-4 flex items-center gap-2">
          <CalendarClock className="h-5 w-5 text-pitflix-primary" />
          <h2 className="text-lg font-bold text-white">Coming soon</h2>
          <span className="text-xs text-pitflix-subtle">Next 30 days</span>
        </div>
      )}
      <div className="space-y-4">
        {movies.length > 0 ? (
          <div>
            <p className="mb-2 text-xs font-semibold uppercase tracking-wide text-pitflix-muted">Movies</p>
            <HorizontalScrollRow hideHeader className="mb-0" contentClassName="gap-3 pb-2">
              {movies.map((m) => (
                <Card key={`m-${m.tmdbId}`} item={m} pinnedId={pinnedMap.get(m.tmdbId)} onDismiss={() => dismiss(dismissKey(m))} />
              ))}
            </HorizontalScrollRow>
          </div>
        ) : null}
        {tv.length > 0 ? (
          <div>
            <p className="mb-2 text-xs font-semibold uppercase tracking-wide text-pitflix-muted">Series</p>
            <HorizontalScrollRow hideHeader className="mb-0" contentClassName="gap-3 pb-2">
              {tv.map((t) => (
                <Card key={`t-${t.tmdbId}`} item={t} pinnedId={pinnedMap.get(t.tmdbId)} onDismiss={() => dismiss(dismissKey(t))} />
              ))}
            </HorizontalScrollRow>
          </div>
        ) : null}
      </div>
    </div>
  );
}
