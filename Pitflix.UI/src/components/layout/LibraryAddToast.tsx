import { AnimatePresence, motion } from "framer-motion";
import { CheckCircle2, AlertTriangle, X } from "lucide-react";
import { useEffect } from "react";
import { useScanStore } from "../../store/scanStore";
import { cn } from "../../utils/cn";

function kindLabel(kind: string) {
  if (kind === "movie") return "Movie";
  if (kind === "episode") return "Episode";
  if (kind === "file") return "Media file";
  return "Media";
}

export function LibraryAddToast() {
  const visible = useScanStore((s) => s.libraryToastVisible);
  const dismiss = useScanStore((s) => s.dismissLibraryToast);

  useEffect(() => {
    if (!visible) return;
    const t = window.setTimeout(() => dismiss(), 5200);
    return () => window.clearTimeout(t);
  }, [visible, dismiss]);

  return (
    <AnimatePresence mode="wait">
      {visible ? (
        <motion.div
          key={`${visible.title}-${visible.matched}-${visible.kind}`}
          role="status"
          initial={{ opacity: 0, y: 12, scale: 0.98 }}
          animate={{ opacity: 1, y: 0, scale: 1 }}
          exit={{ opacity: 0, y: 8, scale: 0.98 }}
          transition={{ duration: 0.2 }}
          className="pointer-events-auto fixed bottom-6 right-6 z-[220] w-[min(22rem,calc(100vw-2rem))] overflow-hidden rounded-xl border border-pitflix-card bg-pitflix-surface/95 pl-4 pr-2 py-3 shadow-xl shadow-black/50 backdrop-blur-md"
        >
          <button
            type="button"
            onClick={() => dismiss()}
            className="absolute right-2 top-2 rounded-lg p-1 text-pitflix-muted transition-colors hover:bg-white/10 hover:text-white"
            aria-label="Dismiss notification"
          >
            <X className="h-4 w-4" />
          </button>
          <div className="flex gap-3 pr-6">
            <div
              className={cn(
                "mt-0.5 flex h-9 w-9 shrink-0 items-center justify-center rounded-lg",
                visible.matched ? "bg-emerald-500/15 text-emerald-400" : "bg-amber-500/15 text-amber-400",
              )}
            >
              {visible.matched ? (
                <CheckCircle2 className="h-5 w-5" aria-hidden />
              ) : (
                <AlertTriangle className="h-5 w-5" aria-hidden />
              )}
            </div>
            <div className="min-w-0 flex-1">
              <p className="text-[11px] font-semibold uppercase tracking-wide text-pitflix-muted">
                New {kindLabel(visible.kind)} added
              </p>
              <p className="mt-1 line-clamp-2 text-sm font-medium leading-snug text-white" title={visible.title}>
                {visible.title}
              </p>
              <p
                className={cn(
                  "mt-1.5 text-xs",
                  visible.matched ? "text-emerald-400/95" : "text-amber-400/95",
                )}
              >
                {visible.matched
                  ? "Matched — linked to TMDB"
                  : "Not matched — review in Unmatched"}
              </p>
            </div>
          </div>
        </motion.div>
      ) : null}
    </AnimatePresence>
  );
}
