import type { ReactNode } from "react";
import { useCallback, useEffect, useLayoutEffect, useRef, useState } from "react";
import { ChevronLeft, ChevronRight } from "lucide-react";
import { cn } from "../../utils/cn";

type HorizontalScrollRowProps = {
  title?: string;
  /** e.g. “See all →” link */
  titleRight?: ReactNode;
  /** When true, only the scroll strip is rendered (use an external section header). */
  hideHeader?: boolean;
  children: ReactNode;
  className?: string;
  contentClassName?: string;
};

export function HorizontalScrollRow({
  title = "",
  titleRight,
  hideHeader = false,
  children,
  className,
  contentClassName,
}: HorizontalScrollRowProps) {
  const scrollerRef = useRef<HTMLDivElement>(null);
  const [canLeft, setCanLeft] = useState(false);
  const [canRight, setCanRight] = useState(false);

  const updateArrows = useCallback(() => {
    const el = scrollerRef.current;
    if (!el) return;
    const { scrollLeft, scrollWidth, clientWidth } = el;
    setCanLeft(scrollLeft > 2);
    setCanRight(scrollLeft + clientWidth < scrollWidth - 2);
  }, []);

  useLayoutEffect(() => {
    updateArrows();
  }, [updateArrows]);

  useEffect(() => {
    const el = scrollerRef.current;
    if (!el) return;

    el.addEventListener("scroll", updateArrows, { passive: true });
    const ro = new ResizeObserver(() => updateArrows());
    ro.observe(el);

    return () => {
      el.removeEventListener("scroll", updateArrows);
      ro.disconnect();
    };
  }, [updateArrows]);

  const scrollByDir = (dir: -1 | 1) => {
    const el = scrollerRef.current;
    if (!el) return;
    el.scrollBy({ left: dir * Math.min(360, el.clientWidth * 0.85), behavior: "smooth" });
  };

  const showHeaderRow = !hideHeader && (Boolean(title) || titleRight != null);

  return (
    <section className={cn("mb-10", className)}>
      {showHeaderRow ? (
        <div className="mb-4 flex items-center justify-between gap-3">
          {title ? <h2 className="text-xl font-bold text-white">{title}</h2> : <span />}
          {titleRight ?? null}
        </div>
      ) : null}
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
          ref={scrollerRef}
          className={cn("scroll-row-x flex gap-5 pb-4 scroll-smooth", contentClassName)}
        >
          {children}
        </div>
      </div>
    </section>
  );
}
