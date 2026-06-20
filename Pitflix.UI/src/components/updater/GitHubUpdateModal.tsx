import { AnimatePresence, motion } from "framer-motion";
import { useEffect } from "react";
import { Download } from "lucide-react";
import type { GitHubUpdateOffer } from "../../updater/githubReleaseUpdater";

type Props = {
  open: boolean;
  offer: GitHubUpdateOffer | null;
  phase: "idle" | "checking" | "up_to_date" | "downloading" | "error";
  downloadPercent: number | null;
  errorMessage: string | null;
  onLater: () => void;
  onUpdateNow: () => void;
};

export function GitHubUpdateModal({
  open,
  offer,
  phase,
  downloadPercent,
  errorMessage,
  onLater,
  onUpdateNow,
}: Props) {
  useEffect(() => {
    if (!open) return;
    const onKey = (e: KeyboardEvent) => {
      if (e.key === "Escape" && phase !== "downloading") onLater();
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [open, phase, onLater]);

  const busy = phase === "downloading";

  return (
    <AnimatePresence>
      {open && offer ? (
        <motion.div
          className="fixed inset-0 z-[260] flex items-center justify-center bg-black/75 p-4 backdrop-blur-sm"
          initial={{ opacity: 0 }}
          animate={{ opacity: 1 }}
          exit={{ opacity: 0 }}
          transition={{ duration: 0.15 }}
          onClick={() => {
            if (!busy) onLater();
          }}
        >
          <motion.div
            role="dialog"
            aria-modal="true"
            aria-labelledby="gh-update-title"
            initial={{ opacity: 0, scale: 0.97, y: 8 }}
            animate={{ opacity: 1, scale: 1, y: 0 }}
            exit={{ opacity: 0, scale: 0.97, y: 8 }}
            transition={{ type: "spring", damping: 28, stiffness: 320 }}
            className="w-full max-w-lg rounded-xl border border-pitflix-primary/30 bg-pitflix-surface shadow-2xl shadow-black/80 ring-1 ring-white/5"
            onClick={(e) => e.stopPropagation()}
          >
            <div className="border-b border-white/5 px-5 py-4">
              <h2 id="gh-update-title" className="text-lg font-semibold text-white">
                Update available
              </h2>
              <p className="mt-2 text-sm text-pitflix-muted">
                A newer Pitflix build is on GitHub. Your app will close so the installer can finish.
              </p>
              <div className="mt-3 flex flex-wrap gap-x-4 gap-y-1 text-xs">
                <span className="text-pitflix-subtle">
                  Current{" "}
                  <span className="font-mono font-semibold text-white">{offer.currentVersion}</span>
                </span>
                <span className="text-pitflix-subtle">
                  Latest{" "}
                  <span className="font-mono font-semibold text-pitflix-primary">
                    {offer.latestVersion}
                  </span>
                </span>
              </div>
            </div>

            <div className="max-h-48 overflow-y-auto px-5 py-3">
              {offer.releaseNotes ? (
                <pre className="whitespace-pre-wrap font-sans text-xs leading-relaxed text-pitflix-muted">
                  {offer.releaseNotes}
                </pre>
              ) : (
                <p className="text-xs text-pitflix-subtle">No release notes provided.</p>
              )}
            </div>

            {phase === "downloading" ? (
              <div className="border-t border-white/5 px-5 py-4">
                <p className="text-xs font-medium text-white">Downloading installer…</p>
                {downloadPercent != null ? (
                  <div className="mt-2 h-2 w-full overflow-hidden rounded-full bg-pitflix-bg">
                    <div
                      className="h-full rounded-full bg-pitflix-primary transition-[width]"
                      style={{ width: `${downloadPercent}%` }}
                    />
                  </div>
                ) : (
                  <p className="mt-2 text-[11px] text-pitflix-subtle">Preparing…</p>
                )}
              </div>
            ) : null}

            {phase === "error" && errorMessage ? (
              <div className="border-t border-white/5 px-5 py-3">
                <p className="text-xs text-red-400/90">{errorMessage}</p>
                <p className="mt-1 text-[11px] text-pitflix-subtle">
                  The release page was opened in your browser as a fallback.
                </p>
              </div>
            ) : null}

            <div className="flex flex-wrap justify-end gap-2 border-t border-white/5 px-5 py-4">
              <button
                type="button"
                disabled={busy}
                onClick={onLater}
                className="rounded-lg border border-pitflix-card bg-pitflix-bg px-4 py-2.5 text-sm font-medium text-pitflix-muted transition-colors hover:border-pitflix-primary/40 hover:text-white disabled:opacity-50"
              >
                Later
              </button>
              <button
                type="button"
                disabled={busy}
                onClick={() => void onUpdateNow()}
                className="inline-flex items-center gap-2 rounded-lg bg-pitflix-primary px-4 py-2.5 text-sm font-semibold text-white transition-colors hover:bg-pitflix-light disabled:opacity-50"
              >
                <Download className="h-4 w-4" />
                Update now
              </button>
            </div>
          </motion.div>
        </motion.div>
      ) : null}
    </AnimatePresence>
  );
}
