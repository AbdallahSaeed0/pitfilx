import { BookmarkPlus, Copy, Pencil, Play, Trash2 } from "lucide-react";
import { useEffect, useLayoutEffect, useRef, useState } from "react";
import { formatBytes, type DeviceFsEntry } from "./deviceUtils";

export type DeviceContextMenuAction =
  | "open"
  | "play"
  | "add-to-library"
  | "copy-path"
  | "rename"
  | "delete";

type Props = {
  entry: DeviceFsEntry;
  x: number;
  y: number;
  onAction: (action: DeviceContextMenuAction) => void;
  onClose: () => void;
};

function entrySubtitle(entry: DeviceFsEntry): string {
  if (entry.is_directory) return "Folder";
  if (entry.size_bytes != null) return formatBytes(entry.size_bytes);
  if (entry.media_kind === "video") return "Video";
  if (entry.media_kind === "image") return "Image";
  return "File";
}

export function DeviceEntryContextMenu({ entry, x, y, onAction, onClose }: Props) {
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
    const onKeyDown    = (e: KeyboardEvent) => { if (e.key === "Escape") onClose(); };
    const onScroll     = () => onClose();
    window.addEventListener("mousedown", onPointerDown);
    window.addEventListener("keydown",   onKeyDown);
    window.addEventListener("scroll",    onScroll, true);
    window.addEventListener("resize",    onClose);
    return () => {
      window.removeEventListener("mousedown", onPointerDown);
      window.removeEventListener("keydown",   onKeyDown);
      window.removeEventListener("scroll",    onScroll, true);
      window.removeEventListener("resize",    onClose);
    };
  }, [onClose]);

  const isVideo = !entry.is_directory && entry.media_kind === "video";

  const item = (
    action: DeviceContextMenuAction,
    label: string,
    Icon: typeof Copy,
    opts?: { danger?: boolean; purple?: boolean },
  ) => (
    <div
      key={action}
      role="menuitem"
      style={{
        display: "flex", alignItems: "center", gap: 10,
        padding: "8px 12px", borderRadius: 7, cursor: "pointer",
        transition: "background 0.1s",
        color: opts?.danger ? "#f87171" : "#e0e0f0",
      }}
      onMouseEnter={(e) => {
        (e.currentTarget as HTMLDivElement).style.background = opts?.danger
          ? "rgba(239,68,68,0.12)"
          : opts?.purple
            ? "rgba(124,58,237,0.16)"
            : "rgba(255,255,255,0.06)";
      }}
      onMouseLeave={(e) => { (e.currentTarget as HTMLDivElement).style.background = "transparent"; }}
      onClick={() => { onAction(action); onClose(); }}
    >
      <Icon
        style={{
          width: 13, height: 13, flexShrink: 0, opacity: 0.85,
          color: opts?.danger ? "#f87171" : opts?.purple ? "#9f7aea" : "rgba(180,180,220,0.55)",
        }}
      />
      <span style={{ fontSize: 12.5, fontWeight: 500, fontFamily: "inherit" }}>{label}</span>
    </div>
  );

  const divider = (key: string) => (
    <div key={key} style={{ height: 1, background: "rgba(255,255,255,0.07)", margin: "4px 0" }} />
  );

  return (
    <div
      ref={menuRef}
      role="menu"
      aria-label={`Actions for ${entry.name}`}
      style={{
        position: "fixed",
        left: pos.x,
        top: pos.y,
        zIndex: 80,
        background: "#111",
        border: "1px solid rgba(255,255,255,0.1)",
        borderRadius: 11,
        padding: 5,
        minWidth: 190,
        boxShadow: "0 20px 60px rgba(0,0,0,0.8)",
        animation: "deviceMenuPop 0.14s ease",
        fontFamily: "'DM Sans', system-ui, sans-serif",
      }}
      onContextMenu={(e) => e.preventDefault()}
    >
      {/* File name header */}
      <div style={{ padding: "8px 12px 6px", borderBottom: "1px solid rgba(255,255,255,0.07)", marginBottom: 4 }}>
        <div style={{ fontSize: 11, fontWeight: 600, color: "#e0e0f0", whiteSpace: "nowrap", overflow: "hidden", textOverflow: "ellipsis", maxWidth: 170 }}>
          {entry.name}
        </div>
        <div style={{ fontSize: 9.5, color: "rgba(180,180,220,0.3)", marginTop: 2, textTransform: "uppercase", letterSpacing: "0.8px" }}>
          {entrySubtitle(entry)}
        </div>
      </div>

      {isVideo && item("play", "Play in media player", Play, { purple: true })}
      {divider("d1")}
      {item("add-to-library", "Add to library", BookmarkPlus)}
      {item("copy-path",      "Copy path",       Copy)}
      {item("rename",         "Rename",           Pencil)}
      {divider("d2")}
      {item("delete", "Delete", Trash2, { danger: true })}
    </div>
  );
}
