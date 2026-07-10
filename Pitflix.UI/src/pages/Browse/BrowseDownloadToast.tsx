import { AnimatePresence, motion } from "framer-motion";
import { CheckCircle2, AlertTriangle, Loader2 } from "lucide-react";
import { useEffect } from "react";
import { cn } from "../../utils/cn";

export type BrowseToastState =
  | { kind: "success"; message: string }
  | { kind: "error"; message: string }
  | { kind: "pending"; message: string; jobId: string; progressPercent?: number | null };

type Props = {
  state: BrowseToastState | null;
  onDismiss: () => void;
  onCancel?: (jobId: string) => void;
};

/** Small local toast for the Browse tab's download hand-off — deliberately its own
 * component (not the shared scan-store toast) to keep this feature isolated.
 *
 * Deliberately NOT `position: fixed` over the page. The embedded browse tab is a
 * real native OS-level child webview layered on top of the page's own HTML —
 * any fixed/floating overlay whose screen position falls inside that webview's
 * bounds (e.g. the usual bottom-right toast corner) gets painted over and is
 * invisible, even though React is rendering it correctly. Rendering inline, in
 * normal document flow, above the container div that hosts the webview,
 * guarantees it's never inside that covered region. */
export function BrowseDownloadToast({ state, onDismiss, onCancel }: Props) {
  useEffect(() => {
    // "pending" (a download still running) is replaced by a "success"/"error"
    // update once the backend finishes — don't time it out from under itself.
    if (!state || state.kind === "pending") return;
    const t = window.setTimeout(onDismiss, 4000);
    return () => window.clearTimeout(t);
  }, [state, onDismiss]);

  const percent =
    state?.kind === "pending" && typeof state.progressPercent === "number"
      ? Math.round(Math.max(0, Math.min(100, state.progressPercent)))
      : null;

  return (
    <AnimatePresence>
      {state ? (
        <motion.div
          role="status"
          initial={{ opacity: 0, height: 0 }}
          animate={{ opacity: 1, height: "auto" }}
          exit={{ opacity: 0, height: 0 }}
          transition={{ duration: 0.15 }}
          className="flex flex-col gap-1.5 overflow-hidden rounded-lg border border-pitflix-card bg-pitflix-surface px-3 py-2 text-xs"
        >
          <div className="flex items-center gap-2">
            {state.kind === "success" ? (
              <CheckCircle2 className="h-4 w-4 shrink-0 text-emerald-400" />
            ) : state.kind === "pending" ? (
              <Loader2 className="h-4 w-4 shrink-0 animate-spin text-pitflix-muted" />
            ) : (
              <AlertTriangle className="h-4 w-4 shrink-0 text-amber-400" />
            )}
            <span className={cn("flex-1 text-white", state.kind === "error" && "text-amber-200")}>
              {state.message}
              {percent != null ? ` — ${percent}%` : null}
            </span>
            {state.kind === "pending" && onCancel ? (
              <button
                type="button"
                onClick={() => onCancel(state.jobId)}
                className="shrink-0 text-[11px] font-medium text-pitflix-muted underline-offset-2 hover:text-white hover:underline"
              >
                Cancel
              </button>
            ) : null}
          </div>
          {state.kind === "pending" ? (
            <div className="h-1 w-full overflow-hidden rounded-full bg-white/10">
              {percent != null ? (
                <div
                  className="h-full rounded-full bg-pitflix-primary transition-[width] duration-200"
                  style={{ width: `${percent}%` }}
                />
              ) : (
                <div className="h-full w-1/3 animate-pulse rounded-full bg-pitflix-primary/60" />
              )}
            </div>
          ) : null}
        </motion.div>
      ) : null}
    </AnimatePresence>
  );
}
