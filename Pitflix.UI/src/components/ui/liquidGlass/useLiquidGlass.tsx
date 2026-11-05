import { useEffect, useId, useRef, useState, type CSSProperties, type ReactNode, type RefObject } from "react";
import { useAppPrefsStore } from "../../../store/appPrefsStore";
import { buildDisplacementMap } from "./displacementMap";

export type LiquidGlassOptions = {
  /** Corner radius of the element in px (the lens follows it). */
  radius: number;
  /** Width of the refracting rim in px. */
  bezel?: number;
  /** Max backdrop shift at the very edge, in px. */
  strength?: number;
  /** Backdrop blur in px (applied before the bend). */
  blur?: number;
  /** Backdrop saturation boost (1 = none). */
  saturation?: number;
};

// SVG filters inside backdrop-filter only work in Chromium (WebView2 / Chrome). Elsewhere fall back to plain blur.
const SUPPORTS_SVG_BACKDROP =
  typeof navigator !== "undefined" && /Chrome\/|Edg\//.test(navigator.userAgent) && !/Firefox\//.test(navigator.userAgent);

type GlassMap = { url: string; w: number; h: number; version: number };

/** Wait this long after the last resize before rebuilding the map; until then the old one is stretched. */
const REBUILD_DEBOUNCE_MS = 120;

export function useLiquidGlassEnabled(): boolean {
  const pref = useAppPrefsStore((s) => s.liquidGlass);
  return pref && SUPPORTS_SVG_BACKDROP;
}

/**
 * Liquid glass for one element: blur + saturate the backdrop, then bend it along the rim with a
 * displacement map sized to the element. Returns the backdrop style to spread on the element, the
 * hidden `<svg>` holding its filter (render it anywhere), and whether the effect is active — when it
 * isn't, the caller should keep its usual frosted styling.
 */
export function useLiquidGlass<T extends HTMLElement>(
  ref: RefObject<T | null>,
  { radius, bezel = 18, strength = 22, blur = 12, saturation = 1.5 }: LiquidGlassOptions,
): { active: boolean; style: CSSProperties | undefined; filter: ReactNode } {
  const enabled = useLiquidGlassEnabled();
  const baseId = `lg-${useId().replace(/[^a-zA-Z0-9_-]/g, "")}`;
  const [size, setSize] = useState<{ w: number; h: number } | null>(null);
  // Every rebuilt map gets a new version, and with it a new filter id (see `applied` below).
  const [maps, setMaps] = useState<GlassMap[]>([]);
  const [applied, setApplied] = useState(0);

  // Checked after every render: callers often mount the element conditionally (toasts, chips),
  // so the ref can go from null to a node without anything this hook depends on changing.
  const observed = useRef<{ el: T | null; ro: ResizeObserver | null }>({ el: null, ro: null });
  useEffect(() => {
    const el = enabled ? ref.current : null;
    if (el === observed.current.el) return;
    observed.current.ro?.disconnect();
    observed.current = { el, ro: null };
    if (!el) return;
    const measure = () => {
      const w = Math.round(el.offsetWidth);
      const h = Math.round(el.offsetHeight);
      setSize((prev) => (prev && prev.w === w && prev.h === h ? prev : { w, h }));
    };
    measure();
    const ro = new ResizeObserver(measure);
    ro.observe(el);
    observed.current.ro = ro;
  });
  useEffect(() => () => observed.current.ro?.disconnect(), []);

  const hasMap = maps.length > 0;
  useEffect(() => {
    if (!enabled || !size || size.w < 2 || size.h < 2) return;
    const t = window.setTimeout(
      () => {
        const url = buildDisplacementMap(size.w, size.h, radius, Math.min(bezel, size.w / 2, size.h / 2));
        if (!url) return;
        // Keep the previous filter mounted until the element has switched to the new one.
        setMaps((prev) => [...prev.slice(-1), { url, w: size.w, h: size.h, version: (prev[prev.length - 1]?.version ?? 0) + 1 }]);
      },
      hasMap ? REBUILD_DEBOUNCE_MS : 0,
    );
    return () => window.clearTimeout(t);
    // `hasMap` only decides whether the build waits; it must not retrigger.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [enabled, size, radius, bezel]);

  // Chromium resolves `backdrop-filter: url(#id)` once, when the style is applied, and never
  // re-resolves it — if the <filter> isn't in the DOM yet at that moment, or its contents change
  // afterwards, the backdrop silently stays unfiltered. So the style only points at a filter a
  // couple of frames after that filter has been committed, and each rebuild gets a fresh id.
  const latest = maps[maps.length - 1]?.version ?? 0;
  useEffect(() => {
    if (!latest) return;
    // A timer rather than rAF so it still lands while the window is hidden/minimised.
    const t = window.setTimeout(() => setApplied(latest), 32);
    return () => window.clearTimeout(t);
  }, [latest]);

  // If the filter is applied while an ancestor is mid-animation (dock slide-in, HUD pop-in), Chromium
  // keeps the backdrop unfiltered even after the animation ends. Re-apply it whenever one finishes.
  useEffect(() => {
    const el = ref.current;
    if (!enabled || !applied || !el) return;
    const onEnd = (e: AnimationEvent) => {
      if (!(e.target instanceof Node) || !e.target.contains(el)) return;
      const value = el.style.backdropFilter;
      el.style.backdropFilter = "none";
      void el.offsetWidth;
      el.style.backdropFilter = value;
    };
    document.addEventListener("animationend", onEnd, true);
    return () => document.removeEventListener("animationend", onEnd, true);
  }, [enabled, applied, ref]);

  const current = maps.find((m) => m.version === applied);
  if (!enabled || !current) return { active: false, style: undefined, filter: null };

  const backdrop = `url(#${baseId}-${current.version})`;
  return {
    active: true,
    style: { backdropFilter: backdrop, WebkitBackdropFilter: backdrop },
    filter: (
      <svg aria-hidden width="0" height="0" style={{ position: "absolute", pointerEvents: "none" }}>
        {maps.map((m) => (
          <filter
            key={m.version}
            id={`${baseId}-${m.version}`}
            x="0"
            y="0"
            width={m.w}
            height={m.h}
            filterUnits="userSpaceOnUse"
            primitiveUnits="userSpaceOnUse"
            colorInterpolationFilters="sRGB"
          >
            <feGaussianBlur in="SourceGraphic" stdDeviation={blur} result="blurred" />
            <feColorMatrix in="blurred" type="saturate" values={String(saturation)} result="saturated" />
            <feImage href={m.url} x="0" y="0" width={m.w} height={m.h} preserveAspectRatio="none" result="map" />
            <feDisplacementMap
              in="saturated"
              in2="map"
              scale={strength * 2}
              xChannelSelector="R"
              yChannelSelector="G"
            />
          </filter>
        ))}
      </svg>
    ),
  };
}
