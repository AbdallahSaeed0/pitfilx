import { useQuery } from "@tanstack/react-query";
import { ChevronRight, Play } from "lucide-react";
import { Link } from "react-router-dom";
import { getWatchingCurrently, type WatchingCurrentlyCard } from "../../api/homeDiscover";
import { MediaImage } from "../../components/ui/MediaImage";
import { Spinner } from "../../components/ui/Spinner";
import { cn } from "../../utils/cn";
import { toPosterSrc } from "../../utils/posterSrc";

type Props = { embedded?: boolean };

export function WatchingCurrentlySection({ embedded = false }: Props) {
  const q = useQuery({
    queryKey: ["home-watching-currently"],
    queryFn: getWatchingCurrently,
    staleTime: 45_000,
  });

  if (q.isLoading)
    return (
      <div className={embedded ? "py-2" : "rounded-2xl border border-pitflix-card/40 bg-pitflix-surface/30 p-6"}>
        <div className="flex items-center gap-2 text-sm text-pitflix-subtle">
          <Spinner className="h-5 w-5" /> Loading series…
        </div>
      </div>
    );

  if (q.isError)
    return (
      <div className={embedded ? "py-2 text-sm text-rose-100/90" : "rounded-2xl border border-rose-500/30 p-6 text-sm text-rose-100/90"}>
        Could not load watching list. Is Pitflix.API running?
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
        When you watch episodes, series you haven’t finished appear here with progress across your library files.
      </div>
    );
  }

  return (
    <div
      className={cn(
        embedded ? "" : "rounded-2xl border border-violet-500/25 bg-gradient-to-br from-violet-950/45 via-pitflix-bg/30 to-zinc-950/40 p-6 shadow-xl shadow-black/35",
      )}
    >
      {embedded ? null : (
        <div className="mb-5 flex flex-wrap items-center gap-2">
          <Play className="h-5 w-5 shrink-0 text-violet-300" />
          <h2 className="text-lg font-bold text-white md:text-xl">Watching currently</h2>
          <span className="text-xs text-pitflix-subtle">Latest activity · continue from next unwatched</span>
          <Link
            to="/series"
            className="ml-auto inline-flex items-center gap-1 text-xs font-semibold text-violet-300 hover:underline"
          >
            Browse series
            <ChevronRight className="h-3.5 w-3.5" />
          </Link>
        </div>
      )}
      <div
        className={cn(
          "-mx-1 flex gap-3 overflow-x-auto overflow-y-visible pb-1.5 pt-0.5",
          "[scrollbar-color:rgba(139,92,246,0.45)_rgba(15,15,20,0.85)] [scrollbar-width:thin]",
          "[&::-webkit-scrollbar]:h-2 [&::-webkit-scrollbar-thumb]:rounded-full [&::-webkit-scrollbar-thumb]:bg-violet-500/45",
          "[&::-webkit-scrollbar-thumb]:hover:bg-violet-400/55 [&::-webkit-scrollbar-track]:rounded-full [&::-webkit-scrollbar-track]:bg-black/45",
        )}
      >
        {list.map((card) => (
          <WatchingCard key={card.libraryShowId} card={card} />
        ))}
      </div>
    </div>
  );
}

function continueSeasonRoute(card: WatchingCurrentlyCard): string {
  let s = card.nextSeason;
  if (!Number.isFinite(s) || s <= 0) {
    const m = /^S(\d+)/i.exec((card.nextLabel ?? "").trim());
    if (m) s = parseInt(m[1]!, 10);
  }
  if (Number.isFinite(s) && s > 0) return `/series/${card.libraryShowId}/season/${s}`;
  return `/series/${card.libraryShowId}`;
}

function WatchingCard({ card }: { card: WatchingCurrentlyCard }) {
  const pct = Math.round(Math.min(100, Math.max(0, (card.progressFraction ?? 0) * 100)));
  const poster = toPosterSrc(card.posterUrl ?? undefined);
  const continueTo = continueSeasonRoute(card);

  return (
    <div className="group flex w-[min(100%,248px)] shrink-0 flex-row gap-3 overflow-hidden rounded-xl border border-violet-500/25 bg-black/40 shadow-md ring-1 ring-white/5 transition-transform hover:-translate-y-0.5 hover:border-violet-400/40 sm:w-[240px]">
      <div className="relative h-[112px] w-[76px] shrink-0 overflow-hidden">
        <Link
          to={`/series/${card.libraryShowId}`}
          className="absolute inset-0 z-10 focus:outline-none focus:ring-2 focus:ring-violet-400/60"
          aria-label={`Open ${card.showTitle}`}
        />
        <MediaImage
          src={poster}
          alt=""
          className="h-full w-full object-cover transition-transform duration-300 group-hover:scale-[1.02]"
          fallbackText={card.showTitle.slice(0, 3)}
        />
        <div className="pointer-events-none absolute inset-0 bg-gradient-to-t from-black/80 via-transparent to-transparent" />
      </div>
      <div className="flex min-w-0 flex-1 flex-col gap-1.5 py-2 pr-2">
        <Link to={`/series/${card.libraryShowId}`} className="block min-h-0">
          <p className="line-clamp-2 text-[13px] font-bold leading-tight text-white hover:text-violet-200">{card.showTitle}</p>
        </Link>
        <div className="space-y-0.5 text-[10px] leading-tight">
          <p className="text-pitflix-muted">
            Last{" "}
            <span className="font-mono font-semibold text-violet-200/95">{card.lastWatchedLabel}</span>
          </p>
          <p className="text-pitflix-muted">
            Next{" "}
            <span className="font-mono font-semibold text-white">{card.nextLabel.replace(/^S/i, "S")}</span>
          </p>
        </div>
        <div className="mt-auto space-y-1">
          <div className="h-1.5 w-full overflow-hidden rounded-full bg-pitflix-bg">
            <div
              className="h-full rounded-full bg-gradient-to-r from-violet-600 to-fuchsia-500 transition-[width]"
              style={{ width: `${pct}%` }}
            />
          </div>
          <p className="text-[9px] text-pitflix-muted">
            <span className="tabular-nums text-white/90">{card.watchedEpisodes ?? 0}</span>
            <span className="text-pitflix-subtle"> / </span>
            <span className="tabular-nums text-white/90">{card.totalEpisodes ?? 0}</span>
            <span className="text-pitflix-subtle"> eps</span>
          </p>
        </div>
        <Link
          to={continueTo}
          className="inline-flex w-full items-center justify-center rounded-md bg-violet-600/90 py-1.5 text-[10px] font-semibold text-white transition-colors hover:bg-violet-500"
        >
          Continue
        </Link>
      </div>
    </div>
  );
}
