import { ChevronLeft, ChevronRight } from "lucide-react";
import { cn } from "../../utils/cn";
import { formatCount } from "../../utils/format";

export type PaginationProps = {
  currentPage: number;
  totalPages: number;
  totalItems: number;
  pageSize: number;
  onPageChange: (p: number) => void;
};

export function Pagination({
  currentPage,
  totalPages,
  totalItems,
  pageSize,
  onPageChange,
}: PaginationProps) {
  if (totalPages <= 1) return null;

  const start = totalItems === 0 ? 0 : (currentPage - 1) * pageSize + 1;
  const end = Math.min(currentPage * pageSize, totalItems);

  const windowSize = 5;
  let startP = Math.max(1, currentPage - 2);
  let endP = Math.min(totalPages, startP + windowSize - 1);
  startP = Math.max(1, endP - windowSize + 1);

  const pages: (number | "…")[] = [];
  if (startP > 1) {
    pages.push(1);
    if (startP > 2) pages.push("…");
  }
  for (let p = startP; p <= endP; p++) pages.push(p);
  if (endP < totalPages) {
    if (endP < totalPages - 1) pages.push("…");
    pages.push(totalPages);
  }

  return (
    <div className="rounded-2xl border border-white/10 bg-pitflix-surface/40 p-4 shadow-[inset_0_1px_0_rgba(255,255,255,0.04)] backdrop-blur-sm">
      <p className="mb-4 text-xs font-medium tracking-wide text-pitflix-subtle">
        Showing {formatCount(start)}–{formatCount(end)} of {formatCount(totalItems)}
      </p>
      <div className="flex flex-wrap items-center gap-1.5">
        <button
          type="button"
          className="flex h-10 w-10 shrink-0 items-center justify-center rounded-xl border border-white/10 bg-pitflix-bg/80 text-pitflix-muted transition hover:border-pitflix-primary/45 hover:text-white disabled:pointer-events-none disabled:opacity-35"
          disabled={currentPage <= 1}
          onClick={() => onPageChange(currentPage - 1)}
          aria-label="Previous page"
        >
          <ChevronLeft className="h-5 w-5" strokeWidth={2} />
        </button>
        <div className="flex flex-wrap items-center gap-1">
          {pages.map((p, i) =>
            p === "…" ? (
              <span key={`e-${i}`} className="px-2 text-sm text-pitflix-subtle">
                …
              </span>
            ) : (
              <button
                key={p}
                type="button"
                className={cn(
                  "flex min-h-10 min-w-[2.5rem] items-center justify-center rounded-xl px-3 text-sm font-semibold transition",
                  p === currentPage
                    ? "bg-gradient-to-b from-pitflix-primary to-pitflix-dark text-white shadow-lg shadow-pitflix-primary/25 ring-1 ring-white/15"
                    : "border border-transparent text-pitflix-muted hover:border-white/10 hover:bg-pitflix-card/80 hover:text-white",
                )}
                onClick={() => onPageChange(p)}
              >
                {p}
              </button>
            ),
          )}
        </div>
        <button
          type="button"
          className="flex h-10 w-10 shrink-0 items-center justify-center rounded-xl border border-white/10 bg-pitflix-bg/80 text-pitflix-muted transition hover:border-pitflix-primary/45 hover:text-white disabled:pointer-events-none disabled:opacity-35"
          disabled={currentPage >= totalPages}
          onClick={() => onPageChange(currentPage + 1)}
          aria-label="Next page"
        >
          <ChevronRight className="h-5 w-5" strokeWidth={2} />
        </button>
      </div>
    </div>
  );
}
