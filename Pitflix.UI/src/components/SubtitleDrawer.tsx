import { AnimatePresence, motion } from "framer-motion";
import { useCallback, useEffect, useState } from "react";
import {
  downloadSubtitle,
  getEpisodeSubtitles,
  getMovieSubtitles,
  searchSubtitles,
  type SubtitleRow,
} from "../api/subtitles";
import { Spinner } from "./ui/Spinner";

type Props = {
  open: boolean;
  onClose: () => void;
  title: string;
  mode: "movie" | "episode";
  movieId?: number;
  /** TMDB movie id — improves search + manual lookup. */
  movieTmdbId?: number;
  episodeId?: number;
  /** Show TMDB id for episode searches (parent_tmdb_id). */
  showTmdbId?: number;
  episodeSeason?: number;
  episodeNumber?: number;
  videoFilePath: string;
};

export function SubtitleDrawer({
  open,
  onClose,
  title,
  mode,
  movieId,
  movieTmdbId,
  episodeId,
  showTmdbId,
  episodeSeason,
  episodeNumber,
  videoFilePath,
}: Props) {
  const [loading, setLoading] = useState(false);
  const [rows, setRows] = useState<SubtitleRow[]>([]);
  const [transportError, setTransportError] = useState<string | null>(null);
  const [apiMessage, setApiMessage] = useState<string | null>(null);
  const [manualQ, setManualQ] = useState("");
  const [downloadState, setDownloadState] = useState<Record<number, "idle" | "loading" | "ok" | "err">>({});

  const runManualSearch = useCallback(() => {
    const q = manualQ.trim();
    if (!q) return;

    setLoading(true);
    setTransportError(null);
    const payload =
      mode === "movie"
        ? searchSubtitles({ query: q, type: "movie", tmdbId: movieTmdbId })
        : searchSubtitles({
            query: q,
            type: "episode",
            parentTmdbId: showTmdbId,
            season: episodeSeason,
            episode: episodeNumber,
          });

    void payload
      .then((p) => {
        setRows(p.items);
        setApiMessage(p.error ?? null);
      })
      .catch(() => setTransportError("Could not search subtitles. Check that the API is running."))
      .finally(() => setLoading(false));
  }, [manualQ, mode, movieTmdbId, showTmdbId, episodeSeason, episodeNumber]);

  useEffect(() => {
    if (!open) return;

    setManualQ(title);
    setRows([]);
    setTransportError(null);
    setApiMessage(null);
    setDownloadState({});
    setLoading(true);

    const run =
      mode === "movie" && movieId
        ? getMovieSubtitles(movieId)
        : mode === "episode" && episodeId
          ? getEpisodeSubtitles(episodeId)
          : Promise.resolve({ items: [] as SubtitleRow[], error: null as string | null });

    void run
      .then((p) => {
        setRows(p.items);
        setApiMessage(p.error ?? null);
      })
      .catch(() => setTransportError("Could not load subtitles. Check that the API is running."))
      .finally(() => setLoading(false));
  }, [open, mode, movieId, episodeId, title]);

  const flagEmoji = (lang: string) =>
    lang.toLowerCase().startsWith("ar") ? "🇸🇦" : "🇬🇧";

  const searchBar = (
    <div className="flex gap-2">
      <input
        value={manualQ}
        onChange={(e) => setManualQ(e.target.value)}
        onKeyDown={(e) => {
          if (e.key === "Enter") runManualSearch();
        }}
        placeholder="Search OpenSubtitles…"
        className="min-w-0 flex-1 rounded-lg border border-pitflix-card bg-pitflix-bg px-3 py-2 text-sm text-white"
      />
      <button
        type="button"
        disabled={loading || !manualQ.trim()}
        onClick={() => runManualSearch()}
        className="shrink-0 rounded-lg bg-pitflix-primary px-3 py-2 text-sm font-medium text-white disabled:opacity-40"
      >
        Search
      </button>
    </div>
  );

  return (
    <AnimatePresence>
      {open ? (
        <>
          <motion.div
            role="presentation"
            className="fixed inset-0 z-[100] bg-black/50"
            initial={{ opacity: 0 }}
            animate={{ opacity: 1 }}
            exit={{ opacity: 0 }}
            onClick={onClose}
          />
          <motion.aside
            initial={{ x: "100%" }}
            animate={{ x: 0 }}
            exit={{ x: "100%" }}
            transition={{ type: "tween", duration: 0.22 }}
            className="fixed bottom-0 right-0 top-0 z-[110] flex w-full max-w-[400px] flex-col border-l border-pitflix-card bg-pitflix-surface shadow-2xl sm:bottom-auto sm:h-full sm:rounded-l-xl"
          >
            <div className="flex items-center justify-between border-b border-pitflix-card px-4 py-3">
              <h2 className="text-sm font-semibold text-white">Subtitles — {title}</h2>
              <button
                type="button"
                onClick={onClose}
                className="text-pitflix-muted hover:text-white"
                aria-label="Close"
              >
                ✕
              </button>
            </div>
            <div className="flex min-h-0 flex-1 flex-col gap-3 overflow-y-auto p-4">
              <div className="shrink-0 space-y-2">
                {searchBar}
                <p className="text-[11px] text-pitflix-subtle">
                  Default list uses your library title. Edit the query and tap Search if nothing appears (colon in titles
                  can be picky).
                </p>
              </div>

              {transportError ? <p className="shrink-0 text-sm text-red-400">{transportError}</p> : null}
              {apiMessage ? (
                <p className="shrink-0 rounded-lg border border-amber-500/30 bg-amber-500/10 px-3 py-2 text-xs text-amber-100">
                  {apiMessage}
                </p>
              ) : null}

              {loading && rows.length === 0 ? (
                <div className="flex flex-1 flex-col items-center justify-center py-16">
                  <Spinner />
                </div>
              ) : rows.length === 0 ? (
                <p className="text-sm text-pitflix-muted">No subtitles for this search yet.</p>
              ) : (
                <ul className={`space-y-3 pb-4 ${loading ? "opacity-60" : ""}`}>
                  {rows.map((s) => {
                    const st = downloadState[s.fileId] ?? "idle";
                    return (
                      <li
                        key={s.subtitleId + s.fileId}
                        className="rounded-xl border border-pitflix-card bg-pitflix-bg/80 p-3"
                      >
                        <div className="mb-2 flex items-start gap-2">
                          <span className="text-lg leading-none">{flagEmoji(s.language)}</span>
                          <div className="min-w-0 flex-1">
                            <p className="line-clamp-2 text-xs font-medium text-white">{s.releaseName}</p>
                            <p className="mt-0.5 text-[10px] text-pitflix-muted">
                              DL {s.downloadCount}
                              {s.ratings > 0 ? ` · ★ ${s.ratings.toFixed(1)}` : ""}
                            </p>
                            <div className="mt-1 flex flex-wrap gap-1">
                              {s.isMachineTranslated ? (
                                <span className="rounded bg-pitflix-card px-1.5 py-0.5 text-[10px] text-pitflix-muted">
                                  🤖 Auto
                                </span>
                              ) : null}
                              {s.isHearingImpaired ? (
                                <span className="rounded bg-pitflix-card px-1.5 py-0.5 text-[10px] text-pitflix-muted">
                                  👂 HI
                                </span>
                              ) : null}
                            </div>
                          </div>
                        </div>
                        <button
                          type="button"
                          disabled={st === "loading"}
                          onClick={() => {
                            setDownloadState((p) => ({ ...p, [s.fileId]: "loading" }));
                            void downloadSubtitle({
                              fileId: s.fileId,
                              videoFilePath,
                              languageCode: s.language || "en",
                            })
                              .then((r) => {
                                if (r.success)
                                  setDownloadState((p) => ({ ...p, [s.fileId]: "ok" }));
                                else {
                                  setDownloadState((p) => ({ ...p, [s.fileId]: "err" }));
                                  console.warn(r.error);
                                }
                              })
                              .catch(() => setDownloadState((p) => ({ ...p, [s.fileId]: "err" })));
                          }}
                          className="flex w-full items-center justify-center gap-2 rounded-lg bg-pitflix-primary py-2 text-xs font-medium text-white disabled:opacity-50"
                        >
                          {st === "loading" ? <Spinner className="h-4 w-4" /> : null}
                          {st === "ok" ? "✓ Saved" : st === "err" ? "Failed" : "⬇ Download"}
                        </button>
                      </li>
                    );
                  })}
                </ul>
              )}
            </div>
          </motion.aside>
        </>
      ) : null}
    </AnimatePresence>
  );
}
