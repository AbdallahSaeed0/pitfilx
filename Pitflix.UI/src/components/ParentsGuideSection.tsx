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

/** Worst-first ranking so the card's accent reflects the most severe category, not just whichever
 * tab happens to be selected — that's what a scanning eye actually needs to notice. */
const SEVERITY_RANK: Record<string, number> = { Severe: 3, Moderate: 2, Mild: 1, None: 0, Unknown: 0 };

/** Card-level accent per worst severity — border/glow/badge, distinct enough to catch the eye while
 * scrolling past (the old version was a barely-there muted-gray row that blended into everything
 * around it). */
const SEVERITY_CARD: Record<string, { border: string; glow: string; iconBg: string; badge: string }> = {
  None: {
    border: "border-emerald-500/40",
    glow: "shadow-[0_0_24px_-8px_rgba(16,185,129,0.35)]",
    iconBg: "bg-emerald-500/15 text-emerald-400",
    badge: "bg-emerald-500 text-white",
  },
  Mild: {
    border: "border-yellow-500/40",
    glow: "shadow-[0_0_24px_-8px_rgba(234,179,8,0.35)]",
    iconBg: "bg-yellow-500/15 text-yellow-400",
    badge: "bg-yellow-500 text-black",
  },
  Moderate: {
    border: "border-orange-500/40",
    glow: "shadow-[0_0_24px_-8px_rgba(249,115,22,0.4)]",
    iconBg: "bg-orange-500/15 text-orange-400",
    badge: "bg-orange-500 text-white",
  },
  Severe: {
    border: "border-red-500/50",
    glow: "shadow-[0_0_28px_-6px_rgba(239,68,68,0.45)]",
    iconBg: "bg-red-500/15 text-red-400",
    badge: "bg-red-500 text-white",
  },
  Unknown: {
    border: "border-pitflix-primary/40",
    glow: "shadow-[0_0_24px_-8px_rgba(139,92,246,0.35)]",
    iconBg: "bg-pitflix-primary/15 text-pitflix-primary",
    badge: "bg-pitflix-primary text-white",
  },
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

  // The card's accent reflects the single worst category present, not whichever tab is currently
  // selected — someone skimming past should see at a glance whether anything here is severe.
  const worstSeverity = categories.reduce<string>((worst, c) => {
    const rank = SEVERITY_RANK[c.severity] ?? 0;
    return rank > (SEVERITY_RANK[worst] ?? 0) ? c.severity : worst;
  }, categories[0]?.severity ?? "Unknown");
  const cardStyle = SEVERITY_CARD[worstSeverity] ?? SEVERITY_CARD.Unknown!;

  return (
    <div className="my-6">
      <div
        className={cn(
          "overflow-hidden rounded-2xl border-2 bg-pitflix-surface/60 transition-shadow",
          cardStyle.border,
          cardStyle.glow,
        )}
      >
        <button
          type="button"
          onClick={() => setExpanded((v) => !v)}
          className="flex w-full items-center gap-3 px-5 py-4 text-left"
        >
          <span className={cn("flex h-9 w-9 shrink-0 items-center justify-center rounded-full", cardStyle.iconBg)}>
            <ShieldAlert className="h-5 w-5" />
          </span>
          <div className="min-w-0">
            <p className="text-sm font-bold text-white">Parents Guide</p>
            {overallRating ? (
              <p className="text-xs text-pitflix-subtle">{overallRating}</p>
            ) : null}
          </div>
          {!q.isLoading && worstSeverity !== "None" ? (
            <span
              className={cn(
                "ml-auto shrink-0 rounded-full px-3 py-1 text-[11px] font-bold uppercase tracking-wide",
                cardStyle.badge,
              )}
            >
              {worstSeverity}
            </span>
          ) : null}
          <ChevronDown
            className={cn(
              "h-5 w-5 shrink-0 text-white/50 transition-transform",
              worstSeverity === "None" ? "ml-auto" : "",
              expanded ? "rotate-180" : "",
            )}
          />
        </button>

        {expanded ? (
        <div className="border-t border-white/[0.06] px-5 pb-5 pt-4">
        {q.isLoading ? (
          <div className="flex items-center gap-2 text-xs text-pitflix-subtle">
            <Spinner className="h-4 w-4" />
            Checking IMDb…
          </div>
        ) : active ? (
          <>
            <div className="mb-3 flex flex-wrap gap-1.5">
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
        ) : null}
        </div>
        ) : null}
      </div>
    </div>
  );
}
