import { useEffect, useRef, type RefObject } from "react";
import { MediaImage } from "../ui/MediaImage";

/**
 * Scroll-driven backdrop for the movie / show / streaming detail and season pages.
 *
 * - {@link HeroBackdrop} replaces the hero's static image: it drifts slower than the page (parallax),
 *   zooms a touch and dissolves into a pre-blurred, darker copy as the hero scrolls away.
 * - {@link AmbientBackdrop} sits pinned behind the rest of the page: a heavily blurred, saturated wash
 *   of the same art with a vignette and film grain, fading in as the hero leaves (or shown from the
 *   start on pages without a hero) — so the page keeps the title's colours instead of flat grey.
 *
 * Smoothness: the visual progress isn't the raw scroll position — it chases it with a time-based
 * ease (frame-rate independent), and every effect runs through a smoothstep curve with a late start,
 * so the first wheel notch from the top only begins the change instead of popping it. Only the
 * parallax offset tracks the scroll exactly (a lagging offset would wobble against its frame).
 *
 * Scrolling only changes CSS variables feeding `opacity` / `transform` (GPU-composited); blur radii
 * are fixed, because animating `filter: blur()` per frame is expensive in this transparent WebView2
 * window. Motion (parallax / zoom) is skipped under prefers-reduced-motion; the fades remain.
 */

const HERO_HEIGHT = 560;

/** Fraction of the remaining distance the eased progress closes per 60 Hz frame (lower = softer). */
const EASE_PER_FRAME = 0.14;
const REFERENCE_FRAME_MS = 1000 / 60;

/** Inline SVG fractal noise, tiled as film grain. */
const GRAIN =
  "url(\"data:image/svg+xml;utf8,<svg xmlns='http://www.w3.org/2000/svg' width='160' height='160'><filter id='n'><feTurbulence type='fractalNoise' baseFrequency='0.9' numOctaves='2' stitchTiles='stitch'/><feColorMatrix values='0 0 0 0 1  0 0 0 0 1  0 0 0 0 1  0 0 0 0.55 0'/></filter><rect width='100%' height='100%' filter='url(%23n)'/></svg>\")";

function findScrollParent(el: HTMLElement | null): HTMLElement | Window {
  for (let node = el?.parentElement; node; node = node.parentElement) {
    const { overflowY } = getComputedStyle(node);
    if (overflowY === "auto" || overflowY === "scroll") return node;
  }
  return window;
}

/** Keeps the hero fully opaque through its top half, then dissolves it into whatever lies beneath. */
const HERO_FADE_MASK = {
  maskImage: "linear-gradient(to bottom, #000 0%, #000 50%, rgba(0,0,0,0.6) 75%, transparent 100%)",
  WebkitMaskImage: "linear-gradient(to bottom, #000 0%, #000 50%, rgba(0,0,0,0.6) 75%, transparent 100%)",
} as const;

const clamp01 = (n: number) => Math.min(1, Math.max(0, n));

/** 0 before `from`, 1 after `to`, smooth S-curve in between (no hard start or stop). */
const smoothstep = (from: number, to: number, x: number) => {
  const t = clamp01((x - from) / (to - from));
  return t * t * (3 - 2 * t);
};

/**
 * Calls `write(el, easedTop, rawTop)` whenever the scroll parent moves. `easedTop` glides toward the
 * real scroll position over a few frames; `rawTop` is exact. No React re-renders.
 *
 * `mountKey` must change whenever the element behind `ref` can appear — e.g. the image URL, which on
 * streaming pages arrives after first render (the element isn't rendered until then, and a ref
 * change alone doesn't re-run effects).
 */
function useScrollVars(
  ref: RefObject<HTMLElement | null>,
  mountKey: unknown,
  write: (el: HTMLElement, easedTop: number, rawTop: number) => void,
) {
  const writeRef = useRef(write);
  writeRef.current = write;

  useEffect(() => {
    const el = ref.current;
    if (!el) return;
    const scroller = findScrollParent(el);
    const read = () => (scroller instanceof Window ? scroller.scrollY : scroller.scrollTop);

    let eased = read();
    let frame = 0;
    let last = 0;
    const tick = (now: number) => {
      const raw = read();
      const dt = last ? Math.min(64, now - last) : REFERENCE_FRAME_MS;
      last = now;
      // Same closing speed per millisecond at 60 Hz and 144 Hz.
      eased += (raw - eased) * (1 - Math.pow(1 - EASE_PER_FRAME, dt / REFERENCE_FRAME_MS));
      if (Math.abs(raw - eased) < 0.5) eased = raw;
      writeRef.current(el, eased, raw);
      if (eased !== raw) {
        frame = requestAnimationFrame(tick);
      } else {
        frame = 0;
        last = 0;
      }
    };
    const onScroll = () => {
      if (!frame) frame = requestAnimationFrame(tick);
    };
    writeRef.current(el, eased, eased);
    scroller.addEventListener("scroll", onScroll, { passive: true });
    return () => {
      scroller.removeEventListener("scroll", onScroll);
      if (frame) cancelAnimationFrame(frame);
    };
  }, [ref, mountKey]);
}

const prefersReducedMotion = () =>
  typeof window !== "undefined" && window.matchMedia?.("(prefers-reduced-motion: reduce)").matches;

/** Drop-in for the hero's `pointer-events-none absolute inset-0` image block. */
export function HeroBackdrop({ src }: { src: string | null | undefined }) {
  const ref = useRef<HTMLDivElement>(null);
  const reduced = useRef(prefersReducedMotion());

  useScrollVars(ref, src, (el, eased, raw) => {
    const p = eased / HERO_HEIGHT;
    // Blur dissolve waits until ~12% of the hero is gone, then eases in.
    el.style.setProperty("--hero-blur", smoothstep(0.12, 0.85, p).toFixed(3));
    el.style.setProperty("--hero-dim", smoothstep(0.2, 1, p).toFixed(3));
    el.style.setProperty("--hero-shift", reduced.current ? "0px" : `${(raw * 0.35).toFixed(1)}px`);
    el.style.setProperty("--hero-zoom", reduced.current ? "1" : (1 + smoothstep(0, 1, p) * 0.06).toFixed(4));
  });

  return (
    // The whole layer fades to TRANSPARENT at the bottom (mask), not to a solid colour: below the hero
    // the ambient glow shows through, and a solid fade there reads as a hard seam between two pages.
    <div ref={ref} className="pointer-events-none absolute inset-0 overflow-hidden" style={HERO_FADE_MASK}>
      {src ? (
        <div
          className="absolute inset-0 will-change-transform"
          style={{ transform: "translate3d(0, var(--hero-shift, 0px), 0) scale(var(--hero-zoom, 1))" }}
        >
          <div className="absolute inset-0 [&_img]:h-full [&_img]:w-full [&_img]:object-cover [&_img]:object-top [&_img]:opacity-75">
            <MediaImage src={src} alt="" className="h-full w-full bg-pitflix-card" fallbackText="" />
          </div>
          {/* Pre-blurred copy cross-fades in — cheaper than animating the blur radius. */}
          <img
            src={src}
            alt=""
            aria-hidden
            className="absolute inset-0 h-full w-full scale-110 object-cover object-top blur-2xl saturate-150 will-change-[opacity]"
            style={{ opacity: "calc(var(--hero-blur, 0) * 0.85)" }}
          />
        </div>
      ) : (
        <div className="absolute inset-0 bg-pitflix-card" />
      )}
      {/* Deepens as it scrolls away so the floating content above stays readable. */}
      <div className="absolute inset-0 bg-pitflix-bg" style={{ opacity: "calc(var(--hero-dim, 0) * 0.5)" }} />
      {/* Left fade so text stays readable */}
      <div className="absolute inset-0 bg-gradient-to-r from-pitflix-bg via-pitflix-bg/55 to-transparent" />
      {/* Softer bottom shade under the title/buttons; the mask above does the actual merge. */}
      <div className="absolute bottom-0 left-0 right-0 h-2/3 bg-gradient-to-t from-pitflix-bg/70 via-pitflix-bg/35 to-transparent" />
      <div className="absolute inset-0 opacity-[0.06] mix-blend-overlay" style={{ backgroundImage: GRAIN }} />
    </div>
  );
}

/**
 * Pinned, blurred colour wash behind the page. Render it as the FIRST child of the page root, and give
 * that root `isolate` so the negative z-index stays inside the page.
 *
 * With a hero (default) it fades in as the hero leaves; `alwaysOn` shows it from the top — for pages
 * with no hero image, where it deepens a little as you scroll.
 */
export function AmbientBackdrop({ src, alwaysOn = false }: { src: string | null | undefined; alwaysOn?: boolean }) {
  const ref = useRef<HTMLDivElement>(null);

  useScrollVars(ref, src, (el, eased) => {
    const amb = alwaysOn
      ? 0.7 + 0.3 * smoothstep(0, HERO_HEIGHT, eased)
      : smoothstep(HERO_HEIGHT * 0.3, HERO_HEIGHT * 1.05, eased);
    el.style.setProperty("--amb", amb.toFixed(3));
  });

  if (!src) return null;
  return (
    // h-0 + sticky: takes no space in the flow, but stays pinned to the scroll viewport.
    <div ref={ref} aria-hidden className="pointer-events-none sticky top-0 -z-10 -mx-6 h-0">
      <div
        className="absolute inset-x-0 -top-12 h-[calc(100vh+3rem)] overflow-hidden will-change-[opacity]"
        style={{ opacity: "var(--amb, 0)" }}
      >
        <img
          src={src}
          alt=""
          className="absolute -inset-[12%] h-[124%] w-[124%] max-w-none object-cover opacity-80 blur-[64px] saturate-[1.7]"
        />
        <div className="absolute inset-0 bg-pitflix-bg/45" />
        {/* Vignette: colour pools at the top, edges and bottom sink into the page background. */}
        <div
          className="absolute inset-0"
          style={{
            background:
              "radial-gradient(120% 85% at 50% 10%, transparent 0%, rgba(20,20,20,0.25) 55%, rgb(20,20,20) 100%)",
          }}
        />
        <div className="absolute inset-0 opacity-[0.07] mix-blend-overlay" style={{ backgroundImage: GRAIN }} />
      </div>
    </div>
  );
}
