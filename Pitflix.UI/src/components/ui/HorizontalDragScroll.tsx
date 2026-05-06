import { type ReactNode, useCallback, useEffect, useRef, useState } from "react";
import { cn } from "../../utils/cn";

type Props = {
  children: ReactNode;
  className?: string;
};

/**
 * Horizontal row that scrolls with wheel (shift+wheel or trackpad deltaX) and click-drag.
 */
export function HorizontalDragScroll({ children, className }: Props) {
  const ref = useRef<HTMLDivElement>(null);
  const drag = useRef<{ x: number; left: number } | null>(null);
  const moved = useRef(false);
  const lastDragAt = useRef(0);
  const [grabbing, setGrabbing] = useState(false);

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

  const onWheel = useCallback((e: React.WheelEvent<HTMLDivElement>) => {
    const el = ref.current;
    if (!el) return;
    const dx = e.deltaX !== 0 ? e.deltaX : e.shiftKey ? e.deltaY : 0;
    if (dx === 0) return;
    e.preventDefault();
    el.scrollLeft += dx;
  }, []);

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

  return (
    <div
      ref={ref}
      role="presentation"
      className={cn(
        "scroll-row-x cursor-grab overflow-x-auto overflow-y-hidden pb-3",
        grabbing && "cursor-grabbing select-none",
        className,
      )}
      onWheel={onWheel}
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
  );
}
