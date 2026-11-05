import { useEffect } from "react";
import { SCROLL_RESET_EVENT } from "../components/layout/PageTransition";

// Tuned by feel in the live app — see PROJECT memory for the reasoning if these ever need revisiting.
const MULTIPLIER = 1.6; // how far one wheel notch travels, relative to the browser's raw delta
/**
 * Fraction of the remaining distance closed per 60Hz frame. Scaled by real elapsed time below, so
 * the glide covers the same ground per millisecond on a 144Hz display as on a 60Hz one — a raw
 * per-frame factor makes the same scroll finish ~2.4x faster on a high-refresh monitor, and turns
 * every dropped frame into a visible hitch.
 */
const LERP_FACTOR = 0.35;
const REFERENCE_FRAME_MS = 1000 / 60;
/** Ignore absurd deltas (tab backgrounded, breakpoint) so the view never teleports on resume. */
const MAX_FRAME_MS = 64;
const SNAP_THRESHOLD_PX = 0.5; // when this close to the target, stop animating and land exactly
/** How long a resolved scrollable-ancestor chain stays valid — one scroll burst, not one gesture. */
const CHAIN_CACHE_MS = 150;

/** Rough px-per-notch for the rarer "line" delta mode some mice/touchpads report. */
function normalizedDeltaY(e: WheelEvent): number {
  return e.deltaMode === 1 ? e.deltaY * 16 : e.deltaY;
}

/**
 * The scrollable ancestors between `start` and `boundary` (exclusive), nearest first.
 *
 * `getComputedStyle` forces a style recalculation, and the wheel handler runs dozens of times a
 * second during a normal scroll — on a heavy page (Home, with every section mounted) doing that
 * walk per event is enough main-thread work to visibly stutter the animation loop below. So the
 * chain is resolved once per scroll burst and cached; the cheap per-event checks (scrollTop,
 * clientHeight) still run fresh every time, which is what actually changes mid-scroll.
 *
 * Capped ancestor depth as a defensive perf bound — legitimate nested-scroll cases are always a
 * handful of levels away, never dozens.
 */
function collectScrollableAncestors(start: EventTarget | null, boundary: HTMLElement): HTMLElement[] {
  const chain: HTMLElement[] = [];
  let el = start instanceof HTMLElement ? start : null;
  let depth = 0;
  while (el && el !== boundary && depth < 20) {
    const style = getComputedStyle(el);
    if (style.overflowY === "auto" || style.overflowY === "scroll") chain.push(el);
    el = el.parentElement;
    depth++;
  }
  return chain;
}

/**
 * True if some scrollable element between `start` and `boundary` (exclusive) can still absorb
 * this wheel's direction — mirrors the browser's native scroll-chaining so nested scroll regions
 * (dropdown lists, modal bodies, the virtualized My Device grid, horizontal poster rows, the
 * embedded player) keep behaving exactly as before. Only once nothing nested can take the scroll
 * do we animate the outer container ourselves.
 */
function chainWillHandle(chain: HTMLElement[], deltaY: number): boolean {
  for (const el of chain) {
    if (el.scrollHeight <= el.clientHeight) continue;
    const canGoDown = el.scrollTop + el.clientHeight < el.scrollHeight - 1;
    const canGoUp = el.scrollTop > 1;
    if ((deltaY > 0 && canGoDown) || (deltaY < 0 && canGoUp)) return true;
  }
  return false;
}

/**
 * Replaces the default per-tick "jump" mouse-wheel scroll on `el` with a continuous eased
 * animation — each wheel notch nudges a target position further, and a single ongoing loop
 * glides the real scroll position toward it every frame. Unlike a fixed-duration tween restarted
 * on every tick (which stutters when wheel events arrive in quick succession — the common case
 * during real scrolling), this keeps gliding smoothly through rapid, irregular notches instead of
 * resetting its easing curve each time.
 *
 * Deliberately leaves alone: ctrl+wheel (zoom), predominantly-horizontal wheel (trackpad swipes /
 * horizontal carousels), and any wheel event a nested scrollable region should still handle
 * natively (see nestedScrollableWillHandle).
 */
export function useSmoothWheelScroll(ref: React.RefObject<HTMLElement | null>) {
  useEffect(() => {
    const el = ref.current;
    if (!el) return;

    let current = el.scrollTop;
    let target = el.scrollTop;
    let rafId: number | null = null;

    /** Scroll extent, refreshed inside the frame loop so wheel events don't each force layout. */
    let max = 0;
    const readMax = () => {
      max = el.scrollHeight - el.clientHeight;
    };

    let cachedChainFor: HTMLElement | null = null;
    let cachedChain: HTMLElement[] = [];
    let cachedChainAt = 0;

    const scrollableChainFor = (targetEl: EventTarget | null): HTMLElement[] => {
      const node = targetEl instanceof HTMLElement ? targetEl : null;
      const now = performance.now();
      if (node === cachedChainFor && now - cachedChainAt < CHAIN_CACHE_MS) return cachedChain;
      cachedChain = collectScrollableAncestors(node, el);
      cachedChainFor = node;
      cachedChainAt = now;
      return cachedChain;
    };

    let lastFrameAt = 0;
    /** Last value written to scrollTop, so we can skip no-op writes that land on the same pixel. */
    let lastWritten = -1;

    const loop = (now: number) => {
      readMax(); // layout is already settled at frame start — the cheapest point to sample it

      const elapsed = lastFrameAt === 0 ? REFERENCE_FRAME_MS : Math.min(MAX_FRAME_MS, now - lastFrameAt);
      lastFrameAt = now;

      const diff = target - current;
      if (Math.abs(diff) < SNAP_THRESHOLD_PX) {
        current = target;
        el.scrollTop = current;
        lastWritten = Math.round(current);
        rafId = null;
        lastFrameAt = 0;
        return;
      }

      // Time-scaled easing: the same fraction of the remaining distance per millisecond, whatever
      // the refresh rate or however long the previous frame actually took.
      const factor = 1 - Math.pow(1 - LERP_FACTOR, elapsed / REFERENCE_FRAME_MS);
      current += diff * factor;

      // The browser snaps scrollTop to whole pixels anyway; writing an unchanged value just costs
      // a scroll event and the listener work hanging off it.
      const rounded = Math.round(current);
      if (rounded !== lastWritten) {
        el.scrollTop = current;
        lastWritten = rounded;
      }
      rafId = requestAnimationFrame(loop);
    };

    const onWheel = (e: WheelEvent) => {
      if (e.ctrlKey) return; // pinch/ctrl+wheel zoom — never intercept
      if (Math.abs(e.deltaX) > Math.abs(e.deltaY)) return; // horizontal gesture — leave to native/carousels
      if (chainWillHandle(scrollableChainFor(e.target), e.deltaY)) return;

      // While the loop is running it refreshes `max` every frame; only sample here when idle.
      if (rafId == null) readMax();
      if (max <= 0) return; // nothing to scroll here

      e.preventDefault();

      // If nothing is animating, re-sync both `current` AND `target` to the element's live position
      // first — it may have moved via keyboard, scrollbar drag, restored/programmatic scroll, or
      // route change since our last frame. Resyncing only `current` left `target` pointing at
      // wherever the *previous* gesture last aimed for, so the next wheel tick computed its new
      // target from that stale value instead of from where the view actually is now — e.g. drag the
      // scrollbar thumb far down, then wheel up even slightly, and the glide would fly back toward
      // the old (often near-top) target instead of nudging up from where you just dragged to.
      if (rafId == null) { current = el.scrollTop; target = current; }
      target = Math.min(max, Math.max(0, target + normalizedDeltaY(e) * MULTIPLIER));
      if (rafId == null) rafId = requestAnimationFrame(loop);
    };

    // A page change jumps the scroller (PageTransition's ResetScrollOnEnter) — drop any glide still
    // running, or it would keep pulling the new page toward the old page's target.
    const onScrollReset = () => {
      if (rafId != null) cancelAnimationFrame(rafId);
      rafId = null;
      lastFrameAt = 0;
      current = target = el.scrollTop;
    };

    el.addEventListener("wheel", onWheel, { passive: false });
    el.addEventListener(SCROLL_RESET_EVENT, onScrollReset);
    return () => {
      el.removeEventListener("wheel", onWheel);
      el.removeEventListener(SCROLL_RESET_EVENT, onScrollReset);
      if (rafId != null) cancelAnimationFrame(rafId);
    };
  }, [ref]);
}
