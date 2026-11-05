// Results for the sidebar's "Search all locations" box — a recursive name search across every
// saved location of the current mode (Normal → saved locations minus private folders; Private →
// private folders), instead of the toolbar filter that only narrows the open folder.
import { invoke, isTauri } from "@tauri-apps/api/core";
import { openPath, revealItemInDir } from "@tauri-apps/plugin-opener";
import { useQuery, useQueryClient } from "@tanstack/react-query";
import { FolderOpen, Search } from "lucide-react";
import { useEffect, useMemo, useState } from "react";
import { openPlayerWindow } from "../../api/player";
import { usePlayback } from "../../hooks/usePlayback";
import { pitflixConfirm } from "../../utils/pitflixDialog";
import { DeviceDurationBadge } from "./DeviceDurationBadge";
import { requestVideoDurations } from "./deviceDurations";
import { DeviceImageViewer } from "./DeviceImageViewer";
import { DeviceVideoHoverPreview, LazyFolderThumb } from "./DeviceThumbs";
import {
  fileDisplayTitle,
  isPathInside,
  isPlayableMedia,
  parentDirectory,
  type DeviceFsEntry,
} from "./deviceUtils";

const RESULT_LIMIT = 500;

/** "D:\Videos\Trips\2023" shown relative to whichever saved location contains it. */
function locationLabel(path: string, roots: string[]): string {
  const parent = parentDirectory(path);
  const root = roots
    .filter((r) => isPathInside(parent, r))
    .sort((a, b) => b.length - a.length)[0];
  if (!root) return parent;
  const rootName = root.replace(/[/\\]+$/, "").split(/[/\\]/).pop() ?? root;
  const rest = parent.slice(root.replace(/[/\\]+$/, "").length).replace(/^[/\\]+/, "");
  return rest ? `${rootName} › ${rest.split(/[/\\]/).join(" › ")}` : rootName;
}

export function DeviceGlobalSearchPanel({
  query,
  roots,
  exclude,
  privateMode,
  onOpenFolder,
}: {
  query: string;
  roots: string[];
  exclude: string[];
  privateMode: boolean;
  /** Opens a folder inside My Device (also used for "Show in folder" on a file). */
  onOpenFolder: (path: string) => void;
}) {
  const { play } = usePlayback();
  const [viewingImage, setViewingImage] = useState<DeviceFsEntry | null>(null);
  const [contextMenu, setContextMenu] = useState<{ entry: DeviceFsEntry; x: number; y: number } | null>(null);

  const qc = useQueryClient();
  const { data: results = [], isFetching, error, refetch } = useQuery<DeviceFsEntry[]>({
    queryKey: ["device-global-search", privateMode, roots, exclude, query],
    queryFn: () =>
      invoke<DeviceFsEntry[]>("device_search_entries", { roots, query, limit: RESULT_LIMIT, exclude }),
    enabled: isTauri() && roots.length > 0 && query.trim().length >= 2,
    staleTime: 15_000,
  });

  const folders = useMemo(() => results.filter((e) => e.is_directory), [results]);
  const files = useMemo(() => results.filter((e) => !e.is_directory), [results]);
  const imageItems = useMemo(() => files.filter((e) => e.media_kind === "image"), [files]);

  useEffect(() => {
    const videos = files.filter((e) => e.media_kind === "video");
    if (videos.length) {
      requestVideoDurations(videos.map((e) => ({ path: e.path, size: e.size_bytes })), { persist: !privateMode });
    }
  }, [files, privateMode]);

  const playVideo = (path: string) => {
    if (!isTauri()) return;
    void openPlayerWindow().catch(() => {});
    void play(path, fileDisplayTitle(path.split(/[/\\]/).pop() ?? path), null, "Movie", 0, {
      suppressContinueWatching: true,
      // No ?path — coming back should land on these same results (search is kept in sessionStorage).
      returnTo: { pathname: "/my-device" },
    });
  };

  const openFile = (e: DeviceFsEntry) => {
    if (e.media_kind === "video") playVideo(e.path);
    else if (e.media_kind === "image") setViewingImage(e);
    else void openPath(e.path).catch(() => {});
  };

  const deleteImage = async (e: DeviceFsEntry) => {
    const ok = await pitflixConfirm(`Move "${e.name}" to the Recycle Bin?`);
    if (!ok) return;
    try {
      await invoke("device_delete_entries", { paths: [e.path] });
      setViewingImage(null);
      void qc.invalidateQueries({ queryKey: ["device-dir"] });
      void refetch();
    } catch {
      // file in use / already gone — leave the viewer open so nothing looks deleted when it isn't
    }
  };

  const reveal = (path: string) => void revealItemInDir(path).catch(() => void openPath(parentDirectory(path)).catch(() => {}));

  const hitLimit = results.length >= RESULT_LIMIT;

  return (
    <div style={{ padding: "16px 24px 32px" }}>
      <div style={{ display: "flex", alignItems: "baseline", gap: 10, marginBottom: 18, paddingRight: "7rem" }}>
        <span style={{ fontSize: 15, fontWeight: 700, color: "#e0e0f0" }}>Search results</span>
        <span style={{ fontSize: 12, color: "rgba(180,180,220,0.5)" }}>
          {isFetching
            ? `Searching all ${privateMode ? "private folders" : "locations"}…`
            : `${folders.length} folder${folders.length === 1 ? "" : "s"} · ${files.length} file${files.length === 1 ? "" : "s"}${hitLimit ? ` (first ${RESULT_LIMIT} shown — refine your search)` : ""}`}
        </span>
      </div>

      {error ? (
        <p style={{ fontSize: 12.5, color: "#f87171" }}>{error instanceof Error ? error.message : String(error)}</p>
      ) : null}

      {!isFetching && results.length === 0 && !error ? (
        <div style={{ display: "flex", flexDirection: "column", alignItems: "center", padding: "80px 20px", color: "rgba(180,180,220,0.3)", textAlign: "center" }}>
          <Search style={{ width: 36, height: 36, marginBottom: 12, opacity: 0.5 }} />
          <div style={{ fontSize: 13 }}>
            {roots.length === 0 ? "Add a location first — search looks inside your saved locations." : `Nothing named "${query}" in your ${privateMode ? "private folders" : "locations"}.`}
          </div>
        </div>
      ) : null}

      {folders.length > 0 ? (
        <div style={{ marginBottom: 22 }}>
          <div style={{ fontSize: 9.5, letterSpacing: 1.5, textTransform: "uppercase", color: "rgba(200,200,235,0.5)", fontWeight: 700, marginBottom: 8 }}>Folders</div>
          <div style={{ display: "grid", gridTemplateColumns: "repeat(auto-fill, minmax(240px, 1fr))", gap: 8 }}>
            {folders.map((f) => (
              <button
                key={f.path}
                type="button"
                onClick={() => onOpenFolder(f.path)}
                onContextMenu={(ev) => { ev.preventDefault(); setContextMenu({ entry: f, x: ev.clientX, y: ev.clientY }); }}
                title={f.path}
                style={{ display: "flex", alignItems: "center", gap: 10, textAlign: "left", background: "rgba(255,255,255,0.03)", border: "1px solid rgba(255,255,255,0.07)", borderRadius: 9, padding: "9px 11px", cursor: "pointer", minWidth: 0 }}
                onMouseEnter={(ev) => { ev.currentTarget.style.background = "rgba(124,58,237,0.1)"; }}
                onMouseLeave={(ev) => { ev.currentTarget.style.background = "rgba(255,255,255,0.03)"; }}
              >
                <FolderOpen style={{ width: 16, height: 16, color: "#a78bfa", flexShrink: 0 }} />
                <span style={{ minWidth: 0, flex: 1 }}>
                  <span style={{ display: "block", fontSize: 12.5, fontWeight: 600, color: "#e0e0f0", overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap" }}>{f.name}</span>
                  <span style={{ display: "block", fontSize: 10.5, color: "rgba(180,180,220,0.45)", overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap" }}>{locationLabel(f.path, roots)}</span>
                </span>
              </button>
            ))}
          </div>
        </div>
      ) : null}

      {files.length > 0 ? (
        <div>
          <div style={{ fontSize: 9.5, letterSpacing: 1.5, textTransform: "uppercase", color: "rgba(200,200,235,0.5)", fontWeight: 700, marginBottom: 8 }}>Files</div>
          <div style={{ display: "grid", gridTemplateColumns: "repeat(auto-fill, minmax(170px, 1fr))", gap: 14 }}>
            {files.map((e) => (
              <div key={e.path} style={{ minWidth: 0 }}>
                <div
                  onClick={() => openFile(e)}
                  onContextMenu={(ev) => { ev.preventDefault(); setContextMenu({ entry: e, x: ev.clientX, y: ev.clientY }); }}
                  title={e.path}
                  style={{ position: "relative", width: "100%", paddingTop: "56.25%", borderRadius: 10, background: "#0c0c0c", cursor: "pointer" }}
                >
                  <div style={{ position: "absolute", inset: 0, borderRadius: 10, overflow: "hidden", border: "1px solid rgba(255,255,255,0.07)", display: "flex", alignItems: "center", justifyContent: "center" }}>
                    {e.media_kind === "video" ? (
                      <>
                        <DeviceVideoHoverPreview path={e.path}>
                          <LazyFolderThumb mode="video" path={e.path} />
                        </DeviceVideoHoverPreview>
                        <DeviceDurationBadge path={e.path} />
                      </>
                    ) : e.media_kind === "image" ? (
                      <LazyFolderThumb mode="image" path={e.path} />
                    ) : (
                      <span style={{ fontSize: 11, fontWeight: 700, color: "rgba(180,180,220,0.35)", textTransform: "uppercase" }}>
                        {e.name.split(".").pop()}
                      </span>
                    )}
                  </div>
                </div>
                <div style={{ marginTop: 6, fontSize: 12, fontWeight: 600, color: "#e0e0f0", overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap" }}>
                  {e.media_kind === "video" ? fileDisplayTitle(e.name) : e.name}
                </div>
                <button
                  type="button"
                  onClick={() => onOpenFolder(parentDirectory(e.path))}
                  title="Open containing folder"
                  style={{ display: "block", maxWidth: "100%", padding: 0, background: "transparent", border: "none", fontSize: 10.5, color: "rgba(180,180,220,0.45)", overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap", cursor: "pointer", textAlign: "left" }}
                >
                  {locationLabel(e.path, roots)}
                </button>
              </div>
            ))}
          </div>
        </div>
      ) : null}

      {contextMenu ? (
        <>
          <div style={{ position: "fixed", inset: 0, zIndex: 59 }} onClick={() => setContextMenu(null)} onContextMenu={(ev) => { ev.preventDefault(); setContextMenu(null); }} />
          <div style={{ position: "fixed", left: contextMenu.x, top: contextMenu.y, zIndex: 60, background: "#1C1C1C", border: "1px solid rgba(255,255,255,0.1)", borderRadius: 10, padding: 6, minWidth: 200, boxShadow: "0 12px 32px rgba(0,0,0,0.5)" }}>
            {[
              contextMenu.entry.is_directory
                ? { label: "Open folder", run: () => onOpenFolder(contextMenu.entry.path) }
                : { label: "Open", run: () => openFile(contextMenu.entry) },
              ...(!contextMenu.entry.is_directory
                ? [{ label: "Show in folder", run: () => onOpenFolder(parentDirectory(contextMenu.entry.path)) }]
                : []),
              { label: "Show in Explorer", run: () => reveal(contextMenu.entry.path) },
            ].map((item) => (
              <button
                key={item.label}
                type="button"
                onClick={() => { setContextMenu(null); item.run(); }}
                style={{ display: "block", width: "100%", padding: "8px 10px", borderRadius: 7, border: "none", background: "transparent", color: "#e0e0f0", fontSize: 12.5, fontWeight: 600, cursor: "pointer", textAlign: "left" }}
                onMouseEnter={(ev) => { ev.currentTarget.style.background = "rgba(255,255,255,0.06)"; }}
                onMouseLeave={(ev) => { ev.currentTarget.style.background = "transparent"; }}
              >
                {item.label}
              </button>
            ))}
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
          onDelete={(e) => void deleteImage(e)}
          onShowInFolder={(e) => { setViewingImage(null); onOpenFolder(parentDirectory(e.path)); }}
          onShowDetails={() => {}}
        />
      ) : null}
    </div>
  );
}
