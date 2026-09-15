import { useEffect, useLayoutEffect, useRef, useState } from "react";
import { createPortal } from "react-dom";
import { RewatchBadge } from "./RewatchBadge";

type Props = {
  open: boolean;
  onClose: () => void;
  /** Trigger element the popover is anchored below — rendered via a portal to
   * <body> so it isn't clipped by an ancestor's `overflow-hidden` (e.g. the
   * detail pages' hero backdrop container). */
  anchorRef: React.RefObject<HTMLElement | null>;
  count: number;
  onChange: (next: number) => void;
};

/** Floating rewatch-count stepper, revealed by holding the trigger button (see useLongPress). */
export function RewatchPopover({ open, onClose, anchorRef, count, onChange }: Props) {
  const panelRef = useRef<HTMLDivElement>(null);
  const [coords, setCoords] = useState<{ top: number; left: number } | null>(null);

  useLayoutEffect(() => {
    if (!open || !anchorRef.current) {
      setCoords(null);
      return;
    }
    const rect = anchorRef.current.getBoundingClientRect();
    setCoords({ top: rect.bottom + 8, left: rect.left });
  }, [open, anchorRef]);

  useEffect(() => {
    if (!open) return;
    const onDocMouseDown = (e: MouseEvent) => {
      const target = e.target as Node;
      if (panelRef.current?.contains(target)) return;
      if (anchorRef.current?.contains(target)) return;
      onClose();
    };
    document.addEventListener("mousedown", onDocMouseDown);
    return () => document.removeEventListener("mousedown", onDocMouseDown);
  }, [open, onClose, anchorRef]);

  if (!open || !coords) return null;

  return createPortal(
    <div
      ref={panelRef}
      style={{ position: "fixed", top: coords.top, left: coords.left }}
      className="z-50 whitespace-nowrap rounded-lg border border-white/10 bg-pitflix-surface p-2.5 shadow-xl"
    >
      <p className="mb-1.5 text-[10px] font-medium uppercase tracking-wide text-pitflix-muted">
        Rewatch count
      </p>
      <RewatchBadge count={count} onChange={onChange} />
    </div>,
    document.body,
  );
}
