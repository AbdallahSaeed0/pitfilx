import type { ReactNode, CSSProperties } from "react";
import type { TargetAndTransition, Transition } from "framer-motion";
import {
  BarChart3,
  CalendarClock,
  CirclePlay,
  Clapperboard,
  Compass,
  Film,
  Globe,
  HardDrive,
  Home,
  ListVideo,
  Settings,
  Signal,
  Sparkles,
  Trophy,
  Tv,
} from "lucide-react";

export type AppNavItemDef = {
  to: string;
  end?: boolean;
  label: string;
  rawIcon: ReactNode;
  anim: { hover: TargetAndTransition; trans?: Transition; style?: CSSProperties };
  requiresInternet?: boolean;
};

export const APP_NAV_ITEMS: AppNavItemDef[] = [
  {
    to: "/",
    end: true,
    label: "Home",
    rawIcon: <Home className="h-4 w-4" />,
    anim: { hover: { scale: [1, 1.3, 1.1, 1.25, 1] }, trans: { duration: 0.5 } },
  },
  {
    to: "/movies",
    label: "Movies",
    rawIcon: <Film className="h-4 w-4" />,
    anim: { hover: { rotate: [0, -14, 14, -8, 8, 0] }, trans: { duration: 0.5 } },
  },
  {
    to: "/series",
    label: "Series",
    rawIcon: <Tv className="h-4 w-4" />,
    anim: { hover: { opacity: [1, 0.2, 1, 0.5, 1, 0.8, 1] }, trans: { duration: 0.45 } },
  },
  {
    to: "/recommendations",
    label: "Recommendations",
    rawIcon: <Sparkles className="h-4 w-4" />,
    anim: {
      hover: { rotate: [0, 25, -25, 15, 0], scale: [1, 1.35, 1, 1.2, 1] },
      trans: { duration: 0.55 },
    },
    requiresInternet: true,
  },
  {
    to: "/trailers",
    label: "Trailers",
    rawIcon: <CirclePlay className="h-4 w-4" />,
    anim: { hover: { scale: [1, 0.75, 1.35, 1.05] }, trans: { duration: 0.35 } },
    requiresInternet: true,
  },
  {
    to: "/online-stream",
    label: "Online Streaming",
    rawIcon: <Globe className="h-4 w-4" />,
    anim: { hover: { rotate: 360 }, trans: { duration: 0.85, ease: "easeInOut" } },
    requiresInternet: true,
  },
  {
    to: "/browse",
    label: "Browse",
    rawIcon: <Compass className="h-4 w-4" />,
    anim: { hover: { rotate: [0, 360] }, trans: { duration: 0.6, ease: "easeInOut" } },
    requiresInternet: true,
  },
  {
    to: "/live",
    label: "Live TV",
    rawIcon: <Signal className="h-4 w-4" />,
    anim: { hover: { scale: [1, 1.2, 0.9, 1.15, 1] }, trans: { duration: 0.45 } },
  },
  {
    to: "/next-episodes",
    label: "Next episodes",
    rawIcon: <CalendarClock className="h-4 w-4" />,
    anim: { hover: { rotate: [0, 0, 35, 0] }, trans: { duration: 0.45, times: [0, 0.3, 0.6, 1] } },
  },
  {
    to: "/awards",
    label: "Awards",
    rawIcon: <Trophy className="h-4 w-4" />,
    anim: { hover: { rotate: [0, -12, 12, -7, 7, 0] }, trans: { duration: 0.5 } },
  },
  {
    to: "/unmatched",
    label: "Unmatched",
    rawIcon: <Clapperboard className="h-4 w-4" />,
    anim: { hover: { rotate: [0, -28, 6, -20, 2, 0] }, trans: { duration: 0.4 } },
  },
  {
    to: "/lists",
    label: "My Lists",
    rawIcon: <ListVideo className="h-4 w-4" />,
    anim: { hover: { x: [0, 6, -2, 4, 0] }, trans: { duration: 0.4 } },
  },
  {
    to: "/my-device",
    label: "My Device",
    rawIcon: <HardDrive className="h-4 w-4" />,
    anim: { hover: { x: [0, -3, 3, -2, 2, -1, 1, 0] }, trans: { duration: 0.4 } },
  },
  {
    to: "/stats",
    label: "Statistics",
    rawIcon: <BarChart3 className="h-4 w-4" />,
    anim: {
      hover: { scaleY: [1, 1.5, 1.2, 1.4] },
      trans: { duration: 0.4, ease: "easeOut" },
      style: { transformOrigin: "bottom center" },
    },
  },
  {
    to: "/settings",
    label: "Settings",
    rawIcon: <Settings className="h-4 w-4" />,
    anim: { hover: { rotate: 180 }, trans: { duration: 0.5, ease: "easeInOut" } },
  },
];
