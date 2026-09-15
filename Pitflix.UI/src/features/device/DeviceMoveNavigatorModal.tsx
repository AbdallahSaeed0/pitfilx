import { invoke } from "@tauri-apps/api/core";
import { ArrowLeft, FolderOpen, Search, X } from "lucide-react";
import { useEffect, useState } from "react";
import { canMoveEntriesTo, parentDirectory, type DeviceFsEntry } from "./deviceUtils";

/**
 * Full nested folder browser for picking a move destination — unlike the flat "immediate
 * subfolders of the current directory" picker, this lets you navigate arbitrarily deep and back
 * up again, bounded at the saved location the item being moved lives under.
 */
export function DeviceMoveNavigatorModal({
  paths,
  startPath,
  rootBoundary,
  onClose,
  onConfirm,
}: {
  /** Item(s) being moved. */
  paths: string[];
  /** Folder to start browsing from (usually the folder currently being viewed). */
  startPath: string;
  /** Won't navigate above this directory — the saved location `startPath` belongs to. */
  rootBoundary: string | null;
  onClose: () => void;
  onConfirm: (destinationDir: string) => void;
}) {
  const [path, setPath] = useState(startPath);
  const [entries, setEntries] = useState<DeviceFsEntry[]>([]);
  const [loading, setLoading] = useState(false);
  const [filter, setFilter] = useState("");

  useEffect(() => {
    let cancelled = false;
    setLoading(true);
    setFilter("");
    invoke<DeviceFsEntry[]>("device_read_dir", { path })
      .then((rows) => { if (!cancelled) setEntries(rows); })
      .catch(() => { if (!cancelled) setEntries([]); })
      .finally(() => { if (!cancelled) setLoading(false); });
    return () => { cancelled = true; };
  }, [path]);

  const folders = entries.filter((e) => e.is_directory);
  const visibleFolders = folders.filter((f) => f.name.toLowerCase().includes(filter.trim().toLowerCase()));
  const normalizedPath = path.replace(/[/\\]+$/, "").toLowerCase();
  const normalizedBoundary = rootBoundary?.replace(/[/\\]+$/, "").toLowerCase() ?? null;
  const canGoBack = normalizedBoundary === null || normalizedPath !== normalizedBoundary;
  const canUseHere = canMoveEntriesTo(paths, path);

  const goBack = () => {
    const parent = parentDirectory(path);
    if (!parent || parent === path) return;
    setPath(parent);
  };

  return (
    <div style={{ position: "fixed", inset: 0, zIndex: 200, display: "flex", alignItems: "center", justifyContent: "center", background: "rgba(0,0,0,0.6)" }}>
      <div style={{ width: 680, height: 640, display: "flex", flexDirection: "column", background: "#1C1C1C", border: "1px solid rgba(255,255,255,0.1)", borderRadius: 12, boxShadow: "0 20px 60px rgba(0,0,0,0.6)" }}>
        <div style={{ display: "flex", alignItems: "center", gap: 10, padding: "14px 16px", borderBottom: "1px solid rgba(255,255,255,0.07)", flexShrink: 0 }}>
          {canGoBack ? (
            <button
              type="button"
              onClick={goBack}
              style={{ width: 26, height: 26, display: "flex", alignItems: "center", justifyContent: "center", borderRadius: 6, background: "rgba(255,255,255,0.04)", border: "1px solid rgba(255,255,255,0.07)", color: "rgba(180,180,220,0.5)", cursor: "pointer", flexShrink: 0 }}
            >
              <ArrowLeft style={{ width: 12, height: 12 }} />
            </button>
          ) : null}
          <span style={{ flex: 1, minWidth: 0, fontSize: 12.5, fontWeight: 600, color: "rgba(224,224,240,0.85)", overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap" }}>
            {path.replace(/[/\\]+$/, "").split(/[/\\]/).pop() ?? path}
          </span>
          <button type="button" onClick={onClose} style={{ background: "transparent", border: "none", color: "rgba(200,200,235,0.5)", cursor: "pointer", flexShrink: 0 }}>
            <X style={{ width: 15, height: 15 }} />
          </button>
        </div>

        <div style={{ padding: "12px 16px 0", flexShrink: 0 }}>
          <div style={{ display: "flex", alignItems: "center", gap: 8, background: "rgba(255,255,255,0.04)", border: "1px solid rgba(255,255,255,0.08)", borderRadius: 8, padding: "8px 12px" }}>
            <Search style={{ width: 13, height: 13, color: "rgba(180,180,220,0.4)" }} />
            <input
              value={filter}
              onChange={(e) => setFilter(e.target.value)}
              placeholder="Search folders…"
              style={{ flex: 1, background: "transparent", border: "none", outline: "none", color: "#e0e0f0", fontSize: 13, fontFamily: "inherit" }}
            />
          </div>
        </div>

        <div style={{ flex: 1, overflowY: "auto", padding: 10 }}>
          {loading ? (
            <p style={{ fontSize: 12, color: "rgba(180,180,220,0.4)", padding: "8px 6px" }}>Loading…</p>
          ) : folders.length === 0 ? (
            <p style={{ fontSize: 12, color: "rgba(180,180,220,0.35)", padding: "8px 6px" }}>No folders here.</p>
          ) : visibleFolders.length === 0 ? (
            <p style={{ fontSize: 12, color: "rgba(180,180,220,0.35)", padding: "8px 6px" }}>No folders match "{filter}".</p>
          ) : (
            visibleFolders.map((f) => (
              <div
                key={f.path}
                onClick={() => setPath(f.path)}
                style={{ display: "flex", alignItems: "center", gap: 9, padding: "9px 10px", borderRadius: 8, cursor: "pointer" }}
                onMouseEnter={(e) => { (e.currentTarget as HTMLDivElement).style.background = "rgba(255,255,255,0.05)"; }}
                onMouseLeave={(e) => { (e.currentTarget as HTMLDivElement).style.background = "transparent"; }}
              >
                <FolderOpen style={{ width: 15, height: 15, color: "rgba(124,58,237,0.7)", flexShrink: 0 }} />
                <span style={{ fontSize: 12.5, color: "rgba(224,224,240,0.85)", overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap" }}>{f.name}</span>
              </div>
            ))
          )}
        </div>

        <div style={{ padding: "12px 16px", borderTop: "1px solid rgba(255,255,255,0.07)", flexShrink: 0 }}>
          <button
            type="button"
            disabled={!canUseHere}
            onClick={() => onConfirm(path)}
            style={{ width: "100%", padding: "9px 0", borderRadius: 8, border: "none", background: "linear-gradient(135deg,#7c3aed,#5b21b6)", color: "white", fontSize: 12.5, fontWeight: 700, cursor: canUseHere ? "pointer" : "not-allowed", opacity: canUseHere ? 1 : 0.4 }}
          >
            Move here
          </button>
        </div>
      </div>
    </div>
  );
}
