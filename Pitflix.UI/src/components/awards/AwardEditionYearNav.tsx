import { useQueryClient } from "@tanstack/react-query";
import { ChevronLeft, ChevronRight } from "lucide-react";
import { useCallback, useEffect, useLayoutEffect, useRef, useState } from "react";
import { Link } from "react-router-dom";
import { getAwardEdition } from "../../api/awards";
import { cn } from "../../utils/cn";

export type AwardEditionYearNavProps = {
  awardId: string;
  years: number[];
  activeYear: number;
};

export function AwardEditionYearNav({ awardId, years, activeYear }: AwardEditionYearNavProps) {
  const qc = useQueryClient();
  const scrollerRef = useRef<HTMLDivElement | null>(null);
  const activeRef = useRef<HTMLAnchorElement | null>(null);
  const [canLeft, setCanLeft] = useState(false);
  const [canRight, setCanRight] = useState(false);

  const prefetchEdition = useCallback(
    (y: number) => {
      qc.prefetchQuery({
        queryKey: ["award-edition", awardId, y],
        queryFn: () => getAwardEdition(awardId, y),
        staleTime: 600_000,
        gcTime: 3_600_000,
      });
    },
    [awardId, qc],
  );

  const updateScrollHints = useCallback(() => {
    const el = scrollerRef.current;
    if (!el) {
      setCanLeft(false);
      setCanRight(false);
      return;
    }
    const { scrollLeft, scrollWidth, clientWidth } = el;
    const max = scrollWidth - clientWidth;
    setCanLeft(scrollLeft > 2);
    setCanRight(max > 2 && scrollLeft < max - 2);
  }, []);

  const scrollByDir = (dir: -1 | 1) => {
    const el = scrollerRef.current;
    if (!el) return;
    const delta = Math.min(el.clientWidth * 0.72, 320) * dir;
    el.scrollBy({ left: delta, behavior: "smooth" });
  };

  useLayoutEffect(() => {
    activeRef.current?.scrollIntoView({ inline: "center", block: "nearest", behavior: "auto" });
  }, [activeYear, years]);

  useLayoutEffect(() => {
    updateScrollHints();
  }, [years, activeYear, updateScrollHints]);

  useEffect(() => {
    const el = scrollerRef.current;
    if (!el) return;
    const ro = new ResizeObserver(() => updateScrollHints());
    ro.observe(el);
    el.addEventListener("scroll", updateScrollHints, { passive: true });
    return () => {
      ro.disconnect();
      el.removeEventListener("scroll", updateScrollHints);
    };
  }, [updateScrollHints, years]);

  if (years.length === 0) return null;

  return (
    <div className="space-y-2">
      <div className="flex items-center justify-between gap-3">
        <p className="text-[11px] font-semibold uppercase tracking-[0.12em] text-pitflix-subtle">
          Jump to year
        </p>
        <p className="hidden text-[11px] text-pitflix-subtle sm:block">
          {years.length} editions · drag or use arrows
        </p>
      </div>

      <div className="group/yearnav relative">
        {canLeft ? (
          <div
            className="pointer-events-none absolute left-0 top-0 z-[1] h-full w-10 bg-gradient-to-r from-pitflix-bg via-pitflix-bg/90 to-transparent sm:w-12"
            aria-hidden
          />
        ) : null}
        {canRight ? (
          <div
            className="pointer-events-none absolute right-0 top-0 z-[1] h-full w-10 bg-gradient-to-l from-pitflix-bg via-pitflix-bg/90 to-transparent sm:w-12"
            aria-hidden
          />
        ) : null}

        <button
          type="button"
          onClick={() => scrollByDir(-1)}
          disabled={!canLeft}
          className={cn(
            "absolute left-0 top-1/2 z-[2] flex h-9 w-9 -translate-y-1/2 items-center justify-center rounded-full",
            "border border-white/10 bg-pitflix-surface/95 text-white shadow-lg shadow-black/40",
            "transition-all hover:border-white/20 hover:bg-pitflix-card",
            "disabled:pointer-events-none disabled:opacity-0",
            "focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-pitflix-primary",
          )}
          aria-label="Scroll years left"
        >
          <ChevronLeft className="h-5 w-5 shrink-0" aria-hidden />
        </button>
        <button
          type="button"
          onClick={() => scrollByDir(1)}
          disabled={!canRight}
          className={cn(
            "absolute right-0 top-1/2 z-[2] flex h-9 w-9 -translate-y-1/2 items-center justify-center rounded-full",
            "border border-white/10 bg-pitflix-surface/95 text-white shadow-lg shadow-black/40",
            "transition-all hover:border-white/20 hover:bg-pitflix-card",
            "disabled:pointer-events-none disabled:opacity-0",
            "focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-pitflix-primary",
          )}
          aria-label="Scroll years right"
        >
          <ChevronRight className="h-5 w-5 shrink-0" aria-hidden />
        </button>

        <div
          ref={scrollerRef}
          className={cn(
            "flex snap-x snap-mandatory gap-1.5 overflow-x-auto px-10 py-1",
            "scroll-smooth [scrollbar-width:none] [-ms-overflow-style:none]",
            "[&::-webkit-scrollbar]:hidden",
            "touch-pan-x",
          )}
          style={{ WebkitOverflowScrolling: "touch" }}
          role="navigation"
          aria-label="Award years"
        >
          {years.map((y) => {
            const active = y === activeYear;
            return (
              <Link
                key={y}
                ref={active ? activeRef : undefined}
                to={`/awards/${encodeURIComponent(awardId)}/${y}`}
                onMouseEnter={() => prefetchEdition(y)}
                onFocus={() => prefetchEdition(y)}
                className={cn(
                  "snap-center shrink-0 rounded-full px-3 py-1.5 text-xs font-semibold tabular-nums transition-all",
                  "ring-1 ring-inset scroll-m-1",
                  active
                    ? "bg-pitflix-primary text-white shadow-lg shadow-pitflix-primary/25 ring-white/20"
                    : "bg-pitflix-surface/80 text-pitflix-muted ring-white/5 hover:bg-pitflix-card hover:text-white hover:ring-white/10",
                )}
              >
                {y}
              </Link>
            );
          })}
        </div>
      </div>
    </div>
  );
}
