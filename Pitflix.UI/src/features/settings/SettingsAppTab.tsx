import { isTauri } from "@tauri-apps/api/core";
import { Eye, EyeOff, RefreshCw } from "lucide-react";
import { AppUpdateSection } from "../../components/updater/AppUpdateSection";
import { setDesktopAutostart, isWindowsHost } from "../../utils/autostart";
import { SettingsMobileSyncSection } from "./SettingsMobileSyncSection";
import type { SettingsPageModel } from "./useSettingsPageModel";

type Props = { model: SettingsPageModel };

export function SettingsAppTab({ model }: Props) {
  const {
    autostartStatus,
    autostartBusy,
    setAutostartMessage,
    setAutostartBusy,
    qc,
    offlineMode,
    setOfflineMode,
    liveTvEnabled,
    setLiveTvEnabled,
    defaultSpoilerProtection,
    setDefaultSpoilerProtection,
    autostartMessage,
  } = model;

  return (
    <>
<section
            id="settings-app"
            className="rounded-2xl border border-white/[0.09] bg-pitflix-surface/50 p-6 shadow-xl shadow-black/30 backdrop-blur-sm"
          >
            <h2 className="mb-4 flex items-center gap-2 border-b border-white/[0.09] pb-4 text-[15px] font-bold tracking-tight text-white">
              <RefreshCw className="h-4 w-4 text-orange-400" strokeWidth={2} />
              Application
            </h2>
            <p className="mt-1 text-[10px] text-pitflix-subtle">
              Desktop app settings
            </p>
            {autostartStatus?.supported ? (
              <div className="mt-4 flex items-center justify-between gap-3">
                <div className="flex-1">
                  <p className="text-xs font-medium text-white">Open when Windows starts</p>
                  <p className="mt-0.5 text-[10px] text-pitflix-subtle">
                    Launch Pitflix automatically when you log in
                  </p>
                </div>
                <button
                  type="button"
                  disabled={autostartBusy}
                  onClick={() => {
                    setAutostartMessage(null);
                    setAutostartBusy(true);
                    const newState = !autostartStatus.enabled;
                    void setDesktopAutostart(newState)
                      .then(() => {
                        setAutostartMessage(newState ? "Enabled startup" : "Disabled startup");
                        void qc.invalidateQueries({ queryKey: ["autostart-status"] });
                      })
                      .catch((err) => {
                        setAutostartMessage(
                          err instanceof Error ? err.message : "Failed to update startup setting"
                        );
                      })
                      .finally(() => setAutostartBusy(false));
                  }}
                  className={`relative inline-flex h-6 w-11 shrink-0 cursor-pointer rounded-full border-2 border-transparent transition-colors duration-200 ease-in-out focus:outline-none focus:ring-2 focus:ring-pitflix-primary focus:ring-offset-2 focus:ring-offset-pitflix-bg disabled:opacity-50 ${
                    autostartStatus.enabled ? "bg-pitflix-primary" : "bg-pitflix-card"
                  }`}
                  role="switch"
                  aria-checked={autostartStatus.enabled}
                >
                  <span
                    className={`pointer-events-none inline-block h-5 w-5 transform rounded-full bg-white shadow ring-0 transition duration-200 ease-in-out ${
                      autostartStatus.enabled ? "translate-x-5" : "translate-x-0"
                    }`}
                  />
                </button>
              </div>
            ) : isWindowsHost() && !isTauri() ? (
              <p className="mt-3 text-xs text-pitflix-muted">
                Startup launch works in the Pitflix desktop app. The browser build cannot register Windows startup.
              </p>
            ) : (
              <p className="mt-3 text-xs text-pitflix-muted">
                Open when Windows starts is only available on Windows.
              </p>
            )}
            {autostartMessage ? <p className="mt-2 text-[11px] text-pitflix-muted">{autostartMessage}</p> : null}

            <div className="mt-4 border-t border-white/5 pt-4 flex items-center justify-between gap-3">
              <div className="flex-1">
                <p className="text-xs font-medium text-white">Offline mode</p>
                <p className="mt-0.5 text-[10px] text-pitflix-subtle">
                  Disables all internet features — online streaming, trailers, and TMDB lookups. Local library still works.
                </p>
              </div>
              <button
                type="button"
                onClick={() => setOfflineMode(!offlineMode)}
                className={`relative inline-flex h-6 w-11 shrink-0 cursor-pointer rounded-full border-2 border-transparent transition-colors duration-200 ease-in-out focus:outline-none focus:ring-2 focus:ring-orange-500 focus:ring-offset-2 focus:ring-offset-pitflix-bg ${
                  offlineMode ? "bg-orange-500" : "bg-pitflix-card"
                }`}
                role="switch"
                aria-checked={offlineMode}
              >
                <span
                  className={`pointer-events-none inline-block h-5 w-5 transform rounded-full bg-white shadow ring-0 transition duration-200 ease-in-out ${
                    offlineMode ? "translate-x-5" : "translate-x-0"
                  }`}
                />
              </button>
            </div>

            <div className="mt-4 border-t border-white/5 pt-4 flex items-center justify-between gap-3">
              <div className="flex-1">
                <p className="text-xs font-medium text-white">Live TV</p>
                <p className="mt-0.5 text-[10px] text-pitflix-subtle">
                  Shows or hides the Live TV section and nav item.
                </p>
              </div>
              <button
                type="button"
                onClick={() => setLiveTvEnabled(!liveTvEnabled)}
                className={`relative inline-flex h-6 w-11 shrink-0 cursor-pointer rounded-full border-2 border-transparent transition-colors duration-200 ease-in-out focus:outline-none focus:ring-2 focus:ring-pitflix-primary focus:ring-offset-2 focus:ring-offset-pitflix-bg ${
                  liveTvEnabled ? "bg-pitflix-primary" : "bg-pitflix-card"
                }`}
                role="switch"
                aria-checked={liveTvEnabled}
              >
                <span
                  className={`pointer-events-none inline-block h-5 w-5 transform rounded-full bg-white shadow ring-0 transition duration-200 ease-in-out ${
                    liveTvEnabled ? "translate-x-5" : "translate-x-0"
                  }`}
                />
              </button>
            </div>

            <div className="mt-4 border-t border-white/5 pt-4 flex items-center justify-between gap-3">
              <div className="flex-1">
                <p className="flex items-center gap-1.5 text-xs font-medium text-white">
                  {defaultSpoilerProtection ? <EyeOff className="h-3.5 w-3.5 text-amber-400" /> : <Eye className="h-3.5 w-3.5 text-pitflix-muted" />}
                  Spoiler protection by default
                </p>
                <p className="mt-0.5 text-[10px] text-pitflix-subtle">
                  When on, episode pages open with titles, overviews, and thumbnails hidden. You can still toggle it off per page from the episodes toolbar.
                </p>
              </div>
              <button
                type="button"
                onClick={() => setDefaultSpoilerProtection(!defaultSpoilerProtection)}
                className={`relative inline-flex h-6 w-11 shrink-0 cursor-pointer rounded-full border-2 border-transparent transition-colors duration-200 ease-in-out focus:outline-none focus:ring-2 focus:ring-amber-500 focus:ring-offset-2 focus:ring-offset-pitflix-bg ${
                  defaultSpoilerProtection ? "bg-amber-500" : "bg-pitflix-card"
                }`}
                role="switch"
                aria-checked={defaultSpoilerProtection}
              >
                <span
                  className={`pointer-events-none inline-block h-5 w-5 transform rounded-full bg-white shadow ring-0 transition duration-200 ease-in-out ${
                    defaultSpoilerProtection ? "translate-x-5" : "translate-x-0"
                  }`}
                />
              </button>
            </div>
          </section>

          <div id="settings-updates">
            <AppUpdateSection />
          </div>

          <div id="settings-mobile-sync" className="mt-4">
            <SettingsMobileSyncSection />
          </div>
    </>
  );
}
