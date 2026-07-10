// Grid thumbnail cache for local image files — same idea as video thumbnails:
// in-memory Map + IndexedDB so folder revisits don't re-decode every image.

const MAX_ENTRIES = 3000;
const cache = new Map<string, string>();

export function getImageThumb(path: string): string | undefined {
  return cache.get(path);
}

const listeners = new Map<string, Set<() => void>>();

export function onImageReady(path: string, cb: () => void): () => void {
  let set = listeners.get(path);
  if (!set) { set = new Set(); listeners.set(path, set); }
  set.add(cb);
  return () => {
    set!.delete(cb);
    if (set!.size === 0) listeners.delete(path);
  };
}

function cacheFromDisk(path: string, dataUrl: string): void {
  if (cache.size >= MAX_ENTRIES) {
    const oldest = cache.keys().next().value;
    if (oldest !== undefined) cache.delete(oldest);
  }
  cache.set(path, dataUrl);
  listeners.get(path)?.forEach((cb) => cb());
}

export function setImageThumb(path: string, dataUrl: string): void {
  if (cache.size >= MAX_ENTRIES) {
    const oldest = cache.keys().next().value;
    if (oldest !== undefined) cache.delete(oldest);
  }
  cache.set(path, dataUrl);
  listeners.get(path)?.forEach((cb) => cb());
  persistImageThumb(path, dataUrl);
}

const DB_NAME = "pitflix-image-cache";
const STORE_NAME = "images_v1";
const MAX_DISK_ENTRIES = 8000;
const DB_VERSION = 1;

let dbPromise: Promise<IDBDatabase | null> | null = null;

function openImageDb(): Promise<IDBDatabase | null> {
  if (dbPromise) return dbPromise;
  dbPromise = new Promise((resolve) => {
    if (typeof indexedDB === "undefined") { resolve(null); return; }
    try {
      const req = indexedDB.open(DB_NAME, DB_VERSION);
      req.onupgradeneeded = () => {
        const db = req.result;
        if (!db.objectStoreNames.contains(STORE_NAME)) db.createObjectStore(STORE_NAME);
      };
      req.onsuccess = () => resolve(req.result);
      req.onerror = () => resolve(null);
      req.onblocked = () => resolve(null);
    } catch {
      resolve(null);
    }
  });
  return dbPromise;
}

function persistImageThumb(path: string, dataUrl: string): void {
  void openImageDb().then((db) => {
    if (!db) return;
    try {
      db.transaction(STORE_NAME, "readwrite").objectStore(STORE_NAME).put(dataUrl, path);
    } catch {
      // ignore
    }
  });
}

export function loadImageFromDisk(path: string): Promise<string | undefined> {
  const inMemory = cache.get(path);
  if (inMemory !== undefined) return Promise.resolve(inMemory);

  return openImageDb().then((db) => {
    if (!db) return undefined;
    return new Promise<string | undefined>((resolve) => {
      try {
        const req = db.transaction(STORE_NAME, "readonly").objectStore(STORE_NAME).get(path);
        req.onsuccess = () => {
          const val = req.result;
          if (typeof val === "string") { cacheFromDisk(path, val); resolve(val); }
          else resolve(undefined);
        };
        req.onerror = () => resolve(undefined);
      } catch {
        resolve(undefined);
      }
    });
  });
}

/** Downscale a local image to a grid-friendly JPEG data URL. */
export function captureImageThumb(src: string): Promise<string | null> {
  return new Promise((resolve) => {
    const img = new Image();
    img.crossOrigin = "anonymous";

    let settled = false;
    const done = (result: string | null) => {
      if (settled) return;
      settled = true;
      clearTimeout(timer);
      resolve(result);
    };

    const timer = setTimeout(() => done(null), 12_000);

    img.onerror = () => done(null);
    img.onload = () => {
      try {
        const vw = img.naturalWidth || img.width || 320;
        const vh = img.naturalHeight || img.height || 180;
        const aspect = vw / vh;
        const MAX_DIM = 320;
        const cw = aspect >= 1 ? MAX_DIM : Math.max(1, Math.round(MAX_DIM * aspect));
        const ch = aspect >= 1 ? Math.max(1, Math.round(MAX_DIM / aspect)) : MAX_DIM;
        const canvas = document.createElement("canvas");
        canvas.width = cw;
        canvas.height = ch;
        const ctx = canvas.getContext("2d");
        if (!ctx) { done(null); return; }
        ctx.drawImage(img, 0, 0, cw, ch);
        const dataUrl = canvas.toDataURL("image/jpeg", 0.88);
        done(dataUrl.length > 200 ? dataUrl : null);
      } catch {
        done(null);
      }
    };

    img.src = src;
  });
}

function pruneOldDiskEntries(): void {
  void openImageDb().then((db) => {
    if (!db) return;
    try {
      const tx = db.transaction(STORE_NAME, "readwrite");
      const store = tx.objectStore(STORE_NAME);
      const countReq = store.count();
      countReq.onsuccess = () => {
        const total = countReq.result;
        if (total <= MAX_DISK_ENTRIES) return;
        let toDelete = total - MAX_DISK_ENTRIES;
        const cursorReq = store.openCursor();
        cursorReq.onsuccess = () => {
          const cursor = cursorReq.result;
          if (!cursor || toDelete <= 0) return;
          cursor.delete();
          toDelete--;
          cursor.continue();
        };
      };
    } catch {
      // ignore
    }
  });
}

pruneOldDiskEntries();

export function clearDeviceImageMemoryCache(): void {
  cache.clear();
}

export function clearDeviceImageDiskCache(): Promise<void> {
  return openImageDb().then((db) => {
    if (!db) return;
    return new Promise<void>((resolve) => {
      try {
        const tx = db.transaction(STORE_NAME, "readwrite");
        const req = tx.objectStore(STORE_NAME).clear();
        req.onsuccess = () => resolve();
        req.onerror = () => resolve();
      } catch {
        resolve();
      }
    });
  });
}

/** Preload full-size image into browser cache for the viewer (no IndexedDB). */
export function preloadImageSrc(src: string): void {
  const img = new Image();
  img.src = src;
}
