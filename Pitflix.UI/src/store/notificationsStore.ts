import { create } from "zustand";

/** A single entry in the notifications center (bell dropdown on the Home header). */
export type PitflixNotificationKind =
  | "matched"
  | "unmatched"
  | "scan"
  | "sync"
  | "watched"
  | "airdate"
  | "trailer"
  | "info";

export type PitflixNotification = {
  id: string;
  kind: PitflixNotificationKind;
  title: string;
  message?: string;
  /** Optional in-app route the row links to (e.g. `/trailers`, `/movie/123`). */
  href?: string;
  ts: number; // epoch ms
  read: boolean;
};

const STORAGE_KEY = "pitflix.notifications.v1";
const MAX = 60;

function load(): PitflixNotification[] {
  try {
    const raw = localStorage.getItem(STORAGE_KEY);
    if (!raw) return [];
    const arr = JSON.parse(raw) as unknown;
    return Array.isArray(arr) ? (arr as PitflixNotification[]).slice(0, MAX) : [];
  } catch {
    return [];
  }
}

function persist(items: PitflixNotification[]) {
  try {
    localStorage.setItem(STORAGE_KEY, JSON.stringify(items.slice(0, MAX)));
  } catch {
    /* storage full / unavailable — notifications are best-effort */
  }
}

type NewNotification = Omit<PitflixNotification, "id" | "ts" | "read"> & { ts?: number };

type NotificationsStore = {
  items: PitflixNotification[];
  add: (n: NewNotification) => void;
  markAllRead: () => void;
  remove: (id: string) => void;
  clear: () => void;
};

// Same kind+title arriving again within this window is treated as a duplicate delivery (e.g. an
// SSE reconnect briefly overlapping the old connection) rather than a genuinely new event.
const DUPLICATE_WINDOW_MS = 8_000;

export const useNotificationsStore = create<NotificationsStore>((set) => ({
  items: load(),
  add: (n) =>
    set((s) => {
      const nowTs = n.ts ?? Date.now();
      const isDuplicate = s.items.some(
        (existing) =>
          existing.kind === n.kind &&
          existing.title === n.title &&
          Math.abs(nowTs - existing.ts) < DUPLICATE_WINDOW_MS,
      );
      if (isDuplicate) return s;

      const item: PitflixNotification = {
        id: `${Date.now()}-${Math.random().toString(36).slice(2, 8)}`,
        ts: n.ts ?? Date.now(),
        read: false,
        kind: n.kind,
        title: n.title,
        message: n.message,
        href: n.href,
      };
      const items = [item, ...s.items].slice(0, MAX);
      persist(items);
      return { items };
    }),
  markAllRead: () =>
    set((s) => {
      const items = s.items.map((i) => (i.read ? i : { ...i, read: true }));
      persist(items);
      return { items };
    }),
  remove: (id) =>
    set((s) => {
      const items = s.items.filter((i) => i.id !== id);
      persist(items);
      return { items };
    }),
  clear: () =>
    set(() => {
      persist([]);
      return { items: [] };
    }),
}));

/** Convenience for pushing from non-React code (e.g. the scan SSE handler). */
export const pushNotification = (n: NewNotification) => useNotificationsStore.getState().add(n);
