import { useEffect, useRef, useState, type RefObject } from "react";
import { useQuery } from "@tanstack/react-query";
import { Check, Play, X } from "lucide-react";
import { getShowSeason, type NextLibraryEpisode } from "../../api/series";
import { toPosterSrc } from "../../utils/posterSrc";

/** Seconds the "Play next" countdown runs before advancing on its own. */
export const END_SCREEN_COUNTDOWN_SECONDS = 10;

type SeasonEpisode = {
  episodeNumber: number;
  title?: string | null;
  overview?: string | null;
  runtimeMinutes?: number | null;
  stillLocalPath?: string | null;
  stillUrl?: string | null;
  watchStatus?: string;
  inLibrary?: boolean;
};

/** Where the shrunken video sits (CSS px, relative to the window) — also the hole in the backdrop. */
export function endScreenVideoBox(viewportWidth: number) {
  const width = Math.round(Math.min(480, Math.max(300, viewportWidth * 0.3)));
  return { left: 48, top: 64, width, height: Math.round((width * 9) / 16) };
}

/**
 * End-of-episode screen (embedded engine only). The libmpv video window sits UNDER the WebView, so
 * this overlay can cover it — except for a transparent box in the top-left that PlayerPage sizes
 * the native video to (via `videoBoxRef` + syncVideoBounds), so the credits keep playing there.
 */
export function PlayerEndOfEpisodeScreen({
  showId,
  showTitle,
  currentSeason,
  currentEpisode,
  currentTitle,
  remainingSeconds,
  paused,
  nextEp,
  videoBoxRef,
  onPlayNext,
  onWatchCredits,
  onBackToSeries,
  onClose,
}: {
  showId: number;
  showTitle: string;
  currentSeason: number | null;
  currentEpisode: number | null;
  currentTitle: string | null;
  remainingSeconds: number;
  paused: boolean;
  nextEp: NextLibraryEpisode;
  videoBoxRef: RefObject<HTMLDivElement | null>;
  onPlayNext: () => void;
  onWatchCredits: () => void;
  onBackToSeries: () => void;
  onClose: () => void;
}) {
  const [box, setBox] = useState(() => endScreenVideoBox(window.innerWidth));
  useEffect(() => {
    const onResize = () => setBox(endScreenVideoBox(window.innerWidth));
    window.addEventListener("resize", onResize);
    return () => window.removeEventListener("resize", onResize);
  }, []);

  // Countdown — holds while the video is paused, so stepping away doesn't skip ahead.
  const [left, setLeft] = useState(END_SCREEN_COUNTDOWN_SECONDS);
  const firedRef = useRef(false);
  useEffect(() => {
    if (paused || left <= 0) return;
    const t = window.setTimeout(() => setLeft((n) => n - 1), 1000);
    return () => window.clearTimeout(t);
  }, [left, paused]);
  useEffect(() => {
    if (left > 0 || firedRef.current) return;
    firedRef.current = true;
    onPlayNext();
  }, [left, onPlayNext]);

  const nextSeasonQ = useQuery({
    queryKey: ["show-season", showId, nextEp.season],
    queryFn: () => getShowSeason(showId, nextEp.season),
    staleTime: 10 * 60_000,
  });
  const currentSeasonQ = useQuery({
    queryKey: ["show-season", showId, currentSeason],
    queryFn: () => getShowSeason(showId, currentSeason!),
    enabled: currentSeason != null,
    staleTime: 10 * 60_000,
  });
  const nextMeta = ((nextSeasonQ.data?.episodes ?? []) as SeasonEpisode[]).find(
    (e) => e.episodeNumber === nextEp.episodeNumber,
  );
  const seasonEps = ((currentSeasonQ.data?.episodes ?? []) as SeasonEpisode[]).filter((e) => e.inLibrary !== false);
  const doneCount = seasonEps.filter(
    (e) => e.watchStatus === "Completed" || e.episodeNumber === currentEpisode,
  ).length;

  const still = toPosterSrc(nextMeta?.stillLocalPath ?? nextMeta?.stillUrl ?? undefined);
  const nextTitle = nextEp.title?.trim() || nextMeta?.title?.trim() || `Episode ${nextEp.episodeNumber}`;
  const newSeason = currentSeason != null && nextEp.season !== currentSeason;
  const remainLabel = (() => {
    const s = Math.max(0, Math.round(remainingSeconds));
    return `-${Math.floor(s / 60)}:${String(s % 60).padStart(2, "0")}`;
  })();

  // Backdrop with a rectangular hole where the native video shows through.
  const hole = {
    WebkitMaskImage: "linear-gradient(#000,#000), linear-gradient(#000,#000)",
    maskImage: "linear-gradient(#000,#000), linear-gradient(#000,#000)",
    WebkitMaskSize: `100% 100%, ${box.width}px ${box.height}px`,
    maskSize: `100% 100%, ${box.width}px ${box.height}px`,
    WebkitMaskPosition: `0 0, ${box.left}px ${box.top}px`,
    maskPosition: `0 0, ${box.left}px ${box.top}px`,
    WebkitMaskRepeat: "no-repeat",
    maskRepeat: "no-repeat",
    WebkitMaskComposite: "xor",
    maskComposite: "exclude",
  } as const;

  return (
    <div className="fixed inset-0 z-[80] text-white" role="dialog" aria-label={`Up next: ${nextTitle}`}>
      <div className="absolute inset-0 bg-[#0e0e10]" style={hole}>
        {still ? <img src={still} alt="" className="h-full w-full object-cover opacity-40" /> : null}
        <div className="absolute inset-0 bg-gradient-to-r from-[#0e0e10] via-[#0e0e10]/85 to-[#0e0e10]/45" />
      </div>

      {/* Stands in for the player's title bar this overlay covers: window drag + close. */}
      <div data-tauri-drag-region className="absolute inset-x-0 top-0 flex h-12 items-center justify-end px-3">
        <button
          type="button"
          aria-label="Close player"
          title="Close player"
          onClick={onClose}
          className="flex h-9 w-9 items-center justify-center rounded-lg text-white/70 transition hover:bg-white/10 hover:text-white"
        >
          <X className="h-4 w-4" />
        </button>
      </div>

      {/* The native video is resized to exactly this box (see PlayerPage syncVideoBounds). */}
      <div
        ref={videoBoxRef}
        className="absolute"
        style={{ left: box.left, top: box.top, width: box.width, height: box.height }}
      />
      <div
        className="pointer-events-none absolute rounded-[3px] ring-1 ring-white/25 shadow-[0_20px_50px_rgba(0,0,0,0.6)]"
        style={{ left: box.left, top: box.top, width: box.width, height: box.height }}
      />
      <div
        className="absolute flex justify-between text-[13px] text-white/65"
        style={{ left: box.left, top: box.top + box.height + 10, width: box.width }}
      >
        <span className="truncate pr-3">
          {currentSeason != null && currentEpisode != null ? `S${currentSeason} E${currentEpisode}` : ""}
          {currentTitle ? ` · ${currentTitle}` : ""} · credits
        </span>
        <span className="tabular-nums">{remainLabel}</span>
      </div>

      <div className="absolute bottom-16 left-12 right-12 flex max-w-[660px] flex-col gap-3.5">
        <span className="text-[13px] font-extrabold tracking-[0.12em] text-pitflix-light">
          {newSeason ? `SEASON ${nextEp.season} · NEXT EPISODE` : "NEXT EPISODE"}
        </span>
        <h2 className="text-4xl font-black leading-none tracking-tight md:text-[52px]">{nextTitle}</h2>
        <p className="text-[16px] text-white/75">
          {showTitle} · S{nextEp.season} E{nextEp.episodeNumber}
          {nextMeta?.runtimeMinutes ? ` · ${nextMeta.runtimeMinutes} min` : ""}
        </p>
        {nextMeta?.overview ? (
          <p className="line-clamp-3 text-[15px] leading-relaxed text-white/70">{nextMeta.overview}</p>
        ) : null}
        <div className="mt-2 flex flex-wrap gap-3">
          <button
            type="button"
            autoFocus
            onClick={() => {
              if (firedRef.current) return;
              firedRef.current = true;
              onPlayNext();
            }}
            className="relative flex h-14 items-center gap-2.5 overflow-hidden rounded-xl bg-white px-6 text-[16px] font-extrabold text-[#121214] hover:bg-white/90"
          >
            <span
              aria-hidden
              className="absolute inset-y-0 left-0 bg-pitflix-primary/25 transition-[width] duration-1000 ease-linear"
              style={{ width: `${((END_SCREEN_COUNTDOWN_SECONDS - left) / END_SCREEN_COUNTDOWN_SECONDS) * 100}%` }}
            />
            <Play className="relative h-[18px] w-[18px] fill-current" />
            <span className="relative">{paused ? "Play next" : `Play next in ${left}s`}</span>
          </button>
          <button
            type="button"
            onClick={onWatchCredits}
            className="h-14 rounded-xl border border-white/30 bg-white/[0.06] px-5 text-[15px] font-semibold hover:bg-white/[0.14]"
          >
            Watch credits
          </button>
          <button
            type="button"
            onClick={onBackToSeries}
            className="h-14 rounded-xl border border-white/30 bg-white/[0.06] px-5 text-[15px] font-semibold hover:bg-white/[0.14]"
          >
            Back to series
          </button>
        </div>
        <p className="flex items-center gap-2.5 text-[13px] text-white/60">
          <span className="flex h-[18px] w-[18px] items-center justify-center rounded-full bg-green-600">
            <Check className="h-3 w-3" />
          </span>
          {currentEpisode != null ? `Episode ${currentEpisode} marked as watched` : "Marked as watched"}
          {seasonEps.length > 0 ? ` · ${doneCount} of ${seasonEps.length} done` : ""}
        </p>
      </div>
    </div>
  );
}
