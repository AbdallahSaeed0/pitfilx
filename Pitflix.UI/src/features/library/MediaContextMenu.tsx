import { Check, RefreshCw } from "lucide-react";
import { useEffect, useLayoutEffect, useRef, useState } from "react";
import { cn } from "../../utils/cn";

export type MediaContextMenuAction = "rescan" | "markWatched" | "markUnwatched";

type Props = {
  label: string;
  x: number;
  y: number;
  watchStatus?: string;
  showRescan?: boolean;
  onAction: (action: MediaContextMenuAction) => void;
  onClose: () => void;
};

export function MediaContextMenu({
  label,
  x,
  y,
  watchStatus,
  showRescan = true,
  onAction,
  onClose,
}: Props) {
  const menuRef = useRef<HTMLDivElement>(null);
  const [pos, setPos] = useState({ x, y });
  const isWatched = watchStatus === "Completed";

  useLayoutEffect(() => {
    const el = menuRef.current;
    if (!el) return;
    const rect = el.getBoundingClientRect();
    let left = x;
    let top = y;
    if (left + rect.width > window.innerWidth - 8) {
      left = Math.max(8, window.innerWidth - rect.width - 8);
    }
    if (top + rect.height > window.innerHeight - 8) {
      top = Math.max(8, window.innerHeight - rect.height - 8);
    }
    setPos({ x: left, y: top });
  }, [x, y]);

  useEffect(() => {
    const onPointerDown = (e: MouseEvent) => {
      if (menuRef.current?.contains(e.target as Node)) return;
      onClose();
    };
    const onKeyDown = (e: KeyboardEvent) => {
      if (e.key === "Escape") onClose();
    };
    const onScroll = () => onClose();

    window.addEventListener("mousedown", onPointerDown);
    window.addEventListener("keydown", onKeyDown);
    window.addEventListener("scroll", onScroll, true);
    window.addEventListener("resize", onClose);
    return () => {
      window.removeEventListener("mousedown", onPointerDown);
      window.removeEventListener("keydown", onKeyDown);
      window.removeEventListener("scroll", onScroll, true);
      window.removeEventListener("resize", onClose);
    };
  }, [onClose]);

  const items: {
    action: MediaContextMenuAction;
    label: string;
    icon: typeof RefreshCw;
    hidden?: boolean;
  }[] = [
    { action: "rescan", label: "Rescan", icon: RefreshCw, hidden: !showRescan },
    {
      action: isWatched ? "markUnwatched" : "markWatched",
      label: isWatched ? "Mark unwatched" : "Mark watched",
      icon: Check,
    },
  ];

  return (
    <div
      ref={menuRef}
      role="menu"
      aria-label={`Actions for ${label}`}
      className="fixed z-[80] min-w-[11rem] overflow-hidden rounded-xl border border-white/10 bg-zinc-900 py-1 shadow-2xl"
      style={{ left: pos.x, top: pos.y }}
      onContextMenu={(e) => e.preventDefault()}
    >
      <p className="truncate border-b border-white/8 px-3 py-2 text-[11px] font-medium text-pitflix-muted">
        {label}
      </p>
      {items
        .filter((i) => !i.hidden)
        .map(({ action, label: itemLabel, icon: Icon }) => (
          <button
            key={action}
            type="button"
            role="menuitem"
            onClick={() => {
              onAction(action);
              onClose();
            }}
            className={cn(
              "flex w-full items-center gap-2.5 px-3 py-2 text-left text-sm text-white transition hover:bg-white/8",
            )}
          >
            <Icon className="h-4 w-4 shrink-0 opacity-80" />
            {itemLabel}
          </button>
        ))}
    </div>
  );
}
