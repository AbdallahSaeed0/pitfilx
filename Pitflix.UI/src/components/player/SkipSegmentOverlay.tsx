import { useEffect } from "react";
import { SkipForward, X } from "lucide-react";
import type { SkipSegment } from "../../api/skip";

export type ActiveSkipSegment = {
  kind: "intro" | "outro";
  segment: SkipSegment;
};

type Props = {
  active: ActiveSkipSegment | null;
  onSkip: () => void;
  onDismiss: () => void;
};

const AUTO_HIDE_MS = 10_000;
const LOW_CONFIDENCE_THRESHOLD = 0.6;

/**
 * Floating "Skip Intro" / "Skip Credits" button, shown while the playhead is inside a
 * detected intro/outro range. Auto-hides after 10s of no action; dismissing (via the X or
 * the timeout) is the parent's job to remember for the rest of this range — this component
 * just renders whatever `active` it's given and reports skip/dismiss intent.
 */
export function SkipSegmentOverlay({ active, onSkip, onDismiss }: Props) {
  useEffect(() => {
    if (!active) return;
    const t = window.setTimeout(onDismiss, AUTO_HIDE_MS);
    return () => window.clearTimeout(t);
    // Re-arm the timer whenever a *different* segment becomes active (new kind or start time),
    // not on every render of the same one.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [active?.kind, active?.segment.start]);

  if (!active) return null;

  const { kind, segment } = active;
  const label = kind === "intro" ? "Skip Intro" : "Skip Credits";
  const lowConfidence =
    typeof segment.confidence === "number" && segment.confidence < LOW_CONFIDENCE_THRESHOLD;

  return (
    <div className="pointer-events-none absolute inset-0 z-40 flex items-end justify-end p-6 pb-24">
      <div
        className={`pointer-events-auto flex items-center gap-1 rounded-xl border backdrop-blur-md transition-opacity ${
          lowConfidence
            ? "border-white/10 bg-pitflix-card/80 opacity-80"
            : "border-white/15 bg-pitflix-card/95"
        }`}
      >
        <button
          type="button"
          onClick={onSkip}
          className="flex items-center gap-2 rounded-l-xl px-4 py-2.5 text-sm font-semibold text-white transition-colors hover:bg-white/10"
        >
          <SkipForward className="h-4 w-4" fill="currentColor" />
          {label}
          {lowConfidence ? (
            <span className="rounded-full bg-white/10 px-1.5 py-0.5 text-[10px] font-medium uppercase tracking-wide text-pitflix-muted">
              Estimated
            </span>
          ) : null}
        </button>
        <button
          type="button"
          onClick={onDismiss}
          aria-label="Dismiss"
          title="Dismiss"
          className="flex h-9 w-9 items-center justify-center rounded-r-xl text-pitflix-muted transition-colors hover:bg-white/10 hover:text-white"
        >
          <X className="h-4 w-4" />
        </button>
      </div>
    </div>
  );
}
