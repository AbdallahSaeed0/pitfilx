import { useEffect, useState } from "react";

/** How long a pause must hold before the info screen appears — a quick pause/resume (scrubbing,
 * a stray key press) shouldn't flash the whole screen. */
const SHOW_DELAY_MS = 7000;

type PlayerPauseInfoOverlayProps = {
  visible: boolean;
  /** Show/movie display title. */
  title: string;
  /** Season number, when playing a TV episode. */
  season?: number | null;
  /** Episode number, when playing a TV episode. */
  episodeNumber?: number | null;
  /** The episode's own title (e.g. "Chapter One: The End's Beginning") — omitted for movies. */
  episodeTitle?: string | null;
  /** Synopsis / overview text, when available. */
  overview?: string | null;
  /** Episode still (TV) or poster (movie) image src, already resolved to a loadable URL. Falls
   * back to the paused video frame showing through (plain gradient) when unavailable. */
  backdropSrc?: string | null;
};

/**
 * Netflix-style "You're watching" info screen shown while playback is paused. Purely
 * decorative — `pointer-events-none` throughout — so it never blocks clicks meant for the
 * seek bar/buttons/video underneath. Kept mounted at all times and faded via opacity (matching
 * the header/footer chrome's own transition) so pause/resume feels instant rather than a mount
 * flash.
 */
export function PlayerPauseInfoOverlay({
  visible,
  title,
  season,
  episodeNumber,
  episodeTitle,
  overview,
  backdropSrc,
}: PlayerPauseInfoOverlayProps) {
  const seasonEpLine = season != null && episodeNumber != null ? `S${season} E${episodeNumber}` : null;

  // Hiding is instant (no delay) so resuming always feels immediate — only showing is delayed.
  const [shown, setShown] = useState(false);
  useEffect(() => {
    if (!visible) {
      setShown(false);
      return;
    }
    const t = setTimeout(() => setShown(true), SHOW_DELAY_MS);
    return () => clearTimeout(t);
  }, [visible]);

  return (
    <div
      className={`pointer-events-none absolute inset-0 z-[8] overflow-hidden transition-opacity duration-[450ms] ease-out ${
        shown ? "opacity-100" : "opacity-0"
      }`}
      inert={shown ? undefined : true}
      aria-hidden={shown ? undefined : true}
    >
      {backdropSrc ? (
        <img src={backdropSrc} alt="" className="absolute inset-0 h-full w-full bg-black object-cover" />
      ) : null}
      <div
        className="absolute inset-0"
        style={{
          background: backdropSrc
            ? "linear-gradient(to right, rgba(0,0,0,0.88) 0%, rgba(0,0,0,0.55) 45%, rgba(0,0,0,0.2) 75%, rgba(0,0,0,0.35) 100%)"
            : "linear-gradient(to right, rgba(0,0,0,0.8) 0%, rgba(0,0,0,0.6) 45%, transparent 85%)",
        }}
      />
      <div className="relative flex h-full items-center">
        <div className="max-w-[38rem] px-16">
          <p className="text-sm font-semibold uppercase tracking-wide text-pitflix-primary">You&apos;re watching</p>
          <h2 className="mt-1.5 text-4xl font-bold leading-tight text-white [text-wrap:balance]">{title}</h2>
          {seasonEpLine ? <p className="mt-1.5 text-base font-semibold text-white/75">{seasonEpLine}</p> : null}
          {episodeTitle ? (
            <p className="mt-3.5 text-lg font-semibold text-white">{episodeTitle}</p>
          ) : null}
          {overview ? (
            <p className="mt-1.5 line-clamp-3 text-sm leading-snug text-white/70">{overview}</p>
          ) : null}
        </div>
      </div>
    </div>
  );
}
