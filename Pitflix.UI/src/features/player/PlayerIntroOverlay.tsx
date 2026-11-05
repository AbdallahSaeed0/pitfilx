import { useEffect, useState } from "react";

/**
 * Opening card for the embedded Pitflix Player. While the file loads it shows the title's art with a
 * slow push-in, the title / episode line and a slim loading sweep; once playback is running it
 * dissolves (fade + slight zoom-through) to reveal the video.
 *
 * This is a real crossfade into the picture: the embedded libmpv video window sits BELOW the
 * transparent WebView (HWND_BOTTOM in libmpv_session.rs), so this HTML layer can cover the live video
 * and fade away over it. Only used for the embedded engine — external mpv is placed above the
 * WebView, where nothing HTML can cover it.
 */

/** Fade from the intro card into the playing video — quick, the video is already running under it. */
const REVEAL_MS = 400;

type Props = {
  /** True while the video is still settling (loading + a short grace period). */
  active: boolean;
  /** Show name for episodes, movie title otherwise. */
  title: string;
  /** Episode title (episodes only). */
  episodeTitle?: string | null;
  season?: number | null;
  episodeNumber?: number | null;
  backdropSrc?: string | null;
};

export function PlayerIntroOverlay({ active, title, episodeTitle, season, episodeNumber, backdropSrc }: Props) {
  // "intro" while loading → "reveal" (fading out over the playing video) → unmounted.
  const [phase, setPhase] = useState<"intro" | "reveal" | "done">(active ? "intro" : "done");

  useEffect(() => {
    if (active) {
      setPhase("intro");
      return;
    }
    setPhase((p) => (p === "done" ? "done" : "reveal"));
    const t = window.setTimeout(() => setPhase("done"), REVEAL_MS);
    return () => window.clearTimeout(t);
  }, [active]);

  if (phase === "done") return null;
  const revealing = phase === "reveal";
  const episodeLine =
    season != null && episodeNumber != null
      ? `S${season} · E${episodeNumber}${episodeTitle ? ` · ${episodeTitle}` : ""}`
      : episodeTitle ?? null;

  return (
    <div
      className="pointer-events-none absolute inset-0 z-10 overflow-hidden bg-black"
      style={{
        opacity: revealing ? 0 : 1,
        transform: revealing ? "scale(1.04)" : "scale(1)",
        transition: `opacity ${REVEAL_MS}ms cubic-bezier(0.4, 0, 0.2, 1), transform ${REVEAL_MS}ms cubic-bezier(0.4, 0, 0.2, 1)`,
      }}
      aria-hidden="true"
    >
      <style>{`
        @keyframes pf-intro-push { from { transform: scale(1.12); } to { transform: scale(1.0); } }
        @keyframes pf-intro-in { from { opacity: 0; } to { opacity: 1; } }
        @keyframes pf-intro-rise { from { opacity: 0; transform: translateY(14px); } to { opacity: 1; transform: translateY(0); } }
        @keyframes pf-intro-sweep { 0% { transform: translateX(-100%); } 100% { transform: translateX(250%); } }
        @media (prefers-reduced-motion: reduce) {
          .pf-intro-anim { animation: pf-intro-in 400ms ease-out both !important; }
        }
      `}</style>

      {backdropSrc ? (
        <img
          src={backdropSrc}
          alt=""
          className="pf-intro-anim absolute inset-0 h-full w-full object-cover"
          style={{ animation: "pf-intro-in 700ms ease-out both, pf-intro-push 9s cubic-bezier(0.2, 0.6, 0.2, 1) both", filter: "saturate(1.1)" }}
        />
      ) : null}
      {/* Cinematic grade: vignette + bottom shade so the title reads on any art. */}
      <div
        className="absolute inset-0"
        style={{
          background:
            "radial-gradient(120% 90% at 50% 40%, rgba(0,0,0,0.15) 0%, rgba(0,0,0,0.55) 60%, rgba(0,0,0,0.92) 100%)",
        }}
      />
      <div className="absolute inset-x-0 bottom-0 h-2/3 bg-gradient-to-t from-black via-black/70 to-transparent" />

      <div className="absolute inset-x-0 bottom-[14%] flex flex-col items-center px-8 text-center">
        <p
          className="pf-intro-anim text-[11px] font-semibold uppercase tracking-[0.32em] text-violet-300/90"
          style={{ animation: "pf-intro-rise 700ms 150ms cubic-bezier(0.2, 0.8, 0.2, 1) both" }}
        >
          Now playing
        </p>
        <h1
          className="pf-intro-anim mt-3 max-w-4xl text-4xl font-bold leading-tight text-white drop-shadow-[0_4px_24px_rgba(0,0,0,0.8)] md:text-5xl"
          style={{ animation: "pf-intro-rise 800ms 250ms cubic-bezier(0.2, 0.8, 0.2, 1) both" }}
        >
          {title}
        </h1>
        {episodeLine ? (
          <p
            className="pf-intro-anim mt-3 text-base text-white/70"
            style={{ animation: "pf-intro-rise 800ms 400ms cubic-bezier(0.2, 0.8, 0.2, 1) both" }}
          >
            {episodeLine}
          </p>
        ) : null}
        {/* Slim loading sweep — calmer than a spinner. */}
        <div
          className="pf-intro-anim relative mt-7 h-[2px] w-40 overflow-hidden rounded-full bg-white/15"
          style={{ animation: "pf-intro-in 600ms 550ms ease-out both" }}
        >
          <div
            className="absolute inset-y-0 left-0 w-1/3 rounded-full bg-gradient-to-r from-transparent via-violet-300 to-transparent"
            style={{ animation: "pf-intro-sweep 1.4s ease-in-out infinite" }}
          />
        </div>
      </div>
    </div>
  );
}
