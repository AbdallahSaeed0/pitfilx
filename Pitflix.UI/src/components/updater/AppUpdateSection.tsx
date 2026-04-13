import { isTauri } from "@tauri-apps/api/core";
import { Download, RefreshCw } from "lucide-react";
import { useAppUpdater } from "../../hooks/useAppUpdater";
import { useAppPrefsStore } from "../../store/appPrefsStore";
import { UPDATER_CONFIG_FILE } from "../../config/updater";

function phaseLabel(phase: ReturnType<typeof useAppUpdater>["phase"]): string | null {
  switch (phase) {
    case "checking":
      return "Checking for updates…";
    case "downloading":
      return "Downloading update…";
    case "installing":
      return null;
    case "success":
      return "Finishing — the app will restart.";
    default:
      return null;
  }
}

export function AppUpdateSection() {
  const {
    phase,
    errorMessage,
    currentVersion,
    availableVersion,
    releaseNotes,
    releaseDate,
    downloadPercent,
    check,
    installPending,
    resetToIdle,
  } = useAppUpdater();

  const checkOnStartup = useAppPrefsStore((s) => s.checkUpdatesOnStartup);
  const setCheckOnStartup = useAppPrefsStore((s) => s.setCheckUpdatesOnStartup);

  const busy = phase === "checking" || phase === "downloading" || phase === "installing";

  return (
    <section id="app-updates" className="rounded-xl border border-pitflix-card/50 bg-pitflix-card p-5">
      <h2 className="text-sm font-semibold text-white">App updates</h2>
      <p className="mt-1 text-[10px] text-pitflix-subtle">
        Install new Pitflix versions from the internet. Update source is configured at build time in{" "}
        <span className="font-mono text-pitflix-muted">{UPDATER_CONFIG_FILE}</span>.
      </p>

      <div className="mt-4 flex flex-wrap items-baseline gap-x-3 gap-y-1">
        <span className="text-[11px] text-pitflix-muted">Current version</span>
        <span className="font-mono text-sm font-semibold text-white">{currentVersion}</span>
      </div>

      {!isTauri() ? (
        <p className="mt-4 text-xs text-pitflix-muted">
          You are running the web UI. Download the Pitflix desktop app to receive updates here.
        </p>
      ) : (
        <>
          <div className="mt-4 flex flex-wrap gap-2">
            <button
              type="button"
              disabled={busy}
              onClick={() => void check()}
              className="inline-flex items-center gap-2 rounded-lg border border-pitflix-card bg-pitflix-bg px-3 py-2 text-xs font-medium text-white hover:border-pitflix-primary/50 disabled:opacity-50"
            >
              {phase === "checking" ? (
                <RefreshCw className="h-3.5 w-3.5 animate-spin" />
              ) : (
                <RefreshCw className="h-3.5 w-3.5" />
              )}
              Check for updates
            </button>

            {phase === "available" ? (
              <button
                type="button"
                disabled={busy}
                onClick={() => void installPending()}
                className="inline-flex items-center gap-2 rounded-lg bg-pitflix-primary px-3 py-2 text-xs font-semibold text-white hover:bg-pitflix-light disabled:opacity-50"
              >
                <Download className="h-3.5 w-3.5" />
                Download &amp; install
              </button>
            ) : null}

            {phase !== "idle" && phase !== "checking" && !busy ? (
              <button
                type="button"
                onClick={() => resetToIdle()}
                className="rounded-lg border border-pitflix-card px-3 py-2 text-xs text-pitflix-muted hover:text-white"
              >
                Dismiss
              </button>
            ) : null}
          </div>

          {phase === "up_to_date" ? (
            <p className="mt-3 text-xs text-emerald-400/90">You are up to date.</p>
          ) : null}

          {phase === "available" && availableVersion ? (
            <div className="mt-4 rounded-lg border border-pitflix-primary/25 bg-pitflix-bg/60 p-3">
              <p className="text-xs font-medium text-white">
                Update available: <span className="font-mono text-pitflix-primary">{availableVersion}</span>
              </p>
              {releaseDate ? (
                <p className="mt-1 text-[10px] text-pitflix-subtle">Released {releaseDate}</p>
              ) : null}
              {releaseNotes ? (
                <pre className="mt-2 max-h-40 overflow-y-auto whitespace-pre-wrap font-sans text-[11px] leading-relaxed text-pitflix-muted">
                  {releaseNotes}
                </pre>
              ) : (
                <p className="mt-2 text-[11px] text-pitflix-subtle">No release notes for this build.</p>
              )}
            </div>
          ) : null}

          {(phase === "downloading" || phase === "installing" || phase === "success") && (
            <div className="mt-4 space-y-2">
              {phase === "installing" ? (
                <>
                  <p className="text-sm font-medium text-white">Pitflix will now close to complete the update.</p>
                  <p className="text-[11px] text-pitflix-muted">Starting the installer…</p>
                </>
              ) : (
                <p className="text-xs text-pitflix-muted">{phaseLabel(phase)}</p>
              )}
              {phase === "downloading" && downloadPercent != null ? (
                <div className="h-2 w-full overflow-hidden rounded-full bg-pitflix-bg">
                  <div
                    className="h-full rounded-full bg-pitflix-primary transition-[width]"
                    style={{ width: `${downloadPercent}%` }}
                  />
                </div>
              ) : null}
            </div>
          )}

          {phase === "error" && errorMessage ? (
            <p className="mt-3 text-xs text-red-400/90">{errorMessage}</p>
          ) : null}

          <div className="mt-6 border-t border-white/5 pt-4">
            <div className="flex items-center justify-between gap-3">
              <div>
                <p className="text-xs font-medium text-white">Check for updates when Pitflix opens</p>
                <p className="mt-0.5 text-[10px] text-pitflix-subtle">
                  Notifies you if an update exists — nothing is downloaded or installed automatically.
                </p>
              </div>
              <button
                type="button"
                onClick={() => setCheckOnStartup(!checkOnStartup)}
                className={`relative inline-flex h-6 w-11 shrink-0 cursor-pointer rounded-full border-2 border-transparent transition-colors duration-200 ease-in-out focus:outline-none focus:ring-2 focus:ring-pitflix-primary focus:ring-offset-2 focus:ring-offset-pitflix-bg ${
                  checkOnStartup ? "bg-pitflix-primary" : "bg-pitflix-card"
                }`}
                role="switch"
                aria-checked={checkOnStartup}
              >
                <span
                  className={`pointer-events-none inline-block h-5 w-5 transform rounded-full bg-white shadow ring-0 transition duration-200 ease-in-out ${
                    checkOnStartup ? "translate-x-5" : "translate-x-0"
                  }`}
                />
              </button>
            </div>
          </div>
        </>
      )}
    </section>
  );
}
