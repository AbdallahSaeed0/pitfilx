import { invoke, isTauri } from "@tauri-apps/api/core";
import { Play } from "lucide-react";
import { saveSettings } from "../../api/settings";
import { PlaybackQualitySettings } from "../../components/settings/PlaybackQualitySettings";
import { cn } from "../../utils/cn";
import type { SettingsPageModel } from "./useSettingsPageModel";

type Props = { model: SettingsPageModel };

export function SettingsPlaybackTab({ model }: Props) {
  const {
    playerEngine,
    setEngine,
    playerBusy,
    savePlayerPath,
    mediaPlayerPath,
    uniquePlayerCandidates,
    setPlayerFieldTouched,
    setMediaPlayerPath,
    handleBrowsePlayerExe,
    setPlayerMessage,
    playerMessage,
    setPlayerBusy,
    refetchSettings,
  } = model;

  return (
    <>
      <section
            id="settings-player"
            className="rounded-2xl border border-white/[0.09] bg-pitflix-surface/50 p-6 shadow-xl shadow-black/30 backdrop-blur-sm"
          >
            <h2 className="mb-4 flex items-center gap-2 border-b border-white/[0.09] pb-4 text-[15px] font-bold tracking-tight text-white">
              <Play className="h-4 w-4 text-green-400" strokeWidth={2} />
              Player
            </h2>
            <p className="mt-1 text-[10px] text-pitflix-subtle">
              Pick whatever plays your media — the app's built-in player, or a local player on your machine.
            </p>

            <div className="mt-4 flex flex-wrap gap-2">
              {isTauri() && (
                <>
                  <button
                    type="button"
                    onClick={() => setEngine("libmpv-embedded")}
                    className={cn(
                      "h-9 rounded-xl border px-3.5 text-xs font-medium transition-all",
                      playerEngine === "libmpv-embedded"
                        ? "border-pitflix-primary bg-pitflix-primary/20 text-white shadow-[0_0_14px_rgba(139,92,246,0.3)]"
                        : "border-white/10 bg-pitflix-bg text-white hover:border-pitflix-primary/50",
                    )}
                  >
                    Pitflix Player
                  </button>
                  <button
                    type="button"
                    onClick={() => setEngine("external-mpv")}
                    className={cn(
                      "h-9 rounded-xl border px-3.5 text-xs font-medium transition-all",
                      playerEngine === "external-mpv"
                        ? "border-pitflix-primary bg-pitflix-primary/20 text-white shadow-[0_0_14px_rgba(139,92,246,0.3)]"
                        : "border-white/10 bg-pitflix-bg text-white hover:border-pitflix-primary/50",
                    )}
                  >
                    External player + companion page
                  </button>
                </>
              )}
              <button
                type="button"
                disabled={playerBusy}
                onClick={() => savePlayerPath("vlc", "VLC")}
                className={cn(
                  "h-9 rounded-xl border px-3.5 text-xs font-medium transition-all disabled:opacity-50",
                  mediaPlayerPath.toLowerCase() === "vlc"
                    ? "border-pitflix-primary bg-pitflix-primary/20 text-white shadow-[0_0_14px_rgba(139,92,246,0.3)]"
                    : "border-white/10 bg-pitflix-bg text-white hover:border-pitflix-primary/50",
                )}
              >
                VLC
              </button>
              <button
                type="button"
                disabled={playerBusy}
                onClick={() => savePlayerPath("mpv", "mpv")}
                className={cn(
                  "h-9 rounded-xl border px-3.5 text-xs font-medium transition-all disabled:opacity-50",
                  mediaPlayerPath.toLowerCase() === "mpv"
                    ? "border-pitflix-primary bg-pitflix-primary/20 text-white shadow-[0_0_14px_rgba(139,92,246,0.3)]"
                    : "border-white/10 bg-pitflix-bg text-white hover:border-pitflix-primary/50",
                )}
              >
                MPV
              </button>
              {uniquePlayerCandidates.slice(0, 6).map(({ path, label }) => (
                <button
                  key={path}
                  type="button"
                  disabled={playerBusy}
                  title={label}
                  onClick={() => savePlayerPath(path, label)}
                  className={cn(
                    "h-9 max-w-[160px] truncate rounded-xl border px-3 text-[11px] font-medium transition-all disabled:opacity-50",
                    mediaPlayerPath === path
                      ? "border-pitflix-primary bg-pitflix-primary/20 text-white shadow-[0_0_14px_rgba(139,92,246,0.3)]"
                      : "border-white/10 bg-pitflix-bg text-white hover:border-pitflix-primary/50",
                  )}
                >
                  {label}
                </button>
              ))}
            </div>

            <p className="mt-2 text-[10px] text-pitflix-subtle">
              Companion page opens episodes, shortcuts, and playlist controls in Pitflix while mpv plays in a separate window.
            </p>

            <div className="mt-4 flex flex-wrap gap-2">
              <input
                value={mediaPlayerPath}
                onChange={(e) => {
                  setPlayerFieldTouched(true);
                  setMediaPlayerPath(e.target.value);
                }}
                placeholder="Custom PATH name or full .exe…"
                className="min-w-[160px] flex-1 rounded-lg border border-pitflix-card bg-pitflix-bg px-2.5 py-2 text-xs text-white focus:border-pitflix-primary/70 focus:outline-none focus:ring-2 focus:ring-pitflix-primary/15"
              />
              <button
                type="button"
                disabled={playerBusy}
                className="h-9 rounded-xl border border-white/[0.08] px-3 text-xs text-white transition-all hover:border-pitflix-primary/50 disabled:opacity-50"
                onClick={() => void handleBrowsePlayerExe()}
              >
                Browse
              </button>
              <button
                type="button"
                disabled={playerBusy}
                className="h-9 rounded-xl bg-pitflix-primary px-3.5 text-xs font-semibold text-white shadow-sm shadow-pitflix-primary/25 transition-all hover:bg-pitflix-light disabled:opacity-50"
                onClick={() => {
                  setPlayerMessage(null);
                  setPlayerBusy(true);
                  void saveSettings({ mediaPlayerPath: mediaPlayerPath.trim() })
                    .then(() => {
                      setPlayerMessage("Saved.");
                      setPlayerFieldTouched(false);
                      refetchSettings();
                    })
                    .catch(() => setPlayerMessage("Could not save."))
                    .finally(() => setPlayerBusy(false));
                }}
              >
                Save
              </button>
              {isTauri() && (
                <button
                  type="button"
                  className="h-9 rounded-xl border border-white/[0.08] px-3 text-xs text-pitflix-muted transition-all hover:border-pitflix-primary/50 hover:text-white"
                  onClick={() => { void invoke("player3_open", {}); }}
                  title="Requires an active playback session from /api/player/play"
                >
                  Launch Player (Test)
                </button>
              )}
            </div>
            {playerMessage ? <p className="mt-2 text-[11px] text-pitflix-muted">{playerMessage}</p> : null}
          </section>
      <PlaybackQualitySettings />
    </>
  );
}
