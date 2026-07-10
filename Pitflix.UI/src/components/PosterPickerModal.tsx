import { useEffect, useMemo, useState } from "react";
import { AnimatePresence, motion } from "framer-motion";
import { API_ORIGIN } from "../api/client";
import { getTvdbArtworks, TVDB_ARTWORK, type TvdbArtwork } from "../api/tvdb";

type TmdbImageRow = {
  filePath: string;
  voteAverage?: number;
};

type PickerRow = {
  key: string;
  previewUrl: string;
  score?: number;
  source: "tmdb" | "tvdb";
  kind: "poster" | "backdrop" | "banner";
};

type PosterPickerModalProps = {
  libraryId: number;
  tmdbId: number;
  mediaType: "Movie" | "Series";
  initialTab: "poster" | "backdrop";
  onClose: () => void;
  onApplied: () => void;
};

const TVDB_PICKER_PREFIX = "tvdb:";

function tvdbRowsForTab(artworks: TvdbArtwork[] | null, tab: "poster" | "backdrop"): PickerRow[] {
  if (!artworks?.length) return [];
  const types: number[] =
    tab === "poster"
      ? [TVDB_ARTWORK.POSTER]
      : [TVDB_ARTWORK.BACKGROUND, TVDB_ARTWORK.BANNER];
  return artworks
    .filter((a) => types.includes(a.type))
    .map((a) => ({
      key: `${TVDB_PICKER_PREFIX}${a.url}`,
      previewUrl: a.thumbnail || a.url,
      score: a.score,
      source: "tvdb" as const,
      kind: a.type === TVDB_ARTWORK.BANNER ? "banner" : tab,
    }));
}

export function PosterPickerModal({
  libraryId,
  tmdbId,
  mediaType,
  initialTab,
  onClose,
  onApplied,
}: PosterPickerModalProps) {
  const [tmdbImages, setTmdbImages] = useState<TmdbImageRow[]>([]);
  const [tvdbArtworks, setTvdbArtworks] = useState<TvdbArtwork[] | null>(null);
  const [selected, setSelected] = useState<string | null>(null);
  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState(false);
  const [activeTab, setActiveTab] = useState<"poster" | "backdrop">(initialTab);

  useEffect(() => {
    setLoading(true);
    setSelected(null);
    const path = activeTab === "poster" ? "posters" : "backdrops";
    const q = encodeURIComponent(mediaType);
    const tvdbMediaType = mediaType === "Movie" ? "movie" : "series";

    void Promise.all([
      fetch(`${API_ORIGIN}/api/images/${tmdbId}/${path}?mediaType=${q}`)
        .then((r) => r.json() as Promise<TmdbImageRow[]>)
        .then((data) => (Array.isArray(data) ? data : []))
        .catch(() => [] as TmdbImageRow[]),
      getTvdbArtworks(tmdbId, tvdbMediaType).catch(() => null),
    ])
      .then(([tmdb, tvdb]) => {
        setTmdbImages(tmdb);
        setTvdbArtworks(tvdb);
      })
      .finally(() => setLoading(false));
  }, [tmdbId, activeTab, mediaType]);

  const rows = useMemo<PickerRow[]>(() => {
    const tmdbRows: PickerRow[] = tmdbImages.map((img) => ({
      key: img.filePath,
      previewUrl: `https://image.tmdb.org/t/p/${activeTab === "poster" ? "w342" : "w500"}${img.filePath}`,
      score: img.voteAverage,
      source: "tmdb",
      kind: activeTab,
    }));
    return [...tmdbRows, ...tvdbRowsForTab(tvdbArtworks, activeTab)];
  }, [tmdbImages, tvdbArtworks, activeTab]);

  const handleApply = async () => {
    if (!selected) return;
    setSaving(true);
    try {
      const isTvdb = selected.startsWith(TVDB_PICKER_PREFIX);
      const body = isTvdb
        ? activeTab === "poster"
          ? { tmdbId, mediaType, posterUrl: selected.slice(TVDB_PICKER_PREFIX.length) }
          : { tmdbId, mediaType, backdropUrl: selected.slice(TVDB_PICKER_PREFIX.length) }
        : activeTab === "poster"
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
                {rows.map((row) => (
                  <button
                    key={row.key}
                    type="button"
                    onClick={() => setSelected(row.key)}
                    className={`relative overflow-hidden rounded-lg border-2 transition-all ${
                      selected === row.key
                        ? "scale-[1.02] border-pitflix-primary"
                        : "border-transparent hover:border-pitflix-primary/50"
                    }`}
                  >
                    <img
                      src={row.previewUrl}
                      alt=""
                      className={`w-full object-cover ${
                        row.kind === "poster"
                          ? "aspect-[2/3]"
                          : row.kind === "banner"
                            ? "aspect-[758/140]"
                            : "aspect-video"
                      }`}
                    />
                    {selected === row.key ? (
                      <div className="absolute right-2 top-2 flex h-6 w-6 items-center justify-center rounded-full bg-pitflix-primary">
                        <span className="text-xs text-white">✓</span>
                      </div>
                    ) : null}
                    {row.source === "tvdb" ? (
                      <div className="absolute left-2 top-2 rounded bg-black/70 px-1.5 py-0.5 text-[10px] font-medium uppercase tracking-wide text-white/80">
                        TVDB
                      </div>
                    ) : null}
                    {row.kind === "banner" ? (
                      <div className="absolute bottom-1 left-1 rounded bg-black/70 px-1 text-[10px] text-white/80">
                        Banner
                      </div>
                    ) : null}
                    {(row.score ?? 0) > 0 ? (
                      <div className="absolute bottom-1 right-1 rounded bg-black/70 px-1 text-xs text-white">
                        ★ {row.score!.toFixed(1)}
                      </div>
                    ) : null}
                  </button>
                ))}
              </div>
            )}
          </div>

          <div className="flex items-center justify-between border-t border-pitflix-card p-4">
            <span className="text-sm text-pitflix-muted">{rows.length} options available</span>
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
