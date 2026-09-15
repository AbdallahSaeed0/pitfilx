import { AnimatePresence, motion, useReducedMotion } from "framer-motion";
import { Suspense } from "react";
import { useLocation, useOutlet } from "react-router-dom";
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

export function PageTransition() {
  const location = useLocation();
  const outlet = useOutlet();
  const reduceMotion = useReducedMotion();

  // rAF is paused while the window is hidden/minimised, so an exit animation started now would
  // never finish — `mode="wait"` would sit on the *old* page until the window came back. Nothing
  // is on screen to animate anyway, so swap straight through.
  const skip = reduceMotion || (typeof document !== "undefined" && document.hidden);
  if (skip) return <Suspense fallback={<PageSkeleton />}>{outlet}</Suspense>;

  return (
    <AnimatePresence mode="wait" initial={false}>
      <motion.div
        key={transitionKey(location.pathname, location.search)}
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
        <Suspense fallback={<PageSkeleton />}>{outlet}</Suspense>
      </motion.div>
    </AnimatePresence>
  );
}
