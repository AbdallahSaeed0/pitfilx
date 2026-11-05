import { invoke, isTauri } from "@tauri-apps/api/core";
import { listen, type UnlistenFn } from "@tauri-apps/api/event";
import { open } from "@tauri-apps/plugin-dialog";
import { openPath, revealItemInDir } from "@tauri-apps/plugin-opener";
import { useQuery, useQueryClient } from "@tanstack/react-query";
import { useVirtualizer } from "@tanstack/react-virtual";
import { Check, CheckSquare, ChevronLeft, ChevronRight, Clock, Dices, Filter, Film, FolderInput, FolderOpen, FolderPlus, HardDrive, Heart, Keyboard, Lock, PanelLeftClose, PanelLeftOpen, Pencil, Search, Send, Trash2, X, Zap } from "lucide-react";
import {
  useCallback,
  useEffect,
  useLayoutEffect,
  useMemo,
  useRef,
  useState,
} from "react";
import { useLocation } from "react-router-dom";
import { addLibraryPath } from "../api/settings";
import { startScan } from "../api/scan";
import { openPlayerWindow } from "../api/player";
import { DeviceImageViewer } from "../features/device/DeviceImageViewer";
import { cancelBackgroundImages, cancelBackgroundThumbnails, DeviceVideoHoverPreview, isDeviceScrolling, LazyFolderThumb, notifyScroll, resetPreviewProgress, resetThumbnailWarmState, scheduleBackgroundImages, scheduleBackgroundThumbnails } from "../features/device/DeviceThumbs";
import { DeviceRouletteModal } from "../features/device/DeviceRouletteModal";
import {
  DeviceEntryContextMenu,
  type DeviceContextMenuAction,
} from "../features/device/DeviceEntryContextMenu";
import {
  DeviceFolderContextMenu,
  type DeviceFolderContextMenuAction,
} from "../features/device/DeviceFolderContextMenu";
import { DeviceShortcutsModal } from "../features/device/DeviceShortcutsModal";
import { AddToCollectionModal, CollectionsPanel, OPEN_COLLECTION_EVENT } from "../features/device/CollectionsPanel";
import { stageCollectionViewById } from "../features/device/PlayerVideoCollectionsSection";
import { DeviceFavoritesPanel, DeviceHistoryPanel } from "../features/device/DeviceSavedItemsPanel";
import { DeviceDurationBadge } from "../features/device/DeviceDurationBadge";
import { DeviceGlobalSearchPanel } from "../features/device/DeviceGlobalSearchPanel";
import { getVideoDuration, requestVideoDurations, useVideoDurationsVersion } from "../features/device/deviceDurations";
import { DeviceMoveNavigatorModal } from "../features/device/DeviceMoveNavigatorModal";
import { DeviceQuickSortModal } from "../features/device/DeviceQuickSortModal";
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
  isPathInside,
  isPlayableMedia,
  isSavedRootPath,
  canMoveEntriesTo,
  loadGridCols,
  loadLastPlayedFilePaths,
  loadPrivateFolders,
  loadSaved,
  loadSidebarCollapsed,
  normalizePathKey,
  parentDirectory,
  PRIVATE_BROWSE_PATH_KEY,
  isFavorite,
  PRIVATE_MODE_ACTIVE_KEY,
  readPrivateModeActiveFlag,
  recordHistory,
  removeLastPlayed,
  toggleFavorite,
  saveLastPlayed,
  savePrivateFolders,
  saveSaved,
  remapDeviceSavedPaths,
  saveSidebarCollapsed,
  suggestNewFolderName,
  TILE_LABEL_HEIGHT,
} from "../features/device/deviceUtils";
import { usePlayback } from "../hooks/usePlayback";
import { useDebounce } from "../hooks/useDebounce";
import { useSmoothWheelScroll } from "../hooks/useSmoothWheelScroll";
import { pitflixConfirm } from "../utils/pitflixDialog";
import { clearDeviceThumbnailDiskCache, clearDeviceThumbnailMemoryCache, watchThumbnailProgress } from "../utils/videoThumbnailCache";
import { isPlayerCovering } from "../store/playerCoverStore";

type DeviceSortId =
  | 'default' | 'nameAZ' | 'nameZA' | 'dateOldNew' | 'dateNewOld'
  | 'sizeSmallBig' | 'sizeBigSmall' | 'durationShortLong' | 'durationLongShort';
const NAME_COLLATOR = new Intl.Collator(undefined, { numeric: true, sensitivity: 'base' });

const COLLECTIONS_OPEN_KEY = "pitflix.device.collectionsOpen.v1";
const GLOBAL_SEARCH_KEY_NORMAL = "pitflix.device.globalSearch.v1";
const GLOBAL_SEARCH_KEY_PRIVATE = "pitflix.device.privateGlobalSearch.v1";
const FAVORITES_OPEN_KEY = "pitflix.device.favoritesOpen.v1";
const HISTORY_OPEN_KEY = "pitflix.device.historyOpen.v1";
// Scroll position per folder path, persisted separately per mode — so switching between saved
// folders (or closing one via the sidebar and reopening it, or leaving My Device/Private Mode
// entirely and coming back) restores each folder's own scroll spot independently, not just "the
// last thing scrolled anywhere."
const SCROLL_MAP_KEY_NORMAL = "pitflix.device.scrollByPath.v1";
const SCROLL_MAP_KEY_PRIVATE = "pitflix.device.privateScrollByPath.v1";

// A page's own [data-scroll-restore-anchor] div usually scrolls itself, but depending on content
// height it can end up sized to fit everything instead (no real overflow), in which case the
// *layout's* <main> (also overflow-y-auto — see MainLayout.tsx) is the one actually scrolling.
function hasRealOverflow(el: Element | null): el is HTMLElement {
  return el instanceof HTMLElement && el.scrollHeight > el.clientHeight + 1;
}

function getEffectiveDeviceScroller(anchorEl: HTMLElement | null): HTMLElement | null {
  const mainEl = document.querySelector("main");
  if (hasRealOverflow(anchorEl)) return anchorEl;
  if (hasRealOverflow(mainEl)) return mainEl;
  return anchorEl;
}

function loadScrollMap(key: string): Record<string, number> {
  try {
    const raw = sessionStorage.getItem(key);
    if (!raw) return {};
    const parsed: unknown = JSON.parse(raw);
    return parsed && typeof parsed === "object" ? (parsed as Record<string, number>) : {};
  } catch {
    return {};
  }
}

function saveScrollMap(key: string, map: Record<string, number>): void {
  try { sessionStorage.setItem(key, JSON.stringify(map)); } catch { /* ignore */ }
}

// Deepest path last browsed under each top-level saved/private location, keyed by that location's
// own root path. Reopening a folder from the sidebar (after closing it, or after leaving My Device
// entirely) resumes here instead of always jumping back to the root — otherwise drilling into
// nested subfolders and coming back would "forget" the subfolder even though its own scroll
// position was still remembered (scroll is keyed by exact path, which is only useful if reopening
// actually lands back on that exact path).
const LAST_SUBPATH_KEY_NORMAL = "pitflix.device.lastSubpathByRoot.v1";
const LAST_SUBPATH_KEY_PRIVATE = "pitflix.device.privateLastSubpathByRoot.v1";

function loadLastSubpathMap(key: string): Record<string, string> {
  try {
    const raw = sessionStorage.getItem(key);
    if (!raw) return {};
    const parsed: unknown = JSON.parse(raw);
    return parsed && typeof parsed === "object" ? (parsed as Record<string, string>) : {};
  } catch {
    return {};
  }
}

function saveLastSubpathMap(key: string, map: Record<string, string>): void {
  try { sessionStorage.setItem(key, JSON.stringify(map)); } catch { /* ignore */ }
}

export function MyDevicePage() {
  const qc = useQueryClient();
  const { play } = usePlayback();
  const location = useLocation();
  // Returning from the player passes the folder it was opened from as ?path=... (see
  // openVideoEntry's returnTo below) — takes priority over the last-browsed-folder fallback
  // so closing a video always lands back in the folder it was actually played from, even if
  // that differs from wherever the user was last browsing before opening it.
  const returnPathParam = useMemo(() => {
    try {
      const p = new URLSearchParams(location.search).get("path");
      return p && p.length > 0 ? p : null;
    } catch {
      return null;
    }
  }, [location.search]);
  const [privateModeActive, setPrivateModeActiveState] = useState<boolean>(() => readPrivateModeActiveFlag());
  const setPrivateModeActive = useCallback((next: boolean) => {
    setPrivateModeActiveState(next);
    try {
      if (next) sessionStorage.setItem(PRIVATE_MODE_ACTIVE_KEY, "1");
      else sessionStorage.removeItem(PRIVATE_MODE_ACTIVE_KEY);
    } catch { /* ignore */ }
  }, []);
  // Persisted in sessionStorage (like privateModeActive) so returning from the player — which
  // remounts this page — lands back on the "My Videos" view instead of resetting to the plain
  // folder browser.
  const [collectionsOpen, setCollectionsOpenState] = useState<boolean>(() => {
    try { return sessionStorage.getItem(COLLECTIONS_OPEN_KEY) === "1"; } catch { return false; }
  });
  const setCollectionsOpen = useCallback((next: boolean) => {
    setCollectionsOpenState(next);
    try {
      if (next) sessionStorage.setItem(COLLECTIONS_OPEN_KEY, "1");
      else sessionStorage.removeItem(COLLECTIONS_OPEN_KEY);
    } catch { /* ignore */ }
  }, []);
  // Same persistence reasoning as collectionsOpen — My Favorite / History are available in both
  // modes (unlike My Videos, which is private-only), so they don't need a privateModeActive check.
  const [favoritesOpen, setFavoritesOpenState] = useState<boolean>(() => {
    try { return sessionStorage.getItem(FAVORITES_OPEN_KEY) === "1"; } catch { return false; }
  });
  const setFavoritesOpen = useCallback((next: boolean) => {
    setFavoritesOpenState(next);
    try {
      if (next) sessionStorage.setItem(FAVORITES_OPEN_KEY, "1");
      else sessionStorage.removeItem(FAVORITES_OPEN_KEY);
    } catch { /* ignore */ }
  }, []);
  const [historyOpen, setHistoryOpenState] = useState<boolean>(() => {
    try { return sessionStorage.getItem(HISTORY_OPEN_KEY) === "1"; } catch { return false; }
  });
  const setHistoryOpen = useCallback((next: boolean) => {
    setHistoryOpenState(next);
    try {
      if (next) sessionStorage.setItem(HISTORY_OPEN_KEY, "1");
      else sessionStorage.removeItem(HISTORY_OPEN_KEY);
    } catch { /* ignore */ }
  }, []);
  const [assignVideoPaths, setAssignVideoPaths] = useState<string[] | null>(null);

  // This page fills <main>'s box exactly (see the top-level wrapper below) by sitting absolutely
  // positioned with negative insets that cancel out main's own padding — but that padding isn't a
  // fixed value: MainLayout gives <main> different padding depending on isTopDock/isFloatingDock
  // (pt-2 instead of pt-12, pb-40 instead of pb-6). A hardcoded `-3rem`/`-1.5rem` guess only matched
  // one of those combinations and quietly clipped/misaligned this whole page's content in the
  // others. Measuring main's REAL computed padding here instead means this keeps working no matter
  // which layout mode is active, without this page needing to know Tailwind's specific class names.
  const [mainInset, setMainInset] = useState({ top: 48, right: 24, bottom: 24, left: 24 });
  useLayoutEffect(() => {
    const measure = () => {
      const mainEl = document.querySelector('main');
      if (!mainEl) return;
      const cs = getComputedStyle(mainEl);
      setMainInset({
        top: parseFloat(cs.paddingTop) || 0,
        right: parseFloat(cs.paddingRight) || 0,
        bottom: parseFloat(cs.paddingBottom) || 0,
        left: parseFloat(cs.paddingLeft) || 0,
      });
    };
    measure();
    window.addEventListener('resize', measure);
    return () => window.removeEventListener('resize', measure);
  }, []);
  const [moveNavigatorPaths, setMoveNavigatorPaths] = useState<string[] | null>(null);
  const [quickSortOpen, setQuickSortOpen] = useState(false);
  const [rouletteOpen, setRouletteOpen] = useState(false);
  const [normalSaved, setNormalSaved] = useState<string[]>(() => loadSaved());
  const [privateFolders, setPrivateFoldersState] = useState<string[]>(() => loadPrivateFolders());
  const [normalCurrentPath, setNormalCurrentPath] = useState<string | null>(() => {
    if (returnPathParam && !readPrivateModeActiveFlag()) return returnPathParam;
    try {
      const s = sessionStorage.getItem(BROWSE_PATH_KEY);
      return s && s.length > 0 ? s : null;
    } catch {
      return null;
    }
  });
  const [privateCurrentPath, setPrivateCurrentPath] = useState<string | null>(() => {
    if (returnPathParam && readPrivateModeActiveFlag()) return returnPathParam;
    try {
      const s = sessionStorage.getItem(PRIVATE_BROWSE_PATH_KEY);
      return s && s.length > 0 ? s : null;
    } catch {
      return null;
    }
  });
  // Private Mode replaces the whole browsing surface: while active, every place below that reads
  // `saved`/`setSaved`/`currentPath`/`setCurrentPath` transparently operates on the private folder
  // list and private browse path instead of the normal ones, so the existing browse/pick/remove
  // logic works unmodified for both — it just needs to persist to the right storage key.
  const saved = privateModeActive ? privateFolders : normalSaved;
  const setSaved = useCallback((next: string[]) => {
    if (privateModeActive) { setPrivateFoldersState(next); savePrivateFolders(next); }
    else { setNormalSaved(next); saveSaved(next); }
  }, [privateModeActive]);
  const currentPath = privateModeActive ? privateCurrentPath : normalCurrentPath;
  const setCurrentPath = privateModeActive ? setPrivateCurrentPath : setNormalCurrentPath;
  const [selectionMode, setSelectionMode] = useState(false);
  const [selectedPaths, setSelectedPaths] = useState<Set<string>>(() => new Set());

  // Where the player (or anything else) wants this page to land, named in the URL it navigates to:
  //   ?collection=<id>            → that actress/category folder's page in My Videos
  //   ?panel=favorites|history    → that panel
  //   ?path=<folder>              → a real folder (handled above, at mount)
  // Previously closing a video from an actress/category folder returned to a bare /my-device and
  // relied on sessionStorage plus whichever view happened to win on mount, so it could come back on
  // a real folder or on the grid instead. This runs on mount AND whenever the search changes, since
  // the page is kept mounted under the player and its React state ignores sessionStorage.
  useEffect(() => {
    const params = new URLSearchParams(location.search);
    const collectionId = params.get("collection");
    if (collectionId) {
      if (!stageCollectionViewById(collectionId)) return;
      setPrivateModeActive(true);
      setPrivateCurrentPath(null);
      setFavoritesOpen(false);
      setHistoryOpen(false);
      setCollectionsOpen(true);
      window.dispatchEvent(new CustomEvent(OPEN_COLLECTION_EVENT, { detail: { id: collectionId } }));
      return;
    }
    const panel = params.get("panel");
    if (panel === "favorites" || panel === "history") {
      setCurrentPath(null);
      setCollectionsOpen(false);
      setFavoritesOpen(panel === "favorites");
      setHistoryOpen(panel === "history");
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [location.search]);

  // Sidebar "Search all locations" — recursive search across every saved location of the current
  // mode. Kept in sessionStorage (per mode) so coming back from the player lands on the same results.
  const globalSearchKey = privateModeActive ? GLOBAL_SEARCH_KEY_PRIVATE : GLOBAL_SEARCH_KEY_NORMAL;
  const [globalSearchInput, setGlobalSearchInputState] = useState<string>(() => {
    try { return sessionStorage.getItem(readPrivateModeActiveFlag() ? GLOBAL_SEARCH_KEY_PRIVATE : GLOBAL_SEARCH_KEY_NORMAL) ?? ""; } catch { return ""; }
  });
  const setGlobalSearchInput = useCallback((next: string) => {
    setGlobalSearchInputState(next);
    try {
      if (next) sessionStorage.setItem(globalSearchKey, next);
      else sessionStorage.removeItem(globalSearchKey);
    } catch { /* ignore */ }
  }, [globalSearchKey]);
  const globalSearchQuery = useDebounce(globalSearchInput.trim(), 300);
  const globalSearchActive = globalSearchInput.trim().length >= 2 && globalSearchQuery.length >= 2;
  const globalSearchInputRef = useRef<HTMLInputElement>(null);
  // Switching Normal <-> Private swaps to that mode's own remembered search (never carries over).
  const prevModeForSearchRef = useRef(privateModeActive);
  useEffect(() => {
    if (prevModeForSearchRef.current === privateModeActive) return;
    prevModeForSearchRef.current = privateModeActive;
    try { setGlobalSearchInputState(sessionStorage.getItem(globalSearchKey) ?? ""); } catch { setGlobalSearchInputState(""); }
  }, [privateModeActive, globalSearchKey]);

  // Hold Ctrl+P for 3s to toggle Private Mode. Ignores OS key-repeat (only the first, non-repeat
  // keydown starts the hold timer) and cancels on keyup/blur before the hold completes, so a quick
  // Ctrl+P tap (e.g. a browser/OS shortcut collision) never accidentally toggles it.
  useEffect(() => {
    const HOLD_MS = 3000;
    let timer: ReturnType<typeof setTimeout> | null = null;
    let holding = false;
    const cancel = () => {
      if (timer) { clearTimeout(timer); timer = null; }
      holding = false;
    };
    const onKeyDown = (e: KeyboardEvent) => {
      // Hidden under the full player (kept alive, see AppRoutes): its keys belong to the player.
      if (isPlayerCovering()) return;
      if (!e.ctrlKey || e.code !== "KeyP") return;
      e.preventDefault();
      if (e.repeat || holding) return;
      holding = true;
      timer = setTimeout(() => {
        setPrivateModeActive(!privateModeActive);
        holding = false;
      }, HOLD_MS);
    };
    const onKeyUp = (e: KeyboardEvent) => {
      if (e.code === "KeyP" || e.code === "ControlLeft" || e.code === "ControlRight") cancel();
    };
    window.addEventListener("keydown", onKeyDown);
    window.addEventListener("keyup", onKeyUp);
    window.addEventListener("blur", cancel);
    return () => {
      cancel();
      window.removeEventListener("keydown", onKeyDown);
      window.removeEventListener("keyup", onKeyUp);
      window.removeEventListener("blur", cancel);
    };
  }, [privateModeActive, setPrivateModeActive]);

  // Easy close: Escape exits Private Mode immediately (after selection mode, if that's also
  // active, gets its own Escape first — see useDeviceKeyboardShortcuts).
  useEffect(() => {
    if (!privateModeActive) return;
    const onKeyDown = (e: KeyboardEvent) => {
      // Hidden under the full player (kept alive, see AppRoutes): its keys belong to the player.
      if (isPlayerCovering()) return;
      if (e.key !== "Escape" || selectionMode) return;
      setPrivateModeActive(false);
      setCollectionsOpen(false);
    };
    window.addEventListener("keydown", onKeyDown);
    return () => window.removeEventListener("keydown", onKeyDown);
  }, [privateModeActive, selectionMode, setPrivateModeActive]);
  /** Custom pointer-based drag-and-drop (like Explorer): paths currently being dragged, and the
   * folder tile currently hovered as a drop target. Independent of selectionMode's click-to-move
   * flow. Not native HTML5 DnD — that leaves a permanent "not allowed" cursor on Windows/WebView2
   * in this frameless window regardless of dropEffect (a known Chromium rendering limitation, not
   * fixable via the drag API), so this tracks pointerdown/move/up manually instead, which keeps the
   * cursor under plain CSS control. State below drives rendering; dragStateRef/dragOverPathRef are
   * the source of truth read inside the handlers, to avoid any stale-closure timing issues between
   * fast-firing pointer events and React's render cycle. */
  const [draggingPaths, setDraggingPaths] = useState<string[] | null>(null);
  const [dragOverPath, setDragOverPath] = useState<string | null>(null);
  const [dragGhost, setDragGhost] = useState<{ x: number; y: number; count: number } | null>(null);
  const dragStateRef = useRef<{
    pointerId: number;
    startX: number;
    startY: number;
    paths: string[];
    active: boolean;
  } | null>(null);
  const dragOverPathRef = useRef<string | null>(null);
  const setDragOverPathBoth = useCallback((p: string | null) => {
    dragOverPathRef.current = p;
    setDragOverPath(p);
  }, []);
  /** A native `click` event still fires after pointerup even when the gesture was a real drag
   * (dropped on a folder, or just dragged and released without a valid target) — without this,
   * that click reopens/plays whatever was under the cursor at the start. Set whenever a drag
   * actually armed (past the movement threshold); consumed and cleared by the very next onClick. */
  const suppressClickRef = useRef(false);
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
  // The sidebar is a plain sibling inside the same element that ends up being the real scroller for
  // a tall folder (<main>; see the mainInset/wrapper comments elsewhere on this page for why that
  // ambiguity exists). Two things were tried and both fell short: min-height: 0 alone only fixes the
  // sidebar's own SIZE (stops it stretching to match a too-tall row), not the fact that it still
  // scrolls away together with <main>'s content since it's a normal-flow sibling; position: sticky
  // was meant to fix that, but its behavior depends on exactly which ancestor is treated as sticky's
  // "nearest scrolling ancestor" and whether any ancestor between the sidebar and that scroller has
  // non-visible overflow (the escape-wrapper here has overflow: hidden) — evidently that combination
  // doesn't stick reliably in this structure. position: fixed sidesteps all of that: it's anchored
  // directly to the viewport and genuinely cannot be carried along by any ancestor's scrolling,
  // sticky containing-block rules or not. Measured against <main>'s own screen position (not the
  // sidebar's own ref) to avoid measuring a box that's already been pulled out of flow by the fixed
  // positioning we're about to apply to it.
  const [sidebarBox, setSidebarBox] = useState<{ top: number; left: number; height: number } | null>(null);
  useLayoutEffect(() => {
    const measure = () => {
      const mainEl = document.querySelector('main');
      if (!mainEl) return;
      const rect = mainEl.getBoundingClientRect();
      setSidebarBox((prev) =>
        prev && prev.top === rect.top && prev.left === rect.left && prev.height === window.innerHeight - rect.top
          ? prev
          : { top: rect.top, left: rect.left, height: window.innerHeight - rect.top },
      );
    };
    measure();
    window.addEventListener('resize', measure);
    // Collapsing/expanding the app's main sidebar moves <main> without resizing the window, so a
    // window 'resize' listener alone left this panel stranded at the old spot (and, collapsed,
    // floating over the file grid). <main> changes width on every frame of that animation, so
    // observing it keeps the panel glued to its left edge throughout.
    const mainEl = document.querySelector('main');
    const ro = mainEl ? new ResizeObserver(measure) : null;
    if (mainEl) ro?.observe(mainEl);
    return () => {
      window.removeEventListener('resize', measure);
      ro?.disconnect();
    };
  }, []);
  const [filterText, setFilterText] = useState("");
  const [scanBusy, setScanBusy] = useState(false);
  const [fsBusy, setFsBusy] = useState(false);
  const [fsBusyLabel, setFsBusyLabel] = useState<string | null>(null);
  const [transferProgress, setTransferProgress] = useState<{ copiedBytes: number; totalBytes: number } | null>(null);
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
  useEffect(() => {
    if (!isTauri()) return;
    let unlisten: UnlistenFn | undefined;
    void listen<{ copiedBytes: number; totalBytes: number }>("device-transfer-progress", (event) => {
      setTransferProgress(event.payload);
    }).then((u) => {
      unlisten = u;
    });
    return () => {
      unlisten?.();
    };
  }, []);
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
  const [sortBy, setSortBy] = useState<DeviceSortId>('default');
  const [filterMenuOpen, setFilterMenuOpen] = useState(false);
  const activeFolderChipRef = useRef<HTMLDivElement>(null);
  const filterInputRef = useRef<HTMLInputElement>(null);
  const filterMenuRef = useRef<HTMLDivElement>(null);
  const scrollContainerRef = useRef<HTMLDivElement>(null);
  // Which element actually scrolls here is ambiguous — <main>'s own height comes from flexbox
  // (see the wrapper's height/margin comment further down), so depending on how much content a
  // folder has, either this internal div or <main> itself ends up being the real scroller. Applying
  // the smooth-wheel-scroll hook to this div too (in addition to <main>'s own, from MainLayout.tsx)
  // means whichever one actually scrolls still gets the eased wheel feel.
  useSmoothWheelScroll(scrollContainerRef);

  // Same ambiguity applies to the scroll-driven thumbnail-loading pause (see notifyScroll in
  // DeviceThumbs.tsx): the anchor's own onScroll={notifyScroll} below only fires notifyScroll when
  // the anchor itself is the one scrolling. On a large folder where <main> ends up being the real
  // scroller instead, that onScroll never fires, isScrolling never becomes true, and every "don't
  // load thumbnails while scrolling" guard silently does nothing — which is exactly when it matters
  // most (a big folder is the case with the most thumbnails competing for the main thread). Listening
  // on <main> directly, for the lifetime of this page, closes that gap regardless of which element
  // is the real scroller. This also covers the My Videos actress/category view (CollectionsPanel),
  // which renders inside this same scroll area and never calls notifyScroll on its own.
  useEffect(() => {
    const mainEl = document.querySelector("main");
    if (!mainEl) return;
    mainEl.addEventListener("scroll", notifyScroll, { passive: true });
    return () => mainEl.removeEventListener("scroll", notifyScroll);
  }, []);

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

  // ── Directory data via React Query (cache kept for 30 min so re-navigating back is instant, but
  // treated as stale almost immediately — files get renamed/moved/deleted from Explorer outside the
  // app all the time, and the old 10-minute staleTime meant those changes wouldn't show up here for
  // up to 10 minutes. refetchOnWindowFocus is opted back in here specifically (the app disables it
  // globally) so alt-tabbing back from Explorer after a change refreshes the current folder right
  // away instead of waiting on the poll below). ──
  const {
    data: rawEntries = [],
    isLoading: busy,
    isFetching,
    error: dirError,
  } = useQuery<DeviceFsEntry[]>({
    queryKey: ["device-dir", currentPath],
    queryFn: () =>
      invoke<DeviceFsEntry[]>("device_read_dir", { path: currentPath! }),
    enabled: !!currentPath && isTauri(),
    staleTime: 3000,
    gcTime: 30 * 60 * 1000,
    refetchOnWindowFocus: true,
    refetchInterval: 15000,
    placeholderData: [],
  });

  // Private folders must never surface while browsing normally, even as a subfolder nested inside
  // a folder the user is browsing that happens to contain one (e.g. it was marked private after
  // being added to a normal saved root). Private Mode itself shows everything unfiltered.
  const entries = useMemo(() => {
    if (privateModeActive || privateFolders.length === 0) return rawEntries;
    return rawEntries.filter(
      (e) => !e.is_directory || !privateFolders.some((pf) => isPathInside(e.path, pf)),
    );
  }, [rawEntries, privateModeActive, privateFolders]);

  // Safety net: if normal browsing somehow lands inside a path that's now marked private (e.g. it
  // was marked private from a different session, or the path was restored from sessionStorage),
  // back out to the root instead of rendering its contents.
  useEffect(() => {
    if (privateModeActive || !normalCurrentPath || privateFolders.length === 0) return;
    if (privateFolders.some((pf) => isPathInside(normalCurrentPath, pf))) {
      setNormalCurrentPath(null);
    }
  }, [privateModeActive, normalCurrentPath, privateFolders]);

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
    setSortBy('default');
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

  // The background preload queues above are module-level, not tied to this component's lifetime —
  // navigating away (e.g. opening a video, which unmounts this page) otherwise leaves them running
  // in the background, and their synchronous canvas frame-decode/JPEG-encode work on the main
  // thread visibly competes with the player's own rendering/input handling. Stop queuing new
  // captures on unmount; anything already in flight just finishes. Thumbnails still self-heal
  // on-demand (via DeviceVideoThumb) once scrolled into view after coming back.
  useEffect(() => {
    return () => {
      cancelBackgroundThumbnails();
      cancelBackgroundImages();
    };
  }, []);

  // Scroll the active saved-folder chip into view
  useEffect(() => {
    activeFolderChipRef.current?.scrollIntoView({ behavior: "smooth", block: "nearest", inline: "center" });
  }, [currentPath]);

  // Persist current path to sessionStorage — normal and private browsing use separate keys so
  // switching modes never clobbers the other mode's remembered position.
  useEffect(() => {
    try {
      if (normalCurrentPath) sessionStorage.setItem(BROWSE_PATH_KEY, normalCurrentPath);
      else sessionStorage.removeItem(BROWSE_PATH_KEY);
    } catch { /* ignore */ }
  }, [normalCurrentPath]);

  useEffect(() => {
    try {
      if (privateCurrentPath) sessionStorage.setItem(PRIVATE_BROWSE_PATH_KEY, privateCurrentPath);
      else sessionStorage.removeItem(PRIVATE_BROWSE_PATH_KEY);
    } catch { /* ignore */ }
  }, [privateCurrentPath]);

  useEffect(() => {
    const bump = () => setLastPlayedRev((n) => n + 1);
    window.addEventListener("pitflix-device-last-played", bump);
    window.addEventListener("focus", bump);
    return () => {
      window.removeEventListener("pitflix-device-last-played", bump);
      window.removeEventListener("focus", bump);
    };
  }, []);

  // Durations for the current folder's videos (duration badge + duration sort). Private Mode keeps
  // them in memory only so private paths never land in persistent storage.
  const durationsVersion = useVideoDurationsVersion();
  const durationSortRev = sortBy.startsWith('duration') ? durationsVersion : 0;
  useEffect(() => {
    if (isFetching) return;
    const videos = entries.filter((e) => !e.is_directory && e.media_kind === 'video');
    if (videos.length === 0) return;
    requestVideoDurations(
      videos.map((e) => ({ path: e.path, size: e.size_bytes })),
      { persist: !privateModeActive },
    );
  }, [entries, isFetching, privateModeActive]);

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
    if (sortBy === 'nameAZ' || sortBy === 'nameZA') {
      const dir = sortBy === 'nameAZ' ? 1 : -1;
      list = [...list].sort((a, b) => {
        if (a.is_directory !== b.is_directory) return a.is_directory ? -1 : 1;
        return dir * NAME_COLLATOR.compare(a.name, b.name);
      });
    } else if (sortBy === 'durationShortLong' || sortBy === 'durationLongShort') {
      // Folders first, then videos by length (still-probing ones last, by name), then other files.
      const dir = sortBy === 'durationShortLong' ? 1 : -1;
      const rank = (e: DeviceFsEntry) => (e.is_directory ? 0 : e.media_kind === 'video' ? 1 : 2);
      list = [...list].sort((a, b) => {
        const ra = rank(a);
        const rb = rank(b);
        if (ra !== rb) return ra - rb;
        if (ra === 1) {
          const da = getVideoDuration(a.path);
          const db = getVideoDuration(b.path);
          if (da != null && db != null && da !== db) return dir * (da - db);
          if (da != null && db == null) return -1;
          if (da == null && db != null) return 1;
        }
        return NAME_COLLATOR.compare(a.name, b.name);
      });
    } else if (sortBy !== 'default') {
      list = [...list].sort((a, b) => {
        if (sortBy === 'dateOldNew')   return (a.created_at ?? 0) - (b.created_at ?? 0);
        if (sortBy === 'dateNewOld')   return (b.created_at ?? 0) - (a.created_at ?? 0);
        if (sortBy === 'sizeSmallBig') return (a.size_bytes ?? 0) - (b.size_bytes ?? 0);
        if (sortBy === 'sizeBigSmall') return (b.size_bytes ?? 0) - (a.size_bytes ?? 0);
        return 0;
      });
    }
    return list;
    // eslint-disable-next-line react-hooks/exhaustive-deps -- durationSortRev re-sorts as durations arrive
  }, [entries, filterText, typeFilter, sortBy, durationSortRev]);

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
  //
  // This value should be a constant (it's just "how tall is the stuff — loading indicator, resume
  // slider, result count — rendered above the grid inside the same scroller"), so it's only ever
  // supposed to change between scroll-driven renders, not because of one. But this effect has no
  // dependency array on purpose (it self-stabilizes against whatever's above the grid without having
  // to enumerate every state that affects that), which meant it was *also* re-running on every
  // scroll-driven re-render — recomputing from `scroller.scrollTop` mid-scroll, on a layout that
  // hasn't necessarily settled yet. Any small inconsistency in that reading fed straight into the
  // virtualizer's item positions and repositioned every rendered row right in the middle of a scroll
  // gesture, which is what made the scrollbar/wheel interaction feel like it was randomly jumping.
  // Skipping the recompute while actively scrolling removes that: nothing above the grid changes
  // *during* a scroll anyway, so there's nothing to catch up on once it settles.
  useLayoutEffect(() => {
    if (isDeviceScrolling()) return;
    const grid = gridContainerRef.current;
    // Same element the virtualizer measures against (see getScrollElement below).
    const scroller = getEffectiveDeviceScroller(scrollContainerRef.current);
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
    // The element that really scrolls. The page's own container isn't height-bounded — it grows to
    // the full content height (55,248 px for a 2,000-video folder) and <main> does the scrolling —
    // so measured against it the virtualizer saw a "viewport" as tall as the whole folder and
    // rendered every row: 2,000 tiles / ~43k DOM nodes, 3.4 s before the grid appeared. Re-read on
    // every render, so it follows the switch to <main> once a folder's content makes it scroll.
    getScrollElement: () => getEffectiveDeviceScroller(scrollContainerRef.current),
    estimateSize: () => rowHeight,
    overscan: 3,
    scrollMargin,
  });

  // Remember the deepest path visited under each top-level location, so reopening that location
  // from the sidebar (see the "Location tabs" click handler below) resumes at the subfolder last
  // browsed instead of always jumping back to its root.
  useEffect(() => {
    if (!currentPath) return;
    const root = saved.find((r) => isPathInside(currentPath, r));
    if (!root) return;
    const key = privateModeActive ? LAST_SUBPATH_KEY_PRIVATE : LAST_SUBPATH_KEY_NORMAL;
    const map = loadLastSubpathMap(key);
    if (map[root] === currentPath) return;
    map[root] = currentPath;
    saveLastSubpathMap(key, map);
  }, [currentPath, privateModeActive, saved]);

  // Restore each folder's own remembered scroll position whenever the active folder changes —
  // including the very first render (so returning from the player, or just reopening My Device,
  // lands where you were), toggling a folder closed then reopening it in the sidebar, and switching
  // between different saved folders. A folder with no remembered position defaults to 0 (top),
  // which covers "genuinely new folder" without needing a separate reset-to-top code path. Retried
  // repeatedly rather than once: the folder's real content (device_read_dir) can still be loading
  // when the early attempts fire, and setting scrollTop before the virtualized grid has grown to
  // full height just gets clamped back to 0. Guarded against a fast folder-to-folder switch — a
  // stale retry from the folder navigated away from must not stomp the newly active one.
  useEffect(() => {
    if (!currentPath) return;
    const key = privateModeActive ? SCROLL_MAP_KEY_PRIVATE : SCROLL_MAP_KEY_NORMAL;
    const saved = loadScrollMap(key)[currentPath] ?? 0;
    let cancelled = false;
    // A folder's content (and the grid's real height) can still be loading in when the early
    // retries fire, so this reapplies the same saved position several times rather than once. But
    // the retries span up to 2.4s — plenty of time for the user to already be scrolling on their
    // own — so a later retry blindly overwriting scrollTop with the original saved value would yank
    // them back to wherever they were when the folder opened. Any manual wheel/touch/pointer input
    // on either candidate scroller cancels the remaining retries.
    const userInputEvents = ["wheel", "touchstart", "pointerdown"] as const;
    const onUserInput = () => { cancelled = true; };
    const mainEl = document.querySelector("main");
    const anchorEl = scrollContainerRef.current;
    for (const evt of userInputEvents) {
      mainEl?.addEventListener(evt, onUserInput, { passive: true });
      anchorEl?.addEventListener(evt, onUserInput, { passive: true });
    }
    const applyScroll = () => {
      if (cancelled) return;
      const target = getEffectiveDeviceScroller(scrollContainerRef.current);
      if (target) target.scrollTop = saved;
    };
    const timers: ReturnType<typeof setTimeout>[] = [];
    const raf = requestAnimationFrame(() => { timers.push(setTimeout(applyScroll, 0)); });
    for (const delay of [120, 300, 600, 1000, 1600, 2400]) {
      timers.push(setTimeout(applyScroll, delay));
    }
    return () => {
      cancelled = true;
      cancelAnimationFrame(raf);
      timers.forEach(clearTimeout);
      for (const evt of userInputEvents) {
        mainEl?.removeEventListener(evt, onUserInput);
        anchorEl?.removeEventListener(evt, onUserInput);
      }
    };
  }, [currentPath, privateModeActive]);

  // Persist scroll position (debounced) per folder path, so switching away and back — whether via
  // the sidebar, leaving My Device entirely, or closing a video — restores each folder's own spot
  // independently rather than only "the last thing scrolled anywhere."
  useEffect(() => {
    if (!currentPath) return;
    const path = currentPath;
    const anchorEl = scrollContainerRef.current;
    const mainEl = document.querySelector("main");
    const key = privateModeActive ? SCROLL_MAP_KEY_PRIVATE : SCROLL_MAP_KEY_NORMAL;
    let timer: ReturnType<typeof setTimeout> | null = null;
    const persist = (el: HTMLElement) => {
      if (timer) clearTimeout(timer);
      timer = setTimeout(() => {
        const map = loadScrollMap(key);
        map[path] = el.scrollTop;
        saveScrollMap(key, map);
      }, 150);
    };
    const onAnchorScroll = () => { if (hasRealOverflow(anchorEl)) persist(anchorEl); };
    const onMainScroll = () => { if (hasRealOverflow(mainEl)) persist(mainEl as HTMLElement); };
    anchorEl?.addEventListener("scroll", onAnchorScroll, { passive: true });
    mainEl?.addEventListener("scroll", onMainScroll, { passive: true });
    return () => {
      if (timer) clearTimeout(timer);
      anchorEl?.removeEventListener("scroll", onAnchorScroll);
      mainEl?.removeEventListener("scroll", onMainScroll);
    };
  }, [currentPath, privateModeActive]);

  // ── Action handlers ──────────────────────────────────────────────────────────

  const pickFolder = useCallback(async () => {
    if (!isTauri()) return;
    const r = await open({ directory: true, multiple: false, title: "Choose a folder" });
    const path = typeof r === "string" ? r : Array.isArray(r) ? r[0] : null;
    if (!path) return;
    if (!saved.includes(path)) {
      const next = [...saved, path];
      setSaved(next);
    }
    setCurrentPath(path);
  }, [saved, setSaved, setCurrentPath]);

  const removeSaved = (path: string) => {
    const next = saved.filter((p) => p !== path);
    setSaved(next);
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

  // Opening a folder from the search results (or "Show in folder" on a file) leaves search.
  const openFolderFromSearch = useCallback((path: string) => {
    setCollectionsOpen(false);
    setFavoritesOpen(false);
    setHistoryOpen(false);
    exitSelectionMode();
    setGlobalSearchInput('');
    setCurrentPath(path);
  }, [setCollectionsOpen, setFavoritesOpen, setHistoryOpen, exitSelectionMode, setGlobalSearchInput, setCurrentPath]);

  // Any sidebar navigation (a location, My Favorite, History, My Videos) also leaves search.
  const searchNavSnapshotRef = useRef({ currentPath, collectionsOpen, favoritesOpen, historyOpen });
  useEffect(() => {
    const prev = searchNavSnapshotRef.current;
    searchNavSnapshotRef.current = { currentPath, collectionsOpen, favoritesOpen, historyOpen };
    if (
      prev.currentPath === currentPath && prev.collectionsOpen === collectionsOpen &&
      prev.favoritesOpen === favoritesOpen && prev.historyOpen === historyOpen
    ) return;
    if (globalSearchInput) setGlobalSearchInput('');
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [currentPath, collectionsOpen, favoritesOpen, historyOpen]);

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
    setMoveNavigatorPaths(selectedList);
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

  const remapAfterMove = useCallback(async (paths: string[], destinationDir: string) => {
    const dest = destinationDir.replace(/[/\\]+$/, "");
    const sep = dest.includes("\\") || !dest.includes("/") ? "\\" : "/";
    const pairs = paths.map((from) => ({ from, to: `${dest}${sep}${from.split(/[/\\]/).pop() ?? ""}` }));
    try {
      const flags = await invoke<boolean[]>("device_paths_exist", {
        paths: [...pairs.map((p) => p.from), ...pairs.map((p) => p.to)],
      });
      remapDeviceSavedPaths(pairs.filter((_, i) => !flags[i] && flags[pairs.length + i]));
    } catch { /* History just falls back to re-finding the files by name */ }
  }, []);

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
    setTransferProgress(null);
    setScanErr(null);
    try {
      try {
        await invoke(mode === "move" ? "device_move_entries" : "device_copy_entries", {
          paths,
          destinationDir,
        });
      } finally {
        // Even a move that failed part-way moved some items — remap exactly the ones that are now
        // at the destination and gone from their old spot, so History / My Favorite follow them.
        if (mode === "move") void remapAfterMove(paths, destinationDir);
      }
      setFolderPicker(null);
      if (clearSelection) exitSelectionMode();
      refreshCurrentDir();
    } catch (e: unknown) {
      setScanErr(e instanceof Error ? e.message : String(e));
    } finally {
      setFsBusy(false);
      setFsBusyLabel(null);
      setTransferProgress(null);
    }
  }, [exitSelectionMode, refreshCurrentDir, remapAfterMove]);

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
      remapDeviceSavedPaths([{ from: entryRename.path, to: newPath }]);
      const oldKey = normalizePathKey(entryRename.path);
      const nextSaved = saved.map((s) =>
        normalizePathKey(s) === oldKey ? newPath : s,
      );
      if (nextSaved.some((s, i) => s !== saved[i])) {
        setSaved(nextSaved);
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

  // Folder version of "Add to My Videos" — grabs the video files sitting directly inside the
  // folder (matching how the collection side's own "Add folder" already works: one level, no
  // recursing into subfolders) so a whole per-actress real folder can be assigned in one action
  // instead of one video at a time.
  const addFolderToCollections = useCallback(async (entry: DeviceFsEntry) => {
    if (!isTauri()) return;
    try {
      const rows = await invoke<DeviceFsEntry[]>("device_read_dir", { path: entry.path });
      const videoPaths = rows.filter((r) => !r.is_directory && r.media_kind === "video").map((r) => r.path);
      if (videoPaths.length === 0) {
        setScanErr("No videos found directly inside this folder.");
        return;
      }
      setAssignVideoPaths(videoPaths);
    } catch (e: unknown) {
      setScanErr(e instanceof Error ? e.message : String(e));
    }
  }, []);

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
      case "add-to-collections":
        if (entry.is_directory) void addFolderToCollections(entry);
        else setAssignVideoPaths([entry.path]);
        break;
      case "toggle-favorite":
        if (!entry.is_directory) {
          toggleFavorite(privateModeActive, entry.path, entry.media_kind === "video" ? "video" : "image");
        }
        break;
      case "select":
        enterSelectionMode();
        toggleSelected(entry.path);
        break;
      case "move":
        // If several items are already selected and this one is among them, move the whole
        // selection — matches how "Select" from this same menu builds a multi-item selection.
        setMoveNavigatorPaths(
          selectionMode && selectedPaths.size > 1 && selectedPaths.has(entry.path)
            ? selectedList
            : [entry.path],
        );
        break;
      case "copy-path":
        void navigator.clipboard.writeText(entry.path).catch(() => {});
        break;
      case "show-in-folder":
        void revealItemInDir(entry.path).catch(() => {});
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

  // Progress for a Regenerate run specifically — not for ordinary folder-open background loading
  // (that had a floating badge that ended up overlapping grid content and was removed). Regenerate
  // is one deliberate, bounded, user-initiated action, so a purpose-built indicator for just that
  // makes sense where a general-purpose one didn't. Cleared automatically when the watch reports
  // everything done; regenerateThumbnailsUnwatchRef stops the previous watch if regenerate is
  // triggered again before the last run finished.
  const [regenProgress, setRegenProgress] = useState<{ done: number; total: number } | null>(null);
  const regenerateThumbnailsUnwatchRef = useRef<(() => void) | null>(null);
  useEffect(() => () => regenerateThumbnailsUnwatchRef.current?.(), []);

  const regenerateThumbnails = useCallback((settings?: DeviceMediaSettings) => {
    if (settings) {
      const saved = saveDeviceMediaSettings(settings);
      setMediaSettings(saved);
    }
    resetPreviewProgress();
    resetThumbnailWarmState();
    clearDeviceThumbnailMemoryCache();
    regenerateThumbnailsUnwatchRef.current?.();
    regenerateThumbnailsUnwatchRef.current = null;
    void clearDeviceThumbnailDiskCache().then(() => {
      if (currentPath && entries.length) {
        const videoPaths = entries
          .filter((e) => !e.is_directory && e.media_kind === "video")
          .map((e) => e.path);
        if (videoPaths.length) {
          setRegenProgress({ done: 0, total: videoPaths.length });
          regenerateThumbnailsUnwatchRef.current = watchThumbnailProgress(videoPaths, (p) => {
            setRegenProgress(p.done >= p.total ? null : p);
          });
          // The frontend cache clears above don't touch thumb_poster's own disk cache (native
          // ffmpeg capture) — without this, native capture just serves back the old cached frame
          // instead of re-extracting at the newly-saved frame-range setting, since from its own
          // point of view nothing has changed.
          void invoke("clear_thumb_posters", { filePaths: videoPaths }).catch(() => {}).finally(() => {
            scheduleBackgroundThumbnails(videoPaths);
          });
        }
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

  const addSelectedToCollections = () => {
    const videoPaths = entries
      .filter((e) => selectedPaths.has(e.path) && !e.is_directory && e.media_kind === "video")
      .map((e) => e.path);
    if (videoPaths.length === 0) {
      setScanErr("No videos in the current selection.");
      return;
    }
    setAssignVideoPaths(videoPaths);
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
    // Never let Private Mode content into the main scanned library — that would surface it
    // app-wide (Home, Library, search…), defeating the whole point of marking it private.
    if (privateModeActive) { setScanErr("Can't add to library from Private Mode."); return; }
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
    const scroller = getEffectiveDeviceScroller(scrollContainerRef.current);
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
          // Explicit folder path so closing the player lands back in the folder this file was
          // actually opened from, not wherever BROWSE_PATH_KEY last happened to point.
          search: currentPath ? `?path=${encodeURIComponent(currentPath)}` : undefined,
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
      // Videos record to History on return from the player (recordDeviceLastPlayedFromPlayer) —
      // images have no equivalent "session" to wait for, so record right at open time instead.
      recordHistory(privateModeActive, e.path, "image");
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
    globalSearchInputRef,
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

  const SORT_OPTIONS: { id: DeviceSortId; label: string }[] = [
    { id: 'default',      label: 'Default'          },
    { id: 'nameAZ',       label: 'Name: A to Z'     },
    { id: 'nameZA',       label: 'Name: Z to A'     },
    { id: 'dateOldNew',   label: 'Date: old to new' },
    { id: 'dateNewOld',   label: 'Date: new to old' },
    { id: 'sizeSmallBig', label: 'Size: small to big' },
    { id: 'sizeBigSmall', label: 'Size: big to small' },
    { id: 'durationShortLong', label: 'Duration: short to long' },
    { id: 'durationLongShort', label: 'Duration: long to short' },
  ];

  const folderCount = entries.filter((e) => e.is_directory).length;
  const fileCount = entries.length - folderCount;
  const filtersActive = typeFilter !== 'all' || sortBy !== 'default';

  return (
    <div
      tabIndex={-1}
      className="outline-none"
      style={{
        display: 'flex',
        // Overrides <main>'s own padding so this page's content reaches its edges — negative
        // margins pull the wrapper out over the padding, and height makes up the difference.
        // Insets are measured from main's real computed padding (see mainInset above) rather than
        // hardcoded, since <main>'s padding varies by layout mode (isTopDock/isFloatingDock) and a
        // fixed guess only matches one combination.
        //
        // This used to be `position: absolute` with the same measured insets, which fills main's
        // box exactly regardless of flexbox's percentage-height quirks (main's height comes from
        // Tailwind's flex-1, which normal-flow percentage resolution doesn't reliably treat as
        // "explicit") — and that in turn is why virtualization worked correctly under it (main
        // stops being scrollable, so this page's own internal container is unambiguously the real
        // scroller). But it visibly broke the layout, so it's reverted to this simpler, previously
        // stable technique — accepting the tradeoff that on tall folders <main> can again become the
        // scroller instead of the internal container.
        height: `calc(100% + ${mainInset.top + mainInset.bottom}px)`,
        marginTop: -mainInset.top,
        marginRight: -mainInset.right,
        marginBottom: -mainInset.bottom,
        marginLeft: -mainInset.left,
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

      {/* Entry details modal — z-[95] so it renders above the image viewer (z-[85]), which is
          also how it's reached now (Details button inside DeviceImageViewer). */}
      {detailsPath ? (
        <div className="fixed inset-0 z-[95] flex items-center justify-center bg-black/60 px-4 backdrop-blur-sm">
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
          showAddToCollections={privateModeActive}
          isFavorited={contextMenu.entry.is_directory ? undefined : isFavorite(privateModeActive, contextMenu.entry.path)}
        />
      ) : null}
      {assignVideoPaths ? (
        <AddToCollectionModal videoPaths={assignVideoPaths} onClose={() => setAssignVideoPaths(null)} />
      ) : null}
      {moveNavigatorPaths && currentPath ? (
        <DeviceMoveNavigatorModal
          paths={moveNavigatorPaths}
          startPath={currentPath}
          rootBoundary={saved.find((r) => isPathInside(currentPath, r)) ?? null}
          onClose={() => setMoveNavigatorPaths(null)}
          onConfirm={(dest) => {
            void transferToFolder(dest, {
              mode: "move",
              paths: moveNavigatorPaths,
              clearSelection: moveNavigatorPaths.every((p) => selectedPaths.has(p)),
            });
            setMoveNavigatorPaths(null);
          }}
        />
      ) : null}
      {quickSortOpen && currentPath ? (
        <DeviceQuickSortModal
          videos={entries.filter((e) => !e.is_directory && isPlayableMedia(e))}
          subfolders={entries.filter((e) => e.is_directory)}
          onMove={async (path, destinationDir) => {
            await transferToFolder(destinationDir, { mode: "move", paths: [path] });
          }}
          onCreateAndMove={async (path, folderName) => {
            const sep = currentPath.includes('\\') ? '\\' : '/';
            const destinationDir = `${currentPath.replace(/[\\/]+$/, '')}${sep}${folderName}`;
            try {
              await invoke("device_create_folder", { parentDir: currentPath, name: folderName });
            } catch {
              // Already exists (or race with a prior create) — fall through to the move either way.
            }
            await transferToFolder(destinationDir, { mode: "move", paths: [path] });
            return destinationDir;
          }}
          onClose={() => setQuickSortOpen(false)}
        />
      ) : null}
      {rouletteOpen && currentPath ? (
        <DeviceRouletteModal
          open={rouletteOpen}
          items={entries
            .filter((e) => !e.is_directory && isPlayableMedia(e))
            .map((e) => ({ id: e.path, label: fileDisplayTitle(e.name), renderThumb: () => <LazyFolderThumb mode="video" path={e.path} /> }))}
          kindLabel="video"
          onClose={() => setRouletteOpen(false)}
          onLanded={(path) => {
            const entry = entries.find((e) => e.path === path);
            if (entry) void openEntry(entry);
          }}
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

      {/* Custom drag-drop ghost — replaces the native OS drag ghost/cursor entirely (see the
          pointer-based drag implementation on each grid item), since the native one gets stuck
          showing a "not allowed" icon in this frameless WebView2 window regardless of dropEffect. */}
      {dragGhost ? (
        <div
          style={{
            position: 'fixed',
            left: dragGhost.x + 14,
            top: dragGhost.y + 14,
            zIndex: 9999,
            pointerEvents: 'none',
            display: 'flex',
            alignItems: 'center',
            gap: 6,
            background: 'rgba(124,58,237,0.95)',
            color: 'white',
            fontSize: 12,
            fontWeight: 700,
            padding: '6px 12px',
            borderRadius: 8,
            boxShadow: '0 6px 20px rgba(0,0,0,0.5)',
          }}
        >
          <FolderInput style={{ width: 14, height: 14 }} strokeWidth={2.4} />
          {dragGhost.count > 1 ? `${dragGhost.count} items` : '1 item'}
        </div>
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
          onChange={(e) => { recordHistory(privateModeActive, e.path, "image"); setViewingImage(e); }}
          onOpenVideo={openVideoEntry}
          onDelete={(e) => {
            setViewingImage(null);
            void deletePaths([e.path], e.name);
          }}
          onShowInFolder={(e) => void revealItemInDir(e.path).catch(() => {})}
          onShowDetails={(e) => setDetailsPath(e.path)}
        />
      ) : null}

      {/* FS busy overlay */}
      {fsBusy ? (
        <div className="pointer-events-none fixed inset-0 z-[90] flex items-center justify-center bg-black/35 backdrop-blur-[1px]">
          <div className="pointer-events-auto w-[min(320px,90vw)] rounded-2xl border border-white/10 bg-zinc-900/95 px-6 py-4 text-center shadow-xl">
            <p className="text-sm font-medium text-white">{fsBusyLabel ?? 'Working…'}</p>
            {transferProgress && transferProgress.totalBytes > 0 ? (
              <>
                <div className="mt-3 h-1.5 w-full overflow-hidden rounded-full bg-white/10">
                  <div
                    className="h-full rounded-full bg-pitflix-primary transition-[width] duration-200 ease-out"
                    style={{
                      width: `${Math.min(100, (100 * transferProgress.copiedBytes) / transferProgress.totalBytes)}%`,
                    }}
                  />
                </div>
                <p className="mt-1.5 text-[11px] text-pitflix-muted">
                  {formatBytes(Math.min(transferProgress.copiedBytes, transferProgress.totalBytes))} of{" "}
                  {formatBytes(transferProgress.totalBytes)} ·{" "}
                  {Math.min(100, Math.round((100 * transferProgress.copiedBytes) / transferProgress.totalBytes))}%
                </p>
              </>
            ) : (
              <p className="mt-1 max-w-xs text-xs text-pitflix-muted">Large files copied across drives can take a minute. You can keep using the app.</p>
            )}
          </div>
        </div>
      ) : null}

      {/* ── SIDEBAR ────────────────────────────────────────────────────────── */}
      {/* Inert spacer holding this column's width in the normal flex flow, since the real sidebar
          below is position: fixed (taken out of flow entirely) — without this, the main panel would
          slide left to fill the gap where the sidebar visually still appears to be. */}
      <div style={{ width: sidebarCollapsed ? 60 : 220, flexShrink: 0, transition: 'width 0.18s ease' }} />
      <div
        style={{
          position: 'fixed',
          top: sidebarBox?.top ?? 0,
          left: sidebarBox?.left ?? 0,
          width: sidebarCollapsed ? 60 : 220,
          height: sidebarBox?.height ?? '100vh',
          zIndex: 10,
          background: '#141414',
          borderRight: '1px solid rgba(255,255,255,0.07)',
          display: 'flex',
          flexDirection: 'column',
          overflow: 'hidden',
          transition: 'width 0.18s ease',
        }}
      >
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
              <div style={{ width: 32, height: 32, borderRadius: 9, background: privateModeActive ? 'linear-gradient(135deg,#a855f7,#5b21b6)' : 'linear-gradient(135deg,#7c3aed,#4f1da3)', display: 'flex', alignItems: 'center', justifyContent: 'center', flexShrink: 0 }}>
                {privateModeActive ? (
                  <Lock style={{ width: 15, height: 15, color: 'white' }} />
                ) : (
                  <svg width="15" height="15" viewBox="0 0 24 24" fill="none" stroke="white" strokeWidth="2" strokeLinecap="round">
                    <rect x="2" y="3" width="20" height="14" rx="2"/>
                    <line x1="8" y1="21" x2="16" y2="21"/>
                    <line x1="12" y1="17" x2="12" y2="21"/>
                  </svg>
                )}
              </div>
              <div style={{ flex: 1, minWidth: 0 }}>
                <div style={{ fontSize: 13, fontWeight: 700, letterSpacing: '-0.02em', color: privateModeActive ? '#c4b5fd' : '#e0e0f0' }}>
                  {privateModeActive ? 'Private Mode' : 'My Device'}
                </div>
                <div style={{ fontSize: 9.5, color: 'rgba(200,200,235,0.55)', marginTop: 1 }}>
                  {privateModeActive ? 'Esc to exit' : 'Local storage'}
                </div>
              </div>
              {privateModeActive ? (
                <button
                  type="button"
                  onClick={() => { setPrivateModeActive(false); setCollectionsOpen(false); }}
                  title="Exit Private Mode"
                  style={{ width: 26, height: 26, display: 'flex', alignItems: 'center', justifyContent: 'center', borderRadius: 6, background: 'rgba(168,85,247,0.15)', border: 'none', color: '#c4b5fd', cursor: 'pointer', flexShrink: 0, transition: 'color 0.15s, background 0.15s' }}
                  onMouseEnter={(e) => { (e.currentTarget as HTMLButtonElement).style.color = '#fff'; (e.currentTarget as HTMLButtonElement).style.background = 'rgba(168,85,247,0.3)'; }}
                  onMouseLeave={(e) => { (e.currentTarget as HTMLButtonElement).style.color = '#c4b5fd'; (e.currentTarget as HTMLButtonElement).style.background = 'rgba(168,85,247,0.15)'; }}
                >
                  <X style={{ width: 13, height: 13 }} />
                </button>
              ) : null}
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

        {/* Search all locations */}
        {!sidebarCollapsed ? (
          <div style={{ padding: '14px 12px 0', flexShrink: 0 }}>
            <div style={{ display: 'flex', alignItems: 'center', gap: 8, background: globalSearchActive ? 'rgba(124,58,237,0.1)' : 'rgba(255,255,255,0.04)', border: `1px solid ${globalSearchActive ? 'rgba(124,58,237,0.4)' : 'rgba(255,255,255,0.07)'}`, borderRadius: 8, padding: '7px 10px' }}>
              <Search style={{ width: 12, height: 12, color: 'rgba(180,180,220,0.45)', flexShrink: 0 }} />
              <input
                ref={globalSearchInputRef}
                type="text"
                value={globalSearchInput}
                onChange={(e) => setGlobalSearchInput(e.target.value)}
                onKeyDown={(e) => {
                  if (e.key === 'Escape' && globalSearchInput) { e.preventDefault(); e.stopPropagation(); setGlobalSearchInput(''); }
                }}
                placeholder={privateModeActive ? 'Search private folders…' : 'Search all locations…'}
                title="Searches every saved location, including subfolders (Ctrl+Shift+F)"
                style={{ flex: 1, minWidth: 0, background: 'transparent', border: 'none', outline: 'none', color: '#e0e0f0', fontSize: 12, fontFamily: 'inherit' }}
              />
              {globalSearchInput ? (
                <button
                  type="button"
                  onClick={() => setGlobalSearchInput('')}
                  aria-label="Clear search"
                  style={{ background: 'transparent', border: 'none', color: 'rgba(200,200,235,0.55)', cursor: 'pointer', display: 'flex', padding: 0, flexShrink: 0 }}
                >
                  <X style={{ width: 12, height: 12 }} />
                </button>
              ) : null}
            </div>
          </div>
        ) : null}

        {/* LOCATIONS label */}
        {!sidebarCollapsed ? (
          <div style={{ padding: '16px 18px 8px', flexShrink: 0 }}>
            <div style={{ fontSize: 9, letterSpacing: 2, textTransform: 'uppercase', color: 'rgba(200,200,235,0.55)', fontWeight: 700 }}>
              {privateModeActive ? 'Private Folders' : 'Locations'}
            </div>
          </div>
        ) : (
          <div style={{ height: 12, flexShrink: 0 }} />
        )}

        {/* Location tabs */}
        <div style={{ flex: 1, minHeight: 0, overflowY: 'auto', padding: sidebarCollapsed ? '0 8px' : '0 10px' }}>
          {/* My Favorite / History — unlike My Videos below, available in both Normal and Private
              mode; each panel reads privateModeActive itself to show that mode's own separate list. */}
          {([
            { key: 'favorites', label: 'My Favorite', icon: Heart, open: favoritesOpen, set: setFavoritesOpen },
            { key: 'history', label: 'History', icon: Clock, open: historyOpen, set: setHistoryOpen },
          ] as const).map((item) => {
            const Icon = item.icon;
            return (
              <div
                key={item.key}
                title={sidebarCollapsed ? item.label : undefined}
                onClick={() => {
                  if (item.open) { item.set(false); return; }
                  setCollectionsOpen(false);
                  setFavoritesOpen(false);
                  setHistoryOpen(false);
                  item.set(true);
                  setCurrentPath(null);
                  exitSelectionMode();
                }}
                style={{
                  display: 'flex', alignItems: 'center', gap: 9,
                  justifyContent: sidebarCollapsed ? 'center' : 'flex-start',
                  padding: sidebarCollapsed ? '9px 0' : '9px 10px', borderRadius: 8, cursor: 'pointer',
                  background: item.open ? 'rgba(124,58,237,0.1)' : 'transparent',
                  marginBottom: 6, position: 'relative', transition: 'background 0.15s',
                }}
                onMouseEnter={(e) => { if (!item.open) (e.currentTarget as HTMLDivElement).style.background = 'rgba(255,255,255,0.04)'; }}
                onMouseLeave={(e) => { if (!item.open) (e.currentTarget as HTMLDivElement).style.background = 'transparent'; }}
              >
                <div style={{ width: 28, height: 28, borderRadius: 7, background: 'rgba(168,85,247,0.14)', border: '1px solid rgba(168,85,247,0.3)', display: 'flex', alignItems: 'center', justifyContent: 'center', flexShrink: 0 }}>
                  <Icon style={{ width: 13, height: 13, color: '#c4b5fd' }} />
                </div>
                {!sidebarCollapsed ? (
                  <>
                    <div style={{ flex: 1, minWidth: 0, fontSize: 12, fontWeight: 600, color: item.open ? '#c4b5fd' : 'rgba(225,225,245,0.88)' }}>
                      {item.label}
                    </div>
                    {item.open && (
                      <div style={{ width: 3, height: 20, background: '#7c3aed', borderRadius: 3, flexShrink: 0, boxShadow: '0 0 10px rgba(124,58,237,0.8)' }} />
                    )}
                  </>
                ) : null}
              </div>
            );
          })}
          {privateModeActive ? (
            <div
              title={sidebarCollapsed ? 'My Videos' : undefined}
              onClick={() => {
                if (collectionsOpen) { setCollectionsOpen(false); return; }
                setFavoritesOpen(false);
                setHistoryOpen(false);
                setCollectionsOpen(true); setCurrentPath(null); exitSelectionMode();
              }}
              style={{
                display: 'flex', alignItems: 'center', gap: 9,
                justifyContent: sidebarCollapsed ? 'center' : 'flex-start',
                padding: sidebarCollapsed ? '9px 0' : '9px 10px', borderRadius: 8, cursor: 'pointer',
                background: collectionsOpen ? 'rgba(124,58,237,0.1)' : 'transparent',
                marginBottom: 6, position: 'relative', transition: 'background 0.15s',
              }}
              onMouseEnter={(e) => { if (!collectionsOpen) (e.currentTarget as HTMLDivElement).style.background = 'rgba(255,255,255,0.04)'; }}
              onMouseLeave={(e) => { if (!collectionsOpen) (e.currentTarget as HTMLDivElement).style.background = 'transparent'; }}
            >
              <div style={{ width: 28, height: 28, borderRadius: 7, background: 'rgba(168,85,247,0.14)', border: '1px solid rgba(168,85,247,0.3)', display: 'flex', alignItems: 'center', justifyContent: 'center', flexShrink: 0 }}>
                <Film style={{ width: 13, height: 13, color: '#c4b5fd' }} />
              </div>
              {!sidebarCollapsed ? (
                <>
                  <div style={{ flex: 1, minWidth: 0, fontSize: 12, fontWeight: 600, color: collectionsOpen ? '#c4b5fd' : 'rgba(225,225,245,0.88)' }}>
                    My Videos
                  </div>
                  {collectionsOpen && (
                    <div style={{ width: 3, height: 20, background: '#7c3aed', borderRadius: 3, flexShrink: 0, boxShadow: '0 0 10px rgba(124,58,237,0.8)' }} />
                  )}
                </>
              ) : null}
            </div>
          ) : null}
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
                  setCollectionsOpen(false);
                  setFavoritesOpen(false);
                  setHistoryOpen(false);
                  if (isActive) { setCurrentPath(null); exitSelectionMode(); return; }
                  const subpathKey = privateModeActive ? LAST_SUBPATH_KEY_PRIVATE : LAST_SUBPATH_KEY_NORMAL;
                  const resumePath = loadLastSubpathMap(subpathKey)[p] ?? p;
                  setCurrentPath(resumePath); setTypeFilter('all'); setFilterText(''); exitSelectionMode();
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
            onClick={() => { setCollectionsOpen(false); setFavoritesOpen(false); setHistoryOpen(false); void pickFolder(); }}
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
      <div style={{ flex: 1, display: 'flex', flexDirection: 'column', overflow: 'hidden', background: '#141414', minWidth: 0, minHeight: 0 }}>

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
                title="Filter"
                style={{
                  width: 32, height: 32, display: 'flex', alignItems: 'center', justifyContent: 'center',
                  borderRadius: 8, cursor: 'pointer', flexShrink: 0, transition: 'all 0.15s',
                  background: filtersActive ? 'rgba(124,58,237,0.18)' : 'rgba(255,255,255,0.04)',
                  border: `1px solid ${filtersActive ? 'rgba(124,58,237,0.4)' : 'rgba(255,255,255,0.07)'}`,
                  color: filtersActive ? '#c4b5fd' : 'rgba(180,180,220,0.6)',
                }}
                onMouseEnter={(e) => { if (!filtersActive) (e.currentTarget as HTMLButtonElement).style.background = 'rgba(255,255,255,0.08)'; }}
                onMouseLeave={(e) => { if (!filtersActive) (e.currentTarget as HTMLButtonElement).style.background = 'rgba(255,255,255,0.04)'; }}
              >
                <Filter style={{ width: 14, height: 14 }} />
              </button>
              {filterMenuOpen ? (
                <div style={{
                  position: 'absolute', top: '120%', right: 0, zIndex: 60,
                  background: '#1C1C1C', border: '1px solid rgba(255,255,255,0.1)', borderRadius: 10,
                  padding: 5, minWidth: 190, maxHeight: 380, overflowY: 'auto', boxShadow: '0 20px 50px rgba(0,0,0,0.65)',
                  animation: 'deviceMenuPop 0.14s ease',
                }}>
                  <div style={{ fontSize: 9.5, letterSpacing: 1, textTransform: 'uppercase', color: 'rgba(180,180,220,0.4)', fontWeight: 700, padding: '6px 10px 4px' }}>Type</div>
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

                  <div style={{ height: 1, background: 'rgba(255,255,255,0.07)', margin: '5px 4px' }} />
                  <div style={{ fontSize: 9.5, letterSpacing: 1, textTransform: 'uppercase', color: 'rgba(180,180,220,0.4)', fontWeight: 700, padding: '6px 10px 4px' }}>Sort by</div>
                  {SORT_OPTIONS.map((so) => {
                    const active = sortBy === so.id;
                    return (
                      <div
                        key={so.id}
                        onClick={() => { setSortBy(so.id); setFilterMenuOpen(false); }}
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
                        {so.label}
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

            {/* Quick sort — fast keyboard-driven manual filing for loose videos */}
            {entries.some((e) => !e.is_directory && isPlayableMedia(e)) ? (
              <button
                type="button"
                onClick={() => setQuickSortOpen(true)}
                title="Quick sort"
                style={{ width: 32, height: 32, display: 'flex', alignItems: 'center', justifyContent: 'center', background: 'rgba(255,255,255,0.04)', border: '1px solid rgba(255,255,255,0.07)', color: 'rgba(180,180,220,0.6)', borderRadius: 8, cursor: 'pointer', flexShrink: 0, transition: 'all 0.15s' }}
                onMouseEnter={(e) => { (e.currentTarget as HTMLButtonElement).style.background = 'rgba(255,255,255,0.08)'; (e.currentTarget as HTMLButtonElement).style.color = '#e0e0f0'; }}
                onMouseLeave={(e) => { (e.currentTarget as HTMLButtonElement).style.background = 'rgba(255,255,255,0.04)'; (e.currentTarget as HTMLButtonElement).style.color = 'rgba(180,180,220,0.6)'; }}
              >
                <Zap style={{ width: 14, height: 14 }} />
              </button>
            ) : null}

            {/* Roulette — spin through this folder's videos and land on a random one to play */}
            {entries.some((e) => !e.is_directory && isPlayableMedia(e)) ? (
              <button
                type="button"
                onClick={() => setRouletteOpen(true)}
                title="Roulette"
                style={{ width: 32, height: 32, display: 'flex', alignItems: 'center', justifyContent: 'center', background: 'rgba(255,255,255,0.04)', border: '1px solid rgba(255,255,255,0.07)', color: 'rgba(180,180,220,0.6)', borderRadius: 8, cursor: 'pointer', flexShrink: 0, transition: 'all 0.15s' }}
                onMouseEnter={(e) => { (e.currentTarget as HTMLButtonElement).style.background = 'rgba(255,255,255,0.08)'; (e.currentTarget as HTMLButtonElement).style.color = '#e0e0f0'; }}
                onMouseLeave={(e) => { (e.currentTarget as HTMLButtonElement).style.background = 'rgba(255,255,255,0.04)'; (e.currentTarget as HTMLButtonElement).style.color = 'rgba(180,180,220,0.6)'; }}
              >
                <Dices style={{ width: 14, height: 14 }} />
              </button>
            ) : null}
          </div>
        ) : null}

        {/* Regenerate-thumbnails progress — its own row rather than a floating overlay, so it can
            never end up overlapping grid content the way a fixed-position badge did. Only shown
            while a Regenerate run is actually in flight; disappears once it finishes. */}
        {regenProgress ? (
          <div style={{ flexShrink: 0, display: 'flex', alignItems: 'center', gap: 10, padding: '8px 24px', borderBottom: '1px solid rgba(255,255,255,0.07)', background: '#1C1C1C' }}>
            <div style={{ flex: 1, maxWidth: 220, height: 5, borderRadius: 999, background: 'rgba(255,255,255,0.1)', overflow: 'hidden' }}>
              <div style={{ height: '100%', width: `${Math.min(100, Math.round((100 * regenProgress.done) / Math.max(1, regenProgress.total)))}%`, background: '#7c3aed', transition: 'width 0.2s ease' }} />
            </div>
            <span style={{ fontSize: 11.5, fontWeight: 600, color: 'rgba(200,200,235,0.65)', whiteSpace: 'nowrap' }}>
              Regenerating thumbnails… {regenProgress.done}/{regenProgress.total}
            </span>
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
            {privateModeActive ? (
              <button type="button" disabled={selectedPaths.size === 0} onClick={addSelectedToCollections}
                style={{ display: 'flex', alignItems: 'center', gap: 7, background: 'rgba(124,58,237,0.15)', color: '#c4b5fd', border: '1px solid rgba(124,58,237,0.35)', borderRadius: 8, padding: '8px 14px', fontSize: 12.5, fontWeight: 700, fontFamily: 'inherit', cursor: 'pointer', flexShrink: 0, transition: 'background 0.15s', opacity: selectedPaths.size === 0 ? 0.4 : 1 }}
                onMouseEnter={(e) => { if (selectedPaths.size > 0) (e.currentTarget as HTMLButtonElement).style.background = 'rgba(124,58,237,0.24)'; }}
                onMouseLeave={(e) => { (e.currentTarget as HTMLButtonElement).style.background = 'rgba(124,58,237,0.15)'; }}
              >
                <FolderPlus style={{ width: 13, height: 13 }} />
                Add to My Videos ({selectedPaths.size})
              </button>
            ) : null}
            <button type="button" disabled={fsBusy || selectedPaths.size === 0} onClick={() => void deleteSelected()}
              style={{ display: 'flex', alignItems: 'center', gap: 7, background: 'rgba(239,68,68,0.08)', color: '#f87171', border: '1px solid rgba(239,68,68,0.25)', borderRadius: 8, padding: '8px 14px', fontSize: 12.5, fontWeight: 600, fontFamily: 'inherit', cursor: 'pointer', flexShrink: 0, transition: 'background 0.15s', opacity: (fsBusy || selectedPaths.size === 0) ? 0.4 : 1 }}
              onMouseEnter={(e) => { if (!(fsBusy || selectedPaths.size === 0)) (e.currentTarget as HTMLButtonElement).style.background = 'rgba(239,68,68,0.15)'; }}
              onMouseLeave={(e) => { (e.currentTarget as HTMLButtonElement).style.background = 'rgba(239,68,68,0.08)'; }}
            >
              <Trash2 style={{ width: 13, height: 13 }} />
              Delete ({selectedPaths.size})
            </button>
            {privateModeActive ? null : (
              <button type="button" disabled={scanBusy || selectedPaths.size === 0} onClick={() => void scanSelectedIntoLibrary()}
                style={{ display: 'flex', alignItems: 'center', gap: 7, background: '#7c3aed', color: 'white', border: 'none', borderRadius: 8, padding: '8px 16px', fontSize: 12.5, fontWeight: 700, fontFamily: 'inherit', cursor: 'pointer', flexShrink: 0, boxShadow: '0 4px 16px rgba(124,58,237,0.35)', transition: 'background 0.15s', opacity: (scanBusy || selectedPaths.size === 0) ? 0.4 : 1 }}
                onMouseEnter={(e) => { if (!(scanBusy || selectedPaths.size === 0)) (e.currentTarget as HTMLButtonElement).style.background = '#6d28d9'; }}
                onMouseLeave={(e) => { (e.currentTarget as HTMLButtonElement).style.background = '#7c3aed'; }}
              >
                {scanBusy ? 'Scanning…' : `Add to library (${selectedPaths.size})`}
              </button>
            )}
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
          data-scroll-restore-anchor
          style={{ flex: 1, minHeight: 0, overflowY: 'auto', position: 'relative' }}
          onScroll={notifyScroll}
          onContextMenu={currentPath ? openBrowseContextMenu : undefined}
        >
          {globalSearchActive ? (
            <DeviceGlobalSearchPanel
              query={globalSearchQuery}
              roots={saved}
              exclude={privateModeActive ? [] : privateFolders}
              privateMode={privateModeActive}
              onOpenFolder={openFolderFromSearch}
            />
          ) : currentPath ? (
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
                          <button
                            type="button"
                            onClick={(ev) => {
                              ev.stopPropagation();
                              if (!currentPath) return;
                              removeLastPlayed(currentPath, item.path);
                              setLastPlayedRev((r) => r + 1);
                            }}
                            aria-label={`Remove ${fileDisplayTitle(item.name)} from Resume where you left off`}
                            title="Remove from this list"
                            style={{
                              position: 'absolute', top: 6, right: 6, zIndex: 1,
                              width: 18, height: 18, borderRadius: '50%', border: 'none',
                              background: 'rgba(0,0,0,0.5)', color: 'rgba(224,224,240,0.7)',
                              display: 'flex', alignItems: 'center', justifyContent: 'center', cursor: 'pointer',
                            }}
                          >
                            <X style={{ width: 11, height: 11 }} />
                          </button>
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
                        const isBeingDragged = !!draggingPaths && draggingPaths.includes(e.path);
                        const isDropHover = dragOverPath === e.path && e.is_directory;

                        const thumbH = Math.max(80, Math.round(120 - (effectiveCols - 3) * 8));
                        const thumbBg = e.is_directory
                          ? 'linear-gradient(160deg,rgba(124,58,237,0.07),rgba(124,58,237,0.02))'
                          : '#1C1C1C';

                        return (
                          <button
                            key={e.path}
                            type="button"
                            data-device-entry
                            data-no-window-drag
                            data-entry-path={e.path}
                            data-is-directory={e.is_directory ? '1' : undefined}
                            onClick={() => {
                              if (suppressClickRef.current) { suppressClickRef.current = false; return; }
                              void openEntry(e);
                            }}
                            onContextMenu={(ev) => {
                              ev.preventDefault(); ev.stopPropagation();
                              setFolderContextMenu(null);
                              setContextMenu({ entry: e, x: ev.clientX, y: ev.clientY });
                            }}
                            onPointerDown={(ev) => {
                              if (ev.button !== 0) return;
                              const dragPaths = selectionMode && selectedPaths.has(e.path) ? selectedList : [e.path];
                              dragStateRef.current = {
                                pointerId: ev.pointerId,
                                startX: ev.clientX,
                                startY: ev.clientY,
                                paths: dragPaths,
                                active: false,
                              };
                            }}
                            onPointerMove={(ev) => {
                              const st = dragStateRef.current;
                              if (!st || st.pointerId !== ev.pointerId) return;
                              if (!st.active) {
                                const dx = ev.clientX - st.startX;
                                const dy = ev.clientY - st.startY;
                                if (dx * dx + dy * dy < 36) return; // ~6px threshold — below this, it's still a click
                                st.active = true;
                                suppressClickRef.current = true; // the click after this pointerup must not open/play the item
                                (ev.currentTarget as HTMLElement).setPointerCapture(ev.pointerId);
                                setDraggingPaths(st.paths);
                                document.body.style.cursor = 'grabbing';
                              }
                              setDragGhost({ x: ev.clientX, y: ev.clientY, count: st.paths.length });
                              const under = document.elementFromPoint(ev.clientX, ev.clientY) as HTMLElement | null;
                              const folderEl = under?.closest<HTMLElement>('[data-entry-path]');
                              const folderPath =
                                folderEl?.dataset.isDirectory === '1' ? folderEl.dataset.entryPath ?? null : null;
                              const valid =
                                !!folderPath && !st.paths.includes(folderPath) && canMoveEntriesTo(st.paths, folderPath);
                              setDragOverPathBoth(valid ? folderPath : null);
                            }}
                            onPointerUp={(ev) => {
                              const st = dragStateRef.current;
                              dragStateRef.current = null;
                              document.body.style.cursor = '';
                              setDragGhost(null);
                              if (st?.active) {
                                (ev.currentTarget as HTMLElement).releasePointerCapture(ev.pointerId);
                                const dropPath = dragOverPathRef.current;
                                if (dropPath) {
                                  const wasSelectionDrag = selectionMode && selectedPaths.has(st.paths[0] ?? '');
                                  void transferToFolder(dropPath, {
                                    mode: 'move',
                                    paths: st.paths,
                                    clearSelection: wasSelectionDrag,
                                  });
                                }
                              }
                              setDraggingPaths(null);
                              setDragOverPathBoth(null);
                            }}
                            onPointerCancel={() => {
                              dragStateRef.current = null;
                              document.body.style.cursor = '';
                              setDragGhost(null);
                              setDraggingPaths(null);
                              setDragOverPathBoth(null);
                            }}
                            style={{
                              borderRadius: 10, overflow: 'hidden', position: 'relative',
                              cursor: draggingPaths ? (isDropHover ? 'copy' : 'grabbing') : 'pointer',
                              background: '#1C1C1C',
                              border: `1px solid ${isDropHover ? 'rgba(124,58,237,0.9)' : isSelected ? 'rgba(124,58,237,0.7)' : isMoveTarget ? 'rgba(124,58,237,0.35)' : 'rgba(255,255,255,0.07)'}`,
                              opacity: isBeingDragged ? 0.4 : 1,
                              boxShadow: isDropHover ? '0 0 0 2px rgba(124,58,237,0.5) inset' : undefined,
                              textAlign: 'left', transformOrigin: 'center center',
                              transition: 'transform 0.18s ease, box-shadow 0.18s ease, border-color 0.18s ease, opacity 0.15s ease',
                            }}
                            onMouseEnter={(ev) => {
                              const el = ev.currentTarget as HTMLButtonElement;
                              const scale = e.media_kind === 'video' ? 1.32 : 1.2;
                              el.style.transform = `translateY(-2px) scale(${scale})`;
                              el.style.boxShadow = '0 20px 48px rgba(0,0,0,0.65)';
                              el.style.borderColor = 'rgba(124,58,237,0.3)';
                              el.style.zIndex = '10';
                              // The virtualized row wrapper has its own `transform` (translateY, for
                              // positioning), which creates a *separate* CSS stacking context — this
                              // button's own z-index can't escape it to paint above the NEXT row's
                              // wrapper (later in DOM = paints on top by default). Bump the row
                              // wrapper's z-index too so the whole enlarged card can overlap neighbors.
                              const rowEl = el.closest<HTMLElement>('[data-index]');
                              if (rowEl) rowEl.style.zIndex = '10';
                            }}
                            onMouseLeave={(ev) => {
                              const el = ev.currentTarget as HTMLButtonElement;
                              el.style.transform = 'translateY(0) scale(1)';
                              el.style.boxShadow = 'none';
                              el.style.borderColor = isSelected ? 'rgba(124,58,237,0.7)' : isMoveTarget ? 'rgba(124,58,237,0.35)' : 'rgba(255,255,255,0.06)';
                              el.style.zIndex = '0';
                              const rowEl = el.closest<HTMLElement>('[data-index]');
                              if (rowEl) rowEl.style.zIndex = '';
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

                            {/* Active drag-and-drop hover hint — the primary "valid drop target" signal.
                                The native OS cursor badge for a valid drop is a small, fixed system icon
                                (not customizable via CSS), so this on-tile highlight is what actually
                                needs to read clearly at a glance. */}
                            {isDropHover ? (
                              <div
                                className="device-drop-hover-pulse"
                                style={{
                                  position: 'absolute', inset: 0, zIndex: 6, display: 'flex', flexDirection: 'column',
                                  alignItems: 'center', justifyContent: 'center', gap: 6,
                                  background: 'rgba(124,58,237,0.32)',
                                  border: '2.5px solid #a78bfa',
                                  borderRadius: 10,
                                  pointerEvents: 'none',
                                }}
                              >
                                <div style={{
                                  width: 34, height: 34, borderRadius: '50%', background: '#7c3aed',
                                  display: 'flex', alignItems: 'center', justifyContent: 'center',
                                  boxShadow: '0 2px 10px rgba(124,58,237,0.7)',
                                }}>
                                  <FolderOpen style={{ width: 18, height: 18, color: 'white' }} strokeWidth={2.4} />
                                </div>
                                <span style={{ background: 'rgba(0,0,0,0.8)', color: '#e9d5ff', fontSize: 10, fontWeight: 800, padding: '3px 9px', borderRadius: 5, letterSpacing: 0.2 }}>
                                  Drop here
                                </span>
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
                                <>
                                  <DeviceVideoHoverPreview path={e.path}>
                                    <LazyFolderThumb mode="video" path={e.path} />
                                  </DeviceVideoHoverPreview>
                                  <DeviceDurationBadge path={e.path} />
                                </>
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
          ) : collectionsOpen ? (
            <CollectionsPanel roots={privateFolders} />
          ) : favoritesOpen ? (
            <DeviceFavoritesPanel
              privateMode={privateModeActive}
              searchRoots={privateModeActive ? [...privateFolders, ...normalSaved] : normalSaved}
              excludeRoots={privateModeActive ? [] : privateFolders}
            />
          ) : historyOpen ? (
            <DeviceHistoryPanel
              privateMode={privateModeActive}
              searchRoots={privateModeActive ? [...privateFolders, ...normalSaved] : normalSaved}
              excludeRoots={privateModeActive ? [] : privateFolders}
            />
          ) : (
            /* Empty / welcome state when no folder selected */
            <div style={{ display: 'flex', flexDirection: 'column', alignItems: 'center', justifyContent: 'center', height: '100%', gap: 16, color: 'rgba(180,180,220,0.3)', textAlign: 'center', padding: '0 40px' }}>
              <svg width="48" height="48" viewBox="0 0 24 24" fill="none" stroke="rgba(124,58,237,0.3)" strokeWidth="1.2" strokeLinecap="round">
                <path d="M22 19a2 2 0 0 1-2 2H4a2 2 0 0 1-2-2V5a2 2 0 0 1 2-2h5l2 3h9a2 2 0 0 1 2 2z"/>
              </svg>
              <div>
                <p style={{ fontSize: 14, fontWeight: 600, color: 'rgba(180,180,220,0.45)', marginBottom: 6 }}>
                  {saved.length === 0
                    ? (privateModeActive ? 'No private folders yet' : 'No locations yet')
                    : 'Select a location'}
                </p>
                <p style={{ fontSize: 12, color: 'rgba(180,180,220,0.28)' }}>
                  {saved.length === 0
                    ? (privateModeActive
                        ? 'Use "Add location" in the sidebar to mark a folder private.'
                        : 'Use "Add location" in the sidebar to bookmark a folder.')
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
