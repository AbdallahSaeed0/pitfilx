import { useCallback, useEffect, useRef } from "react";

type Options = {
  disabled?: boolean;
  /** Delay before repeat starts after the first action. */
  initialDelayMs?: number;
  /** Interval between repeated actions while held. */
  intervalMs?: number;
};

/** Pointer hold on a button: fire once immediately, then repeat while pressed. */
export function useHoldRepeat(action: () => void, options?: Options) {
  const actionRef = useRef(action);
  actionRef.current = action;

  const delayRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  const intervalRef = useRef<ReturnType<typeof setInterval> | null>(null);

  const clearTimers = useCallback(() => {
    if (delayRef.current !== null) {
      clearTimeout(delayRef.current);
      delayRef.current = null;
    }
    if (intervalRef.current !== null) {
      clearInterval(intervalRef.current);
      intervalRef.current = null;
    }
  }, []);

  useEffect(() => () => clearTimers(), [clearTimers]);

  const onPointerDown = useCallback(
    (e: React.PointerEvent<HTMLButtonElement>) => {
      if (options?.disabled) return;
      if (e.button !== 0) return;
      e.preventDefault();
      e.currentTarget.setPointerCapture(e.pointerId);
      actionRef.current();
      clearTimers();
      const initialDelay = options?.initialDelayMs ?? 400;
      const interval = options?.intervalMs ?? 120;
      delayRef.current = setTimeout(() => {
        delayRef.current = null;
        intervalRef.current = setInterval(() => actionRef.current(), interval);
      }, initialDelay);
    },
    [options?.disabled, options?.initialDelayMs, options?.intervalMs, clearTimers],
  );

  const onPointerUp = useCallback(
    (e: React.PointerEvent<HTMLButtonElement>) => {
      clearTimers();
      if (e.currentTarget.hasPointerCapture(e.pointerId)) {
        e.currentTarget.releasePointerCapture(e.pointerId);
      }
    },
    [clearTimers],
  );

  return {
    onPointerDown,
    onPointerUp,
    onPointerLeave: onPointerUp,
    onPointerCancel: onPointerUp,
  };
}
