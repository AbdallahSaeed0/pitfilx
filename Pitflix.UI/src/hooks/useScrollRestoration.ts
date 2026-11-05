import { useEffect, useRef } from "react";
import { SCROLL_RESET_EVENT } from "../components/layout/PageTransition";

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
    // <main> is shared by every page. When the next page opens, PageTransition announces a reset
    // and jumps it to the top — and that jump's scroll event (plus this effect's passive cleanup)
    // can land before React tears this page down, which recorded 0 as this page's position. Stop
    // recording as soon as the reset is announced; the last real position is already saved.
    let leaving = false;
    const onScroll = () => {
      if (!leaving) positions.set(key, el.scrollTop);
    };
    const onReset = () => {
      leaving = true;
    };
    el.addEventListener("scroll", onScroll, { passive: true });
    el.addEventListener(SCROLL_RESET_EVENT, onReset);
    return () => {
      el.removeEventListener("scroll", onScroll);
      el.removeEventListener(SCROLL_RESET_EVENT, onReset);
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
