import { motion } from "framer-motion";
import { useState } from "react";
import { NavLink, useLocation } from "react-router-dom";
import { cn } from "../../../utils/cn";
import type { AppNavItemDef } from "./appNavItems";

type Props = {
  item: AppNavItemDef;
  offlineMode: boolean;
};

function isNavItemActive(pathname: string, item: AppNavItemDef): boolean {
  if (item.end || item.to === "/") return pathname === item.to;
  return pathname === item.to || pathname.startsWith(`${item.to}/`);
}

export function TopDockItem({ item, offlineMode }: Props) {
  const [hovered, setHovered] = useState(false);
  const { pathname } = useLocation();
  const blocked = offlineMode && item.requiresInternet;
  const isActive = !blocked && isNavItemActive(pathname, item);

  const inner = (
    <motion.span
      className={cn(
        "inline-flex items-center gap-1.5 rounded-full px-2.5 py-1.5 text-[11px] font-medium",
        blocked && "cursor-not-allowed opacity-40",
        isActive
          ? "bg-pitflix-primary text-white shadow-md shadow-pitflix-primary/30"
          : "text-pitflix-muted hover:bg-pitflix-card hover:text-white",
      )}
      animate={{ scale: hovered && !blocked ? 1.06 : 1 }}
      transition={{ type: "spring", stiffness: 450, damping: 26 }}
    >
      <motion.span
        className="inline-flex shrink-0"
        style={item.anim.style}
        animate={hovered && !blocked ? item.anim.hover : {}}
        transition={item.anim.trans ?? { type: "spring", stiffness: 350, damping: 12 }}
      >
        {item.rawIcon}
      </motion.span>
      <span className="whitespace-nowrap">{item.label}</span>
    </motion.span>
  );

  if (blocked) {
    return (
      <span className="inline-flex shrink-0" title={`${item.label} — offline mode`}>
        {inner}
      </span>
    );
  }

  return (
    <NavLink
      to={item.to}
      end={item.end}
      className="inline-flex shrink-0"
      aria-label={item.label}
      aria-current={isActive ? "page" : undefined}
      onMouseEnter={() => setHovered(true)}
      onMouseLeave={() => setHovered(false)}
    >
      {inner}
    </NavLink>
  );
}
