import { useEffect, useMemo, useState } from "react";
import { AnimatePresence, motion } from "framer-motion";
import { useQueryClient, type QueryClient } from "@tanstack/react-query";
import { API_ORIGIN } from "../api/client";
import { getTvdbArtworks, TVDB_ARTWORK, type TvdbArtwork } from "../api/tvdb";
import { getFanartArtwork, type FanartResponse } from "../api/fanart";

type TmdbImageRow = {
  filePath: string;
  voteAverage?: number;
};

type PickerTab = "poster" | "backdrop" | "logo";

/** Query families that render a title's poster/backdrop/logo outside its own detail page. */
const ARTWORK_QUERY_PREFIXES = ["home", "history", "movies", "series", "movie", "show", "library", "lists", "next-episodes"];

/**
 * New artwork has a new URL (the API saves every pick under a fresh file name), so every list that
 * embeds the old URL — Home's Continue Watching / Up Next and the rest — must refetch to pick it up,
 * not just the detail page that opened the picker.
 */
function invalidateArtworkQueries(qc: QueryClient) {
  void qc.invalidateQueries({
    predicate: (q) => {
      const head = q.queryKey[0];
      return typeof head === "string" && ARTWORK_QUERY_PREFIXES.some((p) => head === p || head.startsWith(`${p}-`));
    },
  });
}

type PickerRow = {
  key: string;
  previewUrl: string;
  score?: number;
  source: "tmdb" | "tvdb" | "fanart";
  kind: "poster" | "backdrop" | "banner" | "logo";
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
const FANART_PICKER_PREFIX = "fanart:";

function tvdbRowsForTab(artworks: TvdbArtwork[] | null, tab: PickerTab): PickerRow[] {
  if (!artworks?.length) return [];
  if (tab === "logo") {
    return artworks
      .filter((a) => a.type === 11 || a.type === 23 || a.type === 25) // TVDB clearlogo type ids
      .map((a) => ({
        key: `${TVDB_PICKER_PREFIX}${a.url}`,
        previewUrl: a.thumbnail || a.url,
        score: a.score,
        source: "tvdb" as const,
        kind: "logo" as const,
      }));
  }
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

function fanartRowsForTab(fanart: FanartResponse | null, tab: PickerTab): PickerRow[] {
  if (!fanart) return [];
  const items =
    tab === "poster" ? fanart.posters : tab === "backdrop" ? fanart.backgrounds : fanart.clearLogos;
  return items.map((a) => ({
    key: `${FANART_PICKER_PREFIX}${a.url}`,
    previewUrl: a.url,
    source: "fanart" as const,
    kind: tab === "poster" ? "poster" : tab === "backdrop" ? "backdrop" : "logo",
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
  const qc = useQueryClient();
  const [tmdbImages, setTmdbImages] = useState<TmdbImageRow[]>([]);
  const [tvdbArtworks, setTvdbArtworks] = useState<TvdbArtwork[] | null>(null);
  const [fanart, setFanart] = useState<FanartResponse | null>(null);
  const [selected, setSelected] = useState<string | null>(null);
  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState(false);
  const [activeTab, setActiveTab] = useState<PickerTab>(initialTab);

  useEffect(() => {
    setLoading(true);
    setSelected(null);
    const q = encodeURIComponent(mediaType);
    const tvdbMediaType = mediaType === "Movie" ? "movie" : "series";

    const tmdbFetch =
      activeTab === "logo"
        ? Promise.resolve([] as TmdbImageRow[])
        : fetch(`${API_ORIGIN}/api/images/${tmdbId}/${activeTab === "poster" ? "posters" : "backdrops"}?mediaType=${q}`)
            .then((r) => r.json() as Promise<TmdbImageRow[]>)
            .then((data) => (Array.isArray(data) ? data : []))
            .catch(() => [] as TmdbImageRow[]);

    void Promise.all([
      tmdbFetch,
      getTvdbArtworks(tmdbId, tvdbMediaType).catch(() => null),
      getFanartArtwork(tmdbId, tvdbMediaType),
    ])
      .then(([tmdb, tvdb, fa]) => {
        setTmdbImages(tmdb);
        setTvdbArtworks(tvdb);
        setFanart(fa);
      })
      .finally(() => setLoading(false));
  }, [tmdbId, activeTab, mediaType]);

  const rows = useMemo<PickerRow[]>(() => {
    const tmdbRows: PickerRow[] =
      activeTab === "logo"
        ? []
        : tmdbImages.map((img) => ({
            key: img.filePath,
            previewUrl: `https://image.tmdb.org/t/p/${activeTab === "poster" ? "w342" : "w500"}${img.filePath}`,
            score: img.voteAverage,
            source: "tmdb",
            kind: activeTab,
          }));
    return [...tmdbRows, ...tvdbRowsForTab(tvdbArtworks, activeTab), ...fanartRowsForTab(fanart, activeTab)];
  }, [tmdbImages, tvdbArtworks, fanart, activeTab]);

  const handleApply = async () => {
    if (!selected) return;
    setSaving(true);
    try {
      const isTvdb = selected.startsWith(TVDB_PICKER_PREFIX);
      const isFanart = selected.startsWith(FANART_PICKER_PREFIX);
      const remoteUrl = isTvdb
        ? selected.slice(TVDB_PICKER_PREFIX.length)
        : isFanart
          ? selected.slice(FANART_PICKER_PREFIX.length)
          : null;

      const body =
        activeTab === "logo"
          ? { tmdbId, mediaType, logoUrl: remoteUrl }
          : remoteUrl
            ? activeTab === "poster"
              ? { tmdbId, mediaType, posterUrl: remoteUrl }
              : { tmdbId, mediaType, backdropUrl: remoteUrl }
            : activeTab === "poster"
              ? { tmdbId, mediaType, posterPath: selected }
              : { tmdbId, mediaType, backdropPath: selected };

      const res = await fetch(`${API_ORIGIN}/api/images/${libraryId}/select`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(body),
      });
      if (!res.ok) return;
      invalidateArtworkQueries(qc);
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
              Choose {activeTab === "poster" ? "Poster" : activeTab === "backdrop" ? "Backdrop" : "Logo"}
            </h2>
            <div className="flex items-center gap-3">
              <div className="flex gap-1 rounded-lg bg-pitflix-card p-1">
                {(["poster", "backdrop", "logo"] as const).map((t) => (
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
              <div className={`grid gap-3 ${activeTab === "poster" ? "grid-cols-4" : "grid-cols-3"}`}>
                {Array.from({ length: 12 }).map((_, i) => (
                  <div
                    key={i}
                    className={`animate-pulse rounded-lg bg-pitflix-card ${
                      activeTab === "poster" ? "aspect-[2/3]" : activeTab === "logo" ? "aspect-video" : "aspect-video"
                    }`}
                  />
                ))}
              </div>
            ) : rows.length === 0 ? (
              <p className="py-12 text-center text-sm text-pitflix-muted">
                No {activeTab === "logo" ? "logos" : activeTab} found from any connected source.
              </p>
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
                      row.kind === "logo" ? "bg-white/5" : ""
                    } ${
                      selected === row.key
                        ? "scale-[1.02] border-pitflix-primary"
                        : "border-transparent hover:border-pitflix-primary/50"
                    }`}
                  >
                    <img
                      src={row.previewUrl}
                      alt=""
                      className={`w-full ${
                        row.kind === "poster"
                          ? "aspect-[2/3] object-cover"
                          : row.kind === "banner"
                            ? "aspect-[758/140] object-cover"
                            : row.kind === "logo"
                              ? "aspect-video object-contain p-3"
                              : "aspect-video object-cover"
                      }`}
                    />
                    {selected === row.key ? (
                      <div className="absolute right-2 top-2 flex h-6 w-6 items-center justify-center rounded-full bg-pitflix-primary">
                        <span className="text-xs text-white">✓</span>
                      </div>
                    ) : null}
                    {row.source === "fanart" ? (
                      <div className="absolute left-2 top-2 rounded bg-black/70 px-1.5 py-0.5 text-[10px] font-medium uppercase tracking-wide text-white/80">
                        Fanart
                      </div>
                    ) : row.source === "tvdb" ? (
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
