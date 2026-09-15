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
      // A page's own [data-scroll-restore-anchor] div usually scrolls itself, but depending on
      // content height it can end up sized to fit everything instead (no real overflow), in which
      // case the *layout's* <main> (also overflow-y-auto) is the one actually scrolling. Whichever
      // one is captured as having overflow is symmetric with the capture side (see
      // MyDevicePage.openVideoEntry) — pick the same way here so restore targets the same element.
      const hasRealOverflow = (el: Element | null): el is HTMLElement =>
        el instanceof HTMLElement && el.scrollHeight > el.clientHeight + 1;
      const anchor = document.querySelector('[data-scroll-restore-anchor]');
      const mainEl = document.querySelector("main");
      const target = hasRealOverflow(anchor) ? anchor : hasRealOverflow(mainEl) ? mainEl : (anchor ?? mainEl);
      if (target instanceof HTMLElement) {
        target.scrollTop = mainTop;
      }
    }
  };
  // Retried repeatedly (not just once or twice) over a couple of seconds: the destination page's
  // content — e.g. My Device re-fetching a real folder's entries via device_read_dir — can still be
  // loading when the early attempts fire. Setting scrollTop before the (virtualized) container has
  // grown to its full height just gets silently clamped back to 0, and without a later retry that
  // clamp never gets corrected once the content actually finishes loading and grows.
  requestAnimationFrame(() => setTimeout(runScroll, 0));
  for (const delay of [120, 300, 600, 1000, 1600, 2400]) {
    setTimeout(runScroll, delay);
  }
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
