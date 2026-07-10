import { CalendarClock, Check, CloudDownload, Download, HardDriveDownload, X } from "lucide-react";
import type { MouseEventHandler, ReactNode } from "react";
import { AirDateCountdown } from "../ui/AirDateCountdown";
import { formatAirDateForDisplay } from "../../hooks/useCountdown";
import { cn } from "../../utils/cn";

/** Card shell classes for episodes outside the library. */
export function episodeExternalCardClass(
  kind: "missing" | "upcoming",
  extra?: string,
) {
  return cn(
    "relative overflow-hidden transition-all duration-300",
    kind === "missing" && [
      "border-amber-500/30 bg-gradient-to-b from-amber-950/20 via-pitflix-surface to-pitflix-surface",
      "shadow-[inset_0_1px_0_0_rgba(251,191,36,0.08)]",
      "hover:border-amber-400/50 hover:shadow-[0_8px_32px_-12px_rgba(251,191,36,0.25)]",
    ],
    kind === "upcoming" && [
      "border-violet-500/25 bg-gradient-to-b from-violet-950/15 via-pitflix-surface to-pitflix-surface",
      "shadow-[inset_0_1px_0_0_rgba(167,139,250,0.06)]",
      "hover:border-violet-400/40 hover:shadow-[0_8px_32px_-12px_rgba(139,92,246,0.2)]",
    ],
    extra,
  );
}

export function episodeExternalListClass(
  kind: "missing" | "upcoming",
  extra?: string,
) {
  return cn(
    kind === "missing" && "border-amber-500/25 bg-amber-950/10 hover:border-amber-400/40 hover:bg-amber-950/20",
    kind === "upcoming" && "border-violet-500/20 bg-violet-950/10 hover:border-violet-400/35 hover:bg-violet-950/15",
    extra,
  );
}

export function MissingEpisodesBanner({
  count,
  onDownload,
}: {
  count: number;
  onDownload: () => void;
}) {
  if (count <= 0) return null;
  return (
    <div className="relative mb-4 overflow-hidden rounded-2xl border border-amber-500/35 bg-gradient-to-r from-amber-950/50 via-amber-900/20 to-pitflix-surface/80 px-4 py-3.5 shadow-[inset_0_1px_0_0_rgba(251,191,36,0.12)]">
      <div
        className="pointer-events-none absolute -right-8 -top-8 h-32 w-32 rounded-full bg-amber-500/10 blur-2xl"
        aria-hidden
      />
      <div className="relative flex flex-wrap items-center justify-between gap-3">
        <div className="flex min-w-0 items-start gap-3">
          <span className="flex h-10 w-10 shrink-0 items-center justify-center rounded-xl bg-amber-500/15 ring-1 ring-amber-500/30">
            <HardDriveDownload className="h-5 w-5 text-amber-300" strokeWidth={2} />
          </span>
          <div>
            <p className="text-sm font-semibold text-amber-50">
              {count} released episode{count === 1 ? "" : "s"} missing from your library
            </p>
            <p className="mt-0.5 text-xs text-amber-200/70">
              These episodes have aired — download them to complete the season.
            </p>
          </div>
        </div>
        <button
          type="button"
          onClick={onDownload}
          className="inline-flex shrink-0 items-center gap-2 rounded-xl bg-gradient-to-r from-amber-500 to-orange-500 px-4 py-2 text-xs font-bold text-white shadow-lg shadow-amber-900/40 transition hover:from-amber-400 hover:to-orange-400 hover:shadow-amber-800/50"
        >
          <Download className="h-3.5 w-3.5" strokeWidth={2.5} />
          Download missing
        </button>
      </div>
    </div>
  );
}

export function EpisodeStatusBadge({
  kind,
  className,
}: {
  kind: "missing" | "upcoming";
  className?: string;
}) {
  if (kind === "missing") {
    return (
      <span
        className={cn(
          "inline-flex items-center gap-1 rounded-full bg-amber-500/90 px-2 py-0.5 text-[10px] font-bold uppercase tracking-wide text-amber-950 shadow-md shadow-amber-900/30 ring-1 ring-amber-300/40",
          className,
        )}
      >
        <CloudDownload className="h-2.5 w-2.5" strokeWidth={2.5} />
        Missing
      </span>
    );
  }
  return (
    <span
      className={cn(
        "inline-flex items-center gap-1 rounded-full bg-violet-500/85 px-2 py-0.5 text-[10px] font-bold uppercase tracking-wide text-white shadow-md shadow-violet-900/30 ring-1 ring-violet-300/30",
        className,
      )}
    >
      <CalendarClock className="h-2.5 w-2.5" strokeWidth={2.5} />
      Upcoming
    </span>
  );
}

/** Thumbnail overlay tint for non-library episodes. */
export function EpisodeExternalThumbOverlay({ kind }: { kind: "missing" | "upcoming" }) {
  return (
    <>
      <div
        className={cn(
          "pointer-events-none absolute inset-0 transition-opacity duration-300",
          kind === "missing" && "bg-gradient-to-t from-amber-950/70 via-amber-950/20 to-transparent",
          kind === "upcoming" && "bg-gradient-to-t from-violet-950/75 via-violet-950/25 to-transparent",
        )}
        aria-hidden
      />
      {kind === "missing" ? (
        <div className="pointer-events-none absolute inset-0 flex items-center justify-center opacity-0 transition-opacity duration-300 group-hover:opacity-100">
          <span className="flex h-11 w-11 items-center justify-center rounded-full bg-amber-500/90 text-white shadow-xl shadow-amber-900/50 ring-2 ring-amber-300/40">
            <Download className="h-5 w-5" strokeWidth={2.5} />
          </span>
        </div>
      ) : null}
    </>
  );
}

export function MissingEpisodeDownloadButton({
  onClick,
  layout = "grid",
  className,
}: {
  onClick: MouseEventHandler<HTMLButtonElement>;
  layout?: "grid" | "list";
  className?: string;
}) {
  if (layout === "list") {
    return (
      <button
        type="button"
        onClick={onClick}
        className={cn(
          "inline-flex shrink-0 items-center gap-2 rounded-xl bg-gradient-to-r from-amber-500 to-orange-500 px-4 py-2.5 text-xs font-bold text-white shadow-lg shadow-amber-900/35 transition hover:from-amber-400 hover:to-orange-400",
          className,
        )}
      >
        <Download className="h-3.5 w-3.5" strokeWidth={2.5} />
        Download
      </button>
    );
  }
  return (
    <button
      type="button"
      onClick={onClick}
      className={cn(
        "group/btn flex w-full items-center justify-center gap-2 rounded-xl border border-amber-400/30 bg-gradient-to-r from-amber-500/20 via-amber-500/10 to-orange-500/10 px-3 py-2 text-[11px] font-bold text-amber-100 ring-1 ring-inset ring-amber-500/20 transition hover:border-amber-400/50 hover:from-amber-500/30 hover:to-orange-500/20 hover:text-white",
        className,
      )}
    >
      <Download className="h-3.5 w-3.5 transition group-hover/btn:scale-110" strokeWidth={2.5} />
      Download episode
    </button>
  );
}

/** Lets the user mark a released-but-not-downloaded episode as watched (e.g. they saw it elsewhere)
 * without needing the file in the library — or unmark it again. */
export function MissingEpisodeMarkWatchedButton({
  onClick,
  busy,
  watched = false,
  layout = "grid",
  className,
}: {
  onClick: MouseEventHandler<HTMLButtonElement>;
  busy?: boolean;
  /** True to render as "Unmark watched" instead of "Mark watched". */
  watched?: boolean;
  layout?: "grid" | "list";
  className?: string;
}) {
  const Icon = watched ? X : Check;
  const label = busy ? "Saving…" : watched ? "Unmark watched" : "Mark watched";
  if (layout === "list") {
    return (
      <button
        type="button"
        onClick={onClick}
        disabled={busy}
        className={cn(
          "inline-flex shrink-0 items-center gap-2 rounded-xl border border-white/15 bg-white/[0.06] px-4 py-2.5 text-xs font-bold text-white/80 transition hover:border-white/25 hover:text-white disabled:opacity-50",
          className,
        )}
      >
        <Icon className="h-3.5 w-3.5" strokeWidth={2.5} />
        {label}
      </button>
    );
  }
  return (
    <button
      type="button"
      onClick={onClick}
      disabled={busy}
      className={cn(
        "flex w-full items-center justify-center gap-2 rounded-xl border border-white/15 bg-white/[0.05] px-3 py-2 text-[11px] font-bold text-white/70 transition hover:border-white/25 hover:text-white disabled:opacity-50",
        className,
      )}
    >
      <Icon className="h-3.5 w-3.5" strokeWidth={2.5} />
      {label}
    </button>
  );
}

type UpcomingPanelProps = {
  airDate: string | null | undefined;
  variant?: "row" | "card";
  className?: string;
};

/** Air date + countdown for episodes that have not aired yet. */
export function UpcomingEpisodePanel({ airDate, variant = "row", className }: UpcomingPanelProps) {
  if (!airDate?.trim()) {
    return (
      <div
        className={cn(
          "rounded-xl border border-violet-500/20 bg-violet-950/20 px-3 py-2 text-center text-xs text-violet-200/70",
          className,
        )}
      >
        Release date TBA
      </div>
    );
  }

  if (variant === "card") {
    return (
      <div
        className={cn(
          "rounded-xl border border-violet-500/25 bg-gradient-to-br from-violet-950/50 to-zinc-950/80 p-2.5 ring-1 ring-inset ring-violet-400/10",
          className,
        )}
      >
        <p className="text-center text-[10px] font-semibold uppercase tracking-wider text-violet-300/80">
          Airs {formatAirDateForDisplay(airDate)}
        </p>
        <div className="mt-2 flex justify-center">
          <AirDateCountdown airDate={airDate} layout="inline" compact />
        </div>
      </div>
    );
  }

  return (
    <div
      className={cn(
        "shrink-0 rounded-xl border border-violet-500/25 bg-gradient-to-br from-violet-950/40 to-zinc-950/70 px-3 py-2 ring-1 ring-inset ring-violet-400/10",
        className,
      )}
    >
      <p className="text-right text-[10px] font-semibold uppercase tracking-wider text-violet-300/80">
        Airs {formatAirDateForDisplay(airDate)}
      </p>
      <div className="mt-1.5 flex justify-end">
        <AirDateCountdown airDate={airDate} layout="segments" compact />
      </div>
    </div>
  );
}

/** Muted hint under title for missing episodes in grid cards. */
export function MissingEpisodeHint({ className }: { className?: string }) {
  return (
    <p className={cn("text-[10px] font-medium text-amber-300/60", className)}>
      Released · not in library
    </p>
  );
}

/** Optional wrapper to dim/desaturate thumb for external episodes. */
export function episodeExternalThumbClass(kind: "missing" | "upcoming", spoilerBlur?: boolean) {
  return cn(
    "h-full w-full object-cover transition-transform duration-300 group-hover:scale-105",
    kind === "missing" && "saturate-[0.55] brightness-75",
    kind === "upcoming" && "saturate-[0.45] brightness-[0.65]",
    spoilerBlur && "blur-md",
  );
}

export function EpisodeExternalListMeta({
  kind,
  airDate,
}: {
  kind: "missing" | "upcoming";
  airDate?: string | null;
}) {
  if (kind === "missing") {
    return (
      <p className="mt-0.5 flex items-center gap-1 text-[11px] text-amber-300/70">
        <CloudDownload className="h-3 w-3 shrink-0" />
        Available to download
      </p>
    );
  }
  if (airDate?.trim()) {
    return (
      <p className="mt-0.5 flex items-center gap-1 text-[11px] text-violet-300/70">
        <CalendarClock className="h-3 w-3 shrink-0" />
        Scheduled for {formatAirDateForDisplay(airDate)}
      </p>
    );
  }
  return null;
}

/** List row leading icon when episode is not in library. */
export function EpisodeExternalListIcon({ kind }: { kind: "missing" | "upcoming" }) {
  const Icon = kind === "missing" ? HardDriveDownload : CalendarClock;
  return (
    <span
      className={cn(
        "flex h-6 w-6 shrink-0 items-center justify-center rounded-lg ring-1",
        kind === "missing" && "bg-amber-500/15 text-amber-300 ring-amber-500/25",
        kind === "upcoming" && "bg-violet-500/15 text-violet-300 ring-violet-500/25",
      )}
      aria-hidden
    >
      <Icon className="h-3.5 w-3.5" strokeWidth={2} />
    </span>
  );
}

export function EpisodeExternalEmptyFooter({ children }: { children?: ReactNode }) {
  return <div className="mt-auto pt-2">{children}</div>;
}
