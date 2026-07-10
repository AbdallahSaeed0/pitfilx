import { cloneElement, isValidElement, useEffect, useRef, type ReactElement, type ReactNode } from "react";
import { NavLink, useLocation } from "react-router-dom";
import { cn } from "../../../utils/cn";
import {
  FLOATING_DOCK_ACTIVE,
  FLOATING_DOCK_BASE_ICON,
  FLOATING_DOCK_BASE_SIZE,
  FLOATING_DOCK_IDLE,
} from "./floatingDockTheme";
import type { FloatingDockIconRefs } from "./useFloatingDockMagnification";

type Props = {
  index: number;
  label: string;
  icon: ReactNode;
  registerRefs: (index: number, refs: FloatingDockIconRefs) => void;
  to?: string;
  end?: boolean;
  blocked?: boolean;
  isActive?: boolean;
  onClick?: () => void;
};

function isNavItemActive(pathname: string, to: string, end?: boolean): boolean {
  if (end || to === "/") return pathname === to;
  return pathname === to || pathname.startsWith(`${to}/`);
}

function DockIconBody({
  label,
  icon,
  isActive,
  blocked,
  onClick,
  registerRefs,
  index,
}: Omit<Props, "to" | "end">) {
  const wrapperRef = useRef<HTMLDivElement>(null);
  const bgRef = useRef<HTMLDivElement>(null);
  const iconRef = useRef<HTMLSpanElement>(null);

  useEffect(() => {
    registerRefs(index, {
      wrapper: wrapperRef.current,
      bg: bgRef.current,
      icon: iconRef.current,
    });
  });

  const iconEl = isValidElement(icon)
    ? cloneElement(icon as ReactElement<{ className?: string; strokeWidth?: number }>, {
        className: "h-full w-full text-white",
        strokeWidth: 1.75,
      })
    : icon;

  return (
    <div
      ref={wrapperRef}
      className={cn(
        "relative flex shrink-0 cursor-pointer items-center justify-center",
        blocked && "cursor-not-allowed opacity-40",
      )}
      onClick={blocked ? undefined : onClick}
      title={blocked ? `${label} — offline mode` : undefined}
    >
      <div
        ref={bgRef}
        className="flex items-center justify-center rounded-full border transition-[background,box-shadow,border-color] duration-300"
        style={{
          width: FLOATING_DOCK_BASE_SIZE,
          height: FLOATING_DOCK_BASE_SIZE,
          background: isActive ? FLOATING_DOCK_ACTIVE.background : FLOATING_DOCK_IDLE.background,
          boxShadow: isActive ? FLOATING_DOCK_ACTIVE.boxShadow : FLOATING_DOCK_IDLE.boxShadow,
          borderColor: isActive ? FLOATING_DOCK_ACTIVE.borderColor : FLOATING_DOCK_IDLE.borderColor,
        }}
      >
        <span ref={iconRef} className="inline-flex items-center justify-center" style={{ width: FLOATING_DOCK_BASE_ICON, height: FLOATING_DOCK_BASE_ICON }}>
          {iconEl}
        </span>
      </div>
      <span
        className="absolute -bottom-2 left-1/2 h-1 w-1 -translate-x-1/2 rounded-full bg-white/[0.65] transition-opacity duration-250"
        style={{ opacity: isActive ? 1 : 0 }}
        aria-hidden
      />
    </div>
  );
}

export function FloatingDockItem({
  index,
  label,
  icon,
  registerRefs,
  to,
  end,
  blocked = false,
  onClick,
}: Props) {
  const { pathname } = useLocation();
  const isActive = to ? !blocked && isNavItemActive(pathname, to, end) : false;

  if (to && !blocked) {
    return (
      <NavLink to={to} end={end} aria-label={label} aria-current={isActive ? "page" : undefined} className="shrink-0">
        <DockIconBody
          index={index}
          label={label}
          icon={icon}
          registerRefs={registerRefs}
          isActive={isActive}
          blocked={blocked}
        />
      </NavLink>
    );
  }

  return (
    <DockIconBody
      index={index}
      label={label}
      icon={icon}
      registerRefs={registerRefs}
      isActive={isActive}
      blocked={blocked}
      onClick={onClick}
    />
  );
}
