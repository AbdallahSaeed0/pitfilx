import { AnimatePresence, motion } from "framer-motion";
import { useCallback, useEffect, useState } from "react";
import {
  downloadSubtitle,
  downloadSubDl,
  getEpisodeSubtitles,
  getMovieSubtitles,
  searchSubtitles,
  searchSubDl,
  type SubtitleRow,
  type SubDlRow,
} from "../api/subtitles";
import { Spinner } from "./ui/Spinner";

type Props = {
  open: boolean;
  onClose: () => void;
  title: string;
  mode: "movie" | "episode";
  movieId?: number;
  movieTmdbId?: number;
  episodeId?: number;
  showTmdbId?: number;
  episodeSeason?: number;
  episodeNumber?: number;
  videoFilePath: string;
  /** IMDb ID — used for SubDL search quality. */
  imdbId?: string;
};

// Language code → { flag, name }
function langInfo(lang: string): { flag: string; name: string } {
  const code = lang.toLowerCase().split("-")[0].trim();
  const map: Record<string, { flag: string; name: string }> = {
    ar: { flag: "🇸🇦", name: "Arabic" },
    "ar-eg": { flag: "🇪🇬", name: "Arabic (Egypt)" },
    en: { flag: "🇬🇧", name: "English" },
    "en-us": { flag: "🇺🇸", name: "English (US)" },
    fr: { flag: "🇫🇷", name: "French" },
    es: { flag: "🇪🇸", name: "Spanish" },
    de: { flag: "🇩🇪", name: "German" },
    it: { flag: "🇮🇹", name: "Italian" },
    pt: { flag: "🇵🇹", name: "Portuguese" },
    "pt-br": { flag: "🇧🇷", name: "Portuguese (BR)" },
    ru: { flag: "🇷🇺", name: "Russian" },
    zh: { flag: "🇨🇳", name: "Chinese" },
    ja: { flag: "🇯🇵", name: "Japanese" },
    ko: { flag: "🇰🇷", name: "Korean" },
    tr: { flag: "🇹🇷", name: "Turkish" },
    nl: { flag: "🇳🇱", name: "Dutch" },
    pl: { flag: "🇵🇱", name: "Polish" },
    sv: { flag: "🇸🇪", name: "Swedish" },
    da: { flag: "🇩🇰", name: "Danish" },
    fi: { flag: "🇫🇮", name: "Finnish" },
    no: { flag: "🇳🇴", name: "Norwegian" },
    cs: { flag: "🇨🇿", name: "Czech" },
    hu: { flag: "🇭🇺", name: "Hungarian" },
    ro: { flag: "🇷🇴", name: "Romanian" },
    he: { flag: "🇮🇱", name: "Hebrew" },
    fa: { flag: "🇮🇷", name: "Persian" },
    id: { flag: "🇮🇩", name: "Indonesian" },
    vi: { flag: "🇻🇳", name: "Vietnamese" },
    th: { flag: "🇹🇭", name: "Thai" },
    uk: { flag: "🇺🇦", name: "Ukrainian" },
    bg: { flag: "🇧🇬", name: "Bulgarian" },
    sk: { flag: "🇸🇰", name: "Slovak" },
    hr: { flag: "🇭🇷", name: "Croatian" },
    sr: { flag: "🇷🇸", name: "Serbian" },
    el: { flag: "🇬🇷", name: "Greek" },
    ca: { flag: "🏴󠁥󠁳󠁣󠁴󠁿", name: "Catalan" },
    hi: { flag: "🇮🇳", name: "Hindi" },
    bn: { flag: "🇧🇩", name: "Bengali" },
    ur: { flag: "🇵🇰", name: "Urdu" },
  };

  // Full-code match first, then base code, then SubDL natural-language names
  const fullCode = lang.toLowerCase();
  if (map[fullCode]) return map[fullCode];
  if (map[code]) return map[code];

  // SubDL returns language names like "Arabic", "English", etc.
  const byName: Record<string, { flag: string; name: string }> = {
    arabic: { flag: "🇸🇦", name: "Arabic" },
    english: { flag: "🇬🇧", name: "English" },
    french: { flag: "🇫🇷", name: "French" },
    spanish: { flag: "🇪🇸", name: "Spanish" },
    german: { flag: "🇩🇪", name: "German" },
    italian: { flag: "🇮🇹", name: "Italian" },
    portuguese: { flag: "🇵🇹", name: "Portuguese" },
    russian: { flag: "🇷🇺", name: "Russian" },
    chinese: { flag: "🇨🇳", name: "Chinese" },
    japanese: { flag: "🇯🇵", name: "Japanese" },
    korean: { flag: "🇰🇷", name: "Korean" },
    turkish: { flag: "🇹🇷", name: "Turkish" },
    dutch: { flag: "🇳🇱", name: "Dutch" },
    persian: { flag: "🇮🇷", name: "Persian" },
    hebrew: { flag: "🇮🇱", name: "Hebrew" },
  };
  const nameLower = lang.toLowerCase();
  if (byName[nameLower]) return byName[nameLower];

  return { flag: "🌐", name: lang || "Unknown" };
}

type Tab = "opensubtitles" | "subdl";

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
  imdbId,
}: Props) {
  const [tab, setTab] = useState<Tab>("opensubtitles");
  const [loading, setLoading] = useState(false);
  const [rows, setRows] = useState<SubtitleRow[]>([]);
  const [transportError, setTransportError] = useState<string | null>(null);
  const [apiMessage, setApiMessage] = useState<string | null>(null);
  const [manualQ, setManualQ] = useState("");
  const [downloadState, setDownloadState] = useState<Record<number, "idle" | "loading" | "ok" | "err">>({});

  // SubDL state
  const [sdlLoading, setSdlLoading] = useState(false);
  const [sdlRows, setSdlRows] = useState<SubDlRow[]>([]);
  const [sdlError, setSdlError] = useState<string | null>(null);
  const [sdlDownload, setSdlDownload] = useState<Record<string, "idle" | "loading" | "ok" | "err">>({});

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

  // Load OpenSubtitles on open
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

  // Load SubDL when that tab is first selected
  useEffect(() => {
    if (!open || tab !== "subdl" || sdlRows.length > 0 || sdlLoading) return;
    setSdlLoading(true);
    setSdlError(null);
    void searchSubDl({
      imdbId,
      tmdbId: mode === "movie" ? movieTmdbId : showTmdbId,
      title,
      mediaType: mode === "movie" ? "Movie" : "Series",
      season: episodeSeason,
      episode: episodeNumber,
    })
      .then((p) => {
        setSdlRows(p.items);
        if (p.error) setSdlError(p.error);
      })
      .catch(() => setSdlError("SubDL search failed."))
      .finally(() => setSdlLoading(false));
  }, [open, tab, sdlRows.length, sdlLoading, imdbId, mode, movieTmdbId, showTmdbId, title, episodeSeason, episodeNumber]);

  // Reset SubDL cache when drawer reopens
  useEffect(() => {
    if (!open) {
      setSdlRows([]);
      setSdlError(null);
      setSdlDownload({});
    }
  }, [open]);

  const searchBar = (
    <div className="flex gap-2">
      <input
        value={manualQ}
        onChange={(e) => setManualQ(e.target.value)}
        onKeyDown={(e) => { if (e.key === "Enter") runManualSearch(); }}
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

  function LangBadge({ lang }: { lang: string }) {
    const { flag, name } = langInfo(lang);
    return (
      <span className="inline-flex items-center gap-1 text-sm leading-none">
        <span>{flag}</span>
        <span className="text-xs text-pitflix-muted">{name}</span>
      </span>
    );
  }

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
            className="fixed bottom-0 right-0 top-0 z-[110] flex w-full max-w-[420px] flex-col border-l border-pitflix-card bg-pitflix-surface shadow-2xl sm:bottom-auto sm:h-full sm:rounded-l-xl"
          >
            {/* Header */}
            <div className="flex items-center justify-between border-b border-pitflix-card px-4 py-3">
              <h2 className="text-sm font-semibold text-white">Subtitles — {title}</h2>
              <button type="button" onClick={onClose} className="text-pitflix-muted hover:text-white" aria-label="Close">
                ✕
              </button>
            </div>

            {/* Tabs */}
            <div className="flex shrink-0 gap-1 border-b border-pitflix-card px-4 py-2">
              {(["opensubtitles", "subdl"] as Tab[]).map((t) => (
                <button
                  key={t}
                  type="button"
                  onClick={() => setTab(t)}
                  className={`rounded-lg px-3 py-1.5 text-xs font-semibold transition-colors ${
                    tab === t ? "bg-pitflix-primary text-white" : "text-pitflix-muted hover:text-white"
                  }`}
                >
                  {t === "opensubtitles" ? "OpenSubtitles" : "SubDL"}
                </button>
              ))}
            </div>

            {/* Content */}
            <div className="flex min-h-0 flex-1 flex-col gap-3 overflow-y-auto p-4">
              {tab === "opensubtitles" && (
                <>
                  <div className="shrink-0 space-y-2">
                    {searchBar}
                    <p className="text-[11px] text-pitflix-subtle">
                      Default list uses your library title. Edit the query and tap Search if nothing appears.
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
                              <LangBadge lang={s.language} />
                              <div className="min-w-0 flex-1">
                                <p className="line-clamp-2 text-xs font-medium text-white">{s.releaseName}</p>
                                <p className="mt-0.5 text-[10px] text-pitflix-muted">
                                  DL {s.downloadCount}
                                  {s.ratings > 0 ? ` · ★ ${s.ratings.toFixed(1)}` : ""}
                                </p>
                                <div className="mt-1 flex flex-wrap gap-1">
                                  {s.isMachineTranslated ? (
                                    <span className="rounded bg-pitflix-card px-1.5 py-0.5 text-[10px] text-pitflix-muted">🤖 Auto</span>
                                  ) : null}
                                  {s.isHearingImpaired ? (
                                    <span className="rounded bg-pitflix-card px-1.5 py-0.5 text-[10px] text-pitflix-muted">👂 HI</span>
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
                                    setDownloadState((p) => ({ ...p, [s.fileId]: r.success ? "ok" : "err" }));
                                    if (!r.success) console.warn(r.error);
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
                </>
              )}

              {tab === "subdl" && (
                <>
                  {sdlLoading && sdlRows.length === 0 ? (
                    <div className="flex flex-1 flex-col items-center justify-center py-16">
                      <Spinner />
                    </div>
                  ) : sdlError ? (
                    <p className="text-sm text-red-400">{sdlError}</p>
                  ) : sdlRows.length === 0 ? (
                    <p className="text-sm text-pitflix-muted">No SubDL subtitles found.</p>
                  ) : (
                    <ul className={`space-y-3 pb-4 ${sdlLoading ? "opacity-60" : ""}`}>
                      {sdlRows.map((s) => {
                        const key = s.fullLink;
                        const st = sdlDownload[key] ?? "idle";
                        return (
                          <li key={key} className="rounded-xl border border-pitflix-card bg-pitflix-bg/80 p-3">
                            <div className="mb-2 flex items-start gap-2">
                              <LangBadge lang={s.language} />
                              <div className="min-w-0 flex-1">
                                <p className="line-clamp-2 text-xs font-medium text-white">{s.releaseName}</p>
                                <p className="mt-0.5 text-[10px] text-pitflix-muted uppercase">{s.format}</p>
                                {s.isHearingImpaired ? (
                                  <span className="mt-1 inline-block rounded bg-pitflix-card px-1.5 py-0.5 text-[10px] text-pitflix-muted">
                                    👂 HI
                                  </span>
                                ) : null}
                              </div>
                            </div>
                            <button
                              type="button"
                              disabled={st === "loading"}
                              onClick={() => {
                                setSdlDownload((p) => ({ ...p, [key]: "loading" }));
                                void downloadSubDl({ fullLink: s.fullLink, videoFilePath, language: s.language })
                                  .then((r) => {
                                    setSdlDownload((p) => ({ ...p, [key]: r.success ? "ok" : "err" }));
                                    if (!r.success) console.warn(r.error);
                                  })
                                  .catch(() => setSdlDownload((p) => ({ ...p, [key]: "err" })));
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
                </>
              )}
            </div>
          </motion.aside>
        </>
      ) : null}
    </AnimatePresence>
  );
}
