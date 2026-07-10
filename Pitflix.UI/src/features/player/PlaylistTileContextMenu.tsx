import { Copy, Play, Trash2 } from "lucide-react";
import { useEffect, useLayoutEffect, useRef, useState } from "react";
import { formatBytes } from "./playerFormat";
import type { DeviceFsEntry } from "./playerTypes";

type Props = {
  entry: DeviceFsEntry;
  x: number;
  y: number;
  onPlay: () => void;
  onDelete: () => void;
  onClose: () => void;
};

/** Right-click menu for a single row in the embedded player's folder playlist panel. */
export function PlaylistTileContextMenu({ entry, x, y, onPlay, onDelete, onClose }: Props) {
  const menuRef = useRef<HTMLDivElement>(null);
  const [pos, setPos] = useState({ x, y });

  useLayoutEffect(() => {
    const el = menuRef.current;
    if (!el) return;
    const rect = el.getBoundingClientRect();
    let left = x;
    let top = y;
    if (left + rect.width > window.innerWidth - 8) left = Math.max(8, window.innerWidth - rect.width - 8);
    if (top + rect.height > window.innerHeight - 8) top = Math.max(8, window.innerHeight - rect.height - 8);
    setPos({ x: left, y: top });
  }, [x, y]);

  useEffect(() => {
    const onPointerDown = (e: MouseEvent) => { if (menuRef.current?.contains(e.target as Node)) return; onClose(); };
    const onKeyDown = (e: KeyboardEvent) => { if (e.key === "Escape") onClose(); };
    window.addEventListener("mousedown", onPointerDown);
    window.addEventListener("keydown", onKeyDown);
    window.addEventListener("resize", onClose);
    return () => {
      window.removeEventListener("mousedown", onPointerDown);
      window.removeEventListener("keydown", onKeyDown);
      window.removeEventListener("resize", onClose);
    };
  }, [onClose]);

  const run = (fn: () => void) => {
    onClose();
    fn();
  };

  return (
    <div
      ref={menuRef}
      role="menu"
      aria-label={`Actions for ${entry.name}`}
      className="fixed z-[120] min-w-[13.5rem] overflow-hidden rounded-xl border border-white/10 bg-[rgba(14,12,26,0.97)] py-1 shadow-2xl backdrop-blur-xl"
      style={{ left: pos.x, top: pos.y }}
      onContextMenu={(e) => e.preventDefault()}
    >
      <div className="border-b border-white/8 px-3 py-2">
        <p className="truncate text-[12px] font-semibold text-white/90">{entry.name}</p>
        <p className="mt-0.5 text-[10.5px] uppercase tracking-[0.06em] text-pitflix-muted">
          {entry.size_bytes != null ? formatBytes(entry.size_bytes) : "Unknown size"}
        </p>
      </div>
      <button
        type="button"
        role="menuitem"
        onClick={() => run(onPlay)}
        className="flex w-full items-center gap-2.5 px-3 py-2 text-left text-[13px] text-white/90 transition hover:bg-white/10"
      >
        <Play className="h-4 w-4 shrink-0 text-white/65" strokeWidth={2} />
        <span className="min-w-0 flex-1 truncate">Play</span>
      </button>
      <button
        type="button"
        role="menuitem"
        onClick={() => run(() => void navigator.clipboard.writeText(entry.path).catch(() => {}))}
        className="flex w-full items-center gap-2.5 px-3 py-2 text-left text-[13px] text-white/90 transition hover:bg-white/10"
      >
        <Copy className="h-4 w-4 shrink-0 text-white/65" strokeWidth={2} />
        <span className="min-w-0 flex-1 truncate">Copy path</span>
      </button>
      <div className="my-1 h-px bg-white/8" />
      <button
        type="button"
        role="menuitem"
        onClick={() => run(onDelete)}
        className="flex w-full items-center gap-2.5 px-3 py-2 text-left text-[13px] text-[#f87171] transition hover:bg-[rgba(239,68,68,0.12)]"
      >
        <Trash2 className="h-4 w-4 shrink-0" strokeWidth={2} />
        <span className="min-w-0 flex-1 truncate">Delete</span>
      </button>
    </div>
  );
}
