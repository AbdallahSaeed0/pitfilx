import { isTauri } from "@tauri-apps/api/core";
import { getCurrentWindow } from "@tauri-apps/api/window";
import { useEffect } from "react";

/** Elements that must NOT start a window drag — interactive controls, text fields,
 *  the existing Tauri drag strip, and anything that opts out with `.no-window-drag`
 *  or `[data-no-window-drag]`. */
const INTERACTIVE_SELECTOR =
  "button, a, input, select, textarea, label, video, audio, " +
  "[role=button], [role=slider], [role=switch], [contenteditable], " +
  "[data-tauri-drag-region], [data-no-window-drag], .no-window-drag";

/**
 * Lets the user move the main app window by pressing on EMPTY space anywhere and
 * dragging — not just the thin title strip. Uses a small movement threshold so a
 * plain click (buttons, cards, links) or text interaction is never hijacked: the
 * window only starts moving once the pointer travels past the threshold while held
 * down on a non-interactive area.
 */
export function useWindowDragFromEmptySpace() {
  useEffect(() => {
    if (!isTauri()) return;

    let armed = false;
    let startX = 0;
    let startY = 0;

    const onPointerDown = (e: PointerEvent) => {
      if (e.button !== 0) return; // primary button only
      const target = e.target as HTMLElement | null;
      if (!target) return;
      // Don't arm on interactive controls or opt-out regions.
      if (typeof target.closest === "function" && target.closest(INTERACTIVE_SELECTOR)) return;
      armed = true;
      startX = e.clientX;
      startY = e.clientY;
    };

    const onPointerMove = (e: PointerEvent) => {
      if (!armed) return;
      const dx = e.clientX - startX;
      const dy = e.clientY - startY;
      if (dx * dx + dy * dy > 25) {
        // Past the ~5px threshold → hand off to the OS window-move loop.
        armed = false;
        void getCurrentWindow().startDragging().catch(() => {});
      }
    };

    const disarm = () => {
      armed = false;
    };

    document.addEventListener("pointerdown", onPointerDown, true);
    document.addEventListener("pointermove", onPointerMove, true);
    document.addEventListener("pointerup", disarm, true);
    document.addEventListener("pointercancel", disarm, true);
    return () => {
      document.removeEventListener("pointerdown", onPointerDown, true);
      document.removeEventListener("pointermove", onPointerMove, true);
      document.removeEventListener("pointerup", disarm, true);
      document.removeEventListener("pointercancel", disarm, true);
    };
  }, []);
}
