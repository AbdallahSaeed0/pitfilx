import { useQuery } from "@tanstack/react-query";
import { ChevronRight, CirclePlay, Play } from "lucide-react";
import { useEffect, useRef, useState } from "react";
import { Link } from "react-router-dom";
import { getLatestTrailers, type TrailerCard } from "../../api/homeDiscover";
import { TrailerModal } from "../../components/trailers/TrailerModal";
import { HorizontalScrollRow } from "../../components/ui/HorizontalScrollRow";
import { MediaImage } from "../../components/ui/MediaImage";
import { Spinner } from "../../components/ui/Spinner";
import { cn } from "../../utils/cn";

type LatestTrailersProps = { embedded?: boolean };

const STORAGE_KEY = "pitflix.home.trailers.latest.v1";
const NEW_BADGE_MS = 6000;

function trailerKey(t: TrailerCard) {
  return `${t.mediaType}-${t.tmdbId}-${t.youtubeKey}`;
}

/** Last successful fetch, persisted to disk so re-opening the app shows it instantly — no spinner. */
function loadCached(): TrailerCard[] | undefined {
  try {
    const raw = localStorage.getItem(STORAGE_KEY);
    if (!raw) return undefined;
    const parsed = JSON.parse(raw);
    return Array.isArray(parsed) ? (parsed as TrailerCard[]) : undefined;
  } catch {
    return undefined;
  }
}

function saveCached(list: TrailerCard[]) {
  try {
    localStorage.setItem(STORAGE_KEY, JSON.stringify(list));
  } catch {
    /* storage full / disabled — non-fatal, just skip persistence */
  }
}

export function LatestTrailersSection({ embedded = false }: LatestTrailersProps) {
  const [active, setActive] = useState<TrailerCard | null>(null);
  const [newKeys, setNewKeys] = useState<Set<string>>(() => new Set());
  const seenKeysRef = useRef<Set<string> | null>(null);
  const newBadgeTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null);

  const q = useQuery({
    queryKey: ["home-trailers", "persisted-v1"],
    queryFn: getLatestTrailers,
    initialData: loadCached,
    staleTime: 30 * 60_000,   // trailers list is stable; show cached data for 30 min
    gcTime: 2 * 60 * 60_000,  // keep in memory for 2 hours
    refetchInterval: 30 * 60_000, // background poll every 30 min
    refetchOnMount: false,     // never block on mount if data is already in cache
  });

  // Persist every successful fetch, and flag genuinely new trailers for a brief highlight
  // instead of silently swapping the row out from under the user.
  useEffect(() => {
    if (!q.data) return;
    const keys = q.data.map(trailerKey);

    if (seenKeysRef.current != null) {
      const previouslySeen = seenKeysRef.current;
      const added = keys.filter((k) => !previouslySeen.has(k));
      if (added.length > 0) {
        setNewKeys(new Set(added));
        if (newBadgeTimerRef.current) clearTimeout(newBadgeTimerRef.current);
        newBadgeTimerRef.current = setTimeout(() => setNewKeys(new Set()), NEW_BADGE_MS);
      }
    }
    seenKeysRef.current = new Set(keys);
    saveCached(q.data);
  }, [q.data]);

  useEffect(() => () => {
    if (newBadgeTimerRef.current) clearTimeout(newBadgeTimerRef.current);
  }, []);

  if (q.isPending)
    return (
      <div className={embedded ? "py-2" : "rounded-2xl border border-pitflix-card/40 bg-pitflix-surface/30 p-6"}>
        <div className="flex items-center gap-2 text-sm text-pitflix-subtle">
          <Spinner className="h-5 w-5" /> Loading trailers…
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
        <p>Could not load trailers.</p>
        <p className="mt-1 text-xs text-pitflix-muted">
          {q.error instanceof Error ? q.error.message : "Request failed — is Pitflix.API running?"}
        </p>
      </div>
    );

  const list = q.data ?? [];
  if (list.length === 0) {
    return (
      <div
        className={
          embedded
            ? "py-2 text-sm text-pitflix-subtle"
            : "rounded-2xl border border-dashed border-pitflix-card/50 bg-pitflix-bg/40 p-6 text-sm text-pitflix-subtle"
        }
      >
        No ingested trailers in the library yet — run trailer ingestion on the API, then refresh.
      </div>
    );
  }

  return (
    <div
      className={
        embedded ? "" : "rounded-2xl border border-pitflix-card/40 bg-gradient-to-b from-zinc-950/80 to-pitflix-bg/20 p-6"
      }
    >
      {embedded ? null : (
        <div className="mb-4 flex flex-wrap items-center gap-2">
          <Play className="h-5 w-5 shrink-0 text-pitflix-primary" />
          <h2 className="text-lg font-bold text-white">Latest trailers</h2>
          <span className="text-xs text-pitflix-subtle">Official-channel ingest, newest YouTube publish first</span>
          <Link
            to="/trailers?mode=latest"
            className="ml-auto inline-flex items-center gap-1 text-xs font-semibold text-pitflix-primary hover:underline"
          >
            Browse all
            <ChevronRight className="h-3.5 w-3.5" />
          </Link>
        </div>
      )}
      <HorizontalScrollRow hideHeader className="mb-0" contentClassName="gap-3 pb-2">
        {list.map((t) => {
          // Trailer row should look like trailer media, not wallpaper.
          const youtubeThumb = `https://img.youtube.com/vi/${t.youtubeKey}/hqdefault.jpg`;
          const thumb = youtubeThumb || t.posterUrl || t.backdropUrl;
          const key = trailerKey(t);
          const isNew = newKeys.has(key);
          return (
            <button
              key={key}
              type="button"
              onClick={() => setActive(t)}
              className={cn(
                "group relative w-[200px] shrink-0 overflow-hidden rounded-xl border bg-black/40 text-left shadow-lg transition-colors hover:border-pitflix-primary/40",
                isNew ? "border-pitflix-primary/70 ring-2 ring-pitflix-primary/50" : "border-pitflix-card/60",
              )}
            >
              <MediaImage src={thumb} alt="" className="aspect-video w-full object-cover" fallbackText="▶" />
              <div className="absolute inset-0 flex items-center justify-center bg-black/35 opacity-90 transition-opacity group-hover:bg-black/50">
                <CirclePlay className="h-8 w-8 text-white drop-shadow-lg" />
              </div>
              {isNew ? (
                <span className="absolute right-1.5 top-1.5 rounded-full bg-pitflix-primary px-1.5 py-0.5 text-[9px] font-bold uppercase tracking-wide text-white shadow">
                  New
                </span>
              ) : null}
              <div className="space-y-0.5 p-2">
                <p className="line-clamp-2 text-xs font-semibold text-white">{t.title}</p>
                <p className="line-clamp-1 text-[10px] text-pitflix-subtle">{t.trailerTitle}</p>
                {t.trailerPublishedAtUtc ? (
                  <p className="text-[9px] text-pitflix-muted">
                    Published{" "}
                    {new Date(t.trailerPublishedAtUtc).toLocaleDateString(undefined, {
                      month: "short",
                      day: "numeric",
                      year: "numeric",
                    })}
                  </p>
                ) : null}
              </div>
            </button>
          );
        })}
      </HorizontalScrollRow>
      <TrailerModal open={!!active} onClose={() => setActive(null)} trailer={active} />
    </div>
  );
}
