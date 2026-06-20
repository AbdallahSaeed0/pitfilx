import { useQuery, useQueryClient } from "@tanstack/react-query";
import { AnimatePresence, motion, type Transition, type TargetAndTransition } from "framer-motion";
import { NavLink } from "react-router-dom";
import {
  BarChart3,
  CalendarClock,
  CirclePlay,
  Clapperboard,
  Film,
  Globe,
  HardDrive,
  Home,
  ListVideo,
  PanelLeftClose,
  PanelLeftOpen,
  ScanLine,
  Settings,
  Sparkles,
  Trophy,
  Tv,
} from "lucide-react";
import { useState, type ReactNode, type CSSProperties } from "react";
import axios from "axios";
import { getStats } from "../../api/stats";
import { getWatchStats } from "../../api/watchStats";
import { startScan } from "../../api/scan";
import { useScanProgressQuery } from "../../hooks/useScanProgress";
import { useSidebarStore } from "../../store/sidebarStore";
import { useAppPrefsStore } from "../../store/appPrefsStore";
import { cn } from "../../utils/cn";
import { formatCount } from "../../utils/format";
import { PitflixWordmark } from "../ui/PitflixWordmark";

const expandedW = 220;
const collapsedW = 72;

type NavItemDef = {
  to: string;
  end?: boolean;
  label: string;
  rawIcon: ReactNode;
  anim: { hover: TargetAndTransition; trans?: Transition; style?: CSSProperties };
  requiresInternet?: boolean;
};

function NavItemRow({ item, collapsed, offlineMode }: { item: NavItemDef; collapsed: boolean; offlineMode: boolean }) {
  const [hovered, setHovered] = useState(false);

  const cls = ({ isActive }: { isActive: boolean }) =>
    cn(
      "group relative flex items-center rounded-lg py-2 text-sm font-medium transition-colors",
      collapsed ? "justify-center px-0" : "gap-2 px-3",
      isActive
        ? "bg-pitflix-primary text-white"
        : "text-pitflix-muted hover:bg-pitflix-card hover:text-white",
    );

  const blockedCls = cn(
    "group relative flex items-center rounded-lg py-2 text-sm font-medium cursor-not-allowed opacity-40",
    collapsed ? "justify-center px-0" : "gap-2 px-3",
    "text-pitflix-muted",
  );

  const iconEl = (
    <motion.div
      className="inline-flex shrink-0"
      style={item.anim.style}
      animate={hovered ? item.anim.hover : {}}
      transition={item.anim.trans ?? { type: "spring", stiffness: 350, damping: 12 }}
    >
      {item.rawIcon}
    </motion.div>
  );

  const label = (
    <AnimatePresence initial={false}>
      {!collapsed ? (
        <motion.span
          key="label"
          initial={{ opacity: 0, x: -6 }}
          animate={{ opacity: 1, x: 0 }}
          exit={{ opacity: 0, x: -6 }}
          transition={{ duration: 0.15 }}
          className="truncate"
        >
          {item.label}
        </motion.span>
      ) : null}
    </AnimatePresence>
  );

  const tooltip = collapsed ? (
    <span className="relative flex w-full justify-center" title={item.label}>
      {iconEl}
      {label}
      <span className="pointer-events-none absolute left-full z-50 ml-2 hidden whitespace-nowrap rounded-md border border-pitflix-card bg-pitflix-surface px-2 py-1 text-xs font-medium text-white shadow-lg group-hover:block">
        {item.label}
      </span>
    </span>
  ) : (
    <>{iconEl}{label}</>
  );

  if (offlineMode && item.requiresInternet) {
    return (
      <div key={item.to} className={blockedCls} title={collapsed ? `${item.label} (offline mode)` : "Not available in offline mode"}>
        {collapsed ? (
          <span className="relative flex w-full justify-center" title={`${item.label} — offline mode`}>
            {iconEl}
            {label}
            <span className="pointer-events-none absolute left-full z-50 ml-2 hidden whitespace-nowrap rounded-md border border-pitflix-card bg-pitflix-surface px-2 py-1 text-xs font-medium text-white shadow-lg group-hover:block">
              {item.label} — offline mode
            </span>
          </span>
        ) : <>{iconEl}{label}</>}
      </div>
    );
  }

  return (
    <NavLink
      to={item.to}
      end={item.end}
      className={cls}
      onMouseEnter={() => setHovered(true)}
      onMouseLeave={() => setHovered(false)}
    >
      {tooltip}
    </NavLink>
  );
}

export function Sidebar() {
  const collapsed = useSidebarStore((s) => s.collapsed);
  const toggleSidebar = useSidebarStore((s) => s.toggle);
  const offlineMode = useAppPrefsStore((s) => s.offlineMode);
  const { data: stats } = useQuery({ queryKey: ["stats"], queryFn: getStats, refetchInterval: 30_000 });
  const { data: watchStats } = useQuery({ queryKey: ["watch-stats"], queryFn: getWatchStats, staleTime: 5 * 60_000 });
  const streak = watchStats?.watchStreak ?? 0;
  const qc = useQueryClient();
  const { data: scanProgress } = useScanProgressQuery();
  const scanRunning = scanProgress?.isRunning ?? false;
  const [scanError, setScanError] = useState<string | null>(null);

  const items: NavItemDef[] = [
    // Home — heartbeat double-pulse
    { to: "/", end: true, label: "Home",
      rawIcon: <Home className="h-4 w-4" />,
      anim: { hover: { scale: [1, 1.3, 1.1, 1.25, 1] }, trans: { duration: 0.5 } } },

    // Movies — film reel wobble (left-right shake like a reel spinning)
    { to: "/movies", label: "Movies",
      rawIcon: <Film className="h-4 w-4" />,
      anim: { hover: { rotate: [0, -14, 14, -8, 8, 0] }, trans: { duration: 0.5 } } },

    // Series — TV static flicker (opacity blink)
    { to: "/series", label: "Series",
      rawIcon: <Tv className="h-4 w-4" />,
      anim: { hover: { opacity: [1, 0.2, 1, 0.5, 1, 0.8, 1] }, trans: { duration: 0.45 } } },

    // Recommendations — sparkle burst: spin + scale pulse
    { to: "/recommendations", label: "Recommendations",
      rawIcon: <Sparkles className="h-4 w-4" />,
      anim: { hover: { rotate: [0, 25, -25, 15, 0], scale: [1, 1.35, 1, 1.2, 1] }, trans: { duration: 0.55 } },
      requiresInternet: true },

    // Trailers — press-and-pop like hitting Play
    { to: "/trailers", label: "Trailers",
      rawIcon: <CirclePlay className="h-4 w-4" />,
      anim: { hover: { scale: [1, 0.75, 1.35, 1.05] }, trans: { duration: 0.35 } },
      requiresInternet: true },

    // Online Streaming — globe spins continuously while hovered
    { to: "/online-stream", label: "Online Streaming",
      rawIcon: <Globe className="h-4 w-4" />,
      anim: { hover: { rotate: 360 }, trans: { duration: 0.85, ease: "easeInOut" } },
      requiresInternet: true },

    // Next episodes — clock hand jumps forward (quick tick)
    { to: "/next-episodes", label: "Next episodes",
      rawIcon: <CalendarClock className="h-4 w-4" />,
      anim: { hover: { rotate: [0, 0, 35, 0] }, trans: { duration: 0.45, times: [0, 0.3, 0.6, 1] } } },

    // Awards — trophy shimmy side to side (celebration jiggle)
    { to: "/awards", label: "Awards",
      rawIcon: <Trophy className="h-4 w-4" />,
      anim: { hover: { rotate: [0, -12, 12, -7, 7, 0] }, trans: { duration: 0.5 } } },

    // Unmatched — clapperboard snaps open (sharp forward rotate, snaps back)
    { to: "/unmatched", label: "Unmatched",
      rawIcon: <Clapperboard className="h-4 w-4" />,
      anim: { hover: { rotate: [0, -28, 6, -20, 2, 0] }, trans: { duration: 0.4 } } },

    // My Lists — items peek in from the right (quick x nudge)
    { to: "/lists", label: "My Lists",
      rawIcon: <ListVideo className="h-4 w-4" />,
      anim: { hover: { x: [0, 6, -2, 4, 0] }, trans: { duration: 0.4 } } },

    // My device — hard drive hum/vibration (rapid x shake)
    { to: "/my-device", label: "My device",
      rawIcon: <HardDrive className="h-4 w-4" />,
      anim: { hover: { x: [0, -3, 3, -2, 2, -1, 1, 0] }, trans: { duration: 0.4 } } },

    // Statistics — bars shoot up from the bottom
    { to: "/stats", label: "Statistics",
      rawIcon: <BarChart3 className="h-4 w-4" />,
      anim: { hover: { scaleY: [1, 1.5, 1.2, 1.4] }, trans: { duration: 0.4, ease: "easeOut" },
              style: { transformOrigin: "bottom center" } } },

    // Settings — gear rotates 180° (half turn, snaps back on mouse-out)
    { to: "/settings", label: "Settings",
      rawIcon: <Settings className="h-4 w-4" />,
      anim: { hover: { rotate: 180 }, trans: { duration: 0.5, ease: "easeInOut" } } },
  ];

  return (
    <motion.aside
      initial={false}
      animate={{ width: collapsed ? collapsedW : expandedW }}
      transition={{ type: "spring", stiffness: 420, damping: 38 }}
      className="flex h-full shrink-0 flex-col overflow-hidden border-r border-pitflix-card bg-pitflix-surface px-2 py-4"
    >
      <div className={cn("mb-4 flex items-center gap-2 px-1", collapsed && "flex-col")}>
        {collapsed ? (
          <img src="/pitflix_icon_final.svg" alt="Pitflix" className="h-8 w-8 shrink-0" />
        ) : (
          <AnimatePresence initial={false}>
            <motion.div
              key="brand"
              initial={{ opacity: 0, x: -6 }}
              animate={{ opacity: 1, x: 0 }}
              exit={{ opacity: 0, x: -6 }}
              transition={{ duration: 0.15 }}
              className="min-w-0 flex-1"
            >
              <PitflixWordmark className="h-12" />
            </motion.div>
          </AnimatePresence>
        )}
        <button
          type="button"
          onClick={toggleSidebar}
          className={cn(
            "rounded-lg p-1.5 text-pitflix-muted transition-colors hover:bg-pitflix-card hover:text-white",
            collapsed ? "ml-0" : "ml-auto shrink-0",
          )}
          title={collapsed ? "Expand sidebar" : "Collapse sidebar"}
          aria-expanded={!collapsed}
        >
          {collapsed ? <PanelLeftOpen className="h-4 w-4" /> : <PanelLeftClose className="h-4 w-4" />}
        </button>
      </div>

      <nav className="flex flex-1 flex-col gap-0.5 overflow-y-auto overflow-x-hidden">
        {items.map((item) => (
          <NavItemRow key={item.to} item={item} collapsed={collapsed} offlineMode={offlineMode} />
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
          type="button"
          disabled={scanRunning}
          title={
            collapsed
              ? scanError ?? "Scan library"
              : scanError ??
                "Scans every folder listed in Settings, including all subfolders and files added since the last scan."
          }
          className={cn(
            "flex w-full items-center justify-center gap-2 rounded-lg bg-pitflix-primary py-2.5 text-sm font-semibold text-white",
            "hover:bg-pitflix-dark disabled:opacity-50",
            collapsed && "px-0",
          )}
          onClick={() => {
            setScanError(null);
            void startScan({ folders: [] })
              .then(() => {
                void qc.invalidateQueries({ queryKey: ["scanProgress"] });
              })
              .catch((err) => {
                console.error("Scan failed:", err);
                const msg = (() => {
                  if (axios.isAxiosError(err)) {
                    const raw = err.response?.data;
                    const data = raw && typeof raw === "object" ? (raw as Record<string, unknown>) : null;
                    const message = data?.message;
                    if (typeof message === "string" && message.trim()) return message;
                    const code = data?.error;
                    if (code === "NO_LIBRARY_FOLDERS")
                      return "No library folders are configured. Open Settings first.";
                  }
                  return err instanceof Error && err.message.toLowerCase().includes("network")
                    ? "API unreachable"
                    : "Scan could not start";
                })();
                setScanError(msg);
                setTimeout(() => setScanError(null), 3000);
              });
          }}
        >
          <ScanLine className="h-4 w-4 shrink-0" />
          {!collapsed ? <span>{scanError ? scanError : scanRunning ? "Scanning…" : "Scan Library"}</span> : null}
        </button>
      </div>
    </motion.aside>
  );
}
