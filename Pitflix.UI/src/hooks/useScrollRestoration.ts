import { useEffect, useRef } from "react";

// Keyed by route pathname+search so filters that change the URL count as a new scroll position.
const positions = new Map<string, number>();

function getScrollEl(): HTMLElement | null {
  return document.querySelector("main");
}

/** Restores scroll position on a page when navigating back to it (e.g. from a detail page). */
export function useScrollRestoration(key: string, ready: boolean) {
  const restoredForKey = useRef<string | null>(null);

  useEffect(() => {
    const el = getScrollEl();
    if (!el) return;
    const onScroll = () => positions.set(key, el.scrollTop);
    el.addEventListener("scroll", onScroll, { passive: true });
    return () => {
      positions.set(key, el.scrollTop);
      el.removeEventListener("scroll", onScroll);
    };
  }, [key]);

  useEffect(() => {
    if (!ready || restoredForKey.current === key) return;
    const el = getScrollEl();
    const y = positions.get(key);
    if (el && y != null) el.scrollTop = y;
    restoredForKey.current = key;
  }, [key, ready]);
}
