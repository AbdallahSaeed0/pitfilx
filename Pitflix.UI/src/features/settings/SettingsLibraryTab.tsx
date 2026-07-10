import { Bell, FolderMinus, FolderOpen, Zap } from "lucide-react";
import { removeLibraryPath, removePinnedScanPath, removeExcludedScanPath, saveSettings } from "../../api/settings";
import type { SettingsPageModel } from "./useSettingsPageModel";

type Props = { model: SettingsPageModel };

export function SettingsLibraryTab({ model }: Props) {
  const {
    data,
    pathBusy,
    setPathBusy,
    handleBrowse,
    manualPath,
    setManualPath,
    handleAddManual,
    libraryPickMessage,
    pinnedBusy,
    setPinnedBusy,
    handleBrowsePinned,
    pinnedManualPath,
    setPinnedManualPath,
    handleAddPinnedManual,
    pinnedPickMessage,
    libraryScanDesktopToasts,
    scanToastsBusy,
    setLibraryScanDesktopToasts,
    setScanToastsBusy,
    refetchSettings,
    excludedBusy,
    setExcludedBusy,
    handleBrowseExcluded,
    excludedManualPath,
    setExcludedManualPath,
    handleAddExcludedManual,
    excludedPickMessage,
    setToast,
  } = model;

  return (
    <>
          <section
            id="settings-library"
            className="rounded-2xl border border-white/[0.09] bg-pitflix-surface/50 p-6 shadow-xl shadow-black/30 backdrop-blur-sm"
          >
            <div className="mb-4 flex items-center justify-between gap-2 border-b border-white/[0.09] pb-3">
              <h2 className="flex items-center gap-2 text-[15px] font-bold text-white">
                <FolderOpen className="h-4 w-4 text-violet-400" strokeWidth={2} />
                Library folders
              </h2>
              <button
                type="button"
                disabled={pathBusy}
                className="shrink-0 rounded-xl bg-pitflix-primary px-3.5 py-2 text-xs font-semibold text-white transition-all hover:bg-pitflix-light disabled:opacity-50"
                onClick={() => void handleBrowse()}
              >
                {pathBusy ? "…" : "Browse"}
              </button>
            </div>
            <p className="mt-1 text-[10px] leading-relaxed text-pitflix-subtle">
              Add each <span className="text-pitflix-muted">top-level</span> folder once (for example your whole{" "}
              <span className="text-pitflix-muted">Series</span> or <span className="text-pitflix-muted">Movies</span>{" "}
              directory). Everything inside it—including new seasons and episodes—is included automatically when you run
              Scan Library; you do not add a separate path per show. Pitflix also rechecks the library about once an hour in
              the background.
            </p>
            <p className="mt-1.5 text-[10px] text-pitflix-subtle">
              Browse: folder dialog runs on the API host (Alt+Tab if hidden).
            </p>
            <div className="mt-3 max-h-[140px] space-y-1.5 overflow-y-auto">
              {(data?.libraryPaths ?? []).length === 0 ? (
                <p className="text-xs text-pitflix-muted">No folders yet.</p>
              ) : (
                (data?.libraryPaths ?? []).map((p: string) => (
                  <div
                    key={p}
                    className="group flex items-center justify-between gap-2 rounded-xl border border-white/[0.08] bg-pitflix-bg/60 px-3 py-2 transition-colors hover:border-pitflix-primary/25 hover:bg-pitflix-primary/[0.04]"
                  >
                    <p className="truncate text-[11px] text-white" title={p}>
                      {p}
                    </p>
                    <button
                      type="button"
                      className="shrink-0 text-[10px] text-pitflix-subtle transition-colors hover:text-red-400"
                      onClick={() => {
                        setPathBusy(true);
                        void removeLibraryPath(p)
                          .then(() => {
                            void refetchSettings();
                          })
                          .catch(() => setToast("Could not remove library folder."))
                          .finally(() => setPathBusy(false));
                      }}
                    >
                      Remove
                    </button>
                  </div>
                ))
              )}
            </div>
            <div className="mt-3 flex gap-2">
              <input
                value={manualPath}
                onChange={(e) => setManualPath(e.target.value)}
                onKeyDown={(e) => e.key === "Enter" && void handleAddManual()}
                placeholder="Manual path…"
                className="min-w-0 flex-1 rounded-lg border border-pitflix-card bg-pitflix-bg px-2.5 py-2 text-xs text-white placeholder:text-pitflix-subtle focus:border-pitflix-primary/70 focus:outline-none focus:ring-2 focus:ring-pitflix-primary/15"
              />
              <button
                type="button"
                onClick={() => void handleAddManual()}
                disabled={pathBusy}
                className="shrink-0 rounded-xl bg-pitflix-primary px-3.5 py-2 text-xs font-semibold text-white transition-all hover:bg-pitflix-light disabled:opacity-50"
              >
                Add
              </button>
            </div>
            {libraryPickMessage ? <p className="mt-2 text-[11px] text-red-400/90">{libraryPickMessage}</p> : null}
          </section>

          <section className="rounded-2xl border border-white/[0.09] bg-pitflix-surface/50 p-6 shadow-xl shadow-black/30 backdrop-blur-sm">
            <div className="mb-4 flex items-center justify-between gap-2 border-b border-white/[0.09] pb-3">
              <h2 className="flex items-center gap-2 text-[15px] font-bold text-white">
                <Zap className="h-4 w-4 text-emerald-400" strokeWidth={2} />
                Auto-scan folders
              </h2>
              <button
                type="button"
                disabled={pinnedBusy}
                className="shrink-0 rounded-xl border border-pitflix-primary/40 bg-pitflix-bg px-3.5 py-2 text-xs font-semibold text-white transition-all hover:border-pitflix-primary/60 hover:bg-pitflix-primary/15 disabled:opacity-50"
                onClick={() => void handleBrowsePinned()}
              >
                {pinnedBusy ? "…" : "Browse"}
              </button>
            </div>
            <p className="mt-1 text-[10px] leading-relaxed text-pitflix-subtle">
              Pin download or inbox folders you want indexed quickly. Pitflix rescan these about every <span className="text-pitflix-muted">2 minutes</span>{" "}
              (plus the hourly pass over all library folders). You can still run <span className="text-pitflix-muted">Scan Library</span> anytime.
            </p>
            <div className="mt-3 max-h-[120px] space-y-1.5 overflow-y-auto">
              {(data?.pinnedScanPaths ?? []).length === 0 ? (
                <p className="text-xs text-pitflix-muted">No pinned folders — optional.</p>
              ) : (
                (data?.pinnedScanPaths ?? []).map((p: string) => (
                  <div
                    key={p}
                    className="group flex items-center justify-between gap-2 rounded-xl border border-white/[0.08] bg-pitflix-bg/60 px-3 py-2 transition-colors hover:border-pitflix-primary/25 hover:bg-pitflix-primary/[0.04]"
                  >
                    <p className="truncate text-[11px] text-white" title={p}>
                      {p}
                    </p>
                    <button
                      type="button"
                      className="shrink-0 text-[10px] text-pitflix-subtle transition-colors hover:text-red-400"
                      onClick={() => {
                        setPinnedBusy(true);
                        void removePinnedScanPath(p)
                          .then(() => refetchSettings())
                          .finally(() => setPinnedBusy(false));
                      }}
                    >
                      Remove
                    </button>
                  </div>
                ))
              )}
            </div>
            <div className="mt-3 flex gap-2">
              <input
                value={pinnedManualPath}
                onChange={(e) => setPinnedManualPath(e.target.value)}
                onKeyDown={(e) => e.key === "Enter" && void handleAddPinnedManual()}
                placeholder="Manual path for auto-scan…"
                className="min-w-0 flex-1 rounded-lg border border-pitflix-card bg-pitflix-bg px-2.5 py-2 text-xs text-white placeholder:text-pitflix-subtle focus:border-pitflix-primary/70 focus:outline-none focus:ring-2 focus:ring-pitflix-primary/15"
              />
              <button
                type="button"
                onClick={() => void handleAddPinnedManual()}
                disabled={pinnedBusy}
                className="shrink-0 rounded-xl border border-pitflix-primary/40 bg-pitflix-bg px-3.5 py-2 text-xs font-semibold text-white transition-all hover:border-pitflix-primary/60 hover:bg-pitflix-primary/15 disabled:opacity-50"
              >
                Add
              </button>
            </div>
            {pinnedPickMessage ? <p className="mt-2 text-[11px] text-red-400/90">{pinnedPickMessage}</p> : null}
          </section>

          <section className="rounded-2xl border border-white/[0.09] bg-pitflix-surface/50 p-6 shadow-xl shadow-black/30 backdrop-blur-sm">
            <h2 className="mb-4 flex items-center gap-2 border-b border-white/[0.09] pb-4 text-[15px] font-bold tracking-tight text-white">
              <Bell className="h-4 w-4 text-amber-400" strokeWidth={2} />
              Scan desktop toasts
            </h2>
            <p className="mt-1 text-[10px] leading-relaxed text-pitflix-subtle">
              When pinned folders or the hourly library pass indexes something, Pitflix can show a small notification
              (matched vs needs review). Turn this off if you don’t want those popups; scans still run in the background.
              Toasts show at most once per file path once it’s already in the scan log.
            </p>
            <label className="mt-4 flex cursor-pointer items-center gap-3 rounded-xl border border-white/[0.05] bg-white/[0.02] px-3 py-2.5 text-xs text-white transition-colors hover:bg-white/[0.04]">
              <input
                type="checkbox"
                checked={libraryScanDesktopToasts}
                disabled={scanToastsBusy}
                onChange={(e) => {
                  const next = e.target.checked;
                  setLibraryScanDesktopToasts(next);
                  setScanToastsBusy(true);
                  void saveSettings({ libraryScanDesktopToasts: next })
                    .then(() => refetchSettings())
                    .catch(() => setLibraryScanDesktopToasts(!next))
                    .finally(() => setScanToastsBusy(false));
                }}
                className="h-4 w-4 cursor-pointer rounded border-pitflix-card accent-pitflix-primary disabled:opacity-50"
              />
              Notify when background scan adds or updates a discovery
            </label>
          </section>

          <section className="rounded-2xl border border-white/[0.09] bg-pitflix-surface/50 p-6 shadow-xl shadow-black/30 backdrop-blur-sm">
            <div className="mb-4 flex items-center justify-between gap-2 border-b border-white/[0.09] pb-3">
              <h2 className="flex items-center gap-2 text-[15px] font-bold text-white">
                <FolderMinus className="h-4 w-4 text-rose-400" strokeWidth={2} />
                Excluded folders
              </h2>
              <button
                type="button"
                disabled={excludedBusy}
                className="shrink-0 rounded-xl border border-rose-500/40 bg-pitflix-bg px-3.5 py-2 text-xs font-semibold text-rose-200 transition-all hover:border-rose-500/60 hover:bg-rose-500/15 disabled:opacity-50"
                onClick={() => void handleBrowseExcluded()}
              >
                {excludedBusy ? "…" : "Browse"}
              </button>
            </div>
            <p className="mt-1 text-[10px] leading-relaxed text-pitflix-subtle">
              Block specific folders from being scanned. Useful when you have a large drive (like <span className="text-pitflix-muted">F:</span>) 
              but want to exclude certain subfolders (like <span className="text-pitflix-muted">F:\System</span> or <span className="text-pitflix-muted">F:\Temp</span>). 
              Excluded folders and all their subfolders will be skipped during all scans.
            </p>
            <div className="mt-3 max-h-[120px] space-y-1.5 overflow-y-auto">
              {(data?.excludedScanPaths ?? []).length === 0 ? (
                <p className="text-xs text-pitflix-muted">No excluded folders — optional.</p>
              ) : (
                (data?.excludedScanPaths ?? []).map((p: string) => (
                  <div
                    key={p}
                    className="group flex items-center justify-between gap-2 rounded-xl border border-white/[0.08] bg-pitflix-bg/60 px-3 py-2 transition-colors hover:border-pitflix-primary/25 hover:bg-pitflix-primary/[0.04]"
                  >
                    <p className="truncate text-[11px] text-white" title={p}>
                      {p}
                    </p>
                    <button
                      type="button"
                      className="shrink-0 text-[10px] text-pitflix-subtle transition-colors hover:text-red-400"
                      onClick={() => {
                        setExcludedBusy(true);
                        void removeExcludedScanPath(p)
                          .then(() => refetchSettings())
                          .finally(() => setExcludedBusy(false));
                      }}
                    >
                      Remove
                    </button>
                  </div>
                ))
              )}
            </div>
            <div className="mt-3 flex gap-2">
              <input
                value={excludedManualPath}
                onChange={(e) => setExcludedManualPath(e.target.value)}
                onKeyDown={(e) => e.key === "Enter" && void handleAddExcludedManual()}
                placeholder="Manual path to exclude…"
                className="min-w-0 flex-1 rounded-lg border border-pitflix-card bg-pitflix-bg px-2.5 py-2 text-xs text-white placeholder:text-pitflix-subtle focus:border-pitflix-primary/70 focus:outline-none focus:ring-2 focus:ring-pitflix-primary/15"
              />
              <button
                type="button"
                onClick={() => void handleAddExcludedManual()}
                disabled={excludedBusy}
                className="shrink-0 rounded-xl border border-red-500/40 bg-pitflix-bg px-3.5 py-2 text-xs font-semibold text-red-200 transition-all hover:border-red-500/60 hover:bg-red-500/15 disabled:opacity-50"
              >
                Add
              </button>
            </div>
            {excludedPickMessage ? <p className="mt-2 text-[11px] text-red-400/90">{excludedPickMessage}</p> : null}
          </section>
    </>
  );
}
