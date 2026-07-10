import { isTauri } from "@tauri-apps/api/core";
import { getCurrentWindow } from "@tauri-apps/api/window";
import type { NavigateFunction } from "react-router-dom";
import type { PlayerReturnTo } from "../types/playback";

/** Leave Tauri window fullscreen when exiting the player so the main app returns to normal size. */
export async function restoreAppWindowFromFullscreen(): Promise<void> {
  if (!isTauri()) return;
  try {
    const w = getCurrentWindow();
    if (await w.isFullscreen()) {
      await w.setFullscreen(false);
      window.dispatchEvent(new Event("resize"));
    }
  } catch {
    // Non-fatal — navigation should still proceed.
  }
}

function runReturnToScroll(returnTo: PlayerReturnTo) {
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
}

/** Navigate back from the player using explicit return target or browser history. */
export function navigateFromPlayer(navigate: NavigateFunction, returnTo: PlayerReturnTo | undefined, replace = true) {
  void restoreAppWindowFromFullscreen().finally(() => {
    if (returnTo?.pathname) {
      navigate(
        {
          pathname: returnTo.pathname,
          search: returnTo.search ?? "",
          hash: returnTo.hash ?? "",
        },
        { replace },
      );
      runReturnToScroll(returnTo);
    } else {
      navigate(-1);
    }
  });
}
