import { useCallback, useEffect, useMemo, useState } from "react";
import { invoke, isTauri } from "@tauri-apps/api/core";
import { emit, listen } from "@tauri-apps/api/event";
import type { UnlistenFn } from "@tauri-apps/api/event";
import { getPosterThumbnail, setPosterThumbnail } from "../utils/videoThumbnailCache";

type FsEntry = {
  name: string;
  path: string;
  isDirectory?: boolean;
  is_directory?: boolean;
  mediaKind?: string | null;
  media_kind?: string | null;
};

const VIDEO_EXTENSIONS = new Set([
  "mp4", "mkv", "avi", "mov", "webm", "m4v", "wmv", "mpg", "mpeg",
]);

function isPlayableSibling(e: FsEntry): boolean {
  const isDir = e.isDirectory ?? e.is_directory ?? false;
  if (isDir) return false;
  const dot = e.name.lastIndexOf(".");
  if (dot < 0) return false;
  const ext = e.name.slice(dot + 1).toLowerCase();
  return VIDEO_EXTENSIONS.has(ext);
}

function fileDisplayTitle(fileName: string): string {
  const dot = fileName.lastIndexOf(".");
  return dot > 0 ? fileName.slice(0, dot) : fileName;
}

/** Lazy thumbnail tile for one playlist row (mirrors PlaylistTile in PlayerPage). */
function PlaylistRow({
  entry,
  active,
  onSelect,
}: {
  entry: FsEntry;
  active: boolean;
  onSelect: () => void;
}) {
  const [thumbUrl, setThumbUrl] = useState<string | null>(() => getPosterThumbnail(entry.path) ?? null);
  useEffect(() => {
    if (!isTauri()) return;
    const cached = getPosterThumbnail(entry.path);
    if (cached) {
      setThumbUrl(cached);
      return;
    }
    let cancelled = false;
    void invoke<number[]>("thumb_poster", { filePath: entry.path, atSeconds: 60.0 })
      .then((bytes) => {
        if (cancelled) return;
        const blob = new Blob([new Uint8Array(bytes)], { type: "image/jpeg" });
        const url = URL.createObjectURL(blob);
        setPosterThumbnail(entry.path, url);
        setThumbUrl(url);
      })
      .catch(() => {});
    return () => {
      cancelled = true;
    };
  }, [entry.path]);
  return (
    <button
      type="button"
      disabled={active}
      onClick={onSelect}
      className={`flex w-full items-center gap-2 rounded-lg border px-2 py-1.5 text-left text-xs transition-colors ${
        active
          ? "border-pitflix-primary/60 bg-pitflix-primary/15 text-white"
          : "border-white/10 bg-white/5 text-white/90 hover:bg-white/10"
      } disabled:cursor-not-allowed disabled:opacity-60`}
      title={entry.path}
    >
      <span className="block h-[44px] w-[80px] shrink-0 overflow-hidden rounded bg-black/50">
        {thumbUrl ? (
          <img src={thumbUrl} alt="" className="h-full w-full object-cover" />
        ) : null}
      </span>
      <span className="min-w-0 flex-1 truncate">{fileDisplayTitle(entry.name)}</span>
      {active ? <span className="shrink-0 text-[10px] text-pitflix-light">Now</span> : null}
    </button>
  );
}

/** Reads folder + current file from URL params at first load; updates via
 *  `playlist:set-context` event emitted by main when context changes. */
export function PlaylistPopoutPage() {
  const initial = useMemo(() => {
    const params = new URLSearchParams(window.location.search);
    return {
      folder: params.get("folder") ?? "",
      currentFile: params.get("current") ?? "",
    };
  }, []);
  const [folder, setFolder] = useState(initial.folder);
  const [currentFile, setCurrentFile] = useState(initial.currentFile);
  const [entries, setEntries] = useState<FsEntry[]>([]);
  const [busy, setBusy] = useState(false);

  // Listen for context updates emitted by main when the user navigates episodes.
  useEffect(() => {
    if (!isTauri()) return;
    let cleanup: UnlistenFn | undefined;
    void listen<{ folder?: string; currentFile?: string }>(
      "playlist:set-context",
      (ev) => {
        if (ev.payload?.folder != null) setFolder(ev.payload.folder);
        if (ev.payload?.currentFile != null) setCurrentFile(ev.payload.currentFile);
      },
    ).then((un) => {
      cleanup = un;
    });
    return () => {
      cleanup?.();
    };
  }, []);

  // Read folder contents whenever the folder changes.
  useEffect(() => {
    if (!isTauri() || !folder) {
      setEntries([]);
      return;
    }
    setBusy(true);
    void invoke<FsEntry[]>("device_read_dir", { path: folder })
      .then((rows) => setEntries((rows ?? []).filter(isPlayableSibling)))
      .catch(() => setEntries([]))
      .finally(() => setBusy(false));
  }, [folder]);

  const selectFile = useCallback(
    (entry: FsEntry) => {
      // Tell main to play this file. PlayerPage listens for this and navigates.
      void emit("playlist:select-file", { path: entry.path, name: entry.name });
    },
    [],
  );

  const closePopout = useCallback(() => {
    if (!isTauri()) return;
    void invoke("playlist_window_close").catch(() => {});
  }, []);

  return (
    <div className="flex h-screen w-screen flex-col bg-black/85 text-white backdrop-blur">
      <div className="flex items-center justify-between gap-2 border-b border-white/10 px-3 py-2">
        <div className="min-w-0">
          <p className="truncate text-[11px] font-semibold text-white">Folder playlist</p>
          <p className="truncate text-[10px] text-pitflix-muted" title={folder}>
            {folder || "(no folder)"}
          </p>
        </div>
        <button
          type="button"
          aria-label="Close playlist"
          className="rounded px-1.5 py-0.5 text-pitflix-muted hover:bg-white/10 hover:text-white"
          onClick={closePopout}
        >
          ✕
        </button>
      </div>
      <div className="min-h-0 flex-1 overflow-auto p-2">
        {busy ? (
          <p className="px-2 py-3 text-xs text-pitflix-muted">Loading…</p>
        ) : entries.length === 0 ? (
          <p className="px-2 py-3 text-xs text-pitflix-muted">
            No playable files found in this folder.
          </p>
        ) : (
          <div className="space-y-1">
            {entries.map((e) => (
              <PlaylistRow
                key={e.path}
                entry={e}
                active={e.path === currentFile}
                onSelect={() => selectFile(e)}
              />
            ))}
          </div>
        )}
      </div>
    </div>
  );
}
