import { convertFileSrc } from "@tauri-apps/api/core";
import { ChevronLeft, ChevronRight, X } from "lucide-react";
import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { preloadImageSrc } from "../../utils/deviceImageCache";
import type { DeviceFsEntry } from "./deviceUtils";

const MIN_ZOOM = 1;
const MAX_ZOOM = 5;
const ZOOM_STEP = 0.0015; // per wheel-delta unit

type Props = {
  entry: DeviceFsEntry;
  /** Images and videos in current folder view order. */
  items: DeviceFsEntry[];
  onClose: () => void;
  onChange: (entry: DeviceFsEntry) => void;
  onOpenVideo: (entry: DeviceFsEntry) => void;
};

function isVideoEntry(entry: DeviceFsEntry): boolean {
  return entry.media_kind === "video";
}

export function DeviceImageViewer({ entry, items, onClose, onChange, onOpenVideo }: Props) {
  const src = convertFileSrc(entry.path);
  const index = useMemo(
    () => items.findIndex((item) => item.path === entry.path),
    [items, entry.path],
  );
  const hasPrev = index > 0;
  const hasNext = index >= 0 && index < items.length - 1;

  const [zoom, setZoom] = useState(1);
  const [pan, setPan] = useState({ x: 0, y: 0 });
  const zoomed = zoom > 1;

  const resetZoom = useCallback(() => {
    setZoom(1);
    setPan({ x: 0, y: 0 });
  }, []);

  // Reset zoom/pan whenever the viewed image changes.
  useEffect(() => {
    resetZoom();
  }, [entry.path, resetZoom]);

  const clampZoom = (z: number) => Math.min(MAX_ZOOM, Math.max(MIN_ZOOM, z));

  const onWheel = useCallback((e: React.WheelEvent) => {
    e.preventDefault();
    setZoom((prev) => {
      const next = clampZoom(prev - e.deltaY * ZOOM_STEP);
      if (next === MIN_ZOOM) setPan({ x: 0, y: 0 });
      return next;
    });
  }, []);

  const onImageDoubleClick = useCallback((e: React.MouseEvent) => {
    e.stopPropagation();
    setZoom((prev) => (prev > MIN_ZOOM ? MIN_ZOOM : 2.5));
    setPan({ x: 0, y: 0 });
  }, []);

  // Drag-to-pan, only while zoomed in. Tracked on `window` (not just the <img>) because a panned,
  // zoomed image can extend past the viewport, so the pointer regularly leaves the element mid-drag
  // -- element-scoped mousemove/mouseup would stop firing right there and leave the drag "stuck".
  //
  // The whole viewer opts out of the app's "drag empty space to move the window" behavior via
  // data-no-window-drag below (see useWindowDragFromEmptySpace) -- without that, this pan handler
  // would still lose the gesture to a native window-move, since that hook runs on the document's
  // capture phase and fires before any handler here ever sees the event.
  const dragRef = useRef<{ startX: number; startY: number; panX: number; panY: number } | null>(null);
  const [dragging, setDragging] = useState(false);

  const onDragStart = useCallback((e: React.MouseEvent) => {
    if (!zoomed) return;
    e.preventDefault();
    e.stopPropagation();
    dragRef.current = { startX: e.clientX, startY: e.clientY, panX: pan.x, panY: pan.y };
    setDragging(true);
  }, [zoomed, pan]);

  useEffect(() => {
    if (!dragging) return;

    const onMove = (e: MouseEvent) => {
      if (!dragRef.current) return;
      e.preventDefault();
      const { startX, startY, panX, panY } = dragRef.current;
      setPan({ x: panX + (e.clientX - startX), y: panY + (e.clientY - startY) });
    };
    const onUp = () => {
      dragRef.current = null;
      setDragging(false);
    };

    window.addEventListener("mousemove", onMove);
    window.addEventListener("mouseup", onUp);
    return () => {
      window.removeEventListener("mousemove", onMove);
      window.removeEventListener("mouseup", onUp);
    };
  }, [dragging]);

  const navigateTo = useCallback((target: DeviceFsEntry) => {
    if (isVideoEntry(target)) {
      onClose();
      onOpenVideo(target);
      return;
    }
    onChange(target);
  }, [onChange, onClose, onOpenVideo]);

  const goPrev = useCallback(() => {
    if (!hasPrev) return;
    navigateTo(items[index - 1]);
  }, [hasPrev, items, index, navigateTo]);

  const goNext = useCallback(() => {
    if (!hasNext) return;
    navigateTo(items[index + 1]);
  }, [hasNext, items, index, navigateTo]);

  // Preload adjacent images and warm video paths while browsing.
  useEffect(() => {
    for (const offset of [-1, 1]) {
      const neighbor = items[index + offset];
      if (!neighbor) continue;
      if (neighbor.media_kind === "image") preloadImageSrc(convertFileSrc(neighbor.path));
    }
  }, [index, items]);

  useEffect(() => {
    const onKeyDown = (e: KeyboardEvent) => {
      if (e.key === "Escape") {
        e.preventDefault();
        onClose();
        return;
      }
      if (e.key === "ArrowLeft") {
        e.preventDefault();
        goPrev();
        return;
      }
      if (e.key === "ArrowRight") {
        e.preventDefault();
        goNext();
      }
    };
    window.addEventListener("keydown", onKeyDown);
    return () => window.removeEventListener("keydown", onKeyDown);
  }, [goNext, goPrev, onClose]);

  return (
    <div
      className="fixed inset-0 z-[85] flex flex-col bg-black/90 backdrop-blur-sm no-window-drag"
      data-no-window-drag
      onClick={onClose}
    >
      {/* Top bar: just the filename/counter now — the close button moved down a bit (see below). */}
      <div
        className="flex shrink-0 items-center gap-4 px-5 py-4"
        onClick={(e) => e.stopPropagation()}
      >
        <div className="min-w-0">
          <div className="truncate text-sm font-semibold text-white">{entry.name}</div>
          {items.length > 1 ? (
            <div className="mt-0.5 text-xs text-pitflix-muted">
              {index + 1} of {items.length}
            </div>
          ) : null}
        </div>
      </div>

      <button
        type="button"
        aria-label="Close"
        className="absolute right-5 top-16 z-20 flex h-9 w-9 shrink-0 items-center justify-center rounded-full bg-white/10 text-white transition hover:bg-white/20"
        onClick={(e) => { e.stopPropagation(); onClose(); }}
      >
        <X className="h-4 w-4" />
      </button>

      {/* Image area */}
      <div
        className="relative flex min-h-0 flex-1 items-center justify-center overflow-hidden px-4 pb-6"
        onWheel={onWheel}
      >
        {hasPrev ? (
          <button
            type="button"
            aria-label="Previous"
            className="absolute left-4 z-10 flex h-11 w-11 items-center justify-center rounded-full bg-black/50 text-white transition hover:bg-black/70"
            onClick={(e) => { e.stopPropagation(); goPrev(); }}
          >
            <ChevronLeft className="h-6 w-6" />
          </button>
        ) : null}

        <img
          src={src}
          alt={entry.name}
          className="max-h-full max-w-full rounded-xl object-contain shadow-2xl select-none"
          style={{
            transform: `translate(${pan.x}px, ${pan.y}px) scale(${zoom})`,
            cursor: zoomed ? (dragging ? "grabbing" : "grab") : "zoom-in",
            transition: dragging ? "none" : "transform 0.15s ease-out",
          }}
          draggable={false}
          onClick={(e) => e.stopPropagation()}
          onDoubleClick={onImageDoubleClick}
          onMouseDown={onDragStart}
        />

        {hasNext ? (
          <button
            type="button"
            aria-label="Next"
            className="absolute right-4 z-10 flex h-11 w-11 items-center justify-center rounded-full bg-black/50 text-white transition hover:bg-black/70"
            onClick={(e) => { e.stopPropagation(); goNext(); }}
          >
            <ChevronRight className="h-6 w-6" />
          </button>
        ) : null}

        {zoomed ? (
          <button
            type="button"
            onClick={(e) => { e.stopPropagation(); resetZoom(); }}
            className="absolute bottom-4 left-1/2 z-10 -translate-x-1/2 rounded-full bg-black/50 px-3 py-1.5 text-xs font-medium text-white transition hover:bg-black/70"
          >
            Reset zoom ({Math.round(zoom * 100)}%)
          </button>
        ) : null}
      </div>
    </div>
  );
}
