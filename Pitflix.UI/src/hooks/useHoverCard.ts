import { useCallback, useRef, useState } from "react";

const HOVER_DELAY_MS = 700;

/**
 * Returns event handlers and open state for a "hover card" that appears after
 * HOVER_DELAY_MS ms of hovering. The card is dismissed when the cursor leaves
 * either the trigger element or the card itself.
 *
 * Usage:
 *   const { open, triggerProps, cardProps } = useHoverCard();
 *   <div {...triggerProps}>…</div>
 *   {open && <HoverCard {...cardProps} />}
 */
export function useHoverCard() {
  const [open, setOpen] = useState(false);
  const timerRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  const insideRef = useRef(false); // true while cursor is inside trigger or card

  const clearTimer = () => {
    if (timerRef.current != null) {
      clearTimeout(timerRef.current);
      timerRef.current = null;
    }
  };

  const enter = useCallback(() => {
    insideRef.current = true;
    if (timerRef.current != null) return;
    timerRef.current = setTimeout(() => {
      if (insideRef.current) setOpen(true);
      timerRef.current = null;
    }, HOVER_DELAY_MS);
  }, []);

  const leave = useCallback(() => {
    insideRef.current = false;
    clearTimer();
    // Small grace period so moving from trigger → card doesn't close it
    setTimeout(() => {
      if (!insideRef.current) setOpen(false);
    }, 80);
  }, []);

  const triggerProps = {
    onMouseEnter: enter,
    onMouseLeave: leave,
  };

  const cardProps = {
    onMouseEnter: enter,
    onMouseLeave: leave,
  };

  return { open, triggerProps, cardProps };
}
