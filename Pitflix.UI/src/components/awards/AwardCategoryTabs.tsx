import { HorizontalDragScroll } from "../ui/HorizontalDragScroll";
import { cn } from "../../utils/cn";
import type { AwardCategory } from "../../api/awards";

export type AwardCategoryTabsProps = {
  categories: AwardCategory[];
  activeId: string | null;
  onSelect: (id: string) => void;
};

export function AwardCategoryTabs({ categories, activeId, onSelect }: AwardCategoryTabsProps) {
  if (categories.length === 0) return null;

  return (
    <div className="space-y-2">
      <p className="text-[11px] font-semibold uppercase tracking-[0.12em] text-pitflix-subtle">Category</p>
      <HorizontalDragScroll className="-mx-1 flex gap-1.5 px-1 pb-1">
        {categories.map((c) => {
          const active = c.id === activeId;
          return (
            <button
              key={c.id}
              type="button"
              onClick={() => onSelect(c.id)}
              className={cn(
                "shrink-0 rounded-full px-3 py-1.5 text-left text-xs font-semibold transition-all",
                "ring-1 ring-inset",
                active
                  ? "bg-pitflix-primary text-white shadow-md shadow-pitflix-primary/20 ring-white/25"
                  : "max-w-[220px] truncate bg-pitflix-surface/80 text-pitflix-muted ring-white/5 hover:bg-pitflix-card hover:text-white",
              )}
            >
              {c.name}
            </button>
          );
        })}
      </HorizontalDragScroll>
    </div>
  );
}
