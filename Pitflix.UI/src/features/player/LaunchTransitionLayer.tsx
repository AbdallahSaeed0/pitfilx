import { useEffect, useState, type CSSProperties } from "react";
import { COLLAPSE_MS, EXPAND_MS, useLaunchTransition } from "./launchTransition";

/** Smooth "settle" curve — fast start, long gentle landing. */
const EASE = "cubic-bezier(0.22, 1, 0.36, 1)";

/**
 * The card that grows from the clicked element into the full player (and shrinks back on close).
 * Mounted once at the app root — see launchTransition.ts for the flow.
 */
export function LaunchTransitionLayer() {
  const { phase, origin, image, title, runId } = useLaunchTransition();
  // For "expand" the card must first paint AT the origin, then move — `armed` flips one frame later.
  const [armed, setArmed] = useState(false);

  useEffect(() => {
    setArmed(false);
    if (phase !== "expand" && phase !== "collapse") return;
    let raf2 = 0;
    const raf1 = requestAnimationFrame(() => {
      raf2 = requestAnimationFrame(() => setArmed(true));
    });
    return () => {
      cancelAnimationFrame(raf1);
      cancelAnimationFrame(raf2);
    };
  }, [phase, runId]);

  if (phase === "idle" || !origin) return null;

  const full: CSSProperties = { left: 0, top: 0, width: "100vw", height: "100vh", borderRadius: 0 };
  const atOrigin: CSSProperties = {
    left: origin.left,
    top: origin.top,
    width: origin.width,
    height: origin.height,
    borderRadius: 14,
  };

  let box: CSSProperties;
  let transition = "none";
  let opacity = 1;
  if (phase === "expand") {
    box = armed ? full : atOrigin;
    transition = armed
      ? `left ${EXPAND_MS}ms ${EASE}, top ${EXPAND_MS}ms ${EASE}, width ${EXPAND_MS}ms ${EASE}, height ${EXPAND_MS}ms ${EASE}, border-radius ${EXPAND_MS}ms ${EASE}`
      : "none";
  } else if (phase === "collapse") {
    box = armed ? atOrigin : full;
    opacity = armed ? 0 : 1;
    transition = armed
      ? `left ${COLLAPSE_MS}ms ${EASE}, top ${COLLAPSE_MS}ms ${EASE}, width ${COLLAPSE_MS}ms ${EASE}, height ${COLLAPSE_MS}ms ${EASE}, border-radius ${COLLAPSE_MS}ms ${EASE}, opacity 200ms ease-in ${COLLAPSE_MS - 200}ms`
      : "none";
  } else {
    // cover / handoff: full screen; handoff fades out over the player's own intro.
    box = full;
    opacity = phase === "handoff" ? 0 : 1;
    transition = "opacity 240ms ease-out";
  }

  // Title only once the card is big — it would be clutter on a shrinking poster.
  const showTitle = (phase === "expand" && armed) || phase === "cover";

  return (
    <div
      aria-hidden="true"
      className="pointer-events-none fixed z-[10000] overflow-hidden bg-black shadow-[0_30px_80px_rgba(0,0,0,0.6)]"
      style={{ ...box, opacity, transition, willChange: "left, top, width, height, opacity" }}
    >
      {image ? <img src={image} alt="" className="absolute inset-0 h-full w-full object-cover" /> : null}
      <div
        className="absolute inset-0 bg-gradient-to-t from-black via-black/60 to-black/20"
        style={{ opacity: showTitle ? 1 : 0.35, transition: `opacity ${EXPAND_MS}ms ease-out` }}
      />
      <div
        className="absolute inset-x-0 bottom-[14%] px-8 text-center"
        style={{
          opacity: showTitle ? 1 : 0,
          transform: showTitle ? "translateY(0)" : "translateY(12px)",
          transition: `opacity 300ms ease-out ${phase === "expand" ? EXPAND_MS * 0.45 : 0}ms, transform 400ms ${EASE} ${phase === "expand" ? EXPAND_MS * 0.45 : 0}ms`,
        }}
      >
        <p className="text-[11px] font-semibold uppercase tracking-[0.32em] text-violet-300/90">Now playing</p>
        <p className="mt-3 text-4xl font-bold leading-tight text-white drop-shadow-[0_4px_24px_rgba(0,0,0,0.8)] md:text-5xl">
          {title}
        </p>
      </div>
    </div>
  );
}
