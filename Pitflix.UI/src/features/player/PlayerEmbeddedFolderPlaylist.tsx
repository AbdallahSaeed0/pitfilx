import { useEffect, useRef, useState } from "react";
import { useVirtualizer } from "@tanstack/react-virtual";
import { invoke } from "@tauri-apps/api/core";
import { Pin } from "lucide-react";
import { cn } from "../../utils/cn";
import { pitflixConfirm } from "../../utils/pitflixDialog";
import { normalizeMediaPathKey } from "./playerFormat";
import { PLAYER_PLAYLIST_PIN_KEY } from "./playerConstants";
import { PlaylistTile } from "./PlaylistTile";
import { PlaylistTileContextMenu } from "./PlaylistTileContextMenu";
import type { DeviceFsEntry } from "./playerTypes";
import type { PlayerEmbeddedPlaylistProps } from "./playerViewProps";

/** PlaylistTile's rendered height (58px thumbnail + 2*py-[9px] padding, plus
 * room for the size line under the title) — baked in here since virtualized
 * rows are absolutely positioned and can't rely on sibling margin/space-y utilities. */
const PLAYLIST_ROW_HEIGHT = 92;

type Props = PlayerEmbeddedPlaylistProps & {
  activeFilePath: string;
  isFullscreen: boolean;
  fsControlsVisible: boolean;
};

/** Folder playlist panel — PotPlayer-style docked column beside the video (not over it). */
export function PlayerEmbeddedFolderPlaylist({
  currentFolderForPlaylist,
  folderPlaylistOpen,
  folderPlaylistPinned,
  folderPlaylistBusy,
  folderPlaylistEntries,
  setFolderPlaylistEntries,
  setFolderPlaylistOpen,
  setFolderPlaylistPinned,
  navigateToSiblingFile,
  activeFilePath,
  isFullscreen,
  fsControlsVisible,
}: Props) {
  const open = Boolean(currentFolderForPlaylist) && (folderPlaylistOpen || folderPlaylistPinned);
  const scrollRef = useRef<HTMLDivElement | null>(null);
  const [contextMenu, setContextMenu] = useState<{ entry: DeviceFsEntry; x: number; y: number } | null>(null);

  const deleteEntry = async (entry: DeviceFsEntry) => {
    const confirmed = await pitflixConfirm(`Move "${entry.name}" to the Recycle Bin?`);
    if (!confirmed) return;
    try {
      await invoke("device_delete_entries", { paths: [entry.path] });
      setFolderPlaylistEntries((prev) => prev.filter((e) => e.path !== entry.path));
    } catch (err) {
      window.alert(`Couldn't delete "${entry.name}": ${err instanceof Error ? err.message : String(err)}`);
    }
  };
  const activeIndex = folderPlaylistEntries.findIndex(
    (e) => normalizeMediaPathKey(e.path) === normalizeMediaPathKey(activeFilePath),
  );
  const virtualizer = useVirtualizer({
    count: folderPlaylistEntries.length,
    getScrollElement: () => scrollRef.current,
    estimateSize: () => PLAYLIST_ROW_HEIGHT,
    overscan: 6,
  });

  useEffect(() => {
    if (!open || activeIndex < 0 || folderPlaylistBusy) return;
    virtualizer.scrollToIndex(activeIndex, { align: "center" });
  }, [open, activeIndex, folderPlaylistBusy, folderPlaylistEntries.length]); // eslint-disable-line react-hooks/exhaustive-deps

  if (!currentFolderForPlaylist || !open) return null;

  return (
    <aside
      className={cn(
        "relative flex h-full min-h-0 w-[340px] shrink-0 flex-col border-l border-white/[0.07]",
        !isFullscreen || fsControlsVisible ? "opacity-100" : "pointer-events-none opacity-0",
      )}
      style={{ background: "rgba(8,6,20,0.97)" }}
      aria-label="Folder playlist"
    >
      <div className="flex shrink-0 items-start justify-between gap-2 border-b border-white/[0.07] px-5 pb-3.5 pt-5">
        <div className="min-w-0">
          <p className="truncate text-[15px] font-bold text-white">Playlist</p>
          <p className="mt-0.5 truncate text-[11.5px] text-white/[0.36]" title={currentFolderForPlaylist}>
            {currentFolderForPlaylist}
          </p>
        </div>
        <div className="flex shrink-0 items-center gap-2">
          <button
            type="button"
            title={folderPlaylistPinned ? "Unpin playlist" : "Pin playlist open"}
            aria-pressed={folderPlaylistPinned}
            className={cn(
              "flex h-8 w-8 items-center justify-center rounded-full",
              folderPlaylistPinned
                ? "bg-[rgba(124,58,237,0.25)] text-[#c4b5fd]"
                : "bg-white/[0.07] text-white/80 hover:bg-white/[0.14] hover:text-white",
            )}
            onClick={() => {
              const next = !folderPlaylistPinned;
              setFolderPlaylistPinned(next);
              try {
                localStorage.setItem(PLAYER_PLAYLIST_PIN_KEY, next ? "true" : "false");
              } catch {
                /* ignore */
              }
            }}
          >
            <Pin className="h-3.5 w-3.5" fill={folderPlaylistPinned ? "currentColor" : "none"} />
          </button>
          <button
            type="button"
            aria-label="Close playlist"
            className="flex h-8 w-8 items-center justify-center rounded-full bg-white/[0.07] text-white/80 hover:bg-white/[0.14] hover:text-white"
            onClick={() => {
              setFolderPlaylistOpen(false);
              if (folderPlaylistPinned) {
                setFolderPlaylistPinned(false);
                try {
                  localStorage.setItem(PLAYER_PLAYLIST_PIN_KEY, "false");
                } catch {
                  /* ignore */
                }
              }
            }}
          >
            ✕
          </button>
        </div>
      </div>
      <div ref={scrollRef} className="min-h-0 flex-1 overflow-y-auto py-2.5">
        {folderPlaylistBusy ? (
          <p className="px-2 py-3 text-xs text-pitflix-muted">Loading…</p>
        ) : folderPlaylistEntries.length === 0 ? (
          <p className="px-2 py-3 text-xs text-pitflix-muted">No playable files found in this folder.</p>
        ) : (
          // Virtualized: only the rows actually in view (+ overscan) are
          // mounted.  A non-virtualized list here would mount EVERY row's
          // PlaylistTile at once — and each tile fires its own native
          // thumbnail-decode IPC call on mount — so a 1000-entry folder used
          // to fire 1000 simultaneous thumbnail extractions the instant the
          // playlist opened, freezing the app ("not responding").
          <div style={{ height: virtualizer.getTotalSize(), position: "relative" }}>
            {virtualizer.getVirtualItems().map((virtualRow) => {
              const e = folderPlaylistEntries[virtualRow.index];
              const active = e.path === activeFilePath;
              return (
                <div
                  key={e.path}
                  style={{
                    position: "absolute",
                    top: 0,
                    left: 0,
                    width: "100%",
                    height: PLAYLIST_ROW_HEIGHT,
                    transform: `translateY(${virtualRow.start}px)`,
                  }}
                >
                  <PlaylistTile
                    entry={e}
                    active={active}
                    onSelect={() => void navigateToSiblingFile(e)}
                    onContextMenu={(ev) => {
                      ev.preventDefault();
                      console.info(`[pitflix-player] [ctxmenu:playlist-row] opening row menu for "${e.name}"`);
                      setContextMenu({ entry: e, x: ev.clientX, y: ev.clientY });
                    }}
                  />
                </div>
              );
            })}
          </div>
        )}
      </div>
      {contextMenu ? (
        <PlaylistTileContextMenu
          entry={contextMenu.entry}
          x={contextMenu.x}
          y={contextMenu.y}
          onPlay={() => void navigateToSiblingFile(contextMenu.entry)}
          onDelete={() => void deleteEntry(contextMenu.entry)}
          onClose={() => setContextMenu(null)}
        />
      ) : null}
    </aside>
  );
}
