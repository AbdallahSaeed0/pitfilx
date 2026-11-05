// Shared grid for "My Favorite" and "History" — two flat, mixed video/image lists of individual
// files (not folders), each scoped separately per Normal/Private mode. Kept as one parameterized
// component rather than two near-duplicates: the only real differences are which store backs the
// list, the empty-state copy, and History's "Clear history" button.
import { invoke, isTauri } from "@tauri-apps/api/core";
import { openPath, revealItemInDir } from "@tauri-apps/plugin-opener";
import { Clock, Heart, Trash2, X } from "lucide-react";
import { useEffect, useMemo, useState } from "react";
import { openPlayerWindow } from "../../api/player";
import { usePlayback } from "../../hooks/usePlayback";
import { DeviceVideoHoverPreview, LazyFolderThumb } from "./DeviceThumbs";
import { DeviceImageViewer } from "./DeviceImageViewer";
import { relinkMovedDeviceFiles } from "./devicePathRelink";
import {
  clearHistory,
  fileDisplayTitle,
  formatDeviceTimestamp,
  isPlayableMedia,
  loadFavorites,
  loadHistory,
  removeFavorite,
  removeHistoryEntry,
  type DeviceFsEntry,
  type DeviceMediaKind,
} from "./deviceUtils";

type SavedItem = { path: string; mediaKind: DeviceMediaKind; when: number };
type Kind = "favorites" | "history";

function fileNameOf(path: string): string {
  return path.split(/[/\\]/).pop() ?? path;
}

function toEntry(item: SavedItem): DeviceFsEntry {
  return { name: fileNameOf(item.path), path: item.path, is_directory: false, media_kind: item.mediaKind };
}

type LocationProps = {
  /** Where to look for files moved outside the app (the current mode's locations). */
  searchRoots: string[];
  /** Never relink into these (Normal mode passes the private folders). */
  excludeRoots: string[];
};

function SavedItemsGrid({ kind, privateMode, searchRoots, excludeRoots }: { kind: Kind; privateMode: boolean } & LocationProps) {
  const { play } = usePlayback();
  const [items, setItems] = useState<SavedItem[]>([]);
  const [missingPaths, setMissingPaths] = useState<Set<string>>(new Set());
  const [relinking, setRelinking] = useState(false);
  const [viewingImage, setViewingImage] = useState<DeviceFsEntry | null>(null);
  const [contextMenu, setContextMenu] = useState<{ path: string; x: number; y: number } | null>(null);

  const refresh = () => {
    setItems(
      kind === "favorites"
        ? loadFavorites(privateMode).map((e) => ({ path: e.path, mediaKind: e.mediaKind, when: e.addedAt }))
        : loadHistory(privateMode).map((e) => ({ path: e.path, mediaKind: e.mediaKind, when: e.openedAt })),
    );
  };

  // eslint-disable-next-line react-hooks/exhaustive-deps
  useEffect(() => { refresh(); }, [kind, privateMode]);
  useEffect(() => {
    const onRemapped = () => refresh();
    window.addEventListener("pitflix-device-saved-paths-remapped", onRemapped);
    return () => window.removeEventListener("pitflix-device-saved-paths-remapped", onRemapped);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [kind, privateMode]);

  // Same batched existence check used throughout My Device (device_paths_exist) — one round trip
  // for the whole list instead of one per item.
  useEffect(() => {
    if (!isTauri() || items.length === 0) { setMissingPaths(new Set()); return; }
    let cancelled = false;
    void invoke<boolean[]>("device_paths_exist", { paths: items.map((i) => i.path) })
      .then((flags) => {
        if (cancelled) return;
        const missing = new Set<string>();
        items.forEach((item, i) => { if (!flags[i]) missing.add(item.path); });
        setMissingPaths(missing);
        if (missing.size === 0) return;
        // Moved outside the app? Look for it by file name; a relink rewrites the saved paths and
        // fires "pitflix-device-saved-paths-remapped", which refreshes this list.
        setRelinking(true);
        void relinkMovedDeviceFiles(Array.from(missing), searchRoots, excludeRoots)
          .catch(() => 0)
          .finally(() => { if (!cancelled) setRelinking(false); });
      })
      .catch(() => {});
    return () => { cancelled = true; };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [items]);

  const removeItem = (path: string) => {
    if (kind === "favorites") removeFavorite(privateMode, path);
    else removeHistoryEntry(privateMode, path);
    refresh();
  };

  const playVideo = (path: string) => {
    if (!isTauri() || missingPaths.has(path)) return;
    void openPlayerWindow().catch(() => {});
    void play(path, fileDisplayTitle(fileNameOf(path)), null, "Movie", 0, {
      suppressContinueWatching: true,
      // `?panel=` lets My Device land back on this exact panel (see MyDevicePage) instead of
      // whichever view happens to win from saved state.
      returnTo: { pathname: "/my-device", search: `?panel=${kind}` },
    });
  };

  const openItem = (item: SavedItem) => {
    if (missingPaths.has(item.path)) return;
    if (item.mediaKind === "video") { playVideo(item.path); return; }
    setViewingImage(toEntry(item));
  };

  const imageItems = useMemo(() => items.filter((i) => i.mediaKind === "image").map(toEntry), [items]);

  return (
    <div style={{ padding: "16px 24px 32px" }}>
      <div style={{ display: "flex", alignItems: "center", marginBottom: 18, paddingRight: "7rem" }}>
        <span style={{ fontSize: 15, fontWeight: 700, color: "#e0e0f0", flex: 1 }}>
          {kind === "favorites" ? "My Favorite" : "History"}
        </span>
        {kind === "history" && items.length > 0 ? (
          <button
            type="button"
            onClick={() => { clearHistory(privateMode); refresh(); }}
            style={{ display: "flex", alignItems: "center", gap: 6, background: "rgba(239,68,68,0.08)", border: "1px solid rgba(239,68,68,0.25)", borderRadius: 8, padding: "7px 12px", fontSize: 12, fontWeight: 600, color: "#f87171", cursor: "pointer" }}
          >
            <Trash2 style={{ width: 12, height: 12 }} /> Clear history
          </button>
        ) : null}
      </div>

      {items.length === 0 ? (
        <div style={{ display: "flex", flexDirection: "column", alignItems: "center", justifyContent: "center", padding: "80px 20px", color: "rgba(180,180,220,0.3)", textAlign: "center" }}>
          {kind === "favorites" ? (
            <Heart style={{ width: 36, height: 36, marginBottom: 12, opacity: 0.5 }} />
          ) : (
            <Clock style={{ width: 36, height: 36, marginBottom: 12, opacity: 0.5 }} />
          )}
          <div style={{ fontSize: 13, maxWidth: 280 }}>
            {kind === "favorites"
              ? 'No favorites yet — right-click a video or image and choose "Add to Favorites".'
              : "Nothing opened yet — videos and images you open show up here."}
          </div>
        </div>
      ) : (
        <div style={{ display: "grid", gridTemplateColumns: "repeat(auto-fill, minmax(160px, 1fr))", gap: 14 }}>
          {items.map((item) => {
            const isMissing = missingPaths.has(item.path);
            return (
              <div key={item.path} style={{ minWidth: 0 }}>
                <div
                  onClick={() => openItem(item)}
                  onContextMenu={(e) => { e.preventDefault(); setContextMenu({ path: item.path, x: e.clientX, y: e.clientY }); }}
                  style={{ position: "relative", width: "100%", paddingTop: "56.25%", borderRadius: 10, background: "#0c0c0c", cursor: isMissing ? "default" : "pointer" }}
                >
                  <div style={{ position: "absolute", inset: 0, borderRadius: 10, overflow: "hidden", border: `1px solid ${isMissing ? "rgba(239,68,68,0.35)" : "rgba(255,255,255,0.07)"}` }}>
                    {isMissing ? (
                      <div style={{ position: "absolute", inset: 0, display: "flex", flexDirection: "column", alignItems: "center", justifyContent: "center", gap: 8, padding: 10 }}>
                        <span style={{ fontSize: 11, color: relinking ? "rgba(200,200,235,0.6)" : "rgba(239,68,68,0.8)", textAlign: "center" }}>
                          {relinking ? "Looking for moved file…" : "File no longer exists"}
                        </span>
                        <button
                          type="button"
                          onClick={(e) => { e.stopPropagation(); removeItem(item.path); }}
                          style={{ background: "rgba(255,255,255,0.06)", border: "1px solid rgba(255,255,255,0.12)", borderRadius: 6, padding: "4px 10px", fontSize: 11, color: "#e0e0f0", cursor: "pointer" }}
                        >
                          Remove
                        </button>
                      </div>
                    ) : item.mediaKind === "video" ? (
                      <DeviceVideoHoverPreview path={item.path}>
                        <LazyFolderThumb mode="video" path={item.path} />
                      </DeviceVideoHoverPreview>
                    ) : (
                      <LazyFolderThumb mode="image" path={item.path} />
                    )}
                  </div>
                </div>
                <div style={{ marginTop: 6, fontSize: 12, fontWeight: 600, color: "#e0e0f0", overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap" }}>
                  {fileDisplayTitle(fileNameOf(item.path))}
                </div>
                <div style={{ fontSize: 10.5, color: "rgba(180,180,220,0.4)" }}>
                  {formatDeviceTimestamp(item.when)}
                </div>
              </div>
            );
          })}
        </div>
      )}

      {contextMenu ? (
        <>
          <div style={{ position: "fixed", inset: 0, zIndex: 59 }} onClick={() => setContextMenu(null)} />
          <div style={{ position: "fixed", left: contextMenu.x, top: contextMenu.y, zIndex: 60, background: "#1C1C1C", border: "1px solid rgba(255,255,255,0.1)", borderRadius: 10, padding: 6, minWidth: 190, boxShadow: "0 12px 32px rgba(0,0,0,0.5)" }}>
            <button
              type="button"
              onClick={() => { removeItem(contextMenu.path); setContextMenu(null); }}
              style={{ display: "flex", alignItems: "center", gap: 8, width: "100%", padding: "8px 10px", borderRadius: 7, border: "none", background: "transparent", color: "#f87171", fontSize: 12.5, fontWeight: 600, cursor: "pointer", textAlign: "left" }}
              onMouseEnter={(e) => { (e.currentTarget as HTMLButtonElement).style.background = "rgba(255,255,255,0.06)"; }}
              onMouseLeave={(e) => { (e.currentTarget as HTMLButtonElement).style.background = "transparent"; }}
            >
              <X style={{ width: 13, height: 13 }} />
              {kind === "favorites" ? "Remove from Favorites" : "Remove from history"}
            </button>
          </div>
        </>
      ) : null}

      {viewingImage ? (
        <DeviceImageViewer
          entry={viewingImage}
          items={imageItems}
          onClose={() => setViewingImage(null)}
          onChange={setViewingImage}
          onOpenVideo={(e) => { setViewingImage(null); if (isPlayableMedia(e)) playVideo(e.path); }}
          onDelete={(e) => { removeItem(e.path); setViewingImage(null); }}
          onShowInFolder={(e) => void revealItemInDir(e.path).catch(() => void openPath(e.path).catch(() => {}))}
          onShowDetails={() => {}}
        />
      ) : null}
    </div>
  );
}

export function DeviceFavoritesPanel(props: { privateMode: boolean } & LocationProps) {
  return <SavedItemsGrid kind="favorites" {...props} />;
}

export function DeviceHistoryPanel(props: { privateMode: boolean } & LocationProps) {
  return <SavedItemsGrid kind="history" {...props} />;
}
