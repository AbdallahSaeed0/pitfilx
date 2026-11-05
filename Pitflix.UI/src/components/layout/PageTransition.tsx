import { AnimatePresence, motion, useReducedMotion } from "framer-motion";
import { Suspense, useLayoutEffect } from "react";
import { useLocation, useNavigationType, useOutlet, type NavigationType } from "react-router-dom";
import { PageSkeleton } from "../ui/Skeleton";

/**
 * Route transition played on every navigation — sidebar/dock as well as in-page moves like
 * clicking a card (keyed on `search` too, so `?tmdbId=1` → `?tmdbId=2` animates).
 *
 * Uses `useOutlet()` rather than `<Outlet />` so AnimatePresence can hold on to the *outgoing*
 * page element and actually fade it out; with `<Outlet />` the swap has already happened by render
 * time and only an enter animation is possible, which reads as an instant cut.
 *
 * The Suspense boundary lives here, inside the layout, so a lazy page chunk suspends only the
 * content area. The app-level boundary would have blanked the sidebar and title bar too.
 *
 * Everything settles at `y: 0, scale: 1`, which lets Motion emit `transform: none` at rest — pages
 * that use `position: fixed` overlays keep working normally once the animation is done.
 */
/**
 * Query params that only re-filter the page already on screen (search box, pagination, sort,
 * tab switches). These must NOT take part in the animation key: a new key remounts the page,
 * which tears the focused search input out of the DOM mid-type — you get one letter in, then
 * typing goes nowhere. Identity params (`?tmdbId=`, …) are deliberately left in, so moving
 * between two different titles on the same route still animates.
 */
const TRANSIENT_PARAMS = new Set([
  "q",
  "page",
  "sort",
  "genre",
  "watch",
  "lang",
  "mode",
  "filter",
  "view",
]);

function transitionKey(pathname: string, search: string): string {
  const params = new URLSearchParams(search);
  for (const key of [...params.keys()]) {
    if (TRANSIENT_PARAMS.has(key)) params.delete(key);
  }
  const rest = params.toString();
  return rest ? `${pathname}?${rest}` : pathname;
}

/** Fired before a new page resets the shared scroller, so an in-flight wheel glide stops. */
export const SCROLL_RESET_EVENT = "pitflix:scroll-reset";

/**
 * A newly opened page starts at the top. <main> is one scroller shared by every page, so without
 * this a detail page opened from far down the Series grid kept that grid's scroll offset. It used
 * to look fine only because detail pages loaded slowly: their short loading skeleton forced the
 * scroll back to 0. Back/forward (POP) is left alone — list pages restore their own position
 * (useScrollRestoration). Rendered inside the per-page keyed wrapper, so it runs when the new page
 * actually mounts (after the old one's exit animation), not while the old one is still visible.
 */
function ResetScrollOnEnter({ navigationType }: { navigationType: NavigationType }) {
  useLayoutEffect(() => {
    if (navigationType === "POP") return;
    const main = document.querySelector("main");
    if (!main) return;
    main.dispatchEvent(new Event(SCROLL_RESET_EVENT));
    main.scrollTop = 0;
    // Mount-only on purpose: same-page param changes (filters, search) keep the same key.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);
  return null;
}

export function PageTransition() {
  const location = useLocation();
  const outlet = useOutlet();
  const reduceMotion = useReducedMotion();
  const navigationType = useNavigationType();
  const pageKey = transitionKey(location.pathname, location.search);

  // rAF is paused while the window is hidden/minimised, so an exit animation started now would
  // never finish — `mode="wait"` would sit on the *old* page until the window came back. Nothing
  // is on screen to animate anyway, so swap straight through.
  const skip = reduceMotion || (typeof document !== "undefined" && document.hidden);
  if (skip)
    return (
      <>
        <ResetScrollOnEnter key={pageKey} navigationType={navigationType} />
        <Suspense fallback={<PageSkeleton />}>{outlet}</Suspense>
      </>
    );

  return (
    <AnimatePresence mode="wait" initial={false}>
      <motion.div
        key={pageKey}
        initial={{ opacity: 0, y: 18, scale: 0.985 }}
        animate={{
          opacity: 1,
          y: 0,
          scale: 1,
          transition: { duration: 0.28, ease: [0.22, 1, 0.36, 1] },
        }}
        // Leaving is quicker than arriving, so the wait before the new page shows stays short.
        exit={{
          opacity: 0,
          y: -10,
          scale: 0.99,
          transition: { duration: 0.14, ease: [0.4, 0, 1, 1] },
        }}
      >
        <ResetScrollOnEnter navigationType={navigationType} />
        <Suspense fallback={<PageSkeleton />}>{outlet}</Suspense>
      </motion.div>
    </AnimatePresence>
  );
}
