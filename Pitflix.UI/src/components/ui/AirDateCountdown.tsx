import { Clock } from "lucide-react";
import {
  AIR_SCHEDULE_TIMEZONE,
  airDateToUtcMs,
  toCountdownSegments,
  useCountdown,
  type CountdownUnit,
} from "../../hooks/useCountdown";
import { cn } from "../../utils/cn";

const UNIT_DISPLAY: Record<CountdownUnit, string> = {
  d: "D",
  h: "H",
  m: "M",
  s: "S",
};

function shellClass(remainingMs: number): { wrap: string; accent: string } {
  if (remainingMs <= 0) {
    return {
      wrap: "from-emerald-400/50 via-emerald-500/25 to-teal-500/30",
      accent: "shadow-[0_0_24px_-6px_rgba(52,211,153,0.45)]",
    };
  }
  if (remainingMs <= 3600000) {
    return {
      wrap: "from-rose-400/55 via-fuchsia-500/25 to-rose-600/35",
      accent: "shadow-[0_0_28px_-8px_rgba(244,63,94,0.45)]",
    };
  }
  if (remainingMs <= 86400000) {
    return {
      wrap: "from-amber-400/45 via-orange-500/20 to-amber-600/30",
      accent: "shadow-[0_0_22px_-8px_rgba(251,191,36,0.35)]",
    };
  }
  return {
    wrap: "from-violet-400/35 via-fuchsia-500/15 to-violet-600/25",
    accent: "shadow-[0_0_20px_-10px_rgba(167,139,250,0.35)]",
  };
}

function innerPanelClass(remainingMs: number): string {
  if (remainingMs <= 0) return "bg-emerald-950/90 ring-emerald-500/25";
  if (remainingMs <= 3600000) return "bg-zinc-950/95 ring-rose-500/30";
  if (remainingMs <= 86400000) return "bg-zinc-950/95 ring-amber-500/25";
  return "bg-zinc-950/95 ring-white/10";
}

function segmentsToAria(segments: { unit: string; value: number }[]): string {
  return (
    segments
      .map(({ unit, value }) => {
        const label =
          unit === "d"
            ? value === 1
              ? "day"
              : "days"
            : unit === "h"
              ? value === 1
                ? "hour"
                : "hours"
              : unit === "m"
                ? value === 1
                  ? "minute"
                  : "minutes"
                : value === 1
                  ? "second"
                  : "seconds";
        return `${value} ${label}`;
      })
      .join(", ") + " remaining (Cairo)"
  );
}

type AirDateCountdownProps = {
  airDate: string;
  airTime?: string | null;
  layout?: "segments" | "inline";
  size?: "sm" | "md";
  /** Extra-narrow rows (e.g. coming soon carousel). */
  compact?: boolean;
  className?: string;
};

export function AirDateCountdown({
  airDate,
  airTime,
  layout = "segments",
  size = "sm",
  compact = false,
  className,
}: AirDateCountdownProps) {
  const target = airDateToUtcMs(airDate, airTime ?? null);
  const left = useCountdown(target);

  if (left == null) return null;

  const sm = size === "sm";
  const digitSize = sm ? "text-base sm:text-lg" : "text-lg sm:text-xl";
  const labelSize = compact ? "text-[8px]" : "text-[9px] sm:text-[10px]";
  const iconBox = sm ? "h-7 w-7 sm:h-8 sm:w-8" : "h-8 w-8 sm:h-9 sm:w-9";

  if (left <= 0) {
    if (layout === "inline" && compact) {
      return (
        <div
          role="timer"
          title={`Airing now · ${AIR_SCHEDULE_TIMEZONE.replace("_", " ")}`}
          className={cn(
            "w-full rounded-md bg-emerald-950/90 py-1 text-center text-[11px] font-semibold text-emerald-200 ring-1 ring-emerald-500/30",
            className,
          )}
          aria-live="polite"
        >
          Live
        </div>
      );
    }
    const { wrap, accent } = shellClass(0);
    return (
      <div className={cn("inline-flex flex-col items-end gap-1", className)}>
        <div
          role="timer"
          title={`Air window ended · ${AIR_SCHEDULE_TIMEZONE.replace("_", " ")}`}
          className={cn(
            "relative inline-flex overflow-hidden rounded-2xl bg-gradient-to-br p-[1px]",
            wrap,
            accent,
          )}
          aria-live="polite"
          aria-label="Airing now or started (Cairo)"
        >
          <div
            className={cn(
              "flex w-full items-center gap-2 rounded-2xl px-3 py-2 ring-1 ring-inset backdrop-blur-md",
              innerPanelClass(0),
            )}
          >
            <span
              className={cn(
                "flex items-center justify-center rounded-xl bg-emerald-500/20 ring-1 ring-emerald-400/30",
                iconBox,
              )}
            >
              <Clock className="h-4 w-4 text-emerald-300" aria-hidden strokeWidth={2} />
            </span>
            <span className={cn("font-semibold tracking-tight text-emerald-100", sm ? "text-sm" : "text-base")}>
              Live
            </span>
          </div>
        </div>
        {!compact ? (
          <span className="text-[9px] font-semibold uppercase tracking-[0.28em] text-zinc-500">Cairo</span>
        ) : null}
      </div>
    );
  }

  const segments = toCountdownSegments(left);
  if (!segments?.length) return null;

  const aria = segmentsToAria(segments);
  const { wrap, accent } = shellClass(left);
  const ringInner = innerPanelClass(left);

  const segmentColClass = compact
    ? "flex min-w-0 flex-col items-center justify-center border-r border-white/[0.08] px-1 py-1 last:border-r-0"
    : "flex min-w-[2.65rem] flex-col items-center justify-center border-r border-white/[0.06] px-2 py-1.5 last:border-r-0 sm:min-w-[3rem] sm:px-2.5 sm:py-2";

  const segmentBlocks = segments.map(({ unit, value }, i) => (
    <div key={`${unit}-${i}`} className={segmentColClass}>
      <span
        className={cn(
          "font-semibold tabular-nums leading-none tracking-tight text-white",
          compact ? "text-sm" : digitSize,
        )}
      >
        {value}
      </span>
      <span
        className={cn(
          "mt-0.5 font-semibold uppercase leading-none tracking-wider text-zinc-500",
          compact ? "text-[8px]" : labelSize,
        )}
      >
        {UNIT_DISPLAY[unit]}
      </span>
    </div>
  ));

  const cairoFooter = (
    <span className="text-[9px] font-semibold uppercase tracking-[0.28em] text-zinc-500">Cairo time</span>
  );

  if (layout === "inline") {
    const stripTitle = `Countdown to end of ${airDate} · Cairo (${AIR_SCHEDULE_TIMEZONE.replace("_", " ")})`;

    if (compact) {
      return (
        <div
          role="timer"
          title={stripTitle}
          aria-live="polite"
          aria-label={aria}
          className={cn("w-full max-w-full min-w-0", className)}
        >
          <div
            className={cn(
              "overflow-hidden rounded-lg bg-zinc-950/90 ring-1 ring-violet-500/25 backdrop-blur-sm",
              accent,
            )}
          >
            <div
              className="grid w-full min-w-0"
              style={{
                gridTemplateColumns: `repeat(${segments.length}, minmax(0, 1fr))`,
              }}
            >
              {segmentBlocks}
            </div>
          </div>
        </div>
      );
    }

    return (
      <div className={cn("inline-flex max-w-full flex-col items-start gap-1", className)}>
        <div
          role="timer"
          title={stripTitle}
          className={cn("relative inline-flex max-w-full overflow-hidden rounded-xl bg-gradient-to-br p-px", wrap)}
          aria-live="polite"
          aria-label={aria}
        >
          <div
            className={cn(
              "flex w-full min-w-0 flex-nowrap items-stretch rounded-[11px] backdrop-blur-md ring-1 ring-inset",
              ringInner,
              accent,
            )}
          >
            <span
              className={cn(
                "flex shrink-0 items-center justify-center border-r border-white/[0.06] bg-black/20 px-2",
                iconBox,
              )}
            >
              <Clock className="h-3.5 w-3.5 text-zinc-400" aria-hidden strokeWidth={2} />
            </span>
            <span className="flex min-w-0 flex-1 flex-nowrap items-stretch">{segmentBlocks}</span>
          </div>
        </div>
        {cairoFooter}
      </div>
    );
  }

  return (
    <div className={cn("inline-flex flex-col items-end gap-1", className)}>
      <div
        role="timer"
        title={`Countdown to end of ${airDate} · ${AIR_SCHEDULE_TIMEZONE.replace("_", " ")}`}
        className={cn("relative inline-flex overflow-hidden rounded-2xl bg-gradient-to-br p-[1px]", wrap, accent)}
        aria-live="polite"
        aria-label={aria}
      >
        <div
          className={cn(
            "flex items-stretch rounded-2xl backdrop-blur-md ring-1 ring-inset",
            ringInner,
          )}
        >
          <span
            className={cn(
              "flex shrink-0 items-center justify-center border-r border-white/[0.06] bg-gradient-to-b from-white/[0.07] to-transparent px-2 sm:px-2.5",
            )}
          >
            <Clock className="h-4 w-4 text-violet-300/90 sm:h-[18px] sm:w-[18px]" aria-hidden strokeWidth={2} />
          </span>
          <span className="flex flex-wrap items-stretch justify-end">{segmentBlocks}</span>
        </div>
      </div>
      {!compact ? cairoFooter : null}
    </div>
  );
}
