import { X } from "lucide-react";
import { useGitHubUpdater } from "../../context/GitHubUpdaterContext";

/**
 * Thin banner that surfaces when GitHubUpdaterContext finds a newer release on startup.
 * The actual download / install flow lives in the updater modal (opened by setModalOpen).
 * Network errors are silently swallowed by the context so offline launches stay quiet.
 */
export function UpdateStartupBanner() {
  const { pendingOffer, modalOpen, setModalOpen, dismissModal } = useGitHubUpdater();

  // Show only when there's an offer but the modal isn't already open.
  if (!pendingOffer || modalOpen) return null;

  return (
    <div className="mb-4 flex flex-col gap-3 rounded-xl border border-pitflix-primary/30 bg-pitflix-bg/90 px-4 py-3 ring-1 ring-white/5 sm:flex-row sm:items-center sm:justify-between">
      <div className="min-w-0 flex-1">
        <p className="text-sm font-medium text-white">
          Pitflix{" "}
          <span className="font-mono text-pitflix-primary">{pendingOffer.latestVersion}</span> is
          available
        </p>
        {pendingOffer.releaseNotes ? (
          <p className="mt-1 line-clamp-2 text-[11px] text-pitflix-muted">
            {pendingOffer.releaseNotes}
          </p>
        ) : null}
      </div>
      <div className="flex shrink-0 flex-wrap items-center gap-2">
        <button
          type="button"
          onClick={() => setModalOpen(true)}
          className="inline-flex items-center gap-2 rounded-lg bg-pitflix-primary px-3 py-2 text-xs font-semibold text-white hover:bg-pitflix-light"
        >
          View update
        </button>
        <button
          type="button"
          onClick={dismissModal}
          className="rounded-lg p-2 text-pitflix-muted hover:bg-white/5 hover:text-white"
          aria-label="Dismiss"
        >
          <X className="h-4 w-4" />
        </button>
      </div>
    </div>
  );
}
