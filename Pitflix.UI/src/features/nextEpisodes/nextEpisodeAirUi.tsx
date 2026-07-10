import { Pin } from "lucide-react";
import type { ReactNode } from "react";
import { Link } from "react-router-dom";
import { AirDateCountdown } from "../../components/ui/AirDateCountdown";
import { MediaImage } from "../../components/ui/MediaImage";
import { formatAirDateForDisplay } from "../../hooks/useCountdown";
import type { StreamingDetailsLocationState } from "../../pages/StreamingDetailsPage";
import { cn } from "../../utils/cn";

export function nextEpisodeStreamDetailsState(row: {
  showTmdbId: number;
  showTitle: string;
  posterUrl?: string | null;
}): StreamingDetailsLocationState {
  return {
    tmdbId: row.showTmdbId,
    mediaType: "Series",
    title: row.showTitle,
    posterUrl: row.posterUrl ?? null,
  };
}

export function SeasonEpisodeBadge({
  season,
  episodeNumber,
  className,
}: {
  season: number | null | undefined;
  episodeNumber: number | null | undefined;
  className?: string;
}) {
  const s = season ?? "?";
  const e = episodeNumber ?? "?";
  return (
    <span
      className={cn(
        "inline-flex shrink-0 items-center rounded-md bg-white/10 px-1.5 py-0.5 text-[10px] font-semibold tabular-nums text-white/90 ring-1 ring-white/10",
        className,
      )}
    >
      S{s}E{e}
    </span>
  );
}

const rowShell = (interactive: boolean, pinned: boolean) =>
  cn(
    "group relative overflow-hidden rounded-2xl border transition-colors",
    pinned
      ? "border-pitflix-primary/40 bg-gradient-to-br from-pitflix-primary/[0.12] to-pitflix-surface/50 shadow-[inset_0_1px_0_0_rgba(255,255,255,0.06)]"
      : "border-white/[0.08] bg-pitflix-surface/45 hover:border-pitflix-primary/35 hover:bg-pitflix-surface/65",
    interactive && "cursor-pointer",
  );

type AirRowBodyProps = {
  showTitle: string;
  episodeTitle?: string | null;
  season: number | null | undefined;
  episodeNumber: number | null | undefined;
  airDate: string;
  posterUrl?: string | null;
  pinned?: boolean;
  kind?: "library" | "followed";
  /** Extra badges beside title row */
  extraBadges?: ReactNode;
};

export function NextEpisodeAirRowBody({
  showTitle,
  episodeTitle,
  season,
  episodeNumber,
  airDate,
  posterUrl,
  pinned,
  kind,
  extraBadges,
}: AirRowBodyProps) {
  return (
    <div className="flex min-w-0 flex-1 items-center gap-3 sm:gap-4">
      <div className="relative h-[4.5rem] w-12 shrink-0 overflow-hidden rounded-lg bg-pitflix-card shadow-inner ring-1 ring-black/20 sm:h-[5rem] sm:w-[3.25rem]">
        <MediaImage src={posterUrl ?? undefined} alt="" className="h-full w-full object-cover" fallbackText="TV" />
        {pinned ? (
          <span className="absolute right-0.5 top-0.5 flex h-5 w-5 items-center justify-center rounded-md bg-pitflix-primary/90 text-white shadow-md ring-1 ring-black/30">
            <Pin className="h-3 w-3" aria-hidden />
          </span>
        ) : null}
      </div>
      <div className="min-w-0 flex-1">
        <div className="flex flex-wrap items-center gap-2 gap-y-1">
          <p className="truncate font-semibold leading-tight text-white">{showTitle}</p>
          {extraBadges}
          {kind === "followed" ? (
            <span className="rounded-md bg-violet-500/20 px-1.5 py-px text-[10px] font-medium uppercase tracking-wide text-violet-200/90 ring-1 ring-violet-400/25">
              Followed
            </span>
          ) : null}
        </div>
        <p className="mt-0.5 truncate text-xs text-pitflix-subtle">
          <span className="text-pitflix-muted/90">{episodeTitle?.trim() || "Episode"}</span>
          <span className="mx-1.5 text-pitflix-muted/40">·</span>
          <SeasonEpisodeBadge season={season} episodeNumber={episodeNumber} className="align-middle" />
        </p>
      </div>
      <div className="shrink-0 text-right">
        <p className="text-[11px] font-medium tabular-nums text-pitflix-muted" title={airDate}>
          {formatAirDateForDisplay(airDate)}
        </p>
        <div className="mt-1 flex justify-end">
          <AirDateCountdown airDate={airDate} layout="segments" />
        </div>
      </div>
    </div>
  );
}

type LinkedAirRowProps = AirRowBodyProps & {
  libraryShowId: number | null | undefined;
  showTmdbId: number;
  className?: string;
};

/** Full-width clickable row for home embed / lists */
export function NextEpisodeAirRowLink({
  libraryShowId,
  showTmdbId,
  showTitle,
  posterUrl,
  className,
  ...body
}: LinkedAirRowProps) {
  const lib = libraryShowId != null;
  const shell = cn(rowShell(true, !!body.pinned), "block p-3 sm:p-4", className);
  const inner = <NextEpisodeAirRowBody showTitle={showTitle} posterUrl={posterUrl} {...body} />;
  if (lib) {
    return (
      <Link to={`/series/${libraryShowId}`} className={shell}>
        {inner}
      </Link>
    );
  }
  return (
    <Link
      to="/stream-details"
      state={nextEpisodeStreamDetailsState({ showTmdbId, showTitle, posterUrl })}
      className={shell}
    >
      {inner}
    </Link>
  );
}

type PageAirRowProps = AirRowBodyProps & {
  libraryShowId: number | null | undefined;
  showTmdbId: number;
  onTogglePin?: (libraryShowId: number, pin: boolean) => void;
};

/** Schedule row with actions — used on Next episodes page */
export function NextEpisodeAirRowInteractive({
  libraryShowId,
  showTmdbId,
  onTogglePin,
  pinned,
  showTitle,
  posterUrl,
  ...body
}: PageAirRowProps) {
  const lib = libraryShowId != null;
  const streamState = !lib
    ? nextEpisodeStreamDetailsState({ showTmdbId, showTitle, posterUrl })
    : null;
  return (
    <div className={cn(rowShell(false, !!pinned), "p-3 sm:p-4")}>
      {lib ? (
        <Link to={`/series/${libraryShowId}`} className="block rounded-xl focus:outline-none focus-visible:ring-2 focus-visible:ring-pitflix-primary/50">
          <NextEpisodeAirRowBody showTitle={showTitle} posterUrl={posterUrl} pinned={pinned} {...body} />
        </Link>
      ) : (
        <Link
          to="/stream-details"
          state={streamState!}
          className="block rounded-xl focus:outline-none focus-visible:ring-2 focus-visible:ring-pitflix-primary/50"
        >
          <NextEpisodeAirRowBody showTitle={showTitle} posterUrl={posterUrl} pinned={pinned} {...body} />
        </Link>
      )}
      <div className="mt-3 flex flex-wrap items-center justify-end gap-2 border-t border-white/[0.06] pt-3">
        {lib ? (
          <Link
            to={`/series/${libraryShowId}`}
            className="inline-flex items-center justify-center rounded-lg border border-white/15 bg-white/5 px-3 py-1.5 text-xs font-medium text-pitflix-subtle transition-colors hover:border-pitflix-primary/40 hover:bg-white/10 hover:text-white"
          >
            Series
          </Link>
        ) : (
          <Link
            to="/stream-details"
            state={streamState!}
            className="inline-flex items-center justify-center rounded-lg border border-white/15 bg-white/5 px-3 py-1.5 text-xs font-medium text-pitflix-subtle transition-colors hover:border-pitflix-primary/40 hover:bg-white/10 hover:text-white"
          >
            Stream
          </Link>
        )}
        {lib && onTogglePin && libraryShowId ? (
          <button
            type="button"
            onClick={() => onTogglePin(libraryShowId, !pinned)}
            className={cn(
              "inline-flex items-center gap-1.5 rounded-lg px-3 py-1.5 text-xs font-semibold transition-colors",
              pinned
                ? "bg-pitflix-primary/25 text-pitflix-primary hover:bg-pitflix-primary/35"
                : "bg-white/10 text-white/90 hover:bg-pitflix-primary/20 hover:text-pitflix-primary",
            )}
          >
            <Pin className={cn("h-3.5 w-3.5", pinned && "fill-current")} />
            {pinned ? "Pinned" : "Pin"}
          </button>
        ) : null}
      </div>
    </div>
  );
}
