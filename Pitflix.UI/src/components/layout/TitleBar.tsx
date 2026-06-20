import { isTauri } from "@tauri-apps/api/core";
import { getCurrentWindow } from "@tauri-apps/api/window";
import { Minus, Square, WifiOff, X } from "lucide-react";
import { useAppPrefsStore } from "../../store/appPrefsStore";

export function TitleBar() {
  const offlineMode = useAppPrefsStore((s) => s.offlineMode);

  if (!isTauri()) {
    return offlineMode ? (
      <span className="fixed left-3 top-2 z-[9999] flex items-center gap-1 rounded-full bg-orange-500/15 px-2 py-0.5 text-[10px] font-semibold text-orange-400">
        <WifiOff className="h-3 w-3" />
        OFFLINE
      </span>
    ) : null;
  }

  const appWindow = getCurrentWindow();

  return (
    <>
      {/* Transparent drag strip — lets the user drag the window from the top */}
      <div
        data-tauri-drag-region
        className="fixed left-0 right-28 top-0 z-[9998] h-2"
        style={{ cursor: "move" }}
      />

      {/* Floating window controls pill */}
      <div className="titlebar-no-drag fixed right-3 top-2 z-[9999] flex items-center gap-0.5 rounded-lg border border-white/[0.08] bg-black/40 p-0.5 backdrop-blur-xl">
        {offlineMode && (
          <span className="mr-1 flex items-center gap-1 rounded-full bg-orange-500/15 px-2 py-0.5 text-[10px] font-semibold text-orange-400">
            <WifiOff className="h-3 w-3" />
            OFFLINE
          </span>
        )}
        <button
          type="button"
          className="titlebar-no-drag flex h-6 w-8 items-center justify-center rounded text-white/40 transition hover:bg-white/10 hover:text-white/80"
          onClick={(e) => { e.preventDefault(); e.stopPropagation(); void appWindow.minimize(); }}
        >
          <Minus className="h-3 w-3" strokeWidth={2} />
        </button>
        <button
          type="button"
          className="titlebar-no-drag flex h-6 w-8 items-center justify-center rounded text-white/40 transition hover:bg-white/10 hover:text-white/80"
          onClick={(e) => { e.preventDefault(); e.stopPropagation(); void appWindow.toggleMaximize(); }}
        >
          <Square className="h-2.5 w-2.5" strokeWidth={2} />
        </button>
        <button
          type="button"
          className="titlebar-no-drag flex h-6 w-8 items-center justify-center rounded text-white/40 transition hover:bg-red-600 hover:text-white"
          onClick={(e) => { e.preventDefault(); e.stopPropagation(); void appWindow.close(); }}
        >
          <X className="h-3 w-3" strokeWidth={2} />
        </button>
      </div>
    </>
  );
}
