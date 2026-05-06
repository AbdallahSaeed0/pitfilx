import { Search } from "lucide-react";

export function LibrarySearchField({
  value,
  onChange,
  placeholder = "Search titles…",
}: {
  value: string;
  onChange: (value: string) => void;
  placeholder?: string;
}) {
  return (
    <div className="group relative min-w-[min(100%,280px)] flex-1">
      <Search
        className="pointer-events-none absolute left-3.5 top-1/2 h-4 w-4 -translate-y-1/2 text-pitflix-subtle transition-colors group-focus-within:text-pitflix-primary"
        strokeWidth={2}
        aria-hidden
      />
      <input
        value={value}
        onChange={(e) => onChange(e.target.value)}
        placeholder={placeholder}
        className="w-full rounded-2xl border border-white/10 bg-gradient-to-b from-pitflix-card/95 to-pitflix-bg/80 py-3 pl-11 pr-4 text-sm text-white shadow-[inset_0_1px_0_rgba(255,255,255,0.04)] placeholder:text-pitflix-subtle transition-all focus:border-pitflix-primary/55 focus:outline-none focus:ring-2 focus:ring-pitflix-primary/20"
      />
    </div>
  );
}
