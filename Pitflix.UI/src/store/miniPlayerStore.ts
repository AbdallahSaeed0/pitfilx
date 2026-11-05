import { create } from "zustand";
import type { PlaybackLaunchState } from "../types/playback";

/**
 * In-app mini player: the embedded player shrinks into a corner box INSIDE the main window while
 * the rest of the app stays browsable. The player page is kept mounted by PersistentPlayerHost
 * (it's never unmounted while mini, so the libmpv session keeps playing) — this store is what lets
 * it outlive the /player route.
 */

/** Default size of the in-app mini player box and its default inset from the bottom-right (CSS px). */
export const IN_APP_MINI_WIDTH = 400;
export const IN_APP_MINI_MARGIN = 16;
/** Resize limits (width; height always follows at 16:9). */
export const IN_APP_MINI_MIN_WIDTH = 280;
export const IN_APP_MINI_MAX_WIDTH = 960;

/** Box height for a width — always 16:9, like the video it holds. */
export function miniPlayerHeight(width: number): number {
  return Math.round((width * 9) / 16);
}

/** The mini player box: offsets from the window's bottom-right corner, and its width (CSS px). */
export type MiniPlayerPos = { right: number; bottom: number; width: number };

const POS_KEY = "pitflix.miniPlayer.pos.v1";

function loadPos(): MiniPlayerPos {
  try {
    const p = JSON.parse(localStorage.getItem(POS_KEY) ?? "null") as Partial<MiniPlayerPos> | null;
    if (p && Number.isFinite(p.right) && Number.isFinite(p.bottom))
      // Positions saved before resizing existed have no width.
      return { right: p.right!, bottom: p.bottom!, width: Number.isFinite(p.width) ? p.width! : IN_APP_MINI_WIDTH };
  } catch {
    /* ignore */
  }
  return { right: IN_APP_MINI_MARGIN, bottom: IN_APP_MINI_MARGIN, width: IN_APP_MINI_WIDTH };
}

/** Clip-path for the app shell: everything except the box, where the video shows through. */
export function miniPlayerHole({ right, bottom, width }: MiniPlayerPos): string {
  const l = `calc(100% - ${right + width}px)`;
  const r = `calc(100% - ${right}px)`;
  const t = `calc(100% - ${bottom + miniPlayerHeight(width)}px)`;
  const b = `calc(100% - ${bottom}px)`;
  return `polygon(evenodd, 0 0, 100% 0, 100% 100%, 0 100%, 0 0, ${l} ${t}, ${r} ${t}, ${r} ${b}, ${l} ${b}, ${l} ${t})`;
}

/** Fired after the box moved; PlayerPage re-syncs the native video surface to it. */
export const MINI_PLAYER_MOVED_EVENT = "__pitflix_mini_player_moved";

/**
 * Moves the box (and the shell's hole) straight in the DOM. Used for every drag frame so the
 * 4k-line PlayerPage doesn't re-render per pointer move; the store is only written when the drag
 * ends, with the same values, so React never fights these styles.
 */
export function previewMiniPlayerPos(pos: MiniPlayerPos): MiniPlayerPos {
  const next = clampMiniPlayerPos(pos);
  const box = document.querySelector<HTMLElement>('[data-pitflix-mini="true"]');
  if (box) {
    box.style.right = `${next.right}px`;
    box.style.bottom = `${next.bottom}px`;
    box.style.width = `${next.width}px`;
    box.style.height = `${miniPlayerHeight(next.width)}px`;
  }
  const shell = document.querySelector<HTMLElement>("[data-pitflix-app-shell]");
  if (shell) shell.style.clipPath = miniPlayerHole(next);
  window.dispatchEvent(new Event(MINI_PLAYER_MOVED_EVENT));
  return next;
}

/** Keeps the size within limits and the whole box inside the window. */
export function clampMiniPlayerPos(pos: MiniPlayerPos): MiniPlayerPos {
  const widthCap = Math.min(IN_APP_MINI_MAX_WIDTH, window.innerWidth, (window.innerHeight * 16) / 9);
  const width = Math.round(Math.max(IN_APP_MINI_MIN_WIDTH, Math.min(widthCap, pos.width)));
  const maxRight = Math.max(0, window.innerWidth - width);
  const maxBottom = Math.max(0, window.innerHeight - miniPlayerHeight(width));
  return {
    right: Math.round(Math.min(maxRight, Math.max(0, pos.right))),
    bottom: Math.round(Math.min(maxBottom, Math.max(0, pos.bottom))),
    width,
  };
}

type MiniPlayerState = {
  mini: boolean;
  pos: MiniPlayerPos;
  /** Commits a position (drag end, window resize); `persist` also remembers it across launches. */
  setPos: (pos: MiniPlayerPos, persist?: boolean) => void;
  /** Launch state of the session that's playing. Authoritative whenever the route isn't /player. */
  launchState: PlaybackLaunchState | null;
  enter: (state: PlaybackLaunchState) => void;
  /** Episode switch / canonical sync while mini — replaces what the player renders without routing. */
  setLaunchState: (state: PlaybackLaunchState | null) => void;
  /** Back to the full player (caller navigates to /player with MINI_RESTORE_STATE). */
  expand: () => void;
  /** Close the mini player — PersistentPlayerHost unmounts the player, which tears mpv down. */
  close: () => void;
};

export const useMiniPlayerStore = create<MiniPlayerState>((set) => ({
  mini: false,
  pos: loadPos(),
  setPos: (pos, persist = false) => {
    const next = clampMiniPlayerPos(pos);
    set({ pos: next });
    window.dispatchEvent(new Event(MINI_PLAYER_MOVED_EVENT));
    if (persist) {
      try {
        localStorage.setItem(POS_KEY, JSON.stringify(next));
      } catch {
        /* ignore */
      }
    }
  },
  launchState: null,
  enter: (state) => set({ mini: true, launchState: state }),
  setLaunchState: (state) => set({ launchState: state }),
  expand: () => set({ mini: false }),
  close: () => set({ mini: false, launchState: null }),
}));

/** Route state used when expanding: "keep the session that's already playing", not a new launch. */
export const MINI_RESTORE_STATE = { __pitflixMiniRestore: true } as const;

export function isMiniRestoreState(state: unknown): boolean {
  return Boolean(state && typeof state === "object" && "__pitflixMiniRestore" in state);
}
