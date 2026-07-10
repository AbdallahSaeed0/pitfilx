import { CheckSquare, FolderPlus, Settings2 } from "lucide-react";
import { useEffect, useLayoutEffect, useRef, useState } from "react";
import { cn } from "../../utils/cn";

export type DeviceFolderContextMenuAction = "select" | "newFolder" | "configure";

type Props = {
  x: number;
  y: number;
  selectionMode: boolean;
  onAction: (action: DeviceFolderContextMenuAction) => void;
  onClose: () => void;
};

const ITEMS: {
  action: DeviceFolderContextMenuAction;
  label: (selectionMode: boolean) => string;
  icon: typeof CheckSquare;
}[] = [
  {
    action: "select",
    label: (selectionMode) => (selectionMode ? "Cancel select" : "Select"),
    icon: CheckSquare,
  },
  {
    action: "newFolder",
    label: () => "New folder",
    icon: FolderPlus,
  },
  {
    action: "configure",
    label: () => "Configure",
    icon: Settings2,
  },
];

export function DeviceFolderContextMenu({
  x,
  y,
  selectionMode,
  onAction,
  onClose,
}: Props) {
  const menuRef = useRef<HTMLDivElement>(null);
  const [pos, setPos] = useState({ x, y });

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

  return (
    <div
      ref={menuRef}
      role="menu"
      aria-label="Folder actions"
      className="fixed z-[80] min-w-[11rem] overflow-hidden rounded-xl border border-white/10 bg-zinc-900 py-1 shadow-2xl"
      style={{ left: pos.x, top: pos.y }}
      onContextMenu={(e) => e.preventDefault()}
    >
      {ITEMS.map(({ action, label, icon: Icon }) => (
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
            action === "select" && selectionMode && "text-pitflix-primary",
          )}
        >
          <Icon className="h-4 w-4 shrink-0 opacity-80" />
          {label(selectionMode)}
        </button>
      ))}
    </div>
  );
}
