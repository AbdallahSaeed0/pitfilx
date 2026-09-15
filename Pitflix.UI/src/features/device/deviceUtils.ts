export const STORAGE_KEY = "pitflix.device.savedFolders.v1";
export const BROWSE_PATH_KEY = "pitflix.device.browsePath.v1";
export const GRID_COLS_KEY = "pitflix.device.gridCols.v1";
export const SIDEBAR_COLLAPSED_KEY = "pitflix.device.sidebarCollapsed.v1";

// Private Mode — a separate, fully-hidden set of folders + browse position. Stored under its own
// keys so it never mixes with the normal saved-folder list, and "active" lives in sessionStorage
// (not localStorage) so it doesn't silently persist as on across app restarts.
export const PRIVATE_FOLDERS_KEY = "pitflix.device.privateFolders.v1";
export const PRIVATE_BROWSE_PATH_KEY = "pitflix.device.privateBrowsePath.v1";
export const PRIVATE_MODE_ACTIVE_KEY = "pitflix.device.privateModeActive.v1";

export function readPrivateModeActiveFlag(): boolean {
  try {
    return sessionStorage.getItem(PRIVATE_MODE_ACTIVE_KEY) === "1";
  } catch {
    return false;
  }
}

export function loadPrivateFolders(): string[] {
  try {
    const raw = localStorage.getItem(PRIVATE_FOLDERS_KEY);
    if (!raw) return [];
    const j = JSON.parse(raw) as unknown;
    return Array.isArray(j) ? j.filter((x): x is string => typeof x === "string" && x.length > 0) : [];
  } catch {
    return [];
  }
}

export function savePrivateFolders(paths: string[]) {
  try {
    localStorage.setItem(PRIVATE_FOLDERS_KEY, JSON.stringify(paths));
  } catch {
    // ignore
  }
}

export const GRID_COLS_MIN = 3;
export const GRID_COLS_MAX = 12;

export function loadGridCols(): number {
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

export function loadSidebarCollapsed(): boolean {
  try {
    return localStorage.getItem(SIDEBAR_COLLAPSED_KEY) === "1";
  } catch {
    return false;
  }
}

export function saveSidebarCollapsed(collapsed: boolean): void {
  try {
    localStorage.setItem(SIDEBAR_COLLAPSED_KEY, collapsed ? "1" : "0");
  } catch {
    // ignore
  }
}

export type DeviceFsEntry = {
  name: string;
  path: string;
  is_directory: boolean;
  media_kind?: string | null;
  size_bytes?: number | null;
  /** Milliseconds since epoch — when the file landed on this disk (falls back to last-modified
   * where the OS/filesystem has no separate creation time). */
  created_at?: number | null;
};

export function loadSaved(): string[] {
  try {
    const raw = localStorage.getItem(STORAGE_KEY);
    if (!raw) return [];
    const j = JSON.parse(raw) as unknown;
    return Array.isArray(j) ? j.filter((x): x is string => typeof x === "string" && x.length > 0) : [];
  } catch {
    return [];
  }
}

export function saveSaved(paths: string[]) {
  localStorage.setItem(STORAGE_KEY, JSON.stringify(paths));
}

export function isPlayableMedia(e: DeviceFsEntry): boolean {
  if (e.is_directory) return false;
  if (e.media_kind === "video") return true;
  const n = e.name.toLowerCase();
  return /\.(mp3|m4a|aac|flac|wav|ogg|opus|wma|mka)$/i.test(n);
}

export function fileDisplayTitle(fileName: string): string {
  return fileName.replace(/\.[^/.]+$/, "").trim() || fileName;
}

export function parentDirectory(filePath: string): string {
  const s = filePath.trim().replace(/[/\\]+$/, "");
  const i = Math.max(s.lastIndexOf("\\"), s.lastIndexOf("/"));
  if (i <= 0) return s;
  return s.slice(0, i);
}

export function normalizePathKey(p: string): string {
  return p.trim().replace(/[/\\]+$/, "");
}

// Per-folder "last played" — stored purely in localStorage, most-recent-first, capped at
// LAST_PLAYED_MAX entries. Separate from "Continue Watching" (history API); only shown on My Device.
export const LAST_PLAYED_KEY = "pitflix.device.lastPlayed.v1";
export const LAST_PLAYED_MAX = 5;

/** Old format was folderPath -> single filePath; new format is folderPath -> filePath[]. */
type LastPlayedMap = Record<string, string | string[]>;

function toList(value: string | string[] | undefined): string[] {
  if (!value) return [];
  return Array.isArray(value) ? value : [value];
}

export function saveLastPlayed(folderPath: string, filePath: string): void {
  try {
    const raw = localStorage.getItem(LAST_PLAYED_KEY);
    const map = raw ? (JSON.parse(raw) as LastPlayedMap) : {};
    const folderKey = normalizePathKey(folderPath);
    const existing = toList(map[folderKey]).filter((p) => p !== filePath);
    map[folderKey] = [filePath, ...existing].slice(0, LAST_PLAYED_MAX);
    localStorage.setItem(LAST_PLAYED_KEY, JSON.stringify(map));
    if (typeof window !== "undefined") {
      window.dispatchEvent(
        new CustomEvent("pitflix-device-last-played", {
          detail: { folderPath: folderKey, filePath },
        }),
      );
    }
  } catch { /* ignore */ }
}

/** Persist My Device "last played" when closing the player or switching folder siblings. */
export function recordDeviceLastPlayedFromPlayer(
  filePath: string,
  opts?: { suppressContinueWatching?: boolean; returnToPathname?: string },
): void {
  if (!filePath.trim()) return;
  const fromDevice =
    opts?.suppressContinueWatching === true || opts?.returnToPathname === "/my-device";
  if (!fromDevice) return;
  // Same universal trigger point as before (return from the player), now also feeding the global
  // History list — this fires for a video opened from a normal folder, an actress folder, or a
  // category folder alike, since all three route through the player with these same opts.
  recordHistory(readPrivateModeActiveFlag(), filePath, "video");
  const folder = parentDirectory(filePath);
  if (!folder) return;
  saveLastPlayed(folder, filePath);
}

/** Most-recent-first, up to LAST_PLAYED_MAX file paths played in this folder. */
export function loadLastPlayedFilePaths(folderPath: string): string[] {
  try {
    const raw = localStorage.getItem(LAST_PLAYED_KEY);
    if (!raw) return [];
    const map = JSON.parse(raw) as LastPlayedMap;
    return toList(map[normalizePathKey(folderPath)]).slice(0, LAST_PLAYED_MAX);
  } catch {
    return [];
  }
}

/** Removes one file from the "Resume where you left off" slider for its folder. */
export function removeLastPlayed(folderPath: string, filePath: string): void {
  try {
    const raw = localStorage.getItem(LAST_PLAYED_KEY);
    if (!raw) return;
    const map = JSON.parse(raw) as LastPlayedMap;
    const folderKey = normalizePathKey(folderPath);
    const next = toList(map[folderKey]).filter((p) => p !== filePath);
    if (next.length > 0) map[folderKey] = next;
    else delete map[folderKey];
    localStorage.setItem(LAST_PLAYED_KEY, JSON.stringify(map));
    if (typeof window !== "undefined") {
      window.dispatchEvent(
        new CustomEvent("pitflix-device-last-played", { detail: { folderPath: folderKey, filePath } }),
      );
    }
  } catch { /* ignore */ }
}

// ── My Favorite ──────────────────────────────────────────────────────────────
// Separate keys per mode (same pattern as SCROLL_MAP_KEY_NORMAL/PRIVATE elsewhere) so a favorite
// added while browsing privately never surfaces in normal mode or vice versa. Files only (not
// folders) — an individually favorited video/image, addable from any normal folder, actress folder,
// or category folder.
const FAVORITES_KEY_NORMAL = "pitflix.device.favorites.v1";
const FAVORITES_KEY_PRIVATE = "pitflix.device.privateFavorites.v1";

export type DeviceMediaKind = "video" | "image";
export type DeviceFavoriteEntry = { path: string; mediaKind: DeviceMediaKind; addedAt: number };

function favoritesKey(privateMode: boolean): string {
  return privateMode ? FAVORITES_KEY_PRIVATE : FAVORITES_KEY_NORMAL;
}

export function loadFavorites(privateMode: boolean): DeviceFavoriteEntry[] {
  try {
    const raw = localStorage.getItem(favoritesKey(privateMode));
    if (!raw) return [];
    const list = JSON.parse(raw) as unknown;
    if (!Array.isArray(list)) return [];
    return list.filter(
      (e): e is DeviceFavoriteEntry =>
        !!e && typeof e === "object" && typeof (e as DeviceFavoriteEntry).path === "string",
    );
  } catch {
    return [];
  }
}

function saveFavorites(privateMode: boolean, list: DeviceFavoriteEntry[]): void {
  try {
    localStorage.setItem(favoritesKey(privateMode), JSON.stringify(list));
  } catch { /* ignore */ }
}

export function isFavorite(privateMode: boolean, path: string): boolean {
  return loadFavorites(privateMode).some((e) => e.path === path);
}

export function addFavorite(privateMode: boolean, path: string, mediaKind: DeviceMediaKind): void {
  const list = loadFavorites(privateMode).filter((e) => e.path !== path);
  list.unshift({ path, mediaKind, addedAt: Date.now() });
  saveFavorites(privateMode, list);
}

export function removeFavorite(privateMode: boolean, path: string): void {
  saveFavorites(privateMode, loadFavorites(privateMode).filter((e) => e.path !== path));
}

/** Adds if not already favorited, removes if it is. Returns the new favorited state. */
export function toggleFavorite(privateMode: boolean, path: string, mediaKind: DeviceMediaKind): boolean {
  if (isFavorite(privateMode, path)) {
    removeFavorite(privateMode, path);
    return false;
  }
  addFavorite(privateMode, path, mediaKind);
  return true;
}

// ── History ────────────────────────────────────────────────────────────────
// One entry per item, bumped to the top and its timestamp refreshed on reopen — not a full
// chronological log. Separate keys per mode, same reasoning as favorites above. Covers anything
// opened from a normal folder, an actress folder, or a category folder — recorded from
// recordDeviceLastPlayedFromPlayer (videos, on return from the player — the same trigger the
// existing per-folder "last played" feature already uses) and directly at open time for images
// (there's no equivalent "player session" to wait for).
const HISTORY_KEY_NORMAL = "pitflix.device.history.v1";
const HISTORY_KEY_PRIVATE = "pitflix.device.privateHistory.v1";
const HISTORY_MAX = 300;

export type DeviceHistoryEntry = { path: string; mediaKind: DeviceMediaKind; openedAt: number };

function historyKey(privateMode: boolean): string {
  return privateMode ? HISTORY_KEY_PRIVATE : HISTORY_KEY_NORMAL;
}

export function loadHistory(privateMode: boolean): DeviceHistoryEntry[] {
  try {
    const raw = localStorage.getItem(historyKey(privateMode));
    if (!raw) return [];
    const list = JSON.parse(raw) as unknown;
    if (!Array.isArray(list)) return [];
    return list.filter(
      (e): e is DeviceHistoryEntry =>
        !!e && typeof e === "object" && typeof (e as DeviceHistoryEntry).path === "string",
    );
  } catch {
    return [];
  }
}

function saveHistory(privateMode: boolean, list: DeviceHistoryEntry[]): void {
  try {
    localStorage.setItem(historyKey(privateMode), JSON.stringify(list));
  } catch { /* ignore */ }
}

export function recordHistory(privateMode: boolean, path: string, mediaKind: DeviceMediaKind): void {
  if (!path.trim()) return;
  const list = loadHistory(privateMode).filter((e) => e.path !== path);
  list.unshift({ path, mediaKind, openedAt: Date.now() });
  saveHistory(privateMode, list.slice(0, HISTORY_MAX));
}

export function removeHistoryEntry(privateMode: boolean, path: string): void {
  saveHistory(privateMode, loadHistory(privateMode).filter((e) => e.path !== path));
}

export function clearHistory(privateMode: boolean): void {
  saveHistory(privateMode, []);
}

export type DeviceEntryDetails = {
  name: string;
  path: string;
  is_directory: boolean;
  size_bytes?: number | null;
  child_count?: number | null;
  modified_ms?: number | null;
  created_ms?: number | null;
  media_kind?: string | null;
};

export function formatBytes(bytes: number): string {
  if (bytes < 1024) return `${bytes} B`;
  if (bytes < 1024 * 1024) return `${(bytes / 1024).toFixed(1)} KB`;
  if (bytes < 1024 * 1024 * 1024) return `${(bytes / (1024 * 1024)).toFixed(1)} MB`;
  return `${(bytes / (1024 * 1024 * 1024)).toFixed(2)} GB`;
}

export function formatDeviceTimestamp(ms: number | null | undefined): string {
  if (ms == null) return "—";
  try {
    return new Date(ms).toLocaleString();
  } catch {
    return "—";
  }
}

export function suggestNewFolderName(entries: { name: string }[]): string {
  const base = "New folder";
  const exists = (name: string) =>
    entries.some((e) => e.name.toLowerCase() === name.toLowerCase());
  if (!exists(base)) return base;
  let n = 2;
  while (exists(`${base} (${n})`)) n += 1;
  return `${base} (${n})`;
}

export function isSavedRootPath(saved: string[], path: string): boolean {
  const key = normalizePathKey(path);
  return saved.some((s) => normalizePathKey(s).toLowerCase() === key.toLowerCase());
}

export function isPathInside(child: string, parent: string): boolean {
  const childKey = normalizePathKey(child).toLowerCase();
  const parentKey = normalizePathKey(parent).toLowerCase();
  if (!childKey || !parentKey) return false;
  if (childKey === parentKey) return true;
  const sep = parentKey.includes("\\") ? "\\" : "/";
  return childKey.startsWith(`${parentKey}${sep}`);
}

export function canMoveEntriesTo(entries: string[], destinationDir: string): boolean {
  const destKey = normalizePathKey(destinationDir);
  return entries.every((src) => {
    const srcKey = normalizePathKey(src);
    if (srcKey === destKey) return false;
    if (isPathInside(destKey, srcKey)) return false;
    return true;
  });
}

// Gap between grid tiles (matches gap-3 = 12px in Tailwind)
export const GRID_GAP = 12;
// Approximate height of the text label below each tile
export const TILE_LABEL_HEIGHT = 36;
