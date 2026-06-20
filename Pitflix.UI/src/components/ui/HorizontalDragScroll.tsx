import { type ReactNode, useCallback, useEffect, useLayoutEffect, useRef, useState } from "react";
import { ChevronLeft, ChevronRight } from "lucide-react";
import { cn } from "../../utils/cn";

type Props = {
  children: ReactNode;
  className?: string;
};

/**
 * Horizontal row that scrolls via click-drag or the left/right buttons
 * (which auto-hide once there's nothing left to scroll in that direction).
 * Mouse wheel is intentionally not wired up — drag and the buttons are the
 * only supported ways to move this row.
 */
export function HorizontalDragScroll({ children, className }: Props) {
  const ref = useRef<HTMLDivElement>(null);
  const drag = useRef<{ x: number; left: number } | null>(null);
  const moved = useRef(false);
  const lastDragAt = useRef(0);
  const [grabbing, setGrabbing] = useState(false);
  const [canLeft, setCanLeft] = useState(false);
  const [canRight, setCanRight] = useState(false);

  const updateArrows = useCallback(() => {
    const el = ref.current;
    if (!el) return;
    const { scrollLeft, scrollWidth, clientWidth } = el;
    setCanLeft(scrollLeft > 2);
    setCanRight(scrollLeft + clientWidth < scrollWidth - 2);
  }, []);

  useLayoutEffect(() => {
    updateArrows();
  }, [updateArrows]);

  useEffect(() => {
    const el = ref.current;
    if (!el) return;
    el.addEventListener("scroll", updateArrows, { passive: true });
    const ro = new ResizeObserver(() => updateArrows());
    ro.observe(el);
    return () => {
      el.removeEventListener("scroll", updateArrows);
      ro.disconnect();
    };
  }, [updateArrows]);

  useEffect(() => {
    if (!grabbing) return;
    const onMove = (e: MouseEvent) => {
      const d = drag.current;
      const el = ref.current;
      if (d == null || el == null) return;
      if (!moved.current && Math.abs(e.clientX - d.x) > 6) moved.current = true;
      if (!moved.current) return;
      e.preventDefault();
      el.scrollLeft = d.left - (e.clientX - d.x);
    };
    const onUp = () => {
      drag.current = null;
      if (moved.current) lastDragAt.current = Date.now();
      moved.current = false;
      setGrabbing(false);
    };
    document.addEventListener("mousemove", onMove);
    document.addEventListener("mouseup", onUp);
    return () => {
      document.removeEventListener("mousemove", onMove);
      document.removeEventListener("mouseup", onUp);
    };
  }, [grabbing]);

  const onMouseDown = useCallback((e: React.MouseEvent<HTMLDivElement>) => {
    if (e.button !== 0) return;
    const el = ref.current;
    if (!el) return;
    const targ = e.target as HTMLElement;
    if (targ.closest("a,button,input,select,textarea,[data-no-drag-scroll]")) return;
    drag.current = { x: e.clientX, left: el.scrollLeft };
    moved.current = false;
    setGrabbing(true);
  }, []);

  const scrollByDir = (dir: -1 | 1) => {
    const el = ref.current;
    if (!el) return;
    el.scrollBy({ left: dir * Math.min(360, el.clientWidth * 0.85), behavior: "smooth" });
  };

  return (
    <div className="relative">
      {canLeft ? (
        <button
          type="button"
          aria-label="Scroll left"
          onClick={() => scrollByDir(-1)}
          className="absolute left-0 top-1/2 z-10 hidden h-10 w-10 -translate-y-1/2 items-center justify-center rounded-full border border-white/10 bg-pitflix-bg/95 text-white shadow-lg shadow-black/50 backdrop-blur-sm transition hover:bg-pitflix-card sm:flex"
        >
          <ChevronLeft className="h-6 w-6" strokeWidth={2} />
        </button>
      ) : null}
      {canRight ? (
        <button
          type="button"
          aria-label="Scroll right"
          onClick={() => scrollByDir(1)}
          className="absolute right-0 top-1/2 z-10 hidden h-10 w-10 -translate-y-1/2 items-center justify-center rounded-full border border-white/10 bg-pitflix-bg/95 text-white shadow-lg shadow-black/50 backdrop-blur-sm transition hover:bg-pitflix-card sm:flex"
        >
          <ChevronRight className="h-6 w-6" strokeWidth={2} />
        </button>
      ) : null}
      <div
        ref={ref}
        role="presentation"
        className={cn(
          "scroll-row-x cursor-grab overflow-x-auto overflow-y-hidden pb-3",
          grabbing && "cursor-grabbing select-none",
          className,
        )}
        onMouseDown={onMouseDown}
        onClickCapture={(e) => {
          // If the user dragged to scroll, suppress the click that would open a card.
          if (Date.now() - lastDragAt.current < 350) {
            e.preventDefault();
            e.stopPropagation();
          }
        }}
      >
        <div className="flex w-max gap-4">{children}</div>
      </div>
    </div>
  );
}
