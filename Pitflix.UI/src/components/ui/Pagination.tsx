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
    <div>
      <p className="mb-3 text-xs text-pitflix-subtle">
        Showing {formatCount(start)}–{formatCount(end)} of {formatCount(totalItems)} items
      </p>
      <div className="flex flex-wrap items-center gap-1">
        <button
          type="button"
          className="rounded-lg px-2 py-1 text-sm text-pitflix-muted hover:bg-pitflix-card disabled:opacity-30"
          disabled={currentPage <= 1}
          onClick={() => onPageChange(currentPage - 1)}
        >
          ←
        </button>
        {pages.map((p, i) =>
          p === "…" ? (
            <span key={`e-${i}`} className="px-2 text-pitflix-subtle">
              …
            </span>
          ) : (
            <button
              key={p}
              type="button"
              className={cn(
                "min-w-[2rem] rounded-lg px-2 py-1 text-sm",
                p === currentPage
                  ? "bg-pitflix-primary text-white"
                  : "text-pitflix-muted hover:bg-pitflix-card",
              )}
              onClick={() => onPageChange(p)}
            >
              {p}
            </button>
          ),
        )}
        <button
          type="button"
          className="rounded-lg px-2 py-1 text-sm text-pitflix-muted hover:bg-pitflix-card disabled:opacity-30"
          disabled={currentPage >= totalPages}
          onClick={() => onPageChange(currentPage + 1)}
        >
          →
        </button>
      </div>
    </div>
  );
}
