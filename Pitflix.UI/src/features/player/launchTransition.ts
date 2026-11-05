import { create } from "zustand";

/**
 * "Grows out of what you clicked" transition into / out of the embedded Pitflix Player.
 *
 * - A capture-phase pointerdown tracker remembers the on-screen rect of the last thing the user
 *   pressed (play button, poster, episode card…).
 * - `playLaunchExpand` animates a card with the title's art from that rect to the full app window
 *   (over the page you're leaving), then the caller navigates to /player. The layer keeps covering
 *   the screen until PlayerPage calls `handoffLaunch` (its own intro has taken over underneath).
 * - `playCloseCollapse` is the reverse on close: the layer covers the screen, the caller navigates
 *   back, and the card shrinks into the rect the player was opened from.
 *
 * Rendered by <LaunchTransitionLayer/> at the app root so it survives the route change.
 */

export type Rect = { left: number; top: number; width: number; height: number };

type Phase = "idle" | "expand" | "cover" | "handoff" | "collapse";

type LaunchState = {
  phase: Phase;
  /** Rect the card animates from (expand) / to (collapse). */
  origin: Rect | null;
  image: string | null;
  title: string;
  /** Bumped per run so the layer restarts its animation even for back-to-back runs. */
  runId: number;
};

export const useLaunchTransition = create<LaunchState>(() => ({
  phase: "idle",
  origin: null,
  image: null,
  title: "",
  runId: 0,
}));

export const EXPAND_MS = 320;
export const COLLAPSE_MS = 380;

let lastPress: { rect: Rect; at: number } | null = null;
/** The player mounted while the card was still growing — hand off the moment the growth ends. */
let handoffRequested = false;
/** Where the current player session was opened from — what `playCloseCollapse` returns to. */
let sessionOrigin: Rect | null = null;
/** Art the session was opened with — the close shrinks back with the same picture. */
let sessionImage: string | null = null;

/** Installs the pointer tracker once (idempotent). */
export function installLaunchOriginTracker() {
  if (typeof window === "undefined" || (window as { __pfLaunchTracker?: boolean }).__pfLaunchTracker) return;
  (window as { __pfLaunchTracker?: boolean }).__pfLaunchTracker = true;
  window.addEventListener(
    "pointerdown",
    (e) => {
      const el = (e.target as HTMLElement | null)?.closest?.(
        "[data-launch-origin], button, a, [role='button'], li, article",
      ) as HTMLElement | null;
      if (!el) return;
      const r = el.getBoundingClientRect();
      if (r.width < 4 || r.height < 4) return;
      lastPress = { rect: { left: r.left, top: r.top, width: r.width, height: r.height }, at: Date.now() };
    },
    { capture: true, passive: true },
  );
}

const prefersReducedMotion = () =>
  typeof window !== "undefined" && window.matchMedia?.("(prefers-reduced-motion: reduce)").matches;

/** A centred card used when there's no recent click to grow from (keyboard / programmatic play). */
function fallbackRect(): Rect {
  const w = Math.min(window.innerWidth * 0.32, 420);
  const h = w * 0.56;
  return { left: (window.innerWidth - w) / 2, top: (window.innerHeight - h) / 2, width: w, height: h };
}

/**
 * Grow the card from the last pressed element to full screen. Callers do NOT wait for this: the
 * player starts loading at the same time (navigate immediately), and whichever finishes last wins —
 * PlayerPage's handoffLaunch during the growth is deferred to its end. Waiting here used to add the
 * whole animation (~0.5 s) to every play.
 */
export async function playLaunchExpand(opts: { image: string | null; title: string }): Promise<void> {
  if (typeof window === "undefined" || prefersReducedMotion()) return;
  // A press older than ~15 s isn't what triggered this play (e.g. autoplay), so don't grow from it.
  const origin = lastPress && Date.now() - lastPress.at < 15_000 ? lastPress.rect : fallbackRect();
  sessionOrigin = origin;
  sessionImage = opts.image;
  handoffRequested = false;
  useLaunchTransition.setState((s) => ({
    phase: "expand",
    origin,
    image: opts.image,
    title: opts.title,
    runId: s.runId + 1,
  }));
  await new Promise((r) => window.setTimeout(r, EXPAND_MS));
  if (handoffRequested) {
    useLaunchTransition.setState({ phase: "cover" });
    handoffLaunch();
    return;
  }
  useLaunchTransition.setState({ phase: "cover" });
  // Never strand the cover if the player fails to mount and hand off.
  const run = useLaunchTransition.getState().runId;
  window.setTimeout(() => {
    const s = useLaunchTransition.getState();
    if (s.runId === run && s.phase === "cover") handoffLaunch();
  }, 5000);
}

/** Abort a launch that won't reach the embedded player after all (e.g. external player configured). */
export function cancelLaunch() {
  handoffRequested = false;
  useLaunchTransition.setState({ phase: "idle" });
}

/** PlayerPage's intro is showing underneath — fade the launch card away. */
export function handoffLaunch() {
  const s = useLaunchTransition.getState();
  if (s.phase === "expand") {
    handoffRequested = true; // let the growth finish, then hand off immediately
    return;
  }
  if (s.phase !== "cover") return;
  handoffRequested = false;
  useLaunchTransition.setState({ phase: "handoff" });
  const run = s.runId;
  window.setTimeout(() => {
    if (useLaunchTransition.getState().runId === run) useLaunchTransition.setState({ phase: "idle" });
  }, 260);
}

/**
 * Close: cover the screen with the card right away (call BEFORE navigating back), then shrink it into
 * the rect the player was opened from once the previous page has had a moment to render underneath.
 */
export function playCloseCollapse(opts: { image: string | null; title: string }) {
  if (typeof window === "undefined" || prefersReducedMotion()) return;
  const target = sessionOrigin ?? fallbackRect();
  useLaunchTransition.setState((s) => ({
    phase: "cover",
    origin: target,
    image: sessionImage ?? opts.image,
    title: opts.title,
    runId: s.runId + 1,
  }));
  const run = useLaunchTransition.getState().runId;
  // Two frames: let the route change paint the previous page before the card starts shrinking.
  requestAnimationFrame(() =>
    requestAnimationFrame(() => {
      if (useLaunchTransition.getState().runId !== run) return;
      useLaunchTransition.setState({ phase: "collapse" });
      window.setTimeout(() => {
        if (useLaunchTransition.getState().runId === run) useLaunchTransition.setState({ phase: "idle" });
      }, COLLAPSE_MS + 40);
    }),
  );
}
