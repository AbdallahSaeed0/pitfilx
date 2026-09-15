import { useRef } from "react";

/**
 * Hold-to-reveal pattern (e.g. holding "Watch Again" to open the rewatch-count
 * popover instead of playing). Owns both the short-click and long-press callbacks
 * on a single handler set so there's no race between a capture-phase suppression
 * and the bubble-phase click — onMouseUp always fires before onClick, so by the
 * time onClick runs, whether the hold reached the threshold is already settled.
 */
export function useLongPress(
  onLongPress: () => void,
  onClick?: () => void,
  ms = 500,
) {
  const timerRef = useRef<number | null>(null);
  const longPressedRef = useRef(false);

  const clearTimer = () => {
    if (timerRef.current !== null) {
      window.clearTimeout(timerRef.current);
      timerRef.current = null;
    }
  };

  return {
    onMouseDown: () => {
      longPressedRef.current = false;
      clearTimer();
      timerRef.current = window.setTimeout(() => {
        longPressedRef.current = true;
        onLongPress();
      }, ms);
    },
    onMouseUp: clearTimer,
    onMouseLeave: clearTimer,
    onClick: (e: React.MouseEvent) => {
      if (longPressedRef.current) {
        e.preventDefault();
        return;
      }
      onClick?.();
    },
  };
}
