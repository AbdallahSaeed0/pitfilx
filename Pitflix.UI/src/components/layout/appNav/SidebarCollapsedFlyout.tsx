import { createPortal } from "react-dom";
import { useLayoutEffect, useState, type RefObject } from "react";
import { cn } from "../../../utils/cn";

function useFlyoutPosition(visible: boolean, anchorRef: RefObject<HTMLElement | null>) {
  const [pos, setPos] = useState<{ top: number; left: number } | null>(null);

  useLayoutEffect(() => {
    if (!visible || !anchorRef.current) {
      setPos(null);
      return;
    }

    const update = () => {
      const el = anchorRef.current;
      if (!el) return;
      const r = el.getBoundingClientRect();
      setPos({ top: r.top + r.height / 2, left: r.right + 10 });
    };

    update();
    window.addEventListener("scroll", update, true);
    window.addEventListener("resize", update);
    return () => {
      window.removeEventListener("scroll", update, true);
      window.removeEventListener("resize", update);
    };
  }, [visible, anchorRef]);

  return pos;
}

type FlyoutProps = {
  visible: boolean;
  anchorRef: RefObject<HTMLElement | null>;
  label: string;
};

export function SidebarCollapsedFlyout({ visible, anchorRef, label }: FlyoutProps) {
  const pos = useFlyoutPosition(visible, anchorRef);
  if (!visible || !pos || typeof document === "undefined") return null;

  return createPortal(
    <span
      className={cn(
        "pointer-events-none fixed z-[300] -translate-y-1/2 whitespace-nowrap",
        "rounded-lg border border-white/10 bg-pitflix-surface px-3 py-1.5 text-[13px] font-medium text-white shadow-xl shadow-black/40",
      )}
      style={{ top: pos.top, left: pos.left }}
      role="tooltip"
    >
      {label}
    </span>,
    document.body,
  );
}
