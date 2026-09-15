import { ChevronDown } from "lucide-react";
import type { ReactNode } from "react";
import { cn } from "../../utils/cn";

/** Dropdown filter styled to match LibrarySearchField's visual language (gradient card,
 * subtle inset highlight, focus ring) instead of a bare native `<select>`. */
export function LibraryFilterSelect({
  value,
  onChange,
  className,
  children,
}: {
  value: string;
  onChange: (value: string) => void;
  className?: string;
  children: ReactNode;
}) {
  return (
    <div className={cn("group relative", className)}>
      <select
        value={value}
        onChange={(e) => onChange(e.target.value)}
        // colorScheme here (in addition to the global :root one in index.css) makes sure this
        // control's own open option list stays dark even if something later scopes/overrides
        // color-scheme closer to the element.
        style={{ colorScheme: "dark" }}
        className="w-full cursor-pointer appearance-none rounded-2xl border border-white/10 bg-black/40 py-3 pl-4 pr-10 text-sm text-white shadow-[inset_0_1px_0_rgba(255,255,255,0.03)] transition-all hover:border-white/20 hover:bg-black/50 focus:border-pitflix-primary/55 focus:outline-none focus:ring-2 focus:ring-pitflix-primary/20"
      >
        {children}
      </select>
      <ChevronDown
        className="pointer-events-none absolute right-3.5 top-1/2 h-4 w-4 -translate-y-1/2 text-pitflix-subtle transition-colors group-focus-within:text-pitflix-primary group-hover:text-white"
        strokeWidth={2}
        aria-hidden
      />
    </div>
  );
}
