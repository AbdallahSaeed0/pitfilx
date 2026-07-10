import { AnimatePresence, motion } from "framer-motion";
import { cloneElement, isValidElement, useRef, useState, type ReactElement } from "react";
import { NavLink } from "react-router-dom";
import { cn } from "../../../utils/cn";
import type { AppNavItemDef } from "./appNavItems";
import { SidebarCollapsedFlyout } from "./SidebarCollapsedFlyout";

export type AppNavVariant = "sidebar" | "topDock" | "floatingDock";

type Props = {
  item: AppNavItemDef;
  variant: AppNavVariant;
  collapsed?: boolean;
  offlineMode: boolean;
};

function renderIcon(item: AppNavItemDef, large: boolean) {
  if (!isValidElement(item.rawIcon)) return item.rawIcon;
  return cloneElement(item.rawIcon as ReactElement<{ className?: string }>, {
    className: large ? "h-[22px] w-[22px]" : "h-4 w-4",
  });
}

function CollapsedSidebarRow({
  item,
  hovered,
  onHover,
  blocked,
}: {
  item: AppNavItemDef;
  hovered: boolean;
  onHover: (v: boolean) => void;
  blocked: boolean;
}) {
  const anchorRef = useRef<HTMLDivElement>(null);
  const flyoutLabel = blocked ? `${item.label} — offline mode` : item.label;

  const iconEl = (
    <motion.div
      className="inline-flex shrink-0"
      style={item.anim.style}
      animate={hovered && !blocked ? item.anim.hover : {}}
      transition={item.anim.trans ?? { type: "spring", stiffness: 350, damping: 12 }}
    >
      {renderIcon(item, true)}
    </motion.div>
  );

  const rowCls = (active: boolean) =>
    cn(
      "mx-auto flex h-11 w-11 items-center justify-center rounded-xl text-sm font-medium transition-colors",
      active ? "bg-pitflix-primary text-white" : "text-pitflix-muted hover:bg-pitflix-card hover:text-white",
      blocked && "cursor-not-allowed opacity-40",
    );

  const flyout = (
    <SidebarCollapsedFlyout visible={hovered} anchorRef={anchorRef} label={flyoutLabel} />
  );

  if (blocked) {
    return (
      <div
        ref={anchorRef}
        className={rowCls(false)}
        onMouseEnter={() => onHover(true)}
        onMouseLeave={() => onHover(false)}
      >
        {iconEl}
        {flyout}
      </div>
    );
  }

  return (
    <>
      <NavLink
        to={item.to}
        end={item.end}
        className={({ isActive }) => rowCls(isActive)}
        onMouseEnter={() => onHover(true)}
        onMouseLeave={() => onHover(false)}
      >
        <span ref={anchorRef} className="flex h-full w-full items-center justify-center">
          {iconEl}
        </span>
      </NavLink>
      {flyout}
    </>
  );
}

export function AppNavItemRow({ item, variant, collapsed = false, offlineMode }: Props) {
  const [hovered, setHovered] = useState(false);
  const blocked = offlineMode && !!item.requiresInternet;

  if (variant === "sidebar" && collapsed) {
    return (
      <CollapsedSidebarRow
        item={item}
        hovered={hovered}
        onHover={setHovered}
        blocked={blocked}
      />
    );
  }

  const showLabel = variant === "sidebar" ? !collapsed : variant === "topDock";

  const activeCls =
    variant === "floatingDock"
      ? "bg-white/15 text-white shadow-[0_0_16px_rgba(124,58,237,0.35)]"
      : variant === "topDock"
        ? "bg-pitflix-primary text-white shadow-md shadow-pitflix-primary/25"
        : "bg-pitflix-primary text-white";

  const idleCls =
    variant === "floatingDock"
      ? "text-white/55 hover:bg-white/10 hover:text-white"
      : variant === "topDock"
        ? "text-pitflix-muted hover:bg-pitflix-card hover:text-white"
        : "text-pitflix-muted hover:bg-pitflix-card hover:text-white";

  const linkCls = ({ isActive }: { isActive: boolean }) =>
    cn(
      "group relative flex shrink-0 items-center transition-colors",
      variant === "floatingDock" && "h-10 w-10 justify-center rounded-xl",
      variant === "topDock" && "gap-1.5 rounded-full px-3 py-1.5 text-[11px] font-medium",
      variant === "sidebar" && "gap-2 rounded-lg px-3 py-2 text-sm font-medium",
      isActive ? activeCls : idleCls,
    );

  const blockedCls = cn(
    "group relative flex shrink-0 cursor-not-allowed items-center opacity-40",
    variant === "topDock" && "gap-1.5 rounded-full px-3 py-1.5 text-[11px] font-medium",
    variant === "sidebar" && "gap-2 rounded-lg px-3 py-2 text-sm font-medium",
    "text-pitflix-muted",
  );

  const iconEl = (
    <motion.div
      className="inline-flex shrink-0"
      style={item.anim.style}
      animate={hovered ? item.anim.hover : {}}
      transition={item.anim.trans ?? { type: "spring", stiffness: 350, damping: 12 }}
    >
      {renderIcon(item, false)}
    </motion.div>
  );

  const label = showLabel ? (
    variant === "sidebar" ? (
      <AnimatePresence initial={false}>
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
      </AnimatePresence>
    ) : (
      <span className="truncate">{item.label}</span>
    )
  ) : null;

  if (blocked) {
    return (
      <div className={blockedCls} title={`${item.label} — offline mode`}>
        {iconEl}
        {label}
      </div>
    );
  }

  return (
    <NavLink
      to={item.to}
      end={item.end}
      className={linkCls}
      onMouseEnter={() => setHovered(true)}
      onMouseLeave={() => setHovered(false)}
    >
      {iconEl}
      {label}
    </NavLink>
  );
}
