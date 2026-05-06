import { useQuery, useQueryClient } from "@tanstack/react-query";
import { AnimatePresence, motion } from "framer-motion";
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
import { useState, type ReactNode } from "react";
import axios from "axios";
import { getStats } from "../../api/stats";
import { startScan } from "../../api/scan";
import { useScanProgressQuery } from "../../hooks/useScanProgress";
import { useSidebarStore } from "../../store/sidebarStore";
import { cn } from "../../utils/cn";
import { formatCount } from "../../utils/format";

const expandedW = 220;
const collapsedW = 72;

export function Sidebar() {
  const collapsed = useSidebarStore((s) => s.collapsed);
  const toggleSidebar = useSidebarStore((s) => s.toggle);
  const { data: stats } = useQuery({ queryKey: ["stats"], queryFn: getStats, refetchInterval: 30_000 });
  const qc = useQueryClient();
  const { data: scanProgress } = useScanProgressQuery();
  const scanRunning = scanProgress?.isRunning ?? false;
  const [scanError, setScanError] = useState<string | null>(null);

  const navCls = ({ isActive }: { isActive: boolean }) =>
    cn(
      "group relative flex items-center rounded-lg py-2 text-sm font-medium transition-colors",
      collapsed ? "justify-center px-0" : "gap-2 px-3",
      isActive
        ? "bg-pitflix-primary text-white"
        : "text-pitflix-muted hover:bg-pitflix-card hover:text-white",
    );

  const wrapTooltip = (label: string, node: ReactNode) =>
    collapsed ? (
      <span className="relative flex w-full justify-center" title={label}>
        {node}
        <span className="pointer-events-none absolute left-full z-50 ml-2 hidden whitespace-nowrap rounded-md border border-pitflix-card bg-pitflix-surface px-2 py-1 text-xs font-medium text-white shadow-lg group-hover:block">
          {label}
        </span>
      </span>
    ) : (
      node
    );

  const items: { to: string; end?: boolean; label: string; icon: ReactNode }[] = [
    { to: "/", end: true, label: "Home", icon: <Home className="h-4 w-4 shrink-0" /> },
    { to: "/movies", label: "Movies", icon: <Film className="h-4 w-4 shrink-0" /> },
    { to: "/series", label: "Series", icon: <Tv className="h-4 w-4 shrink-0" /> },
    { to: "/recommendations", label: "Recommendations", icon: <Sparkles className="h-4 w-4 shrink-0" /> },
    { to: "/trailers", label: "Trailers", icon: <CirclePlay className="h-4 w-4 shrink-0" /> },
    { to: "/online-stream", label: "Online Streaming (Beta)", icon: <Globe className="h-4 w-4 shrink-0" /> },
    { to: "/next-episodes", label: "Next episodes", icon: <CalendarClock className="h-4 w-4 shrink-0" /> },
    { to: "/awards", label: "Awards", icon: <Trophy className="h-4 w-4 shrink-0" /> },
    { to: "/unmatched", label: "Unmatched", icon: <Clapperboard className="h-4 w-4 shrink-0" /> },
    { to: "/lists", label: "My Lists", icon: <ListVideo className="h-4 w-4 shrink-0" /> },
    { to: "/my-device", label: "My device", icon: <HardDrive className="h-4 w-4 shrink-0" /> },
    { to: "/stats", label: "Statistics", icon: <BarChart3 className="h-4 w-4 shrink-0" /> },
    { to: "/settings", label: "Settings", icon: <Settings className="h-4 w-4 shrink-0" /> },
  ];

  return (
    <motion.aside
      initial={false}
      animate={{ width: collapsed ? collapsedW : expandedW }}
      transition={{ type: "spring", stiffness: 420, damping: 38 }}
      className="flex h-full shrink-0 flex-col overflow-hidden border-r border-pitflix-card bg-pitflix-surface px-2 py-4"
    >
      <div className={cn("mb-4 flex items-center gap-2 px-1", collapsed && "flex-col")}>
        <AnimatePresence initial={false}>
          {!collapsed ? (
            <motion.span
              key="brand"
              initial={{ opacity: 0, x: -6 }}
              animate={{ opacity: 1, x: 0 }}
              exit={{ opacity: 0, x: -6 }}
              transition={{ duration: 0.15 }}
              className="min-w-0 flex-1 truncate text-lg font-semibold tracking-tight text-pitflix-primary"
            >
              Pitflix
            </motion.span>
          ) : null}
        </AnimatePresence>
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
          <NavLink key={item.to} to={item.to} end={item.end} className={navCls}>
            {wrapTooltip(
              item.label,
              <>
                {item.icon}
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
              </>,
            )}
          </NavLink>
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
