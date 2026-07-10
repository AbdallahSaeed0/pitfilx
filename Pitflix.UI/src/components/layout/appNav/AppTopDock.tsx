import { ScanLine } from "lucide-react";
import { cn } from "../../../utils/cn";
import { useAppPrefsStore } from "../../../store/appPrefsStore";
import { PitflixWordmark } from "../../ui/PitflixWordmark";
import { APP_NAV_ITEMS } from "./appNavItems";
import { TopDockItem } from "./TopDockItem";
import { useAppNavScan } from "./useAppNavScan";

export function AppTopDock() {
  const offlineMode = useAppPrefsStore((s) => s.offlineMode);
  const liveTvEnabled = useAppPrefsStore((s) => s.liveTvEnabled);
  const { scanRunning, scanError, runScan } = useAppNavScan();

  return (
    <header className="titlebar-no-drag z-30 shrink-0 border-b border-pitflix-card bg-pitflix-surface/95 pt-10 backdrop-blur-md">
      <div className="flex items-center justify-between gap-3 px-4 pb-2 pt-1">
        <PitflixWordmark className="h-9 shrink-0" />

        <button
          type="button"
          disabled={scanRunning}
          title={scanError ?? "Scan library"}
          onClick={runScan}
          className={cn(
            "inline-flex shrink-0 items-center gap-1.5 rounded-full bg-pitflix-primary px-3 py-1.5 text-[11px] font-semibold text-white",
            "transition-transform hover:scale-105 hover:bg-pitflix-dark disabled:opacity-50",
          )}
        >
          <ScanLine className="h-3.5 w-3.5" />
          <span>{scanError ? scanError : scanRunning ? "Scanning…" : "Scan library"}</span>
        </button>
      </div>

      <nav className="flex flex-wrap items-center gap-1 px-4 pb-3">
        {APP_NAV_ITEMS.filter((item) => item.to !== "/live" || liveTvEnabled).map((item) => (
          <TopDockItem key={item.to} item={item} offlineMode={offlineMode} />
        ))}
      </nav>
    </header>
  );
}
