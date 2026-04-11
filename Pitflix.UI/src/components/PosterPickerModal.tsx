import { useEffect, useState } from "react";
import { AnimatePresence, motion } from "framer-motion";
import { API_ORIGIN } from "../api/client";

type TmdbImageRow = {
  filePath: string;
  voteAverage?: number;
};

type PosterPickerModalProps = {
  libraryId: number;
  tmdbId: number;
  mediaType: "Movie" | "Series";
  initialTab: "poster" | "backdrop";
  onClose: () => void;
  onApplied: () => void;
};

export function PosterPickerModal({
  libraryId,
  tmdbId,
  mediaType,
  initialTab,
  onClose,
  onApplied,
}: PosterPickerModalProps) {
  const [images, setImages] = useState<TmdbImageRow[]>([]);
  const [selected, setSelected] = useState<string | null>(null);
  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState(false);
  const [activeTab, setActiveTab] = useState<"poster" | "backdrop">(initialTab);

  useEffect(() => {
    setLoading(true);
    setSelected(null);
    const path = activeTab === "poster" ? "posters" : "backdrops";
    const q = encodeURIComponent(mediaType);
    void fetch(`${API_ORIGIN}/api/images/${tmdbId}/${path}?mediaType=${q}`)
      .then((r) => r.json() as Promise<TmdbImageRow[]>)
      .then((data) => {
        setImages(Array.isArray(data) ? data : []);
      })
      .catch(() => setImages([]))
      .finally(() => setLoading(false));
  }, [tmdbId, activeTab, mediaType]);

  const handleApply = async () => {
    if (!selected) return;
    setSaving(true);
    try {
      const body =
        activeTab === "poster"
          ? { tmdbId, mediaType, posterPath: selected }
          : { tmdbId, mediaType, backdropPath: selected };
      const res = await fetch(`${API_ORIGIN}/api/images/${libraryId}/select`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(body),
      });
      if (!res.ok) return;
      onApplied();
      onClose();
    } finally {
      setSaving(false);
    }
  };

  return (
    <AnimatePresence>
      <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/80 p-4">
        <motion.div
          initial={{ opacity: 0, scale: 0.95 }}
          animate={{ opacity: 1, scale: 1 }}
          exit={{ opacity: 0, scale: 0.95 }}
          className="flex max-h-[80vh] w-full max-w-3xl flex-col overflow-hidden rounded-xl border border-pitflix-primary/30 bg-pitflix-surface"
        >
          <div className="flex items-center justify-between border-b border-pitflix-card p-4">
            <h2 className="text-lg font-bold text-white">
              Choose {activeTab === "poster" ? "Poster" : "Backdrop"}
            </h2>
            <div className="flex items-center gap-3">
              <div className="flex gap-1 rounded-lg bg-pitflix-card p-1">
                {(["poster", "backdrop"] as const).map((t) => (
                  <button
                    key={t}
                    type="button"
                    onClick={() => {
                      setActiveTab(t);
                      setLoading(true);
                      setSelected(null);
                    }}
                    className={`rounded-md px-3 py-1 text-sm capitalize transition-colors ${
                      activeTab === t
                        ? "bg-pitflix-primary text-white"
                        : "text-pitflix-muted hover:text-white"
                    }`}
                  >
                    {t}
                  </button>
                ))}
              </div>
              <button
                type="button"
                onClick={onClose}
                className="text-xl text-pitflix-muted hover:text-white"
                aria-label="Close"
              >
                ✕
              </button>
            </div>
          </div>

          <div className="flex-1 overflow-y-auto p-4">
            {loading ? (
              <div className="grid grid-cols-4 gap-3">
                {Array.from({ length: 12 }).map((_, i) => (
                  <div
                    key={i}
                    className={`animate-pulse rounded-lg bg-pitflix-card ${
                      activeTab === "poster" ? "aspect-[2/3]" : "aspect-video"
                    }`}
                  />
                ))}
              </div>
            ) : (
              <div
                className={`grid gap-3 ${activeTab === "poster" ? "grid-cols-5" : "grid-cols-3"}`}
              >
                {images.map((img, i) => (
                  <button
                    key={`${img.filePath}-${i}`}
                    type="button"
                    onClick={() => setSelected(img.filePath)}
                    className={`relative overflow-hidden rounded-lg border-2 transition-all ${
                      selected === img.filePath
                        ? "scale-[1.02] border-pitflix-primary"
                        : "border-transparent hover:border-pitflix-primary/50"
                    }`}
                  >
                    <img
                      src={`https://image.tmdb.org/t/p/${activeTab === "poster" ? "w342" : "w500"}${img.filePath}`}
                      alt=""
                      className={`w-full object-cover ${activeTab === "poster" ? "aspect-[2/3]" : "aspect-video"}`}
                    />
                    {selected === img.filePath ? (
                      <div className="absolute right-2 top-2 flex h-6 w-6 items-center justify-center rounded-full bg-pitflix-primary">
                        <span className="text-xs text-white">✓</span>
                      </div>
                    ) : null}
                    {(img.voteAverage ?? 0) > 0 ? (
                      <div className="absolute bottom-1 right-1 rounded bg-black/70 px-1 text-xs text-white">
                        ★ {(img.voteAverage as number).toFixed(1)}
                      </div>
                    ) : null}
                  </button>
                ))}
              </div>
            )}
          </div>

          <div className="flex items-center justify-between border-t border-pitflix-card p-4">
            <span className="text-sm text-pitflix-muted">{images.length} options available</span>
            <div className="flex gap-2">
              <button
                type="button"
                onClick={onClose}
                className="rounded-lg border border-pitflix-card px-4 py-2 text-sm text-pitflix-muted hover:text-white"
              >
                Cancel
              </button>
              <button
                type="button"
                onClick={() => void handleApply()}
                disabled={!selected || saving}
                className="rounded-lg bg-pitflix-primary px-4 py-2 text-sm text-white hover:bg-pitflix-light disabled:opacity-40"
              >
                Apply
              </button>
            </div>
          </div>
        </motion.div>
      </div>
    </AnimatePresence>
  );
}
