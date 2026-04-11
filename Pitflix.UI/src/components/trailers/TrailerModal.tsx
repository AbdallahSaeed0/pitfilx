import { isTauri } from "@tauri-apps/api/core";
import { openUrl } from "@tauri-apps/plugin-opener";
import { AnimatePresence, motion } from "framer-motion";
import { ExternalLink, X } from "lucide-react";
import { useEffect, useState } from "react";
import type { TrailerCard } from "../../api/homeDiscover";
import { MediaImage } from "../ui/MediaImage";

export type TrailerModalProps = {
  open: boolean;
  onClose: () => void;
  trailer: TrailerCard | null;
};

export function TrailerModal({ open, onClose, trailer }: TrailerModalProps) {
  /** YouTube embed; falls back if iframe errors (some environments block embeds even when CSP allows). */
  const [embedFailed, setEmbedFailed] = useState(false);

  useEffect(() => {
    if (!open) return;
    setEmbedFailed(false);
    const onKey = (e: KeyboardEvent) => {
      if (e.key === "Escape") onClose();
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [open, onClose]);

  if (!trailer) return null;

  const watchUrl = `https://www.youtube.com/watch?v=${encodeURIComponent(trailer.youtubeKey)}`;
  const embedUrl = `https://www.youtube.com/embed/${encodeURIComponent(trailer.youtubeKey)}?autoplay=1&rel=0`;

  async function openExternal(url: string) {
    try {
      if (isTauri()) await openUrl(url);
      else window.open(url, "_blank", "noopener,noreferrer");
    } catch {
      window.open(url, "_blank", "noopener,noreferrer");
    }
  }

  const thumb =
    `https://img.youtube.com/vi/${trailer.youtubeKey}/hqdefault.jpg` ||
    trailer.posterUrl ||
    trailer.backdropUrl;

  return (
    <AnimatePresence>
      {open ? (
        <motion.div
          className="fixed inset-0 z-[200] flex items-center justify-center p-4"
          initial={{ opacity: 0 }}
          animate={{ opacity: 1 }}
          exit={{ opacity: 0 }}
          transition={{ duration: 0.15 }}
        >
          <button
            type="button"
            className="absolute inset-0 bg-black/75 backdrop-blur-sm"
            aria-label="Close trailer"
            onClick={onClose}
          />
          <motion.div
            role="dialog"
            aria-modal="true"
            aria-label={`Trailer: ${trailer.title}`}
            className="relative z-10 flex max-h-[90vh] w-full max-w-4xl flex-col overflow-hidden rounded-2xl border border-white/10 bg-pitflix-surface shadow-2xl shadow-black/60"
            initial={{ scale: 0.96, opacity: 0 }}
            animate={{ scale: 1, opacity: 1 }}
            exit={{ scale: 0.96, opacity: 0 }}
            transition={{ type: "spring", stiffness: 420, damping: 32 }}
          >
            <div className="relative shrink-0 border-b border-pitflix-card/60 bg-black/40">
              <div className="absolute right-3 top-3 z-20">
                <button
                  type="button"
                  onClick={onClose}
                  className="rounded-lg bg-black/60 p-2 text-white hover:bg-black/80"
                  aria-label="Close"
                >
                  <X className="h-5 w-5" />
                </button>
              </div>
              {!embedFailed ? (
                <div className="relative aspect-video w-full bg-black">
                  <iframe
                    title={trailer.trailerTitle || trailer.title}
                    src={embedUrl}
                    className="h-full w-full"
                    allow="accelerometer; autoplay; clipboard-write; encrypted-media; gyroscope; picture-in-picture; web-share"
                    allowFullScreen
                    onError={() => setEmbedFailed(true)}
                  />
                </div>
              ) : (
                <div className="relative aspect-video w-full">
                  <MediaImage
                    src={thumb}
                    alt=""
                    className="h-full w-full object-cover opacity-80"
                    fallbackText="▶"
                  />
                  <div className="absolute inset-0 flex flex-col items-center justify-center gap-3 bg-black/55 p-6 text-center">
                    <p className="text-sm font-semibold text-white">Playback unavailable in-app</p>
                    <p className="max-w-md text-xs text-pitflix-subtle">
                      Open this trailer on YouTube for the full experience.
                    </p>
                    <button
                      type="button"
                      onClick={() => void openExternal(watchUrl)}
                      className="inline-flex items-center gap-2 rounded-lg bg-pitflix-primary px-4 py-2 text-sm font-semibold text-white hover:bg-pitflix-light"
                    >
                      <ExternalLink className="h-4 w-4" />
                      Watch on YouTube
                    </button>
                  </div>
                </div>
              )}
            </div>

            <div className="min-h-0 flex-1 space-y-2 overflow-y-auto p-5">
              <div className="flex flex-wrap items-start justify-between gap-3">
                <div>
                  <h2 className="text-lg font-bold text-white">{trailer.title}</h2>
                  <p className="text-xs text-pitflix-subtle">{trailer.trailerTitle}</p>
                  <p className="mt-1 flex flex-wrap gap-2 text-[11px] text-pitflix-muted">
                    <span className="uppercase">{trailer.mediaType}</span>
                    {trailer.releaseDate ? <span>· Release {trailer.releaseDate}</span> : null}
                  </p>
                </div>
                <button
                  type="button"
                  onClick={() => void openExternal(watchUrl)}
                  className="shrink-0 rounded-lg border border-pitflix-card bg-pitflix-bg px-3 py-1.5 text-xs font-semibold text-white hover:border-pitflix-primary/50"
                >
                  <span className="inline-flex items-center gap-1.5">
                    <ExternalLink className="h-3.5 w-3.5" />
                    YouTube
                  </span>
                </button>
              </div>
            </div>
          </motion.div>
        </motion.div>
      ) : null}
    </AnimatePresence>
  );
}

