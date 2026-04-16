import type { NavigateFunction } from "react-router-dom";
import type { PlayerReturnTo } from "../types/playback";

/** Navigate back from the player using explicit return target or browser history. */
export function navigateFromPlayer(navigate: NavigateFunction, returnTo: PlayerReturnTo | undefined, replace = true) {
  if (returnTo?.pathname) {
    navigate(
      {
        pathname: returnTo.pathname,
        search: returnTo.search ?? "",
        hash: returnTo.hash ?? "",
      },
      { replace },
    );
    const y = returnTo.scrollY;
    if (typeof y === "number" && Number.isFinite(y)) {
      const run = () => window.scrollTo({ top: y, left: 0, behavior: "instant" });
      requestAnimationFrame(() => setTimeout(run, 0));
      setTimeout(run, 120);
    }
  } else {
    navigate(-1);
  }
}
