import { convertFileSrc, invoke, isTauri } from "@tauri-apps/api/core";
import { open } from "@tauri-apps/plugin-dialog";
import { openPath } from "@tauri-apps/plugin-opener";
import { useQuery, useQueryClient } from "@tanstack/react-query";
import { useVirtualizer } from "@tanstack/react-virtual";
import { ArrowLeft, Film, FolderOpen, HardDrive, Pencil, Play, Trash2 } from "lucide-react";
import {
  useCallback,
  useEffect,
  useLayoutEffect,
  useMemo,
  useRef,
  useState,
} from "react";
import { addLibraryPath } from "../api/settings";
import { startScan } from "../api/scan";
import { openPlayerWindow } from "../api/player";
import { usePlayback } from "../hooks/usePlayback";
import { cn } from "../utils/cn";
import {
  captureVideoFrame,
  getThumbnail,
  isCanvasCaptureSupported,
  setThumbnail,
} from "../utils/videoThumbnailCache";

const STORAGE_KEY = "pitflix.device.savedFolders.v1";
const BROWSE_PATH_KEY = "pitflix.device.browsePath.v1";
const GRID_COLS_KEY = "pitflix.device.gridCols.v1";

const GRID_COLS_MIN = 3;
const GRID_COLS_MAX = 12;

function loadGridCols(): number {
  try {
    const raw = localStorage.getItem(GRID_COLS_KEY);
    if (!raw) return 5;
    const n = Number.parseInt(raw, 10);
    if (!Number.isFinite(n)) return 5;
    return Math.min(GRID_COLS_MAX, Math.max(GRID_COLS_MIN, n));
  } catch {
    return 5;
  }
}

type DeviceFsEntry = {
  name: string;
  path: string;
  is_directory: boolean;
  media_kind?: string | null;
};

function loadSaved(): string[] {
  try {
    const raw = localStorage.getItem(STORAGE_KEY);
    if (!raw) return [];
    const j = JSON.parse(raw) as unknown;
    return Array.isArray(j) ? j.filter((x): x is string => typeof x === "string" && x.length > 0) : [];
  } catch {
    return [];
  }
}

function saveSaved(paths: string[]) {
  localStorage.setItem(STORAGE_KEY, JSON.stringify(paths));
}

function isPlayableMedia(e: DeviceFsEntry): boolean {
  if (e.is_directory) return false;
  if (e.media_kind === "video") return true;
  const n = e.name.toLowerCase();
  return /\.(mp3|m4a|aac|flac|wav|ogg|opus|wma|mka)$/i.test(n);
}

function fileDisplayTitle(fileName: string): string {
  return fileName.replace(/\.[^/.]+$/, "").trim() || fileName;
}

function parentDirectory(filePath: string): string {
  const s = filePath.trim().replace(/[/\\]+$/, "");
  const i = Math.max(s.lastIndexOf("\\"), s.lastIndexOf("/"));
  if (i <= 0) return s;
  return s.slice(0, i);
}

function normalizePathKey(p: string): string {
  return p.trim().replace(/[/\\]+$/, "");
}

// ── Per-folder "last played" ─────────────────────────────────────────────────
// Stores the most recently played file path per folder, purely in localStorage.
// Separate from "Continue Watching" (which uses the history API); this is
// only shown on the My Device page itself.
const LAST_PLAYED_KEY = "pitflix.device.lastPlayed.v1";

function saveLastPlayed(folderPath: string, filePath: string): void {
  try {
    const raw = localStorage.getItem(LAST_PLAYED_KEY);
    const map = raw ? (JSON.parse(raw) as Record<string, string>) : {};
    map[normalizePathKey(folderPath)] = filePath;
    localStorage.setItem(LAST_PLAYED_KEY, JSON.stringify(map));
  } catch { /* ignore */ }
}

function loadLastPlayedFilePath(folderPath: string): string | null {
  try {
    const raw = localStorage.getItem(LAST_PLAYED_KEY);
    if (!raw) return null;
    const map = JSON.parse(raw) as Record<string, string>;
    return map[normalizePathKey(folderPath)] ?? null;
  } catch {
    return null;
  }
}

function isSavedRootPath(saved: string[], path: string): boolean {
  const key = normalizePathKey(path);
  return saved.some((s) => normalizePathKey(s).toLowerCase() === key.toLowerCase());
}

// ── Concurrency limiter for video metadata / canvas capture ──────────────────
// Prevents renderer freeze when many items enter the viewport simultaneously.
const MAX_VIDEO_LOADS = 4;
let activeVideoLoads = 0;
const videoLoadQueue: Array<() => void> = [];

function acquireVideoSlot(onReady: () => void) {
  if (activeVideoLoads < MAX_VIDEO_LOADS) {
    activeVideoLoads++;
    onReady();
  } else {
    videoLoadQueue.push(onReady);
  }
}

function releaseVideoSlot() {
  activeVideoLoads = Math.max(0, activeVideoLoads - 1);
  if (videoLoadQueue.length > 0) {
    activeVideoLoads++;
    videoLoadQueue.shift()!();
  }
}

// ── DeviceVideoThumb ─────────────────────────────────────────────────────────
// Tries canvas capture first (produces a cached <img>).
// Falls back to a <video> element if canvas is CORS-blocked (Tauri v2 asset://
// should have CORS headers, but we detect failure and degrade gracefully).
function DeviceVideoThumb({ path }: { path: string }) {
  const src = convertFileSrc(path);
  const [thumbSrc, setThumbSrc] = useState<string | null>(() => getThumbnail(path) ?? null);
  const [useVideoFallback, setUseVideoFallback] = useState(false);
  const [failed, setFailed] = useState(false);

  useEffect(() => {
    // Already have a cached image or gave up
    if (thumbSrc !== null || useVideoFallback || failed) return;
    // If canvas is known-broken, skip straight to video fallback
    if (isCanvasCaptureSupported() === false) { setUseVideoFallback(true); return; }

    let alive = true;
    let inSlot = false;

    const onSlot = () => {
      inSlot = true;
      void captureVideoFrame(src).then((dataUrl) => {
        releaseVideoSlot();
        if (!alive) return;
        if (dataUrl) {
          setThumbnail(path, dataUrl);
          setThumbSrc(dataUrl);
        } else {
          // Canvas failed (CORS or decode error) — use <video> element instead
          setUseVideoFallback(true);
        }
      });
    };

    acquireVideoSlot(onSlot);

    return () => {
      alive = false;
      if (!inSlot) {
        const i = videoLoadQueue.indexOf(onSlot);
        if (i >= 0) videoLoadQueue.splice(i, 1);
      }
    };
  }, [src, path]); // eslint-disable-line react-hooks/exhaustive-deps

  if (thumbSrc) {
    return <img src={thumbSrc} alt="" className="h-full w-full object-cover" />;
  }

  if (failed) {
    return (
      <div className="flex h-full flex-col items-center justify-center gap-1 bg-black/60 px-1">
        <Film className="h-8 w-8 text-violet-400/70" strokeWidth={1.25} />
        <span className="text-[9px] text-pitflix-muted">No preview</span>
      </div>
    );
  }

  if (useVideoFallback) {
    return (
      <video
        src={src}
        className="h-full w-full object-cover"
        muted
        playsInline
        preload="metadata"
        onLoadedMetadata={(e) => {
          const el = e.currentTarget;
          try {
            const d = el.duration;
            if (Number.isFinite(d) && d > 0) {
              const lo = Math.min(d * 0.08, Math.max(0, d - 1));
              const hi = Math.max(lo, d * 0.92);
              el.currentTime = lo + Math.random() * (hi - lo);
            }
          } catch { /* ignore */ }
        }}
        onError={() => setFailed(true)}
      />
    );
  }

  return (
    <div className="flex h-full items-center justify-center bg-black/45">
      <Film className="h-8 w-8 text-violet-400/40" strokeWidth={1.25} aria-hidden />
    </div>
  );
}

function DeviceImageThumb({ path }: { path: string }) {
  const src = convertFileSrc(path);
  const [failed, setFailed] = useState(false);
  if (failed) {
    return (
      <div className="flex h-full items-center justify-center text-[10px] text-pitflix-muted">No preview</div>
    );
  }
  return (
    <img
      src={src}
      alt=""
      className="h-full w-full object-cover"
      loading="lazy"
      decoding="async"
      onError={() => setFailed(true)}
    />
  );
}

/** Only renders the heavy thumbnail when actually in the viewport. */
function LazyFolderThumb({ mode, path }: { mode: "video" | "image"; path: string }) {
  const wrapRef = useRef<HTMLDivElement>(null);
  const [visible, setVisible] = useState(false);

  useEffect(() => {
    const el = wrapRef.current;
    if (!el || visible) return;
    const io = new IntersectionObserver(
      (entries) => {
        if (entries.some((x) => x.isIntersecting)) {
          setVisible(true);
          io.disconnect();
        }
      },
      { root: null, rootMargin: "200px 0px", threshold: 0 },
    );
    io.observe(el);
    return () => io.disconnect();
  }, [visible]);

  return (
    <div ref={wrapRef} className="h-full w-full min-h-0">
      {visible ? (
        mode === "video" ? (
          <DeviceVideoThumb path={path} />
        ) : (
          <DeviceImageThumb path={path} />
        )
      ) : (
        <div className="flex h-full items-center justify-center bg-black/45">
          {mode === "video" ? (
            <Film className="h-8 w-8 text-violet-400/25" strokeWidth={1.25} aria-hidden />
          ) : (
            <span className="text-[10px] text-pitflix-muted/70">…</span>
          )}
        </div>
      )}
    </div>
  );
}

// Gap between grid tiles (matches gap-3 = 12px in Tailwind)
const GRID_GAP = 12;
// Approximate height of the text label below each tile
const TILE_LABEL_HEIGHT = 36;

export function MyDevicePage() {
  const qc = useQueryClient();
  const { play } = usePlayback();
  const [saved, setSaved] = useState<string[]>(() => loadSaved());
  const [currentPath, setCurrentPath] = useState<string | null>(() => {
    try {
      const s = sessionStorage.getItem(BROWSE_PATH_KEY);
      return s && s.length > 0 ? s : null;
    } catch {
      return null;
    }
  });
  const [selectionMode, setSelectionMode] = useState(false);
  const [selectedPaths, setSelectedPaths] = useState<Set<string>>(() => new Set());
  const [renamingPath, setRenamingPath] = useState<string | null>(null);
  const [renameDraft, setRenameDraft] = useState("");
  const [gridCols, setGridCols] = useState<number>(() => loadGridCols());
  const [filterText, setFilterText] = useState("");
  const [scanBusy, setScanBusy] = useState(false);
  const [scanErr, setScanErr] = useState<string | null>(null);
  const activeFolderChipRef = useRef<HTMLDivElement>(null);

  // ── Directory data via React Query (cached 10 min — re-navigating back is instant) ──
  const {
    data: entries = [],
    isLoading: busy,
    error: dirError,
  } = useQuery<DeviceFsEntry[]>({
    queryKey: ["device-dir", currentPath],
    queryFn: () =>
      invoke<DeviceFsEntry[]>("device_read_dir", { path: currentPath! }),
    enabled: !!currentPath && isTauri(),
    staleTime: 10 * 60 * 1000,  // 10 minutes — folders don't change often
    gcTime: 30 * 60 * 1000,
    placeholderData: [],
  });

  const err = scanErr ?? (dirError instanceof Error ? dirError.message : dirError ? String(dirError) : null);

  // Reset filter when navigating to a new folder
  useEffect(() => {
    setFilterText("");
  }, [currentPath]);

  // Scroll the active saved-folder chip into view
  useEffect(() => {
    activeFolderChipRef.current?.scrollIntoView({ behavior: "smooth", block: "nearest", inline: "center" });
  }, [currentPath]);

  // Persist current path to sessionStorage
  useEffect(() => {
    try {
      if (currentPath) sessionStorage.setItem(BROWSE_PATH_KEY, currentPath);
      else sessionStorage.removeItem(BROWSE_PATH_KEY);
    } catch { /* ignore */ }
  }, [currentPath]);

  // ── Filtered list ────────────────────────────────────────────────────────────
  const filtered = useMemo(() => {
    const lower = filterText.trim().toLowerCase();
    return lower
      ? entries.filter((e) => e.name.toLowerCase().includes(lower))
      : entries;
  }, [entries, filterText]);

  // Last-played file for the current folder — shown as a "Resume" banner above the grid.
  // Only displayed when the file is still present in the loaded entries.
  const lastPlayedEntry = useMemo((): DeviceFsEntry | null => {
    if (!currentPath || busy || entries.length === 0) return null;
    const fp = loadLastPlayedFilePath(currentPath);
    if (!fp) return null;
    const lower = fp.toLowerCase();
    return entries.find((e) => !e.is_directory && e.path.toLowerCase() === lower) ?? null;
  }, [currentPath, busy, entries]);

  // Group entries into rows of gridCols for the virtualizer
  const rows = useMemo(() => {
    const result: DeviceFsEntry[][] = [];
    for (let i = 0; i < filtered.length; i += gridCols) {
      result.push(filtered.slice(i, i + gridCols));
    }
    return result;
  }, [filtered, gridCols]);

  // Row index that contains the last-played entry (-1 if not applicable)
  const lastPlayedRowIndex = useMemo(() => {
    if (!lastPlayedEntry) return -1;
    for (let i = 0; i < rows.length; i++) {
      if (rows[i].some((e) => e.path === lastPlayedEntry.path)) return i;
    }
    return -1;
  }, [lastPlayedEntry, rows]);

  // Ref for "scroll to last played" — declared here so it's available before virtualizer.
  const hasScrolledToLastPlayedRef = useRef(false);

  // ── Virtual grid setup ───────────────────────────────────────────────────────
  const gridContainerRef = useRef<HTMLDivElement>(null);
  const [containerWidth, setContainerWidth] = useState(800);
  const [scrollMargin, setScrollMargin] = useState(0);

  // Track grid container width so row height stays accurate when window resizes
  useEffect(() => {
    const el = gridContainerRef.current;
    if (!el) return;
    const ro = new ResizeObserver(([entry]) => {
      setContainerWidth(entry.contentRect.width);
    });
    ro.observe(el);
    // Initial measure
    setContainerWidth(el.getBoundingClientRect().width);
    return () => ro.disconnect();
  }, [currentPath]); // re-attach when currentPath changes (grid mounts/unmounts)

  // Track distance from <main>'s scroll origin to the grid container's top.
  // This is needed so the virtualizer knows which rows are visible.
  useLayoutEffect(() => {
    const grid = gridContainerRef.current;
    const main = document.querySelector("main") as HTMLElement | null;
    if (!grid || !main) return;
    const margin = Math.round(
      grid.getBoundingClientRect().top - main.getBoundingClientRect().top + main.scrollTop,
    );
    setScrollMargin((prev) => (prev === margin ? prev : margin));
  }); // intentionally no deps — cheap measurement, self-stabilizes after first render

  const tileWidth =
    containerWidth > 0
      ? (containerWidth - GRID_GAP * (gridCols - 1)) / gridCols
      : 120;
  const rowHeight = Math.ceil(tileWidth) + TILE_LABEL_HEIGHT + GRID_GAP;

  const virtualizer = useVirtualizer({
    count: rows.length,
    getScrollElement: () => document.querySelector("main") as HTMLElement | null,
    estimateSize: () => rowHeight,
    overscan: 4,
    scrollMargin,
  });

  // Scroll to the last-played row once per folder visit so the user can see it
  // (and what's around it) without having to manually locate it.
  useEffect(() => {
    // Reset the "already scrolled" flag whenever the folder changes.
    hasScrolledToLastPlayedRef.current = false;
  }, [currentPath]);

  useEffect(() => {
    if (lastPlayedRowIndex < 0) return;
    if (hasScrolledToLastPlayedRef.current) return;
    hasScrolledToLastPlayedRef.current = true;
    // Delay so the virtualizer and scrollMargin have been measured before we jump.
    const t = setTimeout(() => {
      virtualizer.scrollToIndex(lastPlayedRowIndex, { align: "center" });
    }, 400);
    return () => clearTimeout(t);
  }, [lastPlayedRowIndex, virtualizer]);

  // ── Action handlers ──────────────────────────────────────────────────────────

  const pickFolder = useCallback(async () => {
    if (!isTauri()) return;
    const r = await open({ directory: true, multiple: false, title: "Choose a folder" });
    const path = typeof r === "string" ? r : Array.isArray(r) ? r[0] : null;
    if (!path) return;
    if (!saved.includes(path)) {
      const next = [...saved, path];
      setSaved(next);
      saveSaved(next);
    }
    setCurrentPath(path);
  }, [saved]);

  const removeSaved = (path: string) => {
    const next = saved.filter((p) => p !== path);
    setSaved(next);
    saveSaved(next);
    if (
      currentPath === path ||
      (currentPath &&
        currentPath.startsWith(
          path + (path.includes("\\") ? "\\" : "/"),
        ))
    ) {
      setCurrentPath(null);
    }
  };

  const openRename = (path: string) => {
    const label = path.replace(/[/\\]+$/, "").split(/[/\\]/).pop() ?? path;
    setRenamingPath(path);
    setRenameDraft(label);
  };

  const applyRename = () => {
    const oldPath = renamingPath;
    const label = renameDraft.trim();
    if (!oldPath || !label) { setRenamingPath(null); return; }
    const STORAGE_LABELS = "pitflix.device.folderLabels.v1";
    try {
      const raw = localStorage.getItem(STORAGE_LABELS);
      const map = raw ? (JSON.parse(raw) as Record<string, string>) : {};
      map[oldPath] = label;
      localStorage.setItem(STORAGE_LABELS, JSON.stringify(map));
    } catch { /* ignore */ }
    setRenamingPath(null);
  };

  const folderLabel = (path: string): string => {
    try {
      const raw = localStorage.getItem("pitflix.device.folderLabels.v1");
      if (!raw) return path.replace(/[/\\]+$/, "").split(/[/\\]/).pop() ?? path;
      const map = JSON.parse(raw) as Record<string, string>;
      const custom = map[path];
      if (custom && custom.trim()) return custom.trim();
    } catch { /* ignore */ }
    return path.replace(/[/\\]+$/, "").split(/[/\\]/).pop() ?? path;
  };

  const toggleSelected = (path: string) => {
    setSelectedPaths((prev) => {
      const next = new Set(prev);
      if (next.has(path)) next.delete(path);
      else next.add(path);
      return next;
    });
  };

  const scanSelectedIntoLibrary = async () => {
    const files = entries.filter(
      (e) => !e.is_directory && selectedPaths.has(e.path) && e.media_kind === "video",
    );
    if (files.length === 0) { setScanErr("Select at least one video file."); return; }
    setScanBusy(true);
    setScanErr(null);
    try {
      const dirs = [...new Set(files.map((f) => parentDirectory(f.path)))];
      for (const d of dirs) await addLibraryPath(d);
      await startScan({ folders: dirs });
      void qc.invalidateQueries({ queryKey: ["movies"] });
      void qc.invalidateQueries({ queryKey: ["series"] });
      void qc.invalidateQueries({ queryKey: ["stats"] });
      void qc.invalidateQueries({ queryKey: ["home-movies"] });
      void qc.invalidateQueries({ queryKey: ["home-series"] });
      void qc.invalidateQueries({ queryKey: ["settings"] });
      setSelectedPaths(new Set());
      setSelectionMode(false);
    } catch (e: unknown) {
      setScanErr(e instanceof Error ? e.message : String(e));
    } finally {
      setScanBusy(false);
    }
  };

  const goBackFromBrowse = useCallback(() => {
    if (!currentPath) return;
    if (isSavedRootPath(saved, currentPath)) { setCurrentPath(null); return; }
    const parent = parentDirectory(currentPath);
    const normParent = normalizePathKey(parent);
    const normCurrent = normalizePathKey(currentPath);
    if (!normParent || normParent === normCurrent) { setCurrentPath(null); return; }
    setCurrentPath(parent);
  }, [currentPath, saved]);

  const setGridColsPersist = (n: number) => {
    const v = Math.min(GRID_COLS_MAX, Math.max(GRID_COLS_MIN, Math.round(n)));
    setGridCols(v);
    try { localStorage.setItem(GRID_COLS_KEY, String(v)); } catch { /* ignore */ }
  };

  const openEntry = async (e: DeviceFsEntry) => {
    if (!isTauri()) return;
    if (selectionMode && !e.is_directory) { toggleSelected(e.path); return; }
    if (e.is_directory) { setCurrentPath(e.path); return; }
    if (isPlayableMedia(e)) {
      if (currentPath) saveLastPlayed(currentPath, e.path);
      const main = typeof document !== "undefined" ? document.querySelector("main") : null;
      await play(e.path, fileDisplayTitle(e.name), null, "Movie", 0, {
        returnTo: {
          pathname: "/my-device",
          scrollY: typeof window !== "undefined" ? window.scrollY : undefined,
          mainScrollTop: main instanceof HTMLElement ? main.scrollTop : undefined,
        },
        suppressContinueWatching: true,
      });
      // Explicitly invoke the PitflixPlayer companion in addition to the
      // backend's auto-launch.  My Device files often lack library
      // metadata (MediaId=0), and on a fresh launch where the backend's
      // auto-spawn races with our reaching this point, the explicit call
      // guarantees PitflixPlayer comes up.  Idempotent: if it's already
      // running, the Tauri-side check short-circuits.
      void openPlayerWindow().catch(() => {
        /* best-effort — backend already started the session */
      });
      return;
    }
    if (e.media_kind === "image") { await openPath(e.path); return; }
    await openPath(e.path);
  };

  if (!isTauri()) {
    return (
      <div className="rounded-2xl border border-pitflix-card/50 bg-pitflix-surface/40 p-8 text-center">
        <HardDrive className="mx-auto mb-4 h-12 w-12 text-pitflix-muted" />
        <h1 className="text-xl font-bold text-white">My device</h1>
        <p className="mt-2 text-sm text-pitflix-muted">
          Browsing folders on your computer is available in the Pitflix desktop app (Tauri).
        </p>
      </div>
    );
  }

  return (
    <div>
      {/* ── Page header ─────────────────────────────────────────────────────── */}
      <div className="mb-4 flex flex-wrap items-center justify-between gap-4">
        <div>
          <h1 className="text-3xl font-bold text-white">My device</h1>
          <p className="mt-1 text-sm text-pitflix-muted">Browse photos and videos outside your library.</p>
        </div>
        <button
          type="button"
          onClick={() => void pickFolder()}
          className="inline-flex items-center gap-2 rounded-xl bg-pitflix-primary px-4 py-2.5 text-sm font-medium text-white hover:bg-pitflix-light"
        >
          <FolderOpen className="h-4 w-4" />
          Add folder
        </button>
      </div>

      {/* ── Saved folder chips ───────────────────────────────────────────────── */}
      {saved.length > 0 ? (
        <div className="mb-3 flex flex-wrap gap-2">
          {saved.map((p) => {
            const isActive = currentPath === p ||
              (currentPath && currentPath.startsWith(p.replace(/[/\\]+$/, "") + (p.includes("\\") ? "\\" : "/")));
            return (
            <div
              key={p}
              ref={isActive ? activeFolderChipRef : null}
              className={cn(
                "flex max-w-full items-center gap-2 rounded-xl border px-3 py-2 text-xs",
                isActive
                  ? "border-pitflix-primary/50 bg-pitflix-primary/15 text-white"
                  : "border-pitflix-card bg-pitflix-card/40 text-pitflix-muted",
              )}
            >
              <button
                type="button"
                className="truncate text-left font-medium hover:text-white"
                title={p}
                onClick={() => setCurrentPath(p)}
              >
                {folderLabel(p)}
              </button>
              <button
                type="button"
                className="shrink-0 rounded p-1 text-pitflix-subtle hover:bg-white/10 hover:text-white"
                title="Rename label"
                onClick={() => openRename(p)}
              >
                <Pencil className="h-3.5 w-3.5" />
              </button>
              <button
                type="button"
                className="shrink-0 rounded p-1 text-pitflix-subtle hover:bg-white/10 hover:text-red-300"
                title="Remove from My device"
                onClick={() => removeSaved(p)}
              >
                <Trash2 className="h-3.5 w-3.5" />
              </button>
            </div>
            );
          })}
        </div>
      ) : (
        <p className="mb-6 text-sm text-pitflix-muted">
          No saved folders yet. Use "Add folder" to bookmark a location.
        </p>
      )}

      {/* ── Rename modal ─────────────────────────────────────────────────────── */}
      {renamingPath ? (
        <div className="fixed inset-0 z-[70] flex items-center justify-center bg-black/60 px-4 backdrop-blur-sm">
          <div className="w-full max-w-sm rounded-2xl border border-white/10 bg-zinc-900 p-5 shadow-xl">
            <h2 className="text-sm font-semibold text-white">Folder display name</h2>
            <p className="mt-1 text-xs text-pitflix-muted">
              Shown on this page only. Does not rename the folder on disk.
            </p>
            <input
              autoFocus
              value={renameDraft}
              onChange={(e) => setRenameDraft(e.target.value)}
              className="mt-4 w-full rounded-xl border border-white/10 bg-black/40 px-3 py-2 text-sm text-white"
              onKeyDown={(e) => {
                if (e.key === "Enter") applyRename();
                if (e.key === "Escape") setRenamingPath(null);
              }}
            />
            <div className="mt-4 flex justify-end gap-2">
              <button
                type="button"
                className="rounded-lg px-3 py-2 text-sm text-pitflix-muted hover:text-white"
                onClick={() => setRenamingPath(null)}
              >
                Cancel
              </button>
              <button
                type="button"
                className="rounded-lg bg-pitflix-primary px-4 py-2 text-sm font-medium text-white"
                onClick={() => applyRename()}
              >
                Save
              </button>
            </div>
          </div>
        </div>
      ) : null}

      {err ? <p className="mb-4 text-sm text-rose-300">{err}</p> : null}

      {/* ── Browse view ──────────────────────────────────────────────────────── */}
      {currentPath ? (
        <>
          {/* Breadcrumb + back */}
          <div className="mb-4 flex flex-wrap items-center gap-3">
            <button
              type="button"
              onClick={() => goBackFromBrowse()}
              className="inline-flex shrink-0 items-center gap-2 rounded-xl border border-pitflix-card bg-pitflix-card/40 px-3 py-2 text-sm font-medium text-pitflix-muted hover:border-pitflix-primary/45 hover:text-white"
            >
              <ArrowLeft className="h-4 w-4" />
              Back
            </button>
            <p className="min-w-0 flex-1 break-all font-mono text-xs text-pitflix-subtle">
              {currentPath}
            </p>
          </div>

          {/* Toolbar */}
          <div className="mb-4 flex flex-wrap items-center gap-2">
            <button
              type="button"
              onClick={() => { setSelectionMode((v) => !v); setSelectedPaths(new Set()); }}
              className={cn(
                "rounded-xl border px-4 py-2 text-sm font-medium transition",
                selectionMode
                  ? "border-pitflix-primary bg-pitflix-primary/20 text-white"
                  : "border-pitflix-card text-pitflix-muted hover:text-white",
              )}
            >
              {selectionMode ? "Cancel select" : "Select"}
            </button>
            {selectionMode ? (
              <button
                type="button"
                disabled={scanBusy || selectedPaths.size === 0}
                onClick={() => void scanSelectedIntoLibrary()}
                className="rounded-xl bg-violet-600 px-4 py-2 text-sm font-medium text-white hover:bg-violet-500 disabled:opacity-40"
              >
                {scanBusy ? "Scanning…" : `Add to library (${selectedPaths.size})`}
              </button>
            ) : null}
            {selectionMode ? (
              <span className="text-xs text-pitflix-muted">
                Tap videos to select. Adds each file's folder to the library and runs a scan.
              </span>
            ) : null}
            <input
              type="search"
              placeholder="Filter…"
              value={filterText}
              onChange={(e) => setFilterText(e.target.value)}
              className="rounded-xl border border-pitflix-card bg-pitflix-surface/60 px-3 py-2 text-xs text-white placeholder:text-pitflix-subtle focus:border-pitflix-primary/50 focus:outline-none"
            />
            <label className="ml-auto flex flex-wrap items-center gap-2 text-xs text-pitflix-muted">
              <span className="whitespace-nowrap">Grid</span>
              <input
                type="range"
                min={GRID_COLS_MIN}
                max={GRID_COLS_MAX}
                value={gridCols}
                onChange={(e) => setGridColsPersist(Number(e.target.value))}
                className="h-2 w-28 cursor-pointer accent-pitflix-primary sm:w-36"
              />
              <span className="min-w-[2.5rem] tabular-nums text-pitflix-subtle">
                {gridCols} per row
              </span>
            </label>
          </div>

          {busy ? <p className="mb-4 text-sm text-pitflix-muted">Loading…</p> : null}

          {/* ── Last played banner ────────────────────────────────────────── */}
          {!busy && lastPlayedEntry ? (
            <div className="mb-4 flex items-center gap-3 rounded-xl border border-pitflix-primary/25 bg-pitflix-primary/8 p-3">
              <div className="h-14 w-24 shrink-0 overflow-hidden rounded-lg bg-black/40 ring-1 ring-white/10">
                <LazyFolderThumb mode="video" path={lastPlayedEntry.path} />
              </div>
              <div className="min-w-0 flex-1">
                <p className="mb-0.5 text-[10px] uppercase tracking-wide text-pitflix-muted">Last played</p>
                <p className="truncate text-sm font-medium text-white">{fileDisplayTitle(lastPlayedEntry.name)}</p>
              </div>
              <button
                type="button"
                onClick={() => void openEntry(lastPlayedEntry)}
                className="shrink-0 inline-flex items-center gap-1.5 rounded-lg bg-pitflix-primary px-3 py-2 text-xs font-medium text-white hover:bg-pitflix-light"
              >
                <Play className="h-3 w-3" fill="currentColor" />
                Resume
              </button>
            </div>
          ) : null}

          {filterText && !busy ? (
            <p className="mb-2 text-xs text-pitflix-muted">
              {filtered.length} result{filtered.length !== 1 ? "s" : ""}
            </p>
          ) : null}

          {/* ── Virtual grid ──────────────────────────────────────────────── */}
          {/* The outer div is the measurement anchor; the inner div is sized by
              the virtualizer so the scroll container gets the correct total height. */}
          <div
            ref={gridContainerRef}
            style={{
              height: `${virtualizer.getTotalSize()}px`,
              position: "relative",
            }}
          >
            {virtualizer.getVirtualItems().map((virtualRow) => (
              <div
                key={virtualRow.key}
                data-index={virtualRow.index}
                ref={virtualizer.measureElement}
                style={{
                  position: "absolute",
                  top: 0,
                  left: 0,
                  width: "100%",
                  transform: `translateY(${virtualRow.start - scrollMargin}px)`,
                }}
              >
                <div
                  className="grid pb-3"
                  style={{
                    gridTemplateColumns: `repeat(${gridCols}, minmax(0, 1fr))`,
                    gap: `${GRID_GAP}px`,
                  }}
                >
                  {rows[virtualRow.index].map((e) => (
                    <button
                      key={e.path}
                      type="button"
                      onClick={() => void openEntry(e)}
                      className={cn(
                        "group overflow-hidden rounded-xl border text-left transition",
                        selectionMode && !e.is_directory && selectedPaths.has(e.path)
                          ? "border-pitflix-primary bg-pitflix-primary/10 ring-1 ring-pitflix-primary/50"
                          : "border-pitflix-card/60 bg-pitflix-surface/40 hover:border-pitflix-primary/45",
                      )}
                    >
                      <div className="relative aspect-square bg-black/40">
                        {e.is_directory ? (
                          <div className="flex h-full items-center justify-center">
                            <FolderOpen className="h-10 w-10 text-violet-300/90" />
                          </div>
                        ) : e.media_kind === "image" ? (
                          <LazyFolderThumb mode="image" path={e.path} />
                        ) : e.media_kind === "video" ? (
                          <LazyFolderThumb mode="video" path={e.path} />
                        ) : (
                          <div className="flex h-full items-center justify-center p-2 text-center text-[11px] text-pitflix-muted">
                            {e.name}
                          </div>
                        )}
                      </div>
                      <p className="whitespace-normal break-words p-2 text-left text-xs font-medium leading-snug text-white">
                        {e.name}
                      </p>
                    </button>
                  ))}
                </div>
              </div>
            ))}
          </div>

          {!busy && filtered.length === 0 && entries.length > 0 ? (
            <p className="py-8 text-center text-sm text-pitflix-muted">
              No items match "{filterText}"
            </p>
          ) : null}
        </>
      ) : (
        <p className="text-sm text-pitflix-muted">
          Select a saved folder or add one to browse files.
        </p>
      )}
    </div>
  );
}
