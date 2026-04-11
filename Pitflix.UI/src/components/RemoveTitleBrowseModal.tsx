import { AnimatePresence, motion } from "framer-motion";
import { useEffect, useState } from "react";
import { getMovies } from "../api/movies";
import { getAllSeries } from "../api/series";
import type { MediaCard } from "../types/media";
import { toPosterSrc } from "../utils/posterSrc";
import { MediaImage } from "./ui/MediaImage";
import { Spinner } from "./ui/Spinner";

export type RemoveTitlePick = {
  kind: "movie" | "series";
  id: number;
  title: string;
};

type Props = {
  open: boolean;
  kind: "movies" | "series";
  onClose: () => void;
  /** User chose a title to remove (parent shows confirm). */
  onRequestRemove: (row: RemoveTitlePick) => void;
  /** Increment to force a refetch while still open. */
  refreshToken?: number;
};

const BROWSE_PAGE_SIZE = 1000;

export function RemoveTitleBrowseModal({ open, kind, onClose, onRequestRemove, refreshToken = 0 }: Props) {
  const [items, setItems] = useState<MediaCard[]>([]);
  const [loading, setLoading] = useState(false);

  useEffect(() => {
    if (!open) {
      setItems([]);
      return;
    }
    let cancelled = false;
    setLoading(true);
    const req =
      kind === "movies"
        ? getMovies({ page: 1, pageSize: BROWSE_PAGE_SIZE, sort: "title", watch: "all" })
        : getAllSeries({ page: 1, pageSize: BROWSE_PAGE_SIZE, sort: "title", watch: "all" });
    void req
      .then((res: { items?: MediaCard[] }) => {
        if (!cancelled) setItems(res.items ?? []);
      })
      .catch(() => {
        if (!cancelled) setItems([]);
      })
      .finally(() => {
        if (!cancelled) setLoading(false);
      });
    return () => {
      cancelled = true;
    };
  }, [open, kind, refreshToken]);

  useEffect(() => {
    if (!open) return;
    const onKey = (e: KeyboardEvent) => {
      if (e.key === "Escape") onClose();
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [open, onClose]);

  const label = kind === "movies" ? "Movies" : "Series";

  return (
    <AnimatePresence>
      {open ? (
        <motion.div
          className="fixed inset-0 z-[220] flex items-center justify-center bg-black/75 p-3 backdrop-blur-[2px] sm:p-6"
          initial={{ opacity: 0 }}
          animate={{ opacity: 1 }}
          exit={{ opacity: 0 }}
          transition={{ duration: 0.15 }}
          onClick={onClose}
        >
          <motion.div
            role="dialog"
            aria-modal="true"
            aria-labelledby="browse-remove-title"
            initial={{ opacity: 0, scale: 0.98, y: 10 }}
            animate={{ opacity: 1, scale: 1, y: 0 }}
            exit={{ opacity: 0, scale: 0.98, y: 10 }}
            transition={{ type: "spring", damping: 28, stiffness: 320 }}
            className="flex max-h-[92vh] w-full max-w-6xl flex-col overflow-hidden rounded-2xl border border-pitflix-primary/30 bg-pitflix-surface shadow-2xl shadow-black/70"
            onClick={(e) => e.stopPropagation()}
          >
            <div className="flex shrink-0 items-center justify-between gap-3 border-b border-pitflix-card px-4 py-3 sm:px-5">
              <div>
                <h2 id="browse-remove-title" className="text-lg font-semibold text-white">
                  Browse {label}
                </h2>
                <p className="mt-0.5 text-xs text-pitflix-muted">
                  {loading ? "Loading…" : `${items.length} titles`} — pick one to remove
                </p>
              </div>
              <button
                type="button"
                className="rounded-lg border border-pitflix-card px-3 py-1.5 text-sm text-pitflix-muted transition-colors hover:border-pitflix-primary/40 hover:text-white"
                onClick={onClose}
              >
                Close
              </button>
            </div>

            <div className="min-h-0 flex-1 overflow-y-auto p-3 sm:p-4">
              {loading ? (
                <div className="flex justify-center py-20">
                  <Spinner />
                </div>
              ) : items.length === 0 ? (
                <p className="py-12 text-center text-sm text-pitflix-muted">No titles in your library.</p>
              ) : (
                <div className="grid grid-cols-2 gap-3 sm:grid-cols-3 md:grid-cols-4 lg:grid-cols-5">
                  {items.map((m) => {
                    const poster = toPosterSrc(
                      m.selectedPosterPath ?? m.posterLocalPath ?? m.posterRemoteUrl ?? undefined,
                    );
                    const mt: "movie" | "series" = kind === "movies" ? "movie" : "series";
                    return (
                      <div
                        key={`${mt}-${m.id}`}
                        className="group flex flex-col overflow-hidden rounded-xl border border-pitflix-card bg-pitflix-bg/80 ring-1 ring-white/5 transition hover:border-pitflix-primary/40"
                      >
                        <div className="relative aspect-[2/3] w-full bg-pitflix-card">
                          <MediaImage
                            src={poster}
                            alt=""
                            className="h-full w-full object-cover"
                            fallbackText={m.title.slice(0, 2)}
                          />
                        </div>
                        <div className="flex min-h-0 flex-1 flex-col gap-1.5 p-2">
                          <p className="line-clamp-2 text-[11px] font-medium leading-snug text-white">{m.title}</p>
                          {m.year != null ? (
                            <p className="text-[10px] text-pitflix-subtle">{m.year}</p>
                          ) : null}
                          <button
                            type="button"
                            className="mt-auto w-full rounded-lg bg-red-600/90 py-1.5 text-[11px] font-semibold text-white opacity-95 transition hover:bg-red-500"
                            onClick={() =>
                              onRequestRemove({ kind: mt, id: m.id, title: m.title })
                            }
                          >
                            Remove…
                          </button>
                        </div>
                      </div>
                    );
                  })}
                </div>
              )}
            </div>
          </motion.div>
        </motion.div>
      ) : null}
    </AnimatePresence>
  );
}
