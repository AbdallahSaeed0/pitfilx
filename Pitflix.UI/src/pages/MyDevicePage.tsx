import { invoke, isTauri } from "@tauri-apps/api/core";
import { open } from "@tauri-apps/plugin-dialog";
import { openPath } from "@tauri-apps/plugin-opener";
import { useQuery, useQueryClient } from "@tanstack/react-query";
import { useVirtualizer } from "@tanstack/react-virtual";
import { Check, CheckSquare, ChevronLeft, ChevronRight, Filter, FolderInput, FolderOpen, FolderPlus, HardDrive, Keyboard, PanelLeftClose, PanelLeftOpen, Pencil, Send, Trash2 } from "lucide-react";
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
import { DeviceImageViewer } from "../features/device/DeviceImageViewer";
import { DeviceVideoHoverPreview, LazyFolderThumb, notifyScroll, resetPreviewProgress, resetThumbnailWarmState, scheduleBackgroundImages, scheduleBackgroundThumbnails } from "../features/device/DeviceThumbs";
import {
  DeviceEntryContextMenu,
  type DeviceContextMenuAction,
} from "../features/device/DeviceEntryContextMenu";
import {
  DeviceFolderContextMenu,
  type DeviceFolderContextMenuAction,
} from "../features/device/DeviceFolderContextMenu";
import { DeviceShortcutsModal } from "../features/device/DeviceShortcutsModal";
import { DeviceMediaConfigureModal } from "../features/device/DeviceMediaConfigureModal";
import {
  getDeviceMediaSettings,
  loadDeviceMediaSettings,
  saveDeviceMediaSettings,
  type DeviceMediaSettings,
} from "../features/device/deviceMediaSettings";
import { useDeviceKeyboardShortcuts } from "../features/device/useDeviceKeyboardShortcuts";
import {
  BROWSE_PATH_KEY,
  type DeviceEntryDetails,
  type DeviceFsEntry,
  fileDisplayTitle,
  formatBytes,
  formatDeviceTimestamp,
  GRID_COLS_KEY,
  GRID_COLS_MAX,
  GRID_COLS_MIN,
  GRID_GAP,
  isPlayableMedia,
  isSavedRootPath,
  canMoveEntriesTo,
  loadGridCols,
  loadLastPlayedFilePaths,
  loadSaved,
  loadSidebarCollapsed,
  normalizePathKey,
  parentDirectory,
  saveLastPlayed,
  saveSaved,
  saveSidebarCollapsed,
  suggestNewFolderName,
  TILE_LABEL_HEIGHT,
} from "../features/device/deviceUtils";
import { usePlayback } from "../hooks/usePlayback";
import { pitflixConfirm } from "../utils/pitflixDialog";
import { clearDeviceThumbnailDiskCache, clearDeviceThumbnailMemoryCache } from "../utils/videoThumbnailCache";
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
  const [sidebarCollapsed, setSidebarCollapsed] = useState<boolean>(() => loadSidebarCollapsed());
  const toggleSidebarCollapsed = useCallback(() => {
    setSidebarCollapsed((prev) => {
      const next = !prev;
      saveSidebarCollapsed(next);
      return next;
    });
  }, []);
  const [filterText, setFilterText] = useState("");
  const [scanBusy, setScanBusy] = useState(false);
  const [fsBusy, setFsBusy] = useState(false);
  const [fsBusyLabel, setFsBusyLabel] = useState<string | null>(null);
  const [folderPicker, setFolderPicker] = useState<{
    mode: "move" | "copy";
    paths: string[];
  } | null>(null);
  const [contextMenu, setContextMenu] = useState<{
    entry: DeviceFsEntry;
    x: number;
    y: number;
  } | null>(null);
  const [folderContextMenu, setFolderContextMenu] = useState<{
    x: number;
    y: number;
  } | null>(null);
  const [newFolderOpen, setNewFolderOpen] = useState(false);
  const [newFolderDraft, setNewFolderDraft] = useState("New folder");
  const [entryRename, setEntryRename] = useState<{ path: string; name: string } | null>(null);
  const [detailsPath, setDetailsPath] = useState<string | null>(null);
  const [shortcutsOpen, setShortcutsOpen] = useState(false);
  const [mediaConfigureOpen, setMediaConfigureOpen] = useState(false);
  const [viewingImage, setViewingImage] = useState<DeviceFsEntry | null>(null);
  const [mediaSettings, setMediaSettings] = useState<DeviceMediaSettings>(() => loadDeviceMediaSettings());
  const [scanErr, setScanErr] = useState<string | null>(null);
  const [lastPlayedRev, setLastPlayedRev] = useState(0);
  const [typeFilter, setTypeFilter] = useState<'all' | 'folder' | 'video' | 'image' | 'doc'>('all');
  const [filterMenuOpen, setFilterMenuOpen] = useState(false);
  const activeFolderChipRef = useRef<HTMLDivElement>(null);
  const filterInputRef = useRef<HTMLInputElement>(null);
  const filterMenuRef = useRef<HTMLDivElement>(null);
  const scrollContainerRef = useRef<HTMLDivElement>(null);

  // Close the type-filter dropdown on outside click / Escape
  useEffect(() => {
    if (!filterMenuOpen) return;
    const onPointerDown = (e: MouseEvent) => {
      if (filterMenuRef.current?.contains(e.target as Node)) return;
      setFilterMenuOpen(false);
    };
    const onKeyDown = (e: KeyboardEvent) => { if (e.key === 'Escape') setFilterMenuOpen(false); };
    window.addEventListener('mousedown', onPointerDown);
    window.addEventListener('keydown', onKeyDown);
    return () => {
      window.removeEventListener('mousedown', onPointerDown);
      window.removeEventListener('keydown', onKeyDown);
    };
  }, [filterMenuOpen]);

  // ── Directory data via React Query (cached 10 min — re-navigating back is instant) ──
  const {
    data: entries = [],
    isLoading: busy,
    isFetching,
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

  const { data: entryDetails, isLoading: detailsBusy } = useQuery<DeviceEntryDetails>({
    queryKey: ["device-details", detailsPath],
    queryFn: () => invoke<DeviceEntryDetails>("device_entry_details", { path: detailsPath! }),
    enabled: !!detailsPath && isTauri(),
  });

  // Reset filter when navigating to a new folder
  useEffect(() => {
    setFilterText("");
    setTypeFilter('all');
    setFilterMenuOpen(false);
    setViewingImage(null);
    setContextMenu(null);
    setFolderContextMenu(null);
  }, [currentPath]);

  // Background thumbnail preloading — runs whenever entries for a folder arrive.
  // Generates thumbnails for all videos in the background using a low-priority
  // 2-slot queue so it never starves cards that are currently visible.
  useEffect(() => {
    if (!entries.length || isFetching) return;
    const videoPaths = entries
      .filter(e => !e.is_directory && e.media_kind === 'video')
      .map(e => e.path);
    const imagePaths = entries
      .filter(e => !e.is_directory && e.media_kind === 'image')
      .map(e => e.path);
    if (videoPaths.length) scheduleBackgroundThumbnails(videoPaths);
    if (imagePaths.length) scheduleBackgroundImages(imagePaths);
  }, [entries, isFetching]);

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

  useEffect(() => {
    const bump = () => setLastPlayedRev((n) => n + 1);
    window.addEventListener("pitflix-device-last-played", bump);
    window.addEventListener("focus", bump);
    return () => {
      window.removeEventListener("pitflix-device-last-played", bump);
      window.removeEventListener("focus", bump);
    };
  }, []);

  // ── Filtered list ────────────────────────────────────────────────────────────
  const filtered = useMemo(() => {
    let list = entries;
    const lower = filterText.trim().toLowerCase();
    if (lower) list = list.filter((e) => e.name.toLowerCase().includes(lower));
    if (typeFilter !== 'all') {
      list = list.filter((e) => {
        if (typeFilter === 'folder') return e.is_directory;
        if (typeFilter === 'video')  return !e.is_directory && e.media_kind === 'video';
        if (typeFilter === 'image')  return !e.is_directory && e.media_kind === 'image';
        if (typeFilter === 'doc')    return !e.is_directory && e.media_kind !== 'video' && e.media_kind !== 'image';
        return true;
      });
    }
    return list;
  }, [entries, filterText, typeFilter]);

  const viewerMediaEntries = useMemo(
    () => filtered.filter((e) => !e.is_directory && (e.media_kind === "image" || e.media_kind === "video")),
    [filtered],
  );

  // Last-played files for the current folder — shown as a "Resume" slider above the grid,
  // most-recent-first. Uses isFetching so it hides immediately on folder change, even with cached data.
  const lastPlayedEntries = useMemo((): DeviceFsEntry[] => {
    if (!currentPath || busy || isFetching || entries.length === 0) return [];
    const paths = loadLastPlayedFilePaths(currentPath);
    if (paths.length === 0) return [];
    const byLowerPath = new Map(
      entries.filter((e) => !e.is_directory).map((e) => [e.path.toLowerCase(), e] as const),
    );
    return paths
      .map((fp) => byLowerPath.get(fp.toLowerCase()))
      .filter((e): e is DeviceFsEntry => e != null);
  }, [currentPath, busy, isFetching, entries, lastPlayedRev]);

  // Resume slider: nav-arrow scrolling + which arrows are actionable right now.
  const resumeSliderRef = useRef<HTMLDivElement>(null);
  const [resumeSliderScroll, setResumeSliderScroll] = useState({ canLeft: false, canRight: false });
  const updateResumeSliderScroll = useCallback(() => {
    const el = resumeSliderRef.current;
    if (!el) return;
    setResumeSliderScroll({
      canLeft: el.scrollLeft > 4,
      canRight: el.scrollLeft + el.clientWidth < el.scrollWidth - 4,
    });
  }, []);
  useEffect(() => {
    updateResumeSliderScroll();
  }, [lastPlayedEntries, updateResumeSliderScroll]);
  const scrollResumeSlider = useCallback((direction: 1 | -1) => {
    const el = resumeSliderRef.current;
    if (!el) return;
    el.scrollBy({ left: direction * (el.clientWidth * 0.85), behavior: "smooth" });
  }, []);

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

  // The size slider picks a MINIMUM column count (i.e. a maximum tile size).
  // If the window is stretched wide enough that tiles would exceed
  // MAX_TILE_WIDTH, extra columns are added automatically so tiles stay sharp
  // (thumbnails are captured at a fixed resolution — over-stretching them to
  // fill a huge tile is what causes the blur) instead of just growing wider.
  const MAX_TILE_WIDTH = 260;
  const ABS_MAX_COLS = 24;
  const effectiveCols = useMemo(() => {
    if (containerWidth <= 0) return gridCols;
    let cols = gridCols;
    while (cols < ABS_MAX_COLS) {
      const w = (containerWidth - GRID_GAP * (cols - 1)) / cols;
      if (w <= MAX_TILE_WIDTH) break;
      cols++;
    }
    return cols;
  }, [containerWidth, gridCols]);

  // Group entries into rows of effectiveCols for the virtualizer
  const rows = useMemo(() => {
    const result: DeviceFsEntry[][] = [];
    for (let i = 0; i < filtered.length; i += effectiveCols) {
      result.push(filtered.slice(i, i + effectiveCols));
    }
    return result;
  }, [filtered, effectiveCols]);

  // Track distance from the scroll container's origin to the grid container's top.
  // This is needed so the virtualizer knows which rows are visible.
  useLayoutEffect(() => {
    const grid = gridContainerRef.current;
    const scroller = scrollContainerRef.current;
    if (!grid || !scroller) return;
    const margin = Math.round(
      grid.getBoundingClientRect().top - scroller.getBoundingClientRect().top + scroller.scrollTop,
    );
    setScrollMargin((prev) => (prev === margin ? prev : margin));
  }); // intentionally no deps — cheap measurement, self-stabilizes after first render

  const tileWidth =
    containerWidth > 0
      ? (containerWidth - GRID_GAP * (effectiveCols - 1)) / effectiveCols
      : 120;
  const rowHeight = Math.ceil(tileWidth) + TILE_LABEL_HEIGHT + GRID_GAP;

  const virtualizer = useVirtualizer({
    count: rows.length,
    getScrollElement: () => scrollContainerRef.current,
    estimateSize: () => rowHeight,
    overscan: 3,
    scrollMargin,
  });

  // Scroll to top whenever the folder changes.
  useEffect(() => {
    const scroller = scrollContainerRef.current;
    if (scroller) scroller.scrollTop = 0;
  }, [currentPath]);

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

  const refreshCurrentDir = useCallback(() => {
    if (!currentPath) return;
    void qc.invalidateQueries({ queryKey: ["device-dir", currentPath] });
  }, [currentPath, qc]);

  const selectedList = useMemo(() => [...selectedPaths], [selectedPaths]);

  const subfolders = useMemo(
    () => entries.filter((e) => e.is_directory),
    [entries],
  );

  const moveTargets = useMemo(() => {
    const paths = folderPicker?.paths ?? selectedList;
    return subfolders.filter((folder) => canMoveEntriesTo(paths, folder.path));
  }, [folderPicker?.paths, selectedList, subfolders]);

  const exitSelectionMode = useCallback(() => {
    setSelectionMode(false);
    setSelectedPaths(new Set());
    setFolderPicker(null);
  }, []);

  const enterSelectionMode = useCallback(() => {
    if (document.activeElement instanceof HTMLElement) document.activeElement.blur();
    setSelectionMode(true);
    setSelectedPaths(new Set());
    setFolderPicker(null);
  }, []);

  const toggleSelectionMode = useCallback(() => {
    if (document.activeElement instanceof HTMLElement) document.activeElement.blur();
    setSelectionMode((prev) => {
      if (prev) {
        setSelectedPaths(new Set());
        setFolderPicker(null);
      }
      return !prev;
    });
  }, []);

  const selectAllFiltered = useCallback(() => {
    if (document.activeElement instanceof HTMLElement) document.activeElement.blur();
    setSelectionMode(true);
    setSelectedPaths(new Set(filtered.map((e) => e.path)));
  }, [filtered]);

  const getSingleSelectedEntry = useCallback((): DeviceFsEntry | null => {
    if (selectedList.length !== 1) return null;
    return entries.find((e) => e.path === selectedList[0]) ?? null;
  }, [entries, selectedList]);

  const renameSingleSelected = useCallback(() => {
    const entry = getSingleSelectedEntry();
    if (!entry) {
      setScanErr("Select exactly one item to rename.");
      return;
    }
    setEntryRename({ path: entry.path, name: entry.name });
  }, [getSingleSelectedEntry]);

  const openMovePicker = useCallback(() => {
    if (selectedList.length === 0) return;
    setFolderPicker({ mode: "move", paths: selectedList });
  }, [selectedList]);

  const openCopyPicker = useCallback(() => {
    if (selectedList.length === 0) return;
    setFolderPicker({ mode: "copy", paths: selectedList });
  }, [selectedList]);

  const showDetailsSingleSelected = useCallback(() => {
    const entry = getSingleSelectedEntry();
    if (!entry) {
      setScanErr("Select exactly one item to view details.");
      return;
    }
    setDetailsPath(entry.path);
  }, [getSingleSelectedEntry]);

  const transferToFolder = useCallback(async (
    destinationDir: string,
    opts: { mode: "move" | "copy"; paths: string[]; clearSelection?: boolean },
  ) => {
    const { mode, paths, clearSelection = false } = opts;
    if (paths.length === 0) return;
    if (!canMoveEntriesTo(paths, destinationDir)) {
      setScanErr("Cannot use that folder as the destination.");
      return;
    }
    setFsBusy(true);
    setFsBusyLabel(
      mode === "move"
        ? "Moving files…"
        : "Copying files…",
    );
    setScanErr(null);
    try {
      await invoke(mode === "move" ? "device_move_entries" : "device_copy_entries", {
        paths,
        destinationDir,
      });
      setFolderPicker(null);
      if (clearSelection) exitSelectionMode();
      refreshCurrentDir();
    } catch (e: unknown) {
      setScanErr(e instanceof Error ? e.message : String(e));
    } finally {
      setFsBusy(false);
      setFsBusyLabel(null);
    }
  }, [exitSelectionMode, refreshCurrentDir]);

  const sendToSelected = useCallback(async () => {
    if (!isTauri() || selectedList.length === 0) return;
    const dest = await open({
      directory: true,
      multiple: false,
      title: "Send to folder",
    });
    const path = typeof dest === "string" ? dest : Array.isArray(dest) ? dest[0] : null;
    if (!path) return;
    await transferToFolder(path, {
      mode: "move",
      paths: selectedList,
      clearSelection: true,
    });
  }, [selectedList, transferToFolder]);

  const moveSelectedTo = async (destinationDir: string) => {
    await transferToFolder(destinationDir, {
      mode: "move",
      paths: selectedList,
      clearSelection: true,
    });
  };

  const deletePaths = async (paths: string[], label?: string) => {
    if (paths.length === 0) return;
    const confirmLabel =
      label ??
      (paths.length === 1
        ? entries.find((e) => e.path === paths[0])?.name ?? "this item"
        : `${paths.length} items`);
    if (!(await pitflixConfirm(`Move ${confirmLabel} to the Recycle Bin?`))) return;
    setFsBusy(true);
    setFsBusyLabel("Moving to Recycle Bin…");
    setScanErr(null);
    try {
      await invoke("device_delete_entries", { paths });
      if (paths.every((p) => selectedPaths.has(p))) exitSelectionMode();
      else {
        setSelectedPaths((prev) => {
          const next = new Set(prev);
          for (const p of paths) next.delete(p);
          return next;
        });
      }
      refreshCurrentDir();
    } catch (e: unknown) {
      setScanErr(e instanceof Error ? e.message : String(e));
    } finally {
      setFsBusy(false);
      setFsBusyLabel(null);
    }
  };

  const deleteSelected = async () => {
    await deletePaths(selectedList);
  };

  const applyEntryRename = async () => {
    if (!entryRename) return;
    const name = entryRename.name.trim();
    if (!name) {
      setEntryRename(null);
      return;
    }
    setFsBusy(true);
    setScanErr(null);
    try {
      const newPath = await invoke<string>("device_rename_entry", {
        path: entryRename.path,
        newName: name,
      });
      const oldKey = normalizePathKey(entryRename.path);
      const nextSaved = saved.map((s) =>
        normalizePathKey(s) === oldKey ? newPath : s,
      );
      if (nextSaved.some((s, i) => s !== saved[i])) {
        setSaved(nextSaved);
        saveSaved(nextSaved);
      }
      if (currentPath && normalizePathKey(currentPath) === oldKey) {
        setCurrentPath(newPath);
      }
      setEntryRename(null);
      refreshCurrentDir();
    } catch (e: unknown) {
      setScanErr(e instanceof Error ? e.message : String(e));
    } finally {
      setFsBusy(false);
    }
  };

  const addSingleToLibrary = useCallback(async (entry: DeviceFsEntry) => {
    if (!isTauri() || entry.is_directory || entry.media_kind !== "video") {
      setScanErr("Only video files can be added to the library.");
      return;
    }
    setScanBusy(true);
    setScanErr(null);
    try {
      const dir = parentDirectory(entry.path);
      await addLibraryPath(dir);
      await startScan({ folders: [dir] });
      void qc.invalidateQueries({ queryKey: ["movies"] });
      void qc.invalidateQueries({ queryKey: ["series"] });
      void qc.invalidateQueries({ queryKey: ["stats"] });
      void qc.invalidateQueries({ queryKey: ["home-movies"] });
      void qc.invalidateQueries({ queryKey: ["home-series"] });
      void qc.invalidateQueries({ queryKey: ["settings"] });
    } catch (e: unknown) {
      setScanErr(e instanceof Error ? e.message : String(e));
    } finally {
      setScanBusy(false);
    }
  }, [qc]);

  const handleContextMenuAction = (action: DeviceContextMenuAction, entry: DeviceFsEntry) => {
    setFolderContextMenu(null);
    switch (action) {
      case "open":
        void openPath(entry.path);
        break;
      case "play":
        void openEntry(entry);
        break;
      case "add-to-library":
        void addSingleToLibrary(entry);
        break;
      case "copy-path":
        void navigator.clipboard.writeText(entry.path).catch(() => {});
        break;
      case "rename":
        setEntryRename({ path: entry.path, name: entry.name });
        break;
      case "delete":
        void deletePaths([entry.path], entry.name);
        break;
    }
  };

  const handleFolderContextAction = (action: DeviceFolderContextMenuAction) => {
    switch (action) {
      case "select":
        if (selectionMode) exitSelectionMode();
        else enterSelectionMode();
        break;
      case "newFolder":
        setNewFolderDraft(suggestNewFolderName(entries));
        setNewFolderOpen(true);
        break;
      case "configure":
        setMediaSettings(getDeviceMediaSettings());
        setMediaConfigureOpen(true);
        break;
    }
  };

  const regenerateThumbnails = useCallback((settings?: DeviceMediaSettings) => {
    if (settings) {
      const saved = saveDeviceMediaSettings(settings);
      setMediaSettings(saved);
    }
    resetPreviewProgress();
    resetThumbnailWarmState();
    clearDeviceThumbnailMemoryCache();
    void clearDeviceThumbnailDiskCache().then(() => {
      if (currentPath && entries.length) {
        const videoPaths = entries
          .filter((e) => !e.is_directory && e.media_kind === "video")
          .map((e) => e.path);
        if (videoPaths.length) scheduleBackgroundThumbnails(videoPaths);
      }
    });
  }, [currentPath, entries]);

  const applyMediaSettings = useCallback((next: DeviceMediaSettings) => {
    regenerateThumbnails(next);
    setMediaConfigureOpen(false);
  }, [regenerateThumbnails]);

  const createNewFolder = async () => {
    if (!currentPath) return;
    const name = newFolderDraft.trim();
    if (!name) {
      setNewFolderOpen(false);
      return;
    }
    setFsBusy(true);
    setFsBusyLabel("Creating folder…");
    setScanErr(null);
    try {
      await invoke("device_create_folder", { parentDir: currentPath, name });
      setNewFolderOpen(false);
      refreshCurrentDir();
    } catch (e: unknown) {
      setScanErr(e instanceof Error ? e.message : String(e));
    } finally {
      setFsBusy(false);
      setFsBusyLabel(null);
    }
  };

  const openBrowseContextMenu = (ev: React.MouseEvent) => {
    const target = ev.target as HTMLElement;
    if (target.closest("[data-device-entry]")) return;
    if (target.closest("button, input, textarea, a, label, [role=slider]")) return;
    ev.preventDefault();
    setContextMenu(null);
    setFolderContextMenu({ x: ev.clientX, y: ev.clientY });
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
      exitSelectionMode();
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

  const openVideoEntry = useCallback((e: DeviceFsEntry) => {
    if (!isTauri() || !isPlayableMedia(e)) return;
    setViewingImage(null);
    // Only offer a real resume for files still in the "last 5 played" slider — anything that's
    // aged out (or was never played) always starts from the beginning. Check membership BEFORE
    // saveLastPlayed bumps this file to the front, so it reflects the list as it was going in.
    const wasRecentlyPlayed = lastPlayedEntries.some((item) => item.path === e.path);
    if (currentPath) saveLastPlayed(currentPath, e.path);
    const scroller = scrollContainerRef.current;
    void openPlayerWindow().catch(() => {});
    void play(
      e.path,
      fileDisplayTitle(e.name),
      null,
      "Movie",
      0,
      {
        returnTo: {
          pathname: "/my-device",
          scrollY: typeof window !== "undefined" ? window.scrollY : undefined,
          mainScrollTop: scroller instanceof HTMLElement ? scroller.scrollTop : undefined,
        },
        suppressContinueWatching: true,
      },
      // undefined → play() computes the real resume position from history, same as everywhere
      // else in the app. `1` is a deliberate "force start at 0" sentinel (see usePlayback.play:
      // preferred > 0 skips the history lookup entirely, and 1 is below the 10s resume threshold).
      wasRecentlyPlayed ? undefined : 1,
    );
  }, [currentPath, play, lastPlayedEntries]);

  const openEntry = async (e: DeviceFsEntry) => {
    if (!isTauri()) return;
    if (selectionMode) {
      if (
        e.is_directory &&
        selectedPaths.size > 0 &&
        !selectedPaths.has(e.path) &&
        canMoveEntriesTo(selectedList, e.path)
      ) {
        const count = selectedList.length;
        const label = count === 1 ? "1 item" : `${count} items`;
        if (await pitflixConfirm(`Move ${label} into "${e.name}"?`)) {
          await moveSelectedTo(e.path);
        }
        return;
      }
      toggleSelected(e.path);
      return;
    }
    if (e.is_directory) { setCurrentPath(e.path); return; }
    if (isPlayableMedia(e)) {
      await openVideoEntry(e);
      return;
    }
    if (e.media_kind === "image") {
      setViewingImage(e);
      return;
    }
    await openPath(e.path);
  };

  const keyboardStateRef = useRef({
    currentPath,
    selectionMode,
    selectedCount: selectedPaths.size,
    shortcutsOpen,
    renamingPath,
    entryRename,
    detailsPath,
    folderPicker,
    contextMenu,
    folderContextMenu,
    newFolderOpen,
    viewingImage,
    fsBusy,
    scanBusy,
  });
  keyboardStateRef.current = {
    currentPath,
    selectionMode,
    selectedCount: selectedPaths.size,
    shortcutsOpen,
    renamingPath,
    entryRename,
    detailsPath,
    folderPicker,
    contextMenu,
    folderContextMenu,
    newFolderOpen,
    viewingImage,
    fsBusy,
    scanBusy,
  };

  const keyboardActionsRef = useRef({
    toggleSelectionMode,
    enterSelectionMode,
    exitSelectionMode,
    selectAllFiltered,
    renameSingleSelected,
    openMovePicker,
    openCopyPicker,
    showDetailsSingleSelected,
    sendToSelected,
    deleteSelected,
    goBackFromBrowse,
  });
  keyboardActionsRef.current = {
    toggleSelectionMode,
    enterSelectionMode,
    exitSelectionMode,
    selectAllFiltered,
    renameSingleSelected,
    openMovePicker,
    openCopyPicker,
    showDetailsSingleSelected,
    sendToSelected,
    deleteSelected,
    goBackFromBrowse,
  };

  const openShortcuts = useCallback(() => setShortcutsOpen(true), []);

  useDeviceKeyboardShortcuts(
    keyboardStateRef,
    keyboardActionsRef,
    filterInputRef,
    openShortcuts,
    isTauri(),
  );

  if (!isTauri()) {
    return (
      <div className="rounded-2xl border border-pitflix-card/50 bg-pitflix-surface/40 p-8 text-center">
        <HardDrive className="mx-auto mb-4 h-12 w-12 text-pitflix-muted" />
        <h1 className="text-xl font-bold text-white">My Device</h1>
        <p className="mt-2 text-sm text-pitflix-muted">
          Browsing folders on your computer is available in the Pitflix desktop app (Tauri).
        </p>
      </div>
    );
  }

  // ── Design tokens ──────────────────────────────────────────────────────────
  const TAB_COLORS = [
    { icon: 'rgba(124,58,237,0.18)', iconBorder: 'rgba(124,58,237,0.32)', iconColor: '#9f7aea' },
    { icon: 'rgba(16,100,52,0.2)',   iconBorder: 'rgba(22,163,74,0.28)',  iconColor: '#4ade80' },
    { icon: 'rgba(14,80,160,0.2)',   iconBorder: 'rgba(37,99,235,0.28)',  iconColor: '#60a5fa' },
    { icon: 'rgba(140,80,20,0.2)',   iconBorder: 'rgba(217,119,6,0.28)',  iconColor: '#fbbf24' },
    { icon: 'rgba(140,20,80,0.2)',   iconBorder: 'rgba(219,39,119,0.28)', iconColor: '#f472b6' },
  ];

  const TYPE_FILTERS: { id: 'all'|'folder'|'video'|'image'|'doc'; label: string }[] = [
    { id: 'all',    label: 'All'     },
    { id: 'folder', label: 'Folders' },
    { id: 'video',  label: 'Videos'  },
    { id: 'image',  label: 'Images'  },
    { id: 'doc',    label: 'Docs'    },
  ];

  const folderCount = entries.filter((e) => e.is_directory).length;
  const fileCount = entries.length - folderCount;

  return (
    <div
      tabIndex={-1}
      className="outline-none"
      style={{
        display: 'flex',
        height: 'calc(100% + 4.5rem)',
        margin: '-3rem -1.5rem -1.5rem',
        overflow: 'hidden',
        background: '#141414',
        fontFamily: "'DM Sans', system-ui, sans-serif",
        color: '#e0e0f0',
      }}
    >
      {/* ── All fixed-position overlays ────────────────────────────────────── */}

      {/* Rename display-label modal */}
      {renamingPath ? (
        <div className="fixed inset-0 z-[70] flex items-center justify-center bg-black/60 px-4 backdrop-blur-sm">
          <div className="w-full max-w-sm rounded-2xl border border-white/10 bg-zinc-900 p-5 shadow-xl">
            <h2 className="text-sm font-semibold text-white">Folder display name</h2>
            <p className="mt-1 text-xs text-pitflix-muted">Shown on this page only. Does not rename the folder on disk.</p>
            <input
              autoFocus
              value={renameDraft}
              onChange={(e) => setRenameDraft(e.target.value)}
              className="mt-4 w-full rounded-xl border border-white/10 bg-black/40 px-3 py-2 text-sm text-white"
              onKeyDown={(e) => { if (e.key === 'Enter') applyRename(); if (e.key === 'Escape') setRenamingPath(null); }}
            />
            <div className="mt-4 flex justify-end gap-2">
              <button type="button" className="rounded-lg px-3 py-2 text-sm text-pitflix-muted hover:text-white" onClick={() => setRenamingPath(null)}>Cancel</button>
              <button type="button" className="rounded-lg bg-pitflix-primary px-4 py-2 text-sm font-medium text-white" onClick={() => applyRename()}>Save</button>
            </div>
          </div>
        </div>
      ) : null}

      {/* Move / Copy picker modal */}
      {folderPicker && currentPath ? (
        <div className="fixed inset-0 z-[70] flex items-center justify-center bg-black/60 px-4 backdrop-blur-sm">
          <div className="flex max-h-[min(70vh,32rem)] w-full max-w-md flex-col rounded-2xl border border-white/10 bg-zinc-900 p-5 shadow-xl">
            <h2 className="text-sm font-semibold text-white">{folderPicker.mode === 'copy' ? 'Copy to folder' : 'Move to folder'}</h2>
            <p className="mt-1 text-xs text-pitflix-muted">Choose a folder inside the current location.</p>
            <div className="mt-4 min-h-0 flex-1 overflow-y-auto">
              {moveTargets.length > 0 ? (
                <div className="flex flex-col gap-1">
                  {moveTargets.map((folder) => (
                    <button
                      key={folder.path}
                      type="button"
                      disabled={fsBusy}
                      onClick={() => void transferToFolder(folder.path, { mode: folderPicker.mode, paths: folderPicker.paths, clearSelection: folderPicker.mode === 'move' && folderPicker.paths.every((p) => selectedPaths.has(p)) })}
                      className="flex items-center gap-3 rounded-xl border border-transparent px-3 py-2.5 text-left text-sm text-white transition hover:border-pitflix-primary/40 hover:bg-white/5 disabled:opacity-40"
                    >
                      <FolderOpen className="h-4 w-4 shrink-0 text-violet-300/90" />
                      <span className="truncate">{folder.name}</span>
                    </button>
                  ))}
                </div>
              ) : (
                <p className="py-6 text-center text-sm text-pitflix-muted">No folders available here.</p>
              )}
            </div>
            <div className="mt-4 flex justify-end">
              <button type="button" className="rounded-lg px-3 py-2 text-sm text-pitflix-muted hover:text-white" onClick={() => setFolderPicker(null)}>Cancel</button>
            </div>
          </div>
        </div>
      ) : null}

      {/* Entry rename modal */}
      {entryRename ? (
        <div className="fixed inset-0 z-[70] flex items-center justify-center bg-black/60 px-4 backdrop-blur-sm">
          <div className="w-full max-w-xl rounded-2xl border border-white/10 bg-zinc-900 p-7 shadow-xl">
            <h2 className="text-lg font-semibold text-white">Rename</h2>
            <p className="mt-1.5 text-sm text-pitflix-muted">Renames the file or folder on disk.</p>
            <input
              autoFocus
              value={entryRename.name}
              onChange={(e) => setEntryRename({ ...entryRename, name: e.target.value })}
              className="mt-5 w-full rounded-xl border border-white/10 bg-black/40 px-4 py-3 text-base text-white"
              onKeyDown={(e) => { if (e.key === 'Enter') void applyEntryRename(); if (e.key === 'Escape') setEntryRename(null); }}
            />
            <div className="mt-6 flex justify-end gap-2">
              <button type="button" className="rounded-lg px-4 py-2.5 text-sm text-pitflix-muted hover:text-white" onClick={() => setEntryRename(null)}>Cancel</button>
              <button type="button" disabled={fsBusy} className="rounded-lg bg-pitflix-primary px-5 py-2.5 text-sm font-medium text-white disabled:opacity-40" onClick={() => void applyEntryRename()}>Save</button>
            </div>
          </div>
        </div>
      ) : null}

      {/* Entry details modal */}
      {detailsPath ? (
        <div className="fixed inset-0 z-[70] flex items-center justify-center bg-black/60 px-4 backdrop-blur-sm">
          <div className="w-full max-w-md rounded-2xl border border-white/10 bg-zinc-900 p-5 shadow-xl">
            <h2 className="text-sm font-semibold text-white">Details</h2>
            {detailsBusy || !entryDetails ? (
              <p className="mt-4 text-sm text-pitflix-muted">Loading…</p>
            ) : (
              <dl className="mt-4 space-y-3 text-sm">
                <div><dt className="text-xs uppercase tracking-wide text-pitflix-muted">Name</dt><dd className="mt-0.5 break-all text-white">{entryDetails.name}</dd></div>
                <div><dt className="text-xs uppercase tracking-wide text-pitflix-muted">Type</dt><dd className="mt-0.5 text-white">{entryDetails.is_directory ? 'Folder' : entryDetails.media_kind === 'video' ? 'Video' : entryDetails.media_kind === 'image' ? 'Image' : 'File'}</dd></div>
                <div>
                  <dt className="text-xs uppercase tracking-wide text-pitflix-muted">{entryDetails.is_directory ? 'Items' : 'Size'}</dt>
                  <dd className="mt-0.5 text-white">{entryDetails.is_directory ? `${entryDetails.child_count ?? 0} item${entryDetails.child_count === 1 ? '' : 's'}` : entryDetails.size_bytes != null ? formatBytes(entryDetails.size_bytes) : '—'}</dd>
                </div>
                <div><dt className="text-xs uppercase tracking-wide text-pitflix-muted">Modified</dt><dd className="mt-0.5 text-white">{formatDeviceTimestamp(entryDetails.modified_ms)}</dd></div>
                <div><dt className="text-xs uppercase tracking-wide text-pitflix-muted">Created</dt><dd className="mt-0.5 text-white">{formatDeviceTimestamp(entryDetails.created_ms)}</dd></div>
                <div><dt className="text-xs uppercase tracking-wide text-pitflix-muted">Location</dt><dd className="mt-0.5 break-all font-mono text-xs text-pitflix-subtle">{entryDetails.path}</dd></div>
              </dl>
            )}
            <div className="mt-5 flex justify-end">
              <button type="button" className="rounded-lg px-3 py-2 text-sm text-pitflix-muted hover:text-white" onClick={() => setDetailsPath(null)}>Close</button>
            </div>
          </div>
        </div>
      ) : null}

      {/* New folder modal */}
      {newFolderOpen ? (
        <div className="fixed inset-0 z-[70] flex items-center justify-center bg-black/60 px-4 backdrop-blur-sm">
          <div className="w-full max-w-sm rounded-2xl border border-white/10 bg-zinc-900 p-5 shadow-xl">
            <h2 className="text-sm font-semibold text-white">New folder</h2>
            <p className="mt-1 text-xs text-pitflix-muted">Create a folder in the current location.</p>
            <input
              autoFocus
              value={newFolderDraft}
              onChange={(e) => setNewFolderDraft(e.target.value)}
              className="mt-4 w-full rounded-xl border border-white/10 bg-black/40 px-3 py-2 text-sm text-white"
              onKeyDown={(e) => { if (e.key === 'Enter') void createNewFolder(); if (e.key === 'Escape') setNewFolderOpen(false); }}
            />
            <div className="mt-4 flex justify-end gap-2">
              <button type="button" className="rounded-lg px-3 py-2 text-sm text-pitflix-muted hover:text-white" onClick={() => setNewFolderOpen(false)}>Cancel</button>
              <button type="button" disabled={fsBusy} className="rounded-lg bg-pitflix-primary px-4 py-2 text-sm font-medium text-white disabled:opacity-40" onClick={() => void createNewFolder()}>Create</button>
            </div>
          </div>
        </div>
      ) : null}

      {/* Context menus */}
      {contextMenu ? (
        <DeviceEntryContextMenu
          entry={contextMenu.entry}
          x={contextMenu.x}
          y={contextMenu.y}
          onAction={(action) => handleContextMenuAction(action, contextMenu.entry)}
          onClose={() => setContextMenu(null)}
        />
      ) : null}
      {folderContextMenu ? (
        <DeviceFolderContextMenu
          x={folderContextMenu.x}
          y={folderContextMenu.y}
          selectionMode={selectionMode}
          onAction={handleFolderContextAction}
          onClose={() => setFolderContextMenu(null)}
        />
      ) : null}

      <DeviceShortcutsModal open={shortcutsOpen} onClose={() => setShortcutsOpen(false)} />

      <DeviceMediaConfigureModal
        open={mediaConfigureOpen}
        settings={mediaSettings}
        onClose={() => setMediaConfigureOpen(false)}
        onSave={applyMediaSettings}
        onRegenerateThumbnails={regenerateThumbnails}
      />

      {viewingImage ? (
        <DeviceImageViewer
          entry={viewingImage}
          items={viewerMediaEntries}
          onClose={() => setViewingImage(null)}
          onChange={setViewingImage}
          onOpenVideo={openVideoEntry}
        />
      ) : null}

      {/* FS busy overlay */}
      {fsBusy ? (
        <div className="pointer-events-none fixed inset-0 z-[90] flex items-center justify-center bg-black/35 backdrop-blur-[1px]">
          <div className="pointer-events-auto rounded-2xl border border-white/10 bg-zinc-900/95 px-6 py-4 text-center shadow-xl">
            <p className="text-sm font-medium text-white">{fsBusyLabel ?? 'Working…'}</p>
            <p className="mt-1 max-w-xs text-xs text-pitflix-muted">Large files copied across drives can take a minute. You can keep using the app.</p>
          </div>
        </div>
      ) : null}

      {/* ── SIDEBAR ────────────────────────────────────────────────────────── */}
      <div style={{
        width: sidebarCollapsed ? 60 : 220,
        flexShrink: 0,
        background: '#141414',
        borderRight: '1px solid rgba(255,255,255,0.07)',
        display: 'flex',
        flexDirection: 'column',
        overflow: 'hidden',
        transition: 'width 0.18s ease',
      }}>
        {/* Header */}
        <div style={{ padding: sidebarCollapsed ? '20px 0 22px' : '20px 18px 22px', borderBottom: '1px solid rgba(255,255,255,0.07)', flexShrink: 0 }}>
          {sidebarCollapsed ? (
            <div style={{ display: 'flex', justifyContent: 'center' }}>
              <button
                type="button"
                onClick={toggleSidebarCollapsed}
                title="Expand sidebar"
                style={{ width: 32, height: 32, borderRadius: 9, background: 'linear-gradient(135deg,#7c3aed,#4f1da3)', border: 'none', cursor: 'pointer', display: 'flex', alignItems: 'center', justifyContent: 'center', color: 'white', flexShrink: 0 }}
              >
                <PanelLeftOpen style={{ width: 15, height: 15 }} />
              </button>
            </div>
          ) : (
            <div style={{ display: 'flex', alignItems: 'center', gap: 9 }}>
              <div style={{ width: 32, height: 32, borderRadius: 9, background: 'linear-gradient(135deg,#7c3aed,#4f1da3)', display: 'flex', alignItems: 'center', justifyContent: 'center', flexShrink: 0 }}>
                <svg width="15" height="15" viewBox="0 0 24 24" fill="none" stroke="white" strokeWidth="2" strokeLinecap="round">
                  <rect x="2" y="3" width="20" height="14" rx="2"/>
                  <line x1="8" y1="21" x2="16" y2="21"/>
                  <line x1="12" y1="17" x2="12" y2="21"/>
                </svg>
              </div>
              <div style={{ flex: 1, minWidth: 0 }}>
                <div style={{ fontSize: 13, fontWeight: 700, letterSpacing: '-0.02em', color: '#e0e0f0' }}>My Device</div>
                <div style={{ fontSize: 9.5, color: 'rgba(200,200,235,0.55)', marginTop: 1 }}>Local storage</div>
              </div>
              {/* Keyboard shortcuts — icon only, next to title */}
              <button
                type="button"
                onClick={() => setShortcutsOpen(true)}
                title="Keyboard shortcuts"
                style={{ width: 26, height: 26, display: 'flex', alignItems: 'center', justifyContent: 'center', borderRadius: 6, background: 'transparent', border: 'none', color: 'rgba(200,200,235,0.65)', cursor: 'pointer', flexShrink: 0, transition: 'color 0.15s, background 0.15s' }}
                onMouseEnter={(e) => { (e.currentTarget as HTMLButtonElement).style.color = '#c4b5fd'; (e.currentTarget as HTMLButtonElement).style.background = 'rgba(124,58,237,0.15)'; }}
                onMouseLeave={(e) => { (e.currentTarget as HTMLButtonElement).style.color = 'rgba(200,200,235,0.65)'; (e.currentTarget as HTMLButtonElement).style.background = 'transparent'; }}
              >
                <Keyboard style={{ width: 13, height: 13 }} />
              </button>
              {/* Collapse sidebar */}
              <button
                type="button"
                onClick={toggleSidebarCollapsed}
                title="Collapse sidebar"
                style={{ width: 26, height: 26, display: 'flex', alignItems: 'center', justifyContent: 'center', borderRadius: 6, background: 'transparent', border: 'none', color: 'rgba(200,200,235,0.65)', cursor: 'pointer', flexShrink: 0, transition: 'color 0.15s, background 0.15s' }}
                onMouseEnter={(e) => { (e.currentTarget as HTMLButtonElement).style.color = '#c4b5fd'; (e.currentTarget as HTMLButtonElement).style.background = 'rgba(124,58,237,0.15)'; }}
                onMouseLeave={(e) => { (e.currentTarget as HTMLButtonElement).style.color = 'rgba(200,200,235,0.65)'; (e.currentTarget as HTMLButtonElement).style.background = 'transparent'; }}
              >
                <PanelLeftClose style={{ width: 13, height: 13 }} />
              </button>
            </div>
          )}
        </div>

        {/* LOCATIONS label */}
        {!sidebarCollapsed ? (
          <div style={{ padding: '16px 18px 8px', flexShrink: 0 }}>
            <div style={{ fontSize: 9, letterSpacing: 2, textTransform: 'uppercase', color: 'rgba(200,200,235,0.55)', fontWeight: 700 }}>Locations</div>
          </div>
        ) : (
          <div style={{ height: 12, flexShrink: 0 }} />
        )}

        {/* Location tabs */}
        <div style={{ flex: 1, overflowY: 'auto', padding: sidebarCollapsed ? '0 8px' : '0 10px' }}>
          {saved.map((p, i) => {
            const isActive = currentPath === p ||
              !!(currentPath && currentPath.startsWith(p.replace(/[/\\]+$/, '') + (p.includes('\\') ? '\\' : '/')));
            const c = TAB_COLORS[i % TAB_COLORS.length];
            return (
              <div
                key={p}
                ref={isActive ? activeFolderChipRef : null}
                title={sidebarCollapsed ? folderLabel(p) : undefined}
                onClick={() => {
                  if (isActive) { setCurrentPath(null); exitSelectionMode(); return; }
                  setCurrentPath(p); setTypeFilter('all'); setFilterText(''); exitSelectionMode();
                }}
                style={{
                  display: 'flex', alignItems: 'center', gap: 9,
                  justifyContent: sidebarCollapsed ? 'center' : 'flex-start',
                  padding: sidebarCollapsed ? '9px 0' : '9px 10px', borderRadius: 8, cursor: 'pointer',
                  background: isActive ? 'rgba(124,58,237,0.1)' : 'transparent',
                  marginBottom: 2, position: 'relative', transition: 'background 0.15s',
                }}
                onMouseEnter={(e) => { if (!isActive) (e.currentTarget as HTMLDivElement).style.background = 'rgba(255,255,255,0.04)'; }}
                onMouseLeave={(e) => { if (!isActive) (e.currentTarget as HTMLDivElement).style.background = 'transparent'; }}
              >
                <div style={{ width: 28, height: 28, borderRadius: 7, background: c.icon, border: `1px solid ${c.iconBorder}`, display: 'flex', alignItems: 'center', justifyContent: 'center', flexShrink: 0, boxShadow: sidebarCollapsed && isActive ? '0 0 0 2px rgba(124,58,237,0.6)' : 'none' }}>
                  <svg width="13" height="13" viewBox="0 0 24 24" fill="none" stroke={c.iconColor} strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round">
                    <path d="M22 19a2 2 0 0 1-2 2H4a2 2 0 0 1-2-2V5a2 2 0 0 1 2-2h5l2 3h9a2 2 0 0 1 2 2z"/>
                  </svg>
                </div>
                {!sidebarCollapsed ? (
                  <>
                    <div style={{ flex: 1, minWidth: 0 }}>
                      <div style={{ fontSize: 12, fontWeight: 600, color: isActive ? '#c4b5fd' : 'rgba(225,225,245,0.88)', whiteSpace: 'nowrap', overflow: 'hidden', textOverflow: 'ellipsis' }}>
                        {folderLabel(p)}
                      </div>
                      <div style={{ fontSize: 10, color: 'rgba(180,180,220,0.55)', marginTop: 1 }}>
                        {isActive ? `${entries.length} items` : '—'}
                      </div>
                    </div>
                    {/* Rename / remove buttons shown on hover via group */}
                    <div style={{ display: 'flex', gap: 2, flexShrink: 0 }}>
                      <button
                        type="button"
                        title="Rename label"
                        onClick={(e) => { e.stopPropagation(); openRename(p); }}
                        style={{ width: 20, height: 20, display: 'flex', alignItems: 'center', justifyContent: 'center', borderRadius: 4, background: 'transparent', border: 'none', cursor: 'pointer', color: 'rgba(200,200,235,0.45)', padding: 0 }}
                        onMouseEnter={(e) => { (e.currentTarget as HTMLButtonElement).style.color = '#e0e0f0'; (e.currentTarget as HTMLButtonElement).style.background = 'rgba(255,255,255,0.08)'; }}
                        onMouseLeave={(e) => { (e.currentTarget as HTMLButtonElement).style.color = 'rgba(200,200,235,0.45)'; (e.currentTarget as HTMLButtonElement).style.background = 'transparent'; }}
                      >
                        <Pencil style={{ width: 10, height: 10 }} />
                      </button>
                      <button
                        type="button"
                        title="Remove location"
                        onClick={(e) => { e.stopPropagation(); removeSaved(p); }}
                        style={{ width: 20, height: 20, display: 'flex', alignItems: 'center', justifyContent: 'center', borderRadius: 4, background: 'transparent', border: 'none', cursor: 'pointer', color: 'rgba(200,200,235,0.45)', padding: 0 }}
                        onMouseEnter={(e) => { (e.currentTarget as HTMLButtonElement).style.color = '#f87171'; (e.currentTarget as HTMLButtonElement).style.background = 'rgba(239,68,68,0.1)'; }}
                        onMouseLeave={(e) => { (e.currentTarget as HTMLButtonElement).style.color = 'rgba(200,200,235,0.45)'; (e.currentTarget as HTMLButtonElement).style.background = 'transparent'; }}
                      >
                        <Trash2 style={{ width: 10, height: 10 }} />
                      </button>
                    </div>
                    {isActive && (
                      <div style={{ width: 3, height: 20, background: '#7c3aed', borderRadius: 3, flexShrink: 0, boxShadow: '0 0 10px rgba(124,58,237,0.8)' }} />
                    )}
                  </>
                ) : null}
              </div>
            );
          })}

          {/* Add location */}
          <div
            onClick={() => void pickFolder()}
            title={sidebarCollapsed ? 'Add location' : undefined}
            style={{ display: 'flex', alignItems: 'center', justifyContent: sidebarCollapsed ? 'center' : 'flex-start', gap: 9, padding: sidebarCollapsed ? '9px 0' : '9px 10px', borderRadius: 8, cursor: 'pointer', border: '1px dashed rgba(255,255,255,0.09)', marginTop: 6, transition: 'border-color 0.15s, background 0.15s' }}
            onMouseEnter={(e) => { (e.currentTarget as HTMLDivElement).style.borderColor = 'rgba(124,58,237,0.38)'; (e.currentTarget as HTMLDivElement).style.background = 'rgba(124,58,237,0.05)'; }}
            onMouseLeave={(e) => { (e.currentTarget as HTMLDivElement).style.borderColor = 'rgba(255,255,255,0.09)'; (e.currentTarget as HTMLDivElement).style.background = 'transparent'; }}
          >
            <div style={{ width: 28, height: 28, borderRadius: 7, background: 'rgba(255,255,255,0.03)', display: 'flex', alignItems: 'center', justifyContent: 'center', flexShrink: 0 }}>
              <svg width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="rgba(200,200,235,0.6)" strokeWidth="2.3" strokeLinecap="round">
                <line x1="12" y1="5" x2="12" y2="19"/><line x1="5" y1="12" x2="19" y2="12"/>
              </svg>
            </div>
            {!sidebarCollapsed ? (
              <div style={{ fontSize: 12, color: 'rgba(200,200,235,0.65)', fontWeight: 500 }}>Add location</div>
            ) : null}
          </div>
        </div>

      </div>

      {/* ── MAIN PANEL ─────────────────────────────────────────────────────── */}
      <div style={{ flex: 1, display: 'flex', flexDirection: 'column', overflow: 'hidden', background: '#141414', minWidth: 0 }}>

        {/* Top bar — only when browsing a folder */}
        {currentPath ? (
          <div style={{ flexShrink: 0, padding: '14px 7rem 14px 24px', display: 'flex', alignItems: 'center', gap: 12, borderBottom: '1px solid rgba(255,255,255,0.07)', background: '#141414' }}>
            {/* Back + breadcrumb */}
            <div style={{ display: 'flex', alignItems: 'center', gap: 5, flex: 1, minWidth: 0 }}>
              <button
                type="button"
                onClick={() => goBackFromBrowse()}
                style={{ width: 28, height: 28, borderRadius: 7, background: 'rgba(255,255,255,0.04)', border: '1px solid rgba(255,255,255,0.07)', color: 'rgba(180,180,220,0.5)', display: 'flex', alignItems: 'center', justifyContent: 'center', cursor: 'pointer', flexShrink: 0, transition: 'all 0.15s' }}
                onMouseEnter={(e) => { (e.currentTarget as HTMLButtonElement).style.background = 'rgba(255,255,255,0.08)'; (e.currentTarget as HTMLButtonElement).style.color = '#e0e0f0'; }}
                onMouseLeave={(e) => { (e.currentTarget as HTMLButtonElement).style.background = 'rgba(255,255,255,0.04)'; (e.currentTarget as HTMLButtonElement).style.color = 'rgba(180,180,220,0.5)'; }}
              >
                <svg width="13" height="13" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.2" strokeLinecap="round">
                  <path d="M19 12H5"/><path d="M12 5l-7 7 7 7"/>
                </svg>
              </button>
              <svg width="8" height="8" viewBox="0 0 24 24" fill="none" stroke="rgba(180,180,220,0.22)" strokeWidth="2" strokeLinecap="round" style={{ flexShrink: 0 }}>
                <polyline points="9 18 15 12 9 6"/>
              </svg>
              <span style={{ fontSize: 12.5, fontWeight: 600, color: 'rgba(224,224,240,0.8)', overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>
                {currentPath.replace(/[/\\]+$/, '').split(/[/\\]/).pop() ?? currentPath}
              </span>
            </div>

            {/* Search */}
            <div style={{ display: 'flex', alignItems: 'center', gap: 8, background: 'rgba(255,255,255,0.04)', border: '1px solid rgba(255,255,255,0.07)', borderRadius: 8, padding: '7px 12px', width: 220, flexShrink: 0 }}>
              <svg width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="rgba(180,180,220,0.28)" strokeWidth="2" strokeLinecap="round">
                <circle cx="11" cy="11" r="8"/><line x1="21" y1="21" x2="16.65" y2="16.65"/>
              </svg>
              <input
                ref={filterInputRef}
                type="search"
                placeholder="Search files…"
                value={filterText}
                onChange={(e) => setFilterText(e.target.value)}
                style={{ background: 'transparent', border: 'none', color: '#e0e0f0', fontSize: 12, fontFamily: 'inherit', width: '100%', outline: 'none' }}
              />
            </div>

            {/* Grid size slider */}
            <div style={{ display: 'flex', alignItems: 'center', gap: 8, flexShrink: 0 }}>
              <svg width="11" height="11" viewBox="0 0 24 24" fill="none" stroke="rgba(180,180,220,0.25)" strokeWidth="2">
                <rect x="3" y="3" width="7" height="7"/><rect x="14" y="3" width="7" height="7"/><rect x="3" y="14" width="7" height="7"/><rect x="14" y="14" width="7" height="7"/>
              </svg>
              <input
                type="range"
                min={GRID_COLS_MIN}
                max={GRID_COLS_MAX}
                value={gridCols}
                onChange={(e) => setGridColsPersist(Number(e.target.value))}
                style={{ width: 70, WebkitAppearance: 'none', appearance: 'none', background: 'rgba(255,255,255,0.07)', height: 3, borderRadius: 2, cursor: 'pointer', accentColor: '#7c3aed' }}
              />
              <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="rgba(180,180,220,0.25)" strokeWidth="2">
                <rect x="3" y="3" width="4" height="4"/><rect x="10" y="3" width="4" height="4"/><rect x="17" y="3" width="4" height="4"/>
                <rect x="3" y="10" width="4" height="4"/><rect x="10" y="10" width="4" height="4"/><rect x="17" y="10" width="4" height="4"/>
                <rect x="3" y="17" width="4" height="4"/><rect x="10" y="17" width="4" height="4"/><rect x="17" y="17" width="4" height="4"/>
              </svg>
            </div>

            {/* Filter by type — icon button + dropdown */}
            <div ref={filterMenuRef} style={{ position: 'relative', flexShrink: 0 }}>
              <button
                type="button"
                onClick={() => setFilterMenuOpen((v) => !v)}
                title="Filter by type"
                style={{
                  width: 32, height: 32, display: 'flex', alignItems: 'center', justifyContent: 'center',
                  borderRadius: 8, cursor: 'pointer', flexShrink: 0, transition: 'all 0.15s',
                  background: typeFilter !== 'all' ? 'rgba(124,58,237,0.18)' : 'rgba(255,255,255,0.04)',
                  border: `1px solid ${typeFilter !== 'all' ? 'rgba(124,58,237,0.4)' : 'rgba(255,255,255,0.07)'}`,
                  color: typeFilter !== 'all' ? '#c4b5fd' : 'rgba(180,180,220,0.6)',
                }}
                onMouseEnter={(e) => { if (typeFilter === 'all') (e.currentTarget as HTMLButtonElement).style.background = 'rgba(255,255,255,0.08)'; }}
                onMouseLeave={(e) => { if (typeFilter === 'all') (e.currentTarget as HTMLButtonElement).style.background = 'rgba(255,255,255,0.04)'; }}
              >
                <Filter style={{ width: 14, height: 14 }} />
              </button>
              {filterMenuOpen ? (
                <div style={{
                  position: 'absolute', top: '120%', right: 0, zIndex: 60,
                  background: '#1C1C1C', border: '1px solid rgba(255,255,255,0.1)', borderRadius: 10,
                  padding: 5, minWidth: 150, boxShadow: '0 20px 50px rgba(0,0,0,0.65)',
                  animation: 'deviceMenuPop 0.14s ease',
                }}>
                  {TYPE_FILTERS.map((tf) => {
                    const active = typeFilter === tf.id;
                    return (
                      <div
                        key={tf.id}
                        onClick={() => { setTypeFilter(tf.id); setFilterMenuOpen(false); }}
                        style={{
                          display: 'flex', alignItems: 'center', justifyContent: 'space-between', gap: 10,
                          padding: '7px 10px', borderRadius: 7, cursor: 'pointer', fontSize: 12,
                          fontWeight: 600, color: active ? '#c4b5fd' : 'rgba(224,224,240,0.82)',
                          background: active ? 'rgba(124,58,237,0.14)' : 'transparent',
                          transition: 'background 0.1s',
                        }}
                        onMouseEnter={(e) => { if (!active) (e.currentTarget as HTMLDivElement).style.background = 'rgba(255,255,255,0.06)'; }}
                        onMouseLeave={(e) => { if (!active) (e.currentTarget as HTMLDivElement).style.background = 'transparent'; }}
                      >
                        {tf.label}
                        {active ? <Check style={{ width: 12, height: 12 }} /> : null}
                      </div>
                    );
                  })}
                </div>
              ) : null}
            </div>

            {/* Select mode toggle — icon only */}
            <button
              type="button"
              onClick={toggleSelectionMode}
              title={selectionMode ? 'Cancel select' : 'Select items'}
              style={{
                width: 32, height: 32, display: 'flex', alignItems: 'center', justifyContent: 'center',
                borderRadius: 8, cursor: 'pointer', flexShrink: 0, transition: 'all 0.15s',
                background: selectionMode ? 'rgba(124,58,237,0.18)' : 'rgba(255,255,255,0.04)',
                border: `1px solid ${selectionMode ? 'rgba(124,58,237,0.4)' : 'rgba(255,255,255,0.07)'}`,
                color: selectionMode ? '#c4b5fd' : 'rgba(180,180,220,0.6)',
              }}
              onMouseEnter={(e) => { if (!selectionMode) (e.currentTarget as HTMLButtonElement).style.background = 'rgba(255,255,255,0.08)'; }}
              onMouseLeave={(e) => { if (!selectionMode) (e.currentTarget as HTMLButtonElement).style.background = 'rgba(255,255,255,0.04)'; }}
            >
              <CheckSquare style={{ width: 14, height: 14 }} />
            </button>

            {/* Add folder button — icon only */}
            <button
              type="button"
              onClick={() => { setNewFolderDraft(suggestNewFolderName(entries)); setNewFolderOpen(true); }}
              title="Add folder"
              style={{ width: 32, height: 32, display: 'flex', alignItems: 'center', justifyContent: 'center', background: 'linear-gradient(135deg,#7c3aed,#5b21b6)', color: 'white', border: 'none', borderRadius: 8, cursor: 'pointer', flexShrink: 0, boxShadow: '0 4px 20px rgba(124,58,237,0.32)', transition: 'transform 0.1s, box-shadow 0.15s' }}
              onMouseEnter={(e) => { (e.currentTarget as HTMLButtonElement).style.transform = 'translateY(-1px)'; (e.currentTarget as HTMLButtonElement).style.boxShadow = '0 6px 24px rgba(124,58,237,0.45)'; }}
              onMouseLeave={(e) => { (e.currentTarget as HTMLButtonElement).style.transform = 'translateY(0)'; (e.currentTarget as HTMLButtonElement).style.boxShadow = '0 4px 20px rgba(124,58,237,0.32)'; }}
            >
              <FolderPlus style={{ width: 14, height: 14 }} />
            </button>
          </div>
        ) : null}

        {/* SELECT ACTION BAR */}
        {currentPath && selectionMode ? (
          <div style={{ flexShrink: 0, display: 'flex', alignItems: 'center', gap: 8, padding: '9px 24px', borderBottom: '1px solid rgba(255,255,255,0.07)', background: '#1C1C1C', flexWrap: 'wrap' }}>
            <button type="button" onClick={toggleSelectionMode}
              style={{ display: 'flex', alignItems: 'center', gap: 7, background: '#2A2A2A', color: '#e0e0f0', border: '1px solid rgba(255,255,255,0.12)', borderRadius: 8, padding: '8px 14px', fontSize: 12.5, fontWeight: 700, fontFamily: 'inherit', cursor: 'pointer', flexShrink: 0, transition: 'background 0.15s' }}
              onMouseEnter={(e) => { (e.currentTarget as HTMLButtonElement).style.background = '#333'; }}
              onMouseLeave={(e) => { (e.currentTarget as HTMLButtonElement).style.background = '#2A2A2A'; }}
            >
              Cancel select
            </button>
            <button type="button" disabled={fsBusy || selectedPaths.size === 0} onClick={openMovePicker}
              style={{ display: 'flex', alignItems: 'center', gap: 7, background: '#2A2A2A', color: '#e0e0f0', border: '1px solid rgba(255,255,255,0.1)', borderRadius: 8, padding: '8px 14px', fontSize: 12.5, fontWeight: 600, fontFamily: 'inherit', cursor: 'pointer', flexShrink: 0, transition: 'background 0.15s', opacity: (fsBusy || selectedPaths.size === 0) ? 0.4 : 1 }}
              onMouseEnter={(e) => { if (!(fsBusy || selectedPaths.size === 0)) (e.currentTarget as HTMLButtonElement).style.background = '#333'; }}
              onMouseLeave={(e) => { (e.currentTarget as HTMLButtonElement).style.background = '#2A2A2A'; }}
            >
              <FolderInput style={{ width: 13, height: 13 }} />
              Move ({selectedPaths.size})
            </button>
            <button type="button" disabled={fsBusy || selectedPaths.size === 0} onClick={() => void sendToSelected()}
              style={{ display: 'flex', alignItems: 'center', gap: 7, background: '#2A2A2A', color: '#e0e0f0', border: '1px solid rgba(255,255,255,0.1)', borderRadius: 8, padding: '8px 14px', fontSize: 12.5, fontWeight: 600, fontFamily: 'inherit', cursor: 'pointer', flexShrink: 0, transition: 'background 0.15s', opacity: (fsBusy || selectedPaths.size === 0) ? 0.4 : 1 }}
              onMouseEnter={(e) => { if (!(fsBusy || selectedPaths.size === 0)) (e.currentTarget as HTMLButtonElement).style.background = '#333'; }}
              onMouseLeave={(e) => { (e.currentTarget as HTMLButtonElement).style.background = '#2A2A2A'; }}
            >
              <Send style={{ width: 13, height: 13 }} />
              Send to ({selectedPaths.size})
            </button>
            <button type="button" disabled={fsBusy || selectedPaths.size === 0} onClick={() => void deleteSelected()}
              style={{ display: 'flex', alignItems: 'center', gap: 7, background: 'rgba(239,68,68,0.08)', color: '#f87171', border: '1px solid rgba(239,68,68,0.25)', borderRadius: 8, padding: '8px 14px', fontSize: 12.5, fontWeight: 600, fontFamily: 'inherit', cursor: 'pointer', flexShrink: 0, transition: 'background 0.15s', opacity: (fsBusy || selectedPaths.size === 0) ? 0.4 : 1 }}
              onMouseEnter={(e) => { if (!(fsBusy || selectedPaths.size === 0)) (e.currentTarget as HTMLButtonElement).style.background = 'rgba(239,68,68,0.15)'; }}
              onMouseLeave={(e) => { (e.currentTarget as HTMLButtonElement).style.background = 'rgba(239,68,68,0.08)'; }}
            >
              <Trash2 style={{ width: 13, height: 13 }} />
              Delete ({selectedPaths.size})
            </button>
            <button type="button" disabled={scanBusy || selectedPaths.size === 0} onClick={() => void scanSelectedIntoLibrary()}
              style={{ display: 'flex', alignItems: 'center', gap: 7, background: '#7c3aed', color: 'white', border: 'none', borderRadius: 8, padding: '8px 16px', fontSize: 12.5, fontWeight: 700, fontFamily: 'inherit', cursor: 'pointer', flexShrink: 0, boxShadow: '0 4px 16px rgba(124,58,237,0.35)', transition: 'background 0.15s', opacity: (scanBusy || selectedPaths.size === 0) ? 0.4 : 1 }}
              onMouseEnter={(e) => { if (!(scanBusy || selectedPaths.size === 0)) (e.currentTarget as HTMLButtonElement).style.background = '#6d28d9'; }}
              onMouseLeave={(e) => { (e.currentTarget as HTMLButtonElement).style.background = '#7c3aed'; }}
            >
              {scanBusy ? 'Scanning…' : `Add to library (${selectedPaths.size})`}
            </button>
            <div style={{ flex: 1 }} />
            <span style={{ fontSize: 11.5, color: 'rgba(180,180,220,0.4)', fontStyle: 'italic' }}>
              Tap items to select. Tap a folder to move into it, or use Send to for any folder.
            </span>
          </div>
        ) : null}

        {/* Error message */}
        {err ? (
          <div style={{ flexShrink: 0, padding: '6px 24px' }}>
            <p style={{ fontSize: 12, color: '#f87171' }}>{err}</p>
          </div>
        ) : null}

        {/* Scrollable content area */}
        <div
          ref={scrollContainerRef}
          style={{ flex: 1, overflowY: 'auto', position: 'relative' }}
          onScroll={notifyScroll}
          onContextMenu={currentPath ? openBrowseContextMenu : undefined}
        >
          {currentPath ? (
            <div style={{ padding: '16px 24px 32px' }}>

              {/* Loading indicator */}
              {busy ? <p style={{ fontSize: 12, color: 'rgba(180,180,220,0.4)', marginBottom: 16 }}>Loading…</p> : null}

              {/* ── Last played slider ──────────────────────────────────── */}
              {!busy && !selectionMode && lastPlayedEntries.length > 0 ? (
                <div style={{ marginBottom: 14, position: 'relative' }}>
                  <div style={{ fontSize: 9, letterSpacing: 2, textTransform: 'uppercase', color: '#7c3aed', fontWeight: 700, marginBottom: 8, paddingLeft: 2 }}>
                    Resume where you left off
                  </div>
                  <div style={{ position: 'relative' }}>
                    {resumeSliderScroll.canLeft ? (
                      <button
                        type="button"
                        aria-label="Scroll left"
                        onClick={() => scrollResumeSlider(-1)}
                        style={{
                          position: 'absolute', left: -4, top: '50%', transform: 'translateY(-50%)', zIndex: 2,
                          width: 30, height: 30, borderRadius: '50%', border: '1px solid rgba(124,58,237,0.35)',
                          background: 'rgba(15,15,20,0.92)', color: '#e0e0f0', display: 'flex', alignItems: 'center',
                          justifyContent: 'center', cursor: 'pointer', boxShadow: '0 4px 12px rgba(0,0,0,0.4)',
                        }}
                      >
                        <ChevronLeft style={{ width: 16, height: 16 }} />
                      </button>
                    ) : null}

                    <div
                      ref={resumeSliderRef}
                      onScroll={updateResumeSliderScroll}
                      style={{
                        display: 'flex',
                        gap: 12,
                        overflowX: 'auto',
                        scrollSnapType: 'x proximity',
                        paddingBottom: 4,
                        scrollbarWidth: 'none',
                      }}
                      className="scrollbar-hide"
                    >
                      {lastPlayedEntries.map((item) => (
                        <div
                          key={item.path}
                          style={{
                            scrollSnapAlign: 'start',
                            flex: '0 0 auto',
                            width: 260,
                            background: 'linear-gradient(to right,rgba(124,58,237,0.12),rgba(124,58,237,0.03))',
                            border: '1px solid rgba(124,58,237,0.22)',
                            borderRadius: 12,
                            display: 'flex',
                            alignItems: 'center',
                            gap: 10,
                            padding: '10px 12px',
                            position: 'relative',
                            overflow: 'hidden',
                            cursor: 'pointer',
                            transition: 'transform 0.12s ease-out, border-color 0.12s ease-out',
                          }}
                          onClick={() => void openEntry(item)}
                          onMouseEnter={(ev) => {
                            (ev.currentTarget as HTMLDivElement).style.transform = 'translateY(-2px)';
                            (ev.currentTarget as HTMLDivElement).style.borderColor = 'rgba(124,58,237,0.5)';
                          }}
                          onMouseLeave={(ev) => {
                            (ev.currentTarget as HTMLDivElement).style.transform = 'translateY(0)';
                            (ev.currentTarget as HTMLDivElement).style.borderColor = 'rgba(124,58,237,0.22)';
                          }}
                        >
                          <div style={{ position: 'absolute', left: 0, top: 0, bottom: 0, width: 3, background: '#7c3aed', borderRadius: '3px 0 0 3px' }} />
                          <div style={{ width: 48, height: 32, background: '#1C1C1C', borderRadius: 7, display: 'flex', alignItems: 'center', justifyContent: 'center', flexShrink: 0, border: '1px solid rgba(124,58,237,0.2)', overflow: 'hidden' }}>
                            <LazyFolderThumb mode="video" path={item.path} />
                          </div>
                          <div style={{ flex: 1, minWidth: 0 }}>
                            <div style={{ fontSize: 12.5, fontWeight: 600, whiteSpace: 'nowrap', overflow: 'hidden', textOverflow: 'ellipsis', color: '#e0e0f0' }}>{fileDisplayTitle(item.name)}</div>
                          </div>
                          <button
                            type="button"
                            onClick={(ev) => { ev.stopPropagation(); void openEntry(item); }}
                            aria-label={`Resume ${fileDisplayTitle(item.name)}`}
                            style={{ background: '#7c3aed', color: 'white', border: 'none', borderRadius: 7, width: 30, height: 30, display: 'flex', alignItems: 'center', justifyContent: 'center', fontSize: 12, cursor: 'pointer', flexShrink: 0 }}
                          >
                            ▶
                          </button>
                        </div>
                      ))}
                    </div>

                    {resumeSliderScroll.canRight ? (
                      <button
                        type="button"
                        aria-label="Scroll right"
                        onClick={() => scrollResumeSlider(1)}
                        style={{
                          position: 'absolute', right: -4, top: '50%', transform: 'translateY(-50%)', zIndex: 2,
                          width: 30, height: 30, borderRadius: '50%', border: '1px solid rgba(124,58,237,0.35)',
                          background: 'rgba(15,15,20,0.92)', color: '#e0e0f0', display: 'flex', alignItems: 'center',
                          justifyContent: 'center', cursor: 'pointer', boxShadow: '0 4px 12px rgba(0,0,0,0.4)',
                        }}
                      >
                        <ChevronRight style={{ width: 16, height: 16 }} />
                      </button>
                    ) : null}
                  </div>
                </div>
              ) : null}

              {/* Search results count */}
              {filterText && !busy ? (
                <p style={{ fontSize: 10.5, color: 'rgba(180,180,220,0.3)', marginBottom: 8 }}>
                  {filtered.length} result{filtered.length !== 1 ? 's' : ''}
                </p>
              ) : null}

              {/* ── Virtual grid ────────────────────────────────────────── */}
              <div
                ref={gridContainerRef}
                style={{ height: `${virtualizer.getTotalSize()}px`, position: 'relative' }}
              >
                {virtualizer.getVirtualItems().map((virtualRow) => (
                  <div
                    key={virtualRow.key}
                    data-index={virtualRow.index}
                    ref={virtualizer.measureElement}
                    style={{ position: 'absolute', top: 0, left: 0, width: '100%', transform: `translateY(${virtualRow.start - scrollMargin}px)` }}
                  >
                    <div style={{ display: 'grid', gridTemplateColumns: `repeat(${effectiveCols}, minmax(0, 1fr))`, gap: `${GRID_GAP}px`, paddingBottom: 3 }}>
                      {rows[virtualRow.index].map((e) => {
                        const isSelected = selectionMode && selectedPaths.has(e.path);
                        const isMoveTarget =
                          selectionMode && e.is_directory && selectedPaths.size > 0 &&
                          !selectedPaths.has(e.path) && canMoveEntriesTo(selectedList, e.path);

                        const thumbH = Math.max(80, Math.round(120 - (effectiveCols - 3) * 8));
                        const thumbBg = e.is_directory
                          ? 'linear-gradient(160deg,rgba(124,58,237,0.07),rgba(124,58,237,0.02))'
                          : '#1C1C1C';

                        return (
                          <button
                            key={e.path}
                            type="button"
                            data-device-entry
                            onClick={() => void openEntry(e)}
                            onContextMenu={(ev) => {
                              ev.preventDefault(); ev.stopPropagation();
                              setFolderContextMenu(null);
                              setContextMenu({ entry: e, x: ev.clientX, y: ev.clientY });
                            }}
                            style={{
                              borderRadius: 10, overflow: 'hidden', cursor: 'pointer', position: 'relative',
                              background: '#1C1C1C',
                              border: `1px solid ${isSelected ? 'rgba(124,58,237,0.7)' : isMoveTarget ? 'rgba(124,58,237,0.35)' : 'rgba(255,255,255,0.07)'}`,
                              textAlign: 'left', transition: 'transform 0.15s, box-shadow 0.15s, border-color 0.15s',
                            }}
                            onMouseEnter={(ev) => {
                              (ev.currentTarget as HTMLButtonElement).style.transform = 'translateY(-2px)';
                              (ev.currentTarget as HTMLButtonElement).style.boxShadow = '0 12px 36px rgba(0,0,0,0.55)';
                              (ev.currentTarget as HTMLButtonElement).style.borderColor = 'rgba(124,58,237,0.3)';
                            }}
                            onMouseLeave={(ev) => {
                              (ev.currentTarget as HTMLButtonElement).style.transform = 'translateY(0)';
                              (ev.currentTarget as HTMLButtonElement).style.boxShadow = 'none';
                              (ev.currentTarget as HTMLButtonElement).style.borderColor = isSelected ? 'rgba(124,58,237,0.7)' : isMoveTarget ? 'rgba(124,58,237,0.35)' : 'rgba(255,255,255,0.06)';
                            }}
                          >
                            {/* Selection highlight overlay */}
                            {isSelected ? (
                              <div style={{ position: 'absolute', inset: 0, background: 'rgba(124,58,237,0.1)', border: '2px solid rgba(124,58,237,0.7)', borderRadius: 10, zIndex: 4, pointerEvents: 'none' }} />
                            ) : null}

                            {/* Selection checkbox */}
                            {selectionMode ? (
                              <div style={{
                                position: 'absolute', top: 7, left: 7, width: 20, height: 20, borderRadius: '50%', zIndex: 5,
                                display: 'flex', alignItems: 'center', justifyContent: 'center', pointerEvents: 'none',
                                background: isSelected ? '#7c3aed' : 'rgba(0,0,0,0.45)',
                                border: isSelected ? 'none' : '1.5px solid rgba(255,255,255,0.25)',
                                boxShadow: isSelected ? '0 2px 8px rgba(124,58,237,0.6)' : 'none',
                                transition: 'all 0.15s',
                              }}>
                                {isSelected ? <Check style={{ width: 10, height: 10, color: 'white', strokeWidth: 3 }} /> : null}
                              </div>
                            ) : null}

                            {/* Move target hint */}
                            {isMoveTarget ? (
                              <div className="device-move-hint" style={{ position: 'absolute', right: 6, top: 6, zIndex: 5, background: 'rgba(0,0,0,0.7)', color: '#c4b5fd', fontSize: 9, fontWeight: 700, padding: '2px 6px', borderRadius: 4, opacity: 0, transition: 'opacity 0.15s' }}>
                                Move here
                              </div>
                            ) : null}

                            {/* Thumbnail */}
                            <div style={{ height: thumbH, background: thumbBg, display: 'flex', alignItems: 'center', justifyContent: 'center', position: 'relative', overflow: 'hidden' }}>
                              {e.is_directory ? (
                                <svg width="40" height="36" viewBox="0 0 40 36" fill="none">
                                  <path d="M2 5C2 3.34 3.34 2 5 2H15L19 8H35C36.66 8 38 9.34 38 11V31C38 32.66 36.66 34 35 34H5C3.34 34 2 32.66 2 31V5Z" fill="rgba(124,58,237,0.15)" stroke="rgba(124,58,237,0.45)" strokeWidth="1.4"/>
                                  <path d="M2 14H38" stroke="rgba(124,58,237,0.15)" strokeWidth="1"/>
                                </svg>
                              ) : e.media_kind === 'image' ? (
                                <LazyFolderThumb mode="image" path={e.path} />
                              ) : e.media_kind === 'video' ? (
                                <DeviceVideoHoverPreview path={e.path}>
                                  <LazyFolderThumb mode="video" path={e.path} />
                                </DeviceVideoHoverPreview>
                              ) : (
                                <svg width="24" height="30" viewBox="0 0 24 30" fill="none" stroke="rgba(180,180,220,0.2)" strokeWidth="1.4" strokeLinecap="round">
                                  <path d="M14 2H6a2 2 0 0 0-2 2v24a2 2 0 0 0 2 2h16a2 2 0 0 0 2-2V8z"/>
                                  <polyline points="14 2 14 8 20 8"/>
                                </svg>
                              )}
                            </div>

                            {/* Name strip */}
                            <div style={{ padding: '7px 9px 8px' }}>
                              <div style={{ fontSize: 11, fontWeight: 500, color: '#c0c0d8', whiteSpace: 'nowrap', overflow: 'hidden', textOverflow: 'ellipsis', lineHeight: 1.3, transition: 'color 0.15s' }}>
                                {e.name}
                              </div>
                              {(e.media_kind === 'video' || e.media_kind === 'image') ? (
                                <div style={{ fontSize: 9.5, color: 'rgba(180,180,220,0.28)', marginTop: 2 }}>
                                  {e.media_kind === 'video' ? 'Video' : 'Image'}
                                </div>
                              ) : null}
                            </div>
                          </button>
                        );
                      })}
                    </div>
                  </div>
                ))}
              </div>

              {/* Empty state */}
              {!busy && filtered.length === 0 ? (
                <div style={{ display: 'flex', flexDirection: 'column', alignItems: 'center', justifyContent: 'center', padding: '80px 20px', color: 'rgba(180,180,220,0.3)' }}>
                  <svg width="36" height="36" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.3" strokeLinecap="round" style={{ marginBottom: 12, opacity: 0.5 }}>
                    <circle cx="11" cy="11" r="8"/><line x1="21" y1="21" x2="16.65" y2="16.65"/>
                  </svg>
                  <div style={{ fontSize: 13 }}>
                    {filterText ? `Nothing matches "${filterText}"` : entries.length === 0 ? 'This folder is empty.' : `No ${typeFilter}s in this folder.`}
                  </div>
                </div>
              ) : null}
            </div>
          ) : (
            /* Empty / welcome state when no folder selected */
            <div style={{ display: 'flex', flexDirection: 'column', alignItems: 'center', justifyContent: 'center', height: '100%', gap: 16, color: 'rgba(180,180,220,0.3)', textAlign: 'center', padding: '0 40px' }}>
              <svg width="48" height="48" viewBox="0 0 24 24" fill="none" stroke="rgba(124,58,237,0.3)" strokeWidth="1.2" strokeLinecap="round">
                <path d="M22 19a2 2 0 0 1-2 2H4a2 2 0 0 1-2-2V5a2 2 0 0 1 2-2h5l2 3h9a2 2 0 0 1 2 2z"/>
              </svg>
              <div>
                <p style={{ fontSize: 14, fontWeight: 600, color: 'rgba(180,180,220,0.45)', marginBottom: 6 }}>
                  {saved.length === 0 ? 'No locations yet' : 'Select a location'}
                </p>
                <p style={{ fontSize: 12, color: 'rgba(180,180,220,0.28)' }}>
                  {saved.length === 0
                    ? 'Use "Add location" in the sidebar to bookmark a folder.'
                    : 'Pick a location from the sidebar to browse its files.'}
                </p>
              </div>
            </div>
          )}
        </div>

        {/* ── Status bar ──────────────────────────────────────────────────── */}
        {currentPath && !busy ? (
          <div style={{ flexShrink: 0, padding: '7px 24px', borderTop: '1px solid rgba(255,255,255,0.04)', display: 'flex', alignItems: 'center', gap: 10 }}>
            <div style={{ fontSize: 10.5, color: 'rgba(180,180,220,0.3)' }}>{entries.length} items</div>
            <div style={{ width: 1, height: 10, background: 'rgba(255,255,255,0.07)' }} />
            <div style={{ fontSize: 10.5, color: 'rgba(180,180,220,0.3)' }}>{folderCount} folders · {fileCount} files</div>
          </div>
        ) : null}
      </div>
    </div>
  );
}
