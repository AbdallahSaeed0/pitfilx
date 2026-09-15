import { useQuery, useQueryClient } from "@tanstack/react-query";
import { Check, ChevronRight, ListPlus, RefreshCw } from "lucide-react";
import { useEffect, useLayoutEffect, useRef, useState } from "react";
import { addListItem, getLists } from "../../api/lists";
import { cn } from "../../utils/cn";
import { formatListMenuLabel } from "../../utils/listMarks";
import type { MediaContextTarget } from "./useMediaContextMenu";

export type MediaContextMenuAction = "rescan" | "markWatched" | "markUnwatched";

type Props = {
  target: MediaContextTarget;
  x: number;
  y: number;
  showRescan?: boolean;
  onAction: (action: MediaContextMenuAction) => void;
  onClose: () => void;
};

function targetMediaType(target: MediaContextTarget): "Movie" | "Series" {
  if (target.kind === "streaming") return target.mediaType;
  return target.kind === "movie" ? "Movie" : "Series";
}

export function MediaContextMenu({
  target,
  x,
  y,
  showRescan = true,
  onAction,
  onClose,
}: Props) {
  const label = target.title;
  const watchStatus = "watchStatus" in target ? target.watchStatus : undefined;
  const tmdbId = target.tmdbId;
  const mediaType = targetMediaType(target);
  const posterUrl = target.kind === "streaming" ? target.posterUrl : undefined;
  const imdbId = target.kind === "streaming" ? target.imdbId : undefined;

  const qc = useQueryClient();
  const menuRef = useRef<HTMLDivElement>(null);
  const [pos, setPos] = useState({ x, y });
  const [listsOpen, setListsOpen] = useState(false);
  const [addedFlashListId, setAddedFlashListId] = useState<number | null>(null);
  const isWatched = watchStatus === "Completed";

  const { data: lists } = useQuery({
    queryKey: ["lists"],
    queryFn: getLists,
    enabled: listsOpen,
    staleTime: 60_000,
  });

  const onAddToList = (listId: number) => {
    void addListItem(listId, {
      tmdbId,
      mediaType,
      title: label,
      posterRemoteUrl: posterUrl ?? undefined,
      imdbId: imdbId ?? undefined,
    }).then(() => {
      void qc.invalidateQueries({ queryKey: ["lists"] });
      void qc.invalidateQueries({ queryKey: ["list-tmdb-ids"] });
      setAddedFlashListId(listId);
      window.setTimeout(() => setAddedFlashListId((cur) => (cur === listId ? null : cur)), 1000);
    });
  };

  useLayoutEffect(() => {
    const el = menuRef.current;
    if (!el) return;
    const rect = el.getBoundingClientRect();
    let left = x;
    let top = y;
    if (left + rect.width > window.innerWidth - 8) {
      left = Math.max(8, window.innerWidth - rect.width - 8);
    }
    if (top + rect.height > window.innerHeight - 8) {
      top = Math.max(8, window.innerHeight - rect.height - 8);
    }
    setPos({ x: left, y: top });
  }, [x, y]);

  useEffect(() => {
    const onPointerDown = (e: MouseEvent) => {
      if (menuRef.current?.contains(e.target as Node)) return;
      onClose();
    };
    const onKeyDown = (e: KeyboardEvent) => {
      if (e.key === "Escape") onClose();
    };
    const onScroll = () => onClose();

    window.addEventListener("mousedown", onPointerDown);
    window.addEventListener("keydown", onKeyDown);
    window.addEventListener("scroll", onScroll, true);
    window.addEventListener("resize", onClose);
    return () => {
      window.removeEventListener("mousedown", onPointerDown);
      window.removeEventListener("keydown", onKeyDown);
      window.removeEventListener("scroll", onScroll, true);
      window.removeEventListener("resize", onClose);
    };
  }, [onClose]);

  const items: {
    action: MediaContextMenuAction;
    label: string;
    icon: typeof RefreshCw;
    hidden?: boolean;
  }[] = [
    { action: "rescan", label: "Rescan", icon: RefreshCw, hidden: !showRescan },
    {
      action: isWatched ? "markUnwatched" : "markWatched",
      label: isWatched ? "Mark unwatched" : "Mark watched",
      icon: Check,
    },
  ];

  return (
    <div
      ref={menuRef}
      role="menu"
      aria-label={`Actions for ${label}`}
      className="fixed z-[80] min-w-[11rem] overflow-hidden rounded-xl border border-white/10 bg-zinc-900 py-1 shadow-2xl"
      style={{ left: pos.x, top: pos.y }}
      onContextMenu={(e) => e.preventDefault()}
    >
      <p className="truncate border-b border-white/8 px-3 py-2 text-[11px] font-medium text-pitflix-muted">
        {label}
      </p>
      {items
        .filter((i) => !i.hidden)
        .map(({ action, label: itemLabel, icon: Icon }) => (
          <button
            key={action}
            type="button"
            role="menuitem"
            onClick={() => {
              onAction(action);
              onClose();
            }}
            className={cn(
              "flex w-full items-center gap-2.5 px-3 py-2 text-left text-sm text-white transition hover:bg-white/8",
            )}
          >
            <Icon className="h-4 w-4 shrink-0 opacity-80" />
            {itemLabel}
          </button>
        ))}

      <button
        type="button"
        role="menuitem"
        onClick={() => setListsOpen((o) => !o)}
        className="flex w-full items-center gap-2.5 px-3 py-2 text-left text-sm text-white transition hover:bg-white/8"
      >
        <ListPlus className="h-4 w-4 shrink-0 opacity-80" />
        Add to playlist
        <ChevronRight className={cn("ml-auto h-3.5 w-3.5 opacity-60 transition-transform", listsOpen && "rotate-90")} />
      </button>
      {listsOpen && (
        <div className="max-h-48 overflow-y-auto border-t border-white/8 py-1">
          {!lists ? (
            <p className="px-3 py-2 text-xs text-pitflix-muted">Loading…</p>
          ) : lists.length === 0 ? (
            <p className="px-3 py-2 text-xs text-pitflix-muted">No lists yet.</p>
          ) : (
            lists.map((l) => (
              <button
                key={l.id}
                type="button"
                role="menuitem"
                onClick={() => onAddToList(l.id)}
                className="flex w-full items-center justify-between gap-2 px-3 py-1.5 pl-8 text-left text-[13px] text-white/80 transition hover:bg-white/8"
              >
                <span className="truncate">{formatListMenuLabel(l.name)}</span>
                {addedFlashListId === l.id && (
                  <span className="shrink-0 text-[10px] font-semibold text-pitflix-primary">Added</span>
                )}
              </button>
            ))
          )}
        </div>
      )}
    </div>
  );
}
