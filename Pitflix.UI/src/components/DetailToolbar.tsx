import { useQueryClient } from "@tanstack/react-query";
import axios from "axios";
import { open as openDialog } from "@tauri-apps/plugin-dialog";
import { useEffect, useRef, useState, type ComponentType } from "react";
import { useNavigate } from "react-router-dom";
import { AlertCircle, FolderInput, FolderSearch, MoreHorizontal, RefreshCw, Search, Trash2, Tv } from "lucide-react";
import {
  deleteMediaFromDevice,
  refreshMovieMetadata,
  refreshShowMetadata,
  relocateMovieFile,
  relocateSeriesFolder,
  rematchMovieFromFile,
  rematchSeriesFromFolder,
  wrapMovieFile,
} from "../api/library";
import { LinkMovieToEpisodeModal } from "./LinkMovieToEpisodeModal";
import { PickTmdbTitleModal, type PickTmdbMatchTarget } from "./PickTmdbTitleModal";
import { cn } from "../utils/cn";
import { pitflixConfirm } from "../utils/pitflixDialog";

/** Page-specific action (open folder, change artwork, drop…) shown ahead of the matching actions
 * in the "menu" / "list" variants. */
export type DetailToolbarExtraItem = {
  key: string;
  label: string;
  icon?: ComponentType<{ className?: string; strokeWidth?: number }>;
  title?: string;
  onClick: () => void;
  disabled?: boolean;
};

type ToolbarAction = {
  key: string;
  label: string;
  icon: ComponentType<{ className?: string; strokeWidth?: number }>;
  spinning?: boolean;
  title?: string;
  onClick: () => void;
};

type DetailToolbarProps = {
  /** "bar" (default): the classic row of buttons. "menu": a ⋯ button with a dropdown.
   * "list": a plain vertical list (for side columns). */
  variant?: "bar" | "menu" | "list";
  /** Extra page actions listed first ("On this device") in the menu / list variants. */
  extraItems?: DetailToolbarExtraItem[];
  kind: "movie" | "series";
  libraryId: number;
  tmdbId: number;
  /** Shown in the manual pick-title modal for context. */
  pickHint?: string;
  filePath?: string;
  folderPath?: string;
  onDeleted?: () => void;
  /** Called after a successful file re-match with the new library row id. */
  onMovieRematched?: (newLibraryId: number) => void;
  /** Called after a successful series folder re-match with the new library row id. */
  onShowRematched?: (newLibraryId: number) => void;
};

export function DetailToolbar({
  variant = "bar",
  extraItems = [],
  kind,
  libraryId,
  tmdbId: _tmdbId,
  pickHint,
  filePath,
  folderPath,
  onDeleted,
  onMovieRematched,
  onShowRematched,
}: DetailToolbarProps) {
  const qc = useQueryClient();
  const [actionMsg, setActionMsg] = useState<string | null>(null);
  const [busy, setBusy] = useState<string | null>(null);
  const [showDeleteConfirm, setShowDeleteConfirm] = useState(false);
  const [pickTarget, setPickTarget] = useState<PickTmdbMatchTarget | null>(null);
  const [wrapResult, setWrapResult] = useState<{ message: string; ok: boolean } | null>(null);
  const [linkEpisodeOpen, setLinkEpisodeOpen] = useState(false);
  const navigate = useNavigate();

  const mediaType = kind === "movie" ? "Movie" : "Series";

  const invalidate = () => {
    void qc.invalidateQueries({ queryKey: [kind === "movie" ? "movie" : "show", libraryId] });
    void qc.invalidateQueries({ queryKey: ["movies"] });
    void qc.invalidateQueries({ queryKey: ["series"] });
    void qc.invalidateQueries({ queryKey: ["stats"] });
    void qc.invalidateQueries({ queryKey: ["lists"] });
    void qc.invalidateQueries({ queryKey: ["list-contains"] });
    void qc.invalidateQueries({ queryKey: ["list-tmdb-ids"] });
    void qc.invalidateQueries({ queryKey: [kind === "movie" ? "movie-videos" : "show-videos", libraryId] });
    // Poster/title changes here (re-match, pick-correct-title) never touched Home's own queries, so
    // a title fixed up on its detail page kept showing its old poster/data on Home until a full
    // reload. Covers every "home-*" key (home-layout, home-history, home-section:<id>, …) by prefix
    // so new home queries stay covered without another edit here.
    void qc.invalidateQueries({
      predicate: (query) => typeof query.queryKey[0] === "string" && query.queryKey[0].startsWith("home"),
    });
  };

  const showToast = (msg: string) => {
    setActionMsg(msg);
    window.setTimeout(() => setActionMsg(null), 4000);
  };

  const onRefreshMetadata = () => {
    setBusy("refresh");
    const req = kind === "movie" ? refreshMovieMetadata(libraryId) : refreshShowMetadata(libraryId);
    void req
      .then((r) => {
        if (r && r.success === false) {
          showToast(r.error ?? "Refresh failed.");
          return;
        }
        showToast("Refreshed credits and details from TMDB.");
        invalidate();
      })
      .catch(() => showToast("Could not reach the API or TMDB."))
      .finally(() => setBusy(null));
  };

  const onDeleteFromDevice = async () => {
    const pathToDelete = kind === "movie" ? filePath : folderPath;
    if (!pathToDelete) {
      showToast("No file path available.");
      return;
    }
    setBusy("delete");
    setShowDeleteConfirm(false);
    try {
      await deleteMediaFromDevice({ path: pathToDelete, mediaType, libraryId });
      showToast("Deleted from device successfully.");
      invalidate();
      if (onDeleted) window.setTimeout(() => onDeleted(), 1500);
    } catch (error: unknown) {
      const msg = axios.isAxiosError(error)
        ? (error.response?.data as { error?: string } | undefined)?.error
        : undefined;
      showToast(msg || (error instanceof Error ? error.message : "Could not delete from device."));
    } finally {
      setBusy(null);
    }
  };

  const onRematchFromFile = async () => {
    if (kind !== "movie") return;
    const ok = await pitflixConfirm(
      "Remove this movie from the library and match the file again? Use this if the wrong TMDB title was chosen.",
    );
    if (!ok) return;
    setBusy("rematch");
    void rematchMovieFromFile(libraryId)
      .then((r) => {
        if (!r.success) { showToast(r.error ?? "Re-match failed."); return; }
        showToast("File matched again.");
        const nid = r.libraryId ?? libraryId;
        onMovieRematched?.(nid);
        invalidate();
      })
      .catch(() => showToast("Could not re-match (API or TMDB)."))
      .finally(() => setBusy(null));
  };

  const onWrapMovieFile = async () => {
    if (kind !== "movie" || busy !== null) return;
    const ok = await pitflixConfirm(
      "Move this movie's video file (and any matching subtitles) into its own folder named after the movie?",
    );
    if (!ok) return;
    setBusy("wrap");
    setWrapResult(null);
    try {
      const r = await wrapMovieFile(libraryId);
      setWrapResult({ message: r.message, ok: r.success });
      if (r.movedCount > 0) invalidate();
    } catch (e) {
      setWrapResult({
        message: e instanceof Error ? e.message : "Could not wrap this movie's file.",
        ok: false,
      });
    } finally {
      setBusy(null);
      window.setTimeout(() => setWrapResult(null), 6000);
    }
  };

  const onRematchSeriesFromFolder = async () => {
    if (kind !== "series") return;
    const ok = await pitflixConfirm(
      "Remove this series from the library and match all video files in its folder again? Use this if the wrong TMDB show was chosen.",
    );
    if (!ok) return;
    setBusy("rematch-series");
    void rematchSeriesFromFolder(libraryId)
      .then((r) => {
        if (!r.success) { showToast(r.error ?? "Re-match failed."); return; }
        showToast("Series folder matched again.");
        const nid = r.libraryId ?? libraryId;
        onShowRematched?.(nid);
        invalidate();
      })
      .catch(() => showToast("Could not re-match (API or TMDB)."))
      .finally(() => setBusy(null));
  };

  /** File/folder was moved or renamed outside Pitflix: point the library entry at its new location. */
  const onRelocate = async () => {
    const picked = await openDialog(
      kind === "movie"
        ? {
            multiple: false,
            title: "Find the movie's video file",
            filters: [{ name: "Video", extensions: ["mkv", "mp4", "avi", "mov", "m4v", "wmv", "ts", "m2ts", "webm", "flv", "mpg", "mpeg"] }],
          }
        : { directory: true, multiple: false, title: "Find the series' new folder" },
    ).catch(() => null);
    if (typeof picked !== "string" || !picked) return;
    setBusy("relocate");
    try {
      if (kind === "movie") {
        const r = await relocateMovieFile(libraryId, picked);
        showToast(r.success ? "Movie relocated — watch state kept." : (r.error ?? "Relocate failed."));
        if (r.success) invalidate();
      } else {
        const r = await relocateSeriesFolder(libraryId, picked);
        if (!r.success) showToast(r.error ?? "Relocate failed.");
        else {
          showToast(
            `Series relocated: ${r.relinked} episode file(s) re-linked` +
              (r.missing > 0 ? `, ${r.missing} still missing.` : "."),
          );
          invalidate();
          void qc.invalidateQueries({ queryKey: ["show-season"] });
        }
      }
    } catch {
      showToast("Could not reach the API.");
    } finally {
      setBusy(null);
    }
  };

  const onPickMatched = (r: { libraryId?: number; showId?: number; episodeId?: number }) => {
    if (kind === "movie" && r.libraryId != null) {
      showToast("Linked file to the title you chose.");
      onMovieRematched?.(r.libraryId);
    } else if (kind === "series" && r.libraryId != null) {
      showToast("Linked folder to the series you chose.");
      onShowRematched?.(r.libraryId);
    }
    invalidate();
  };

  const hasPath = kind === "movie" ? !!filePath : !!folderPath;

  const matchActions: ToolbarAction[] = [
    { key: "refresh", label: "Refresh from TMDB", icon: RefreshCw, spinning: busy === "refresh", onClick: () => void onRefreshMetadata() },
  ];
  if (kind === "movie" && (filePath || libraryId > 0)) {
    matchActions.push(
      { key: "rematch", label: "Re-match file", icon: RefreshCw, spinning: busy === "rematch", onClick: () => void onRematchFromFile() },
      { key: "pick", label: "Pick correct title…", icon: Search, onClick: () => setPickTarget({ kind: "movie", libraryId }) },
      {
        key: "relocate",
        label: "Relocate file…",
        icon: FolderSearch,
        spinning: busy === "relocate",
        title: "The file was moved or renamed — pick it at its new location (keeps watch state)",
        onClick: () => void onRelocate(),
      },
      {
        key: "link-episode",
        label: "It's an episode…",
        icon: Tv,
        title: "This file is really an episode of a series in your library — link it there",
        onClick: () => setLinkEpisodeOpen(true),
      },
      {
        key: "wrap",
        label: busy === "wrap" ? "Wrapping…" : "Wrap it",
        icon: FolderInput,
        title: "Move this movie's loose video file into its own folder named after the movie",
        onClick: () => void onWrapMovieFile(),
      },
    );
  }
  if (kind === "series" && (folderPath || libraryId > 0)) {
    matchActions.push(
      {
        key: "rematch-series",
        label: "Re-match folder",
        icon: RefreshCw,
        spinning: busy === "rematch-series",
        onClick: () => void onRematchSeriesFromFolder(),
      },
      { key: "pick", label: "Pick correct series…", icon: Search, onClick: () => setPickTarget({ kind: "series", libraryId }) },
      {
        key: "relocate",
        label: "Relocate folder…",
        icon: FolderSearch,
        spinning: busy === "relocate",
        title: "The series folder was moved or renamed — pick its new location (keeps watch state)",
        onClick: () => void onRelocate(),
      },
    );
  }

  const mgmtBtn =
    "inline-flex shrink-0 items-center gap-1.5 rounded-[7px] border border-white/[0.07] bg-white/[0.03] px-[13px] py-[7px] text-[12px] text-white/[0.38] transition hover:bg-white/[0.08] hover:text-white/[0.72] disabled:opacity-45";

  const [menuOpen, setMenuOpen] = useState(false);
  const menuRef = useRef<HTMLDivElement>(null);
  useEffect(() => {
    if (!menuOpen) return;
    const onDown = (e: PointerEvent) => {
      if (menuRef.current && !menuRef.current.contains(e.target as Node)) setMenuOpen(false);
    };
    const onKey = (e: KeyboardEvent) => {
      if (e.key === "Escape") setMenuOpen(false);
    };
    document.addEventListener("pointerdown", onDown, { capture: true });
    document.addEventListener("keydown", onKey);
    return () => {
      document.removeEventListener("pointerdown", onDown, { capture: true });
      document.removeEventListener("keydown", onKey);
    };
  }, [menuOpen]);

  const itemRow = (
    key: string,
    label: string,
    Icon: ToolbarAction["icon"] | undefined,
    onClick: () => void,
    opts: { spinning?: boolean; danger?: boolean; title?: string; disabled?: boolean } = {},
  ) => (
    <button
      key={key}
      type="button"
      role={variant === "menu" ? "menuitem" : undefined}
      title={opts.title}
      disabled={opts.disabled ?? busy !== null}
      onClick={() => {
        setMenuOpen(false);
        onClick();
      }}
      className={cn(
        "flex w-full items-center gap-2.5 rounded-lg px-3 py-2.5 text-left text-[13.5px] transition disabled:opacity-45",
        opts.danger ? "font-semibold text-red-400 hover:bg-red-500/10" : "text-white/85 hover:bg-white/[0.07]",
      )}
    >
      {Icon ? <Icon className={cn("h-4 w-4 shrink-0 opacity-70", opts.spinning && "animate-spin")} strokeWidth={2} /> : null}
      {label}
    </button>
  );

  const groupLabel = (text: string) => (
    <p className="px-3 pb-1 pt-2 text-[10.5px] font-bold uppercase tracking-[0.1em] text-white/35">{text}</p>
  );

  const groupedItems = (
    <>
      {extraItems.length > 0 ? (
        <>
          {groupLabel("On this device")}
          {extraItems.map((x) => itemRow(x.key, x.label, x.icon, x.onClick, { title: x.title, disabled: x.disabled ?? false }))}
          <div className="mx-2 my-1 h-px bg-white/[0.08]" />
        </>
      ) : null}
      {groupLabel("Fix matching")}
      {matchActions.map((m) => itemRow(m.key, m.label, m.icon, m.onClick, { spinning: m.spinning, title: m.title }))}
      {hasPath ? (
        <>
          <div className="mx-2 my-1 h-px bg-white/[0.08]" />
          {itemRow("delete", "Delete from device…", Trash2, () => setShowDeleteConfirm(true), { danger: true })}
        </>
      ) : null}
    </>
  );

  return (
    <div className={variant === "bar" ? "w-full min-w-0" : "relative min-w-0"}>
      {variant === "bar" ? (
        <div className="flex flex-wrap items-center gap-2 px-12 py-4">
          {matchActions.map((m) => (
            <button key={m.key} type="button" className={mgmtBtn} title={m.title} disabled={busy !== null} onClick={m.onClick}>
              <m.icon className={cn("h-3.5 w-3.5", m.spinning && "animate-spin")} strokeWidth={2} />
              {m.label}
            </button>
          ))}
          {hasPath ? (
            <button
              type="button"
              className="inline-flex shrink-0 items-center gap-1.5 rounded-[7px] border border-red-500/[0.14] bg-red-500/[0.06] px-[13px] py-[7px] text-[12px] text-red-500/[0.62] transition hover:bg-red-500/[0.13] hover:text-red-500/90 disabled:opacity-45"
              disabled={busy !== null}
              onClick={() => setShowDeleteConfirm(true)}
            >
              <Trash2 className="h-3.5 w-3.5" strokeWidth={2} />
              Delete from device
            </button>
          ) : null}
        </div>
      ) : variant === "menu" ? (
        <div ref={menuRef} className="relative">
          <button
            type="button"
            aria-label="More actions"
            aria-haspopup="menu"
            aria-expanded={menuOpen}
            title="More actions"
            onClick={() => setMenuOpen((o) => !o)}
            className="flex h-14 w-14 items-center justify-center rounded-xl border border-white/[0.18] bg-white/[0.08] text-white transition hover:bg-white/[0.16]"
          >
            <MoreHorizontal className="h-5 w-5" />
          </button>
          {menuOpen ? (
            <div
              role="menu"
              className="absolute left-0 top-full z-50 mt-2 w-[270px] rounded-2xl border border-white/[0.1] bg-[#1c1c21] p-1.5 shadow-[0_20px_50px_rgba(0,0,0,0.6)]"
            >
              {groupedItems}
            </div>
          ) : null}
        </div>
      ) : (
        <div className="flex flex-col">{groupedItems}</div>
      )}
      {actionMsg ? (
        <p
          role="status"
          className={cn(
            "text-sm",
            variant === "bar"
              ? "px-12 pb-2 text-white/40"
              : variant === "menu"
                ? "absolute left-0 top-full z-40 mt-2 w-72 rounded-lg bg-black/85 px-3 py-2 text-white/80"
                : "px-3 pt-2 text-white/50",
          )}
        >
          {actionMsg}
        </p>
      ) : null}

      {wrapResult ? (
        <div className={variant === "bar" ? "px-12 pb-3" : "pt-2"}>
          <div
            role="status"
            className={cn(
              "flex items-start gap-2.5 rounded-xl border px-4 py-3 text-sm shadow-lg backdrop-blur-sm",
              wrapResult.ok
                ? "border-pitflix-primary/40 bg-pitflix-primary/10 text-white shadow-pitflix-primary/10"
                : "border-red-500/40 bg-red-950/30 text-red-100 shadow-red-900/20",
            )}
          >
            {wrapResult.ok ? (
              <FolderInput className="mt-0.5 h-4 w-4 shrink-0 text-pitflix-primary" />
            ) : (
              <AlertCircle className="mt-0.5 h-4 w-4 shrink-0 text-red-300" />
            )}
            <p className="leading-snug">{wrapResult.message}</p>
            <button
              type="button"
              onClick={() => setWrapResult(null)}
              className="ml-auto shrink-0 text-xs text-white/40 hover:text-white"
              aria-label="Dismiss"
            >
              ✕
            </button>
          </div>
        </div>
      ) : null}

      <PickTmdbTitleModal
        open={pickTarget !== null}
        onClose={() => setPickTarget(null)}
        target={pickTarget}
        hintTitle={pickHint}
        onMatched={onPickMatched}
      />

      {kind === "movie" ? (
        <LinkMovieToEpisodeModal
          open={linkEpisodeOpen}
          onClose={() => setLinkEpisodeOpen(false)}
          libraryId={libraryId}
          filePath={filePath}
          onLinked={({ showId, season }) => {
            invalidate();
            void qc.invalidateQueries({ queryKey: ["show", showId] });
            void qc.invalidateQueries({ queryKey: ["show-season"] });
            navigate(`/series/${showId}/season/${season}`, { replace: true });
          }}
        />
      ) : null}

      {showDeleteConfirm && (
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/75 px-4 backdrop-blur-sm">
          <div className="w-full max-w-md rounded-xl border border-red-500/30 bg-zinc-900 p-6 shadow-2xl">
            <h3 className="text-lg font-semibold text-white">Delete from device?</h3>
            <p className="mt-2 text-sm text-zinc-400">
              This will permanently delete the {kind === "movie" ? "movie file" : "entire series folder"} from your device. This action cannot be undone.
            </p>
            {kind === "series" && folderPath && (
              <p className="mt-2 text-xs text-zinc-500">Folder: {folderPath}</p>
            )}
            {kind === "movie" && filePath && (
              <p className="mt-2 text-xs text-zinc-500">File: {filePath}</p>
            )}
            <div className="mt-6 flex justify-end gap-3">
              <button
                type="button"
                className="rounded-lg border border-zinc-600 px-4 py-2 text-sm font-medium text-zinc-200 hover:bg-zinc-800"
                onClick={() => setShowDeleteConfirm(false)}
                disabled={busy === "delete"}
              >
                Cancel
              </button>
              <button
                type="button"
                className="rounded-lg bg-red-600 px-4 py-2 text-sm font-semibold text-white hover:bg-red-500 disabled:opacity-50"
                onClick={() => void onDeleteFromDevice()}
                disabled={busy === "delete"}
              >
                {busy === "delete" ? "Deleting..." : "Yes, delete"}
              </button>
            </div>
          </div>
        </div>
      )}
    </div>
  );
}
