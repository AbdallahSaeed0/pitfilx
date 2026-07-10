import { useQuery } from "@tanstack/react-query";
import { AnimatePresence, motion } from "framer-motion";
import { ScanLine } from "lucide-react";
import { useRef, useState } from "react";
import { getStats } from "../../api/stats";
import { getWatchStats } from "../../api/watchStats";
import { useSidebarStore } from "../../store/sidebarStore";
import { useAppPrefsStore } from "../../store/appPrefsStore";
import { cn } from "../../utils/cn";
import { formatCount } from "../../utils/format";
import { PitflixWordmark } from "../ui/PitflixWordmark";
import { APP_NAV_ITEMS } from "./appNav/appNavItems";
import { AppNavItemRow } from "./appNav/AppNavItemRow";
import { SidebarCollapsedFlyout } from "./appNav/SidebarCollapsedFlyout";
import { useAppNavScan } from "./appNav/useAppNavScan";

const expandedW = 220;
const collapsedW = 72;

export function Sidebar() {
  const collapsed = useSidebarStore((s) => s.collapsed);
  const toggleSidebar = useSidebarStore((s) => s.toggle);
  const offlineMode = useAppPrefsStore((s) => s.offlineMode);
  const liveTvEnabled = useAppPrefsStore((s) => s.liveTvEnabled);
  const { data: stats } = useQuery({ queryKey: ["stats"], queryFn: getStats, refetchInterval: 30_000 });
  const { data: watchStats } = useQuery({ queryKey: ["watch-stats"], queryFn: getWatchStats, staleTime: 5 * 60_000 });
  const streak = watchStats?.watchStreak ?? 0;
  const { scanRunning, scanError, runScan } = useAppNavScan();
  const [scanHovered, setScanHovered] = useState(false);
  const scanAnchorRef = useRef<HTMLButtonElement>(null);

  return (
    <motion.aside
      initial={false}
      animate={{ width: collapsed ? collapsedW : expandedW }}
      transition={{ type: "spring", stiffness: 420, damping: 38 }}
      className="relative z-30 flex h-full shrink-0 flex-col overflow-hidden border-r border-pitflix-card bg-pitflix-surface px-2 py-4"
    >
      <div className="mb-4 px-1">
        <button
          type="button"
          onClick={toggleSidebar}
          className={cn(
            "flex w-full items-center bg-transparent",
            collapsed ? "justify-center p-1" : "justify-start px-1 py-0.5",
          )}
          aria-label={collapsed ? "Expand sidebar" : "Collapse sidebar"}
          aria-expanded={!collapsed}
        >
          {collapsed ? (
            <img src="/pitflix_icon_final.svg" alt="Pitflix" className="h-9 w-9 shrink-0" />
          ) : (
            <AnimatePresence initial={false} mode="wait">
              <motion.div
                key="brand"
                initial={{ opacity: 0, x: -6 }}
                animate={{ opacity: 1, x: 0 }}
                exit={{ opacity: 0, x: -6 }}
                transition={{ duration: 0.15 }}
                className="min-w-0"
              >
                <PitflixWordmark className="h-12" />
              </motion.div>
            </AnimatePresence>
          )}
        </button>
      </div>

      <nav className="flex flex-1 flex-col gap-1 overflow-x-hidden overflow-y-auto">
        {APP_NAV_ITEMS.filter((item) => item.to !== "/live" || liveTvEnabled).map((item) => (
          <AppNavItemRow
            key={item.to}
            item={item}
            variant="sidebar"
            collapsed={collapsed}
            offlineMode={offlineMode}
          />
        ))}
      </nav>

      <div className="mt-auto space-y-2 border-t border-pitflix-card pt-3">
        <motion.div
          className="flex flex-wrap gap-1.5 px-1 text-[10px] text-pitflix-subtle"
          animate={{ opacity: collapsed ? 0 : 1 }}
          transition={{ duration: 0.15 }}
          style={{ pointerEvents: collapsed ? "none" : undefined }}
        >
          {!collapsed ? (
            <>
              <span className="rounded bg-pitflix-card px-1.5 py-0.5">
                Movies {formatCount(stats?.totalMovies ?? 0)}
              </span>
              <span className="rounded bg-pitflix-card px-1.5 py-0.5">
                Series {formatCount(stats?.totalSeries ?? 0)}
              </span>
              <span className="rounded bg-pitflix-primary/25 px-1.5 py-0.5 text-pitflix-light">
                Unmatched {formatCount(stats?.totalUnmatched ?? 0)}
              </span>
            </>
          ) : null}
        </motion.div>

        {streak >= 2 ? (
          <motion.div
            animate={{ opacity: 1 }}
            title={collapsed ? `${streak} day streak` : undefined}
            className={cn(
              "flex items-center gap-1.5 rounded-lg border border-orange-500/40 bg-orange-500/10 px-3 py-2 text-xs font-semibold text-orange-300",
              collapsed ? "justify-center px-0" : "",
            )}
          >
            <span>🔥</span>
            {!collapsed ? <span>{streak} day streak</span> : null}
          </motion.div>
        ) : null}

        <button
          ref={scanAnchorRef}
          type="button"
          disabled={scanRunning}
          title={collapsed ? undefined : scanError ?? "Scans every folder listed in Settings, including all subfolders and files added since the last scan."}
          className={cn(
            "flex w-full items-center justify-center gap-2 rounded-lg bg-pitflix-primary text-sm font-semibold text-white",
            "hover:bg-pitflix-dark disabled:opacity-50",
            collapsed ? "mx-auto h-11 w-11 px-0 py-0" : "py-2.5",
          )}
          onClick={runScan}
          onMouseEnter={() => setScanHovered(true)}
          onMouseLeave={() => setScanHovered(false)}
        >
          <ScanLine className={cn("shrink-0", collapsed ? "h-[22px] w-[22px]" : "h-4 w-4")} />
          {!collapsed ? <span>{scanError ? scanError : scanRunning ? "Scanning…" : "Scan Library"}</span> : null}
        </button>

        {collapsed ? (
          <SidebarCollapsedFlyout
            visible={scanHovered}
            anchorRef={scanAnchorRef}
            label={scanError ? scanError : scanRunning ? "Scanning…" : "Scan library"}
          />
        ) : null}
      </div>
    </motion.aside>
  );
}
