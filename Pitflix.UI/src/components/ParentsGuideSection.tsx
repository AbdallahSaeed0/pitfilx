import { useQuery } from "@tanstack/react-query";
import { useEffect, useState } from "react";
import { ChevronDown, ShieldAlert } from "lucide-react";
import { getParentsGuide } from "../api/stream";
import { Spinner } from "./ui/Spinner";
import { cn } from "../utils/cn";

/** Active-tab background per severity — inactive tabs stay neutral, only the selected one is colored. */
const SEVERITY_TAB_ACTIVE: Record<string, string> = {
  None: "bg-emerald-500 text-white shadow-sm",
  Mild: "bg-yellow-500 text-black shadow-sm",
  Moderate: "bg-orange-500 text-white shadow-sm",
  Severe: "bg-red-500 text-white shadow-sm",
  Unknown: "bg-pitflix-primary text-white shadow-sm",
};

const SEVERITY_DOT: Record<string, string> = {
  None: "bg-emerald-400",
  Mild: "bg-yellow-400",
  Moderate: "bg-orange-400",
  Severe: "bg-red-400",
  Unknown: "bg-white/30",
};

const SEVERITY_TEXT: Record<string, string> = {
  None: "text-emerald-300",
  Mild: "text-yellow-300",
  Moderate: "text-orange-300",
  Severe: "text-red-300",
  Unknown: "text-pitflix-muted",
};

export function ParentsGuideSection({ imdbId }: { imdbId: string | null | undefined }) {
  const [tab, setTab] = useState<string | null>(null);
  const [expanded, setExpanded] = useState(false);

  const q = useQuery({
    queryKey: ["parents-guide", imdbId],
    queryFn: () => getParentsGuide(imdbId!),
    enabled: !!imdbId,
    staleTime: 24 * 60 * 60 * 1000,
    gcTime: 24 * 60 * 60 * 1000,
    retry: false,
  });

  const categories = q.data?.categories ?? [];

  // Default to the first (worst-listed) category once data arrives.
  useEffect(() => {
    if (categories.length > 0 && (tab == null || !categories.some((c) => c.name === tab))) {
      setTab(categories[0]!.name);
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [categories.length, imdbId]);

  if (!imdbId) return null;

  if (!q.isLoading && (q.isError || !q.data || q.data.error || categories.length === 0)) return null;

  const overallRating = q.data?.overallRating;
  const active = categories.find((c) => c.name === tab) ?? categories[0];

  return (
    <div className="-mx-6 border-t border-white/5 px-12 py-5">
      <button
        type="button"
        onClick={() => setExpanded((v) => !v)}
        className="flex w-full items-center gap-2 text-left"
      >
        <ShieldAlert className="h-4 w-4 text-pitflix-primary" />
        <p className="text-[11px] font-semibold uppercase tracking-[0.12em] text-white/35">Parents Guide</p>
        {overallRating ? (
          <span className="text-[11px] text-pitflix-subtle">{overallRating}</span>
        ) : null}
        <ChevronDown
          className={cn("ml-auto h-4 w-4 text-white/35 transition-transform", expanded ? "rotate-180" : "")}
        />
      </button>

      {expanded ? (
        q.isLoading ? (
          <div className="mt-3 flex items-center gap-2 text-xs text-pitflix-subtle">
            <Spinner className="h-4 w-4" />
            Checking IMDb…
          </div>
        ) : active ? (
          <>
            <div className="mb-3 mt-3 flex flex-wrap gap-1.5">
              {categories.map((c) => {
                const isActive = c.name === active.name;
                return (
                  <button
                    key={c.name}
                    type="button"
                    onClick={() => setTab(c.name)}
                    className={cn(
                      "flex items-center gap-1.5 rounded-full px-3 py-1 text-[11px] font-semibold transition-all",
                      isActive
                        ? SEVERITY_TAB_ACTIVE[c.severity] ?? SEVERITY_TAB_ACTIVE.Unknown
                        : "border border-white/10 text-pitflix-muted hover:border-white/25 hover:text-white",
                    )}
                  >
                    {!isActive ? (
                      <span className={cn("h-1.5 w-1.5 shrink-0 rounded-full", SEVERITY_DOT[c.severity] ?? SEVERITY_DOT.Unknown)} />
                    ) : null}
                    {c.name}
                  </button>
                );
              })}
            </div>

            <div className="rounded-xl border border-white/[0.07] bg-white/[0.02] p-4">
              <div className="mb-3 flex items-center justify-between">
                <p className="text-sm font-semibold text-white">{active.name}</p>
                <span className={cn("text-[11px] font-bold uppercase tracking-wide", SEVERITY_TEXT[active.severity] ?? SEVERITY_TEXT.Unknown)}>
                  {active.severity}
                </span>
              </div>
              {active.items.length > 0 ? (
                <ul className="space-y-2.5 text-[13px] leading-relaxed text-white/80">
                  {active.items.map((item, i) => (
                    <li key={i} className="flex gap-2.5">
                      <span className="mt-[7px] h-1 w-1 shrink-0 rounded-full bg-white/30" />
                      <span>{item}</span>
                    </li>
                  ))}
                </ul>
              ) : (
                <p className="text-[13px] text-pitflix-subtle">No specific details listed for this category.</p>
              )}
            </div>
          </>
        ) : null
      ) : null}
    </div>
  );
}
