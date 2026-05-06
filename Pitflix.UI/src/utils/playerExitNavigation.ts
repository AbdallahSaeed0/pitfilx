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
    const runScroll = () => {
      const y = returnTo.scrollY;
      if (typeof y === "number" && Number.isFinite(y)) {
        window.scrollTo({ top: y, left: 0, behavior: "instant" });
      }
      const mainTop = returnTo.mainScrollTop;
      if (typeof mainTop === "number" && Number.isFinite(mainTop)) {
        const main = document.querySelector("main");
        if (main instanceof HTMLElement) {
          main.scrollTop = mainTop;
        }
      }
    };
    requestAnimationFrame(() => setTimeout(runScroll, 0));
    setTimeout(runScroll, 120);
  } else {
    navigate(-1);
  }
}
