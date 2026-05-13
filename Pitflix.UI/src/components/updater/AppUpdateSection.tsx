import { isTauri } from "@tauri-apps/api/core";
import { RefreshCw } from "lucide-react";
import { useEffect, useState } from "react";
import { useGitHubUpdater } from "../../context/GitHubUpdaterContext";
import { useAppPrefsStore } from "../../store/appPrefsStore";
import { GITHUB_RELEASES_WEB } from "../../config/githubRelease";
import { getDesktopAppVersion } from "../../updater/desktopVersion";
import { UI_PACKAGE_VERSION } from "../../version";

export function AppUpdateSection() {
  const {
    phase,
    errorMessage,
    checkForUpdates,
    dismissModal,
  } = useGitHubUpdater();

  const checkOnStartup = useAppPrefsStore((s) => s.checkUpdatesOnStartup);
  const setCheckOnStartup = useAppPrefsStore((s) => s.setCheckUpdatesOnStartup);

  const busy = phase === "checking" || phase === "downloading";

  const [runtimeVersion, setRuntimeVersion] = useState<string | null>(null);
  useEffect(() => {
    void getDesktopAppVersion().then(setRuntimeVersion);
  }, []);

  const displayedVersion = runtimeVersion ?? UI_PACKAGE_VERSION;

  return (
    <section id="app-updates" className="rounded-xl border border-pitflix-card/50 bg-pitflix-card p-5">
      <h2 className="text-sm font-semibold text-white">App updates</h2>
      <div className="mt-4 flex flex-wrap items-baseline gap-x-3 gap-y-1">
        <span className="text-[11px] text-pitflix-muted">Current version</span>
        <span className="font-mono text-sm font-semibold text-white">{displayedVersion}</span>
      </div>

      <p className="mt-3 text-[10px] text-pitflix-subtle leading-relaxed">
        Pitflix checks{" "}
        <a
          href={GITHUB_RELEASES_WEB}
          target="_blank"
          rel="noreferrer"
          className="text-pitflix-primary underline-offset-2 hover:underline"
        >
          GitHub Releases
        </a>{" "}
        for the latest Windows installer. No separate signature file is required.
      </p>

      {!isTauri() ? (
        <p className="mt-4 text-xs text-pitflix-muted">
          You are running the web UI. Download the Pitflix desktop app to update from here.
        </p>
      ) : (
        <>
          <div className="mt-4 flex flex-wrap gap-2">
            <button
              type="button"
              disabled={busy}
              onClick={() => void checkForUpdates()}
              className="inline-flex items-center gap-2 rounded-lg border border-pitflix-card bg-pitflix-bg px-3 py-2 text-xs font-medium text-white hover:border-pitflix-primary/50 disabled:opacity-50"
            >
              {phase === "checking" ? (
                <RefreshCw className="h-3.5 w-3.5 animate-spin" />
              ) : (
                <RefreshCw className="h-3.5 w-3.5" />
              )}
              Check for updates
            </button>

            {phase === "error" ? (
              <button
                type="button"
                onClick={() => dismissModal()}
                className="rounded-lg border border-pitflix-card px-3 py-2 text-xs text-pitflix-muted hover:text-white"
              >
                Clear status
              </button>
            ) : null}
          </div>

          {phase === "up_to_date" ? (
            <p className="mt-3 text-xs text-emerald-400/90">You’re on the latest release.</p>
          ) : null}

          {phase === "error" && errorMessage ? (
            <p className="mt-3 text-xs text-red-400/90">{errorMessage}</p>
          ) : null}

          <div className="mt-6 border-t border-white/5 pt-4">
            <div className="flex items-center justify-between gap-3">
              <div>
                <p className="text-xs font-medium text-white">Check for updates automatically</p>
                <p className="mt-0.5 text-[10px] text-pitflix-subtle">
                  After launch, Pitflix compares your version with the latest GitHub release. You choose when to download.
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
