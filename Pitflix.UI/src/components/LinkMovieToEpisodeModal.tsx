import { Search, Tv } from "lucide-react";
import { useEffect, useState } from "react";
import { linkMovieToEpisode, searchLibraryTitles, type LibraryTitleRow } from "../api/library";
import { useDebounce } from "../hooks/useDebounce";
import { MediaImage } from "./ui/MediaImage";
import { Spinner } from "./ui/Spinner";

/** Best-effort SxxExx / 1x05 / "Episode 5" guess from the file name to prefill the inputs. */
function guessSeasonEpisode(filePath?: string): { season: string; episode: string } {
  const name = (filePath ?? "").split(/[\\/]/).pop() ?? "";
  const se = /s(\d{1,2})[\s._-]*e(\d{1,3})/i.exec(name) ?? /\b(\d{1,2})x(\d{1,3})\b/i.exec(name);
  if (se) return { season: String(Number(se[1])), episode: String(Number(se[2])) };
  const ep = /\b(?:ep?|episode)[\s._-]*(\d{1,3})\b/i.exec(name);
  return { season: "1", episode: ep ? String(Number(ep[1])) : "" };
}

type LinkMovieToEpisodeModalProps = {
  open: boolean;
  onClose: () => void;
  libraryId: number;
  filePath?: string;
  onLinked: (r: { showId: number; season: number }) => void;
};

/** Re-links a file that was matched as a movie to an episode of a series already in the library. */
export function LinkMovieToEpisodeModal({ open, onClose, libraryId, filePath, onLinked }: LinkMovieToEpisodeModalProps) {
  const [q, setQ] = useState("");
  const debounced = useDebounce(q, 300);
  const [results, setResults] = useState<LibraryTitleRow[]>([]);
  const [loading, setLoading] = useState(false);
  const [picked, setPicked] = useState<LibraryTitleRow | null>(null);
  const [season, setSeason] = useState("1");
  const [episode, setEpisode] = useState("");
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    if (!open) return;
    const g = guessSeasonEpisode(filePath);
    setSeason(g.season);
    setEpisode(g.episode);
    setQ("");
    setResults([]);
    setPicked(null);
    setError(null);
  }, [open, filePath]);

  useEffect(() => {
    if (!open) return;
    const term = debounced.trim();
    if (term.length < 2) {
      setResults([]);
      setLoading(false);
      return;
    }
    const ac = new AbortController();
    setLoading(true);
    void searchLibraryTitles(term, ac.signal)
      .then((d) => setResults(d.shows))
      .catch(() => {
        if (!ac.signal.aborted) setResults([]);
      })
      .finally(() => {
        if (!ac.signal.aborted) setLoading(false);
      });
    return () => ac.abort();
  }, [open, debounced]);

  const submit = () => {
    if (!picked) return;
    const s = Number(season);
    const e = Number(episode);
    if (!Number.isInteger(s) || s < 0 || !Number.isInteger(e) || e < 1) {
      setError("Enter a valid season and episode number.");
      return;
    }
    setSaving(true);
    setError(null);
    void linkMovieToEpisode(libraryId, { showId: picked.id, season: s, episode: e })
      .then((r) => {
        if (!r.success) {
          setError(r.error ?? "Could not link as an episode.");
          return;
        }
        onLinked({ showId: r.showId ?? picked.id, season: s });
        onClose();
      })
      .catch(() => setError("Could not reach the API."))
      .finally(() => setSaving(false));
  };

  if (!open) return null;

  const numInput =
    "w-20 rounded-lg border border-pitflix-card bg-pitflix-bg px-3 py-2 text-sm text-white focus:border-pitflix-primary focus:outline-none";

  return (
    <div className="fixed inset-0 z-[60] flex items-center justify-center bg-black/80 px-4 backdrop-blur-sm">
      <div className="flex max-h-[85vh] w-full max-w-lg flex-col rounded-xl border border-pitflix-card bg-zinc-900 shadow-2xl">
        <div className="border-b border-pitflix-card px-5 py-4">
          <h3 className="text-lg font-semibold text-white">Link as a series episode</h3>
          <p className="mt-1 text-sm text-zinc-400">
            Pick the series from your library and the episode this file is. The movie entry is removed and its watch
            state moves to the episode.
          </p>
          {filePath ? <p className="mt-1 truncate text-xs text-zinc-500" title={filePath}>File: {filePath}</p> : null}
          {picked ? null : (
            <div className="relative mt-3">
              <Search className="absolute left-3 top-1/2 h-4 w-4 -translate-y-1/2 text-zinc-500" strokeWidth={2} />
              <input
                autoFocus
                value={q}
                onChange={(e) => setQ(e.target.value)}
                placeholder="Search series in your library…"
                className="w-full rounded-lg border border-pitflix-card bg-pitflix-bg py-2.5 pl-10 pr-4 text-sm text-white placeholder:text-zinc-500 focus:border-pitflix-primary focus:outline-none"
              />
            </div>
          )}
        </div>

        <div className="min-h-0 flex-1 overflow-y-auto px-3 py-3">
          {error ? <p className="px-2 pb-2 text-sm text-red-400">{error}</p> : null}
          {picked ? (
            <div className="space-y-4 px-2">
              <div className="flex items-center gap-3 rounded-lg border border-pitflix-primary/40 bg-white/5 p-2">
                <div className="h-16 w-11 shrink-0 overflow-hidden rounded bg-pitflix-card">
                  {picked.posterUrl ? (
                    <MediaImage src={picked.posterUrl} alt="" className="h-full w-full object-cover" fallbackText="" />
                  ) : null}
                </div>
                <div className="min-w-0 flex-1">
                  <p className="font-medium text-white">
                    {picked.title}
                    {picked.year ? <span className="ml-2 font-normal text-zinc-400">({picked.year})</span> : null}
                  </p>
                </div>
                <button
                  type="button"
                  className="shrink-0 text-xs text-zinc-400 hover:text-white"
                  onClick={() => setPicked(null)}
                  disabled={saving}
                >
                  Change
                </button>
              </div>
              <div className="flex items-end gap-4">
                <label className="flex flex-col gap-1 text-xs text-zinc-400">
                  Season
                  <input type="number" min={0} value={season} onChange={(e) => setSeason(e.target.value)} className={numInput} />
                </label>
                <label className="flex flex-col gap-1 text-xs text-zinc-400">
                  Episode
                  <input
                    type="number"
                    min={1}
                    autoFocus
                    value={episode}
                    onChange={(e) => setEpisode(e.target.value)}
                    onKeyDown={(e) => e.key === "Enter" && submit()}
                    className={numInput}
                  />
                </label>
              </div>
            </div>
          ) : loading ? (
            <div className="flex justify-center py-12">
              <Spinner />
            </div>
          ) : debounced.trim().length < 2 ? (
            <p className="px-2 py-8 text-center text-sm text-zinc-500">Type at least 2 characters to search.</p>
          ) : results.length === 0 ? (
            <p className="px-2 py-8 text-center text-sm text-zinc-500">No series in your library match.</p>
          ) : (
            <ul className="space-y-2">
              {results.map((hit) => (
                <li key={hit.id}>
                  <button
                    type="button"
                    onClick={() => setPicked(hit)}
                    className="flex w-full gap-3 rounded-lg border border-transparent p-2 text-left transition-colors hover:border-pitflix-primary/40 hover:bg-white/5"
                  >
                    <div className="h-16 w-11 shrink-0 overflow-hidden rounded bg-pitflix-card">
                      {hit.posterUrl ? (
                        <MediaImage src={hit.posterUrl} alt="" className="h-full w-full object-cover" fallbackText="" />
                      ) : null}
                    </div>
                    <div className="min-w-0 flex-1">
                      <p className="font-medium text-white">
                        {hit.title}
                        {hit.year ? <span className="ml-2 font-normal text-zinc-400">({hit.year})</span> : null}
                      </p>
                      {hit.overview ? <p className="mt-0.5 line-clamp-2 text-xs text-zinc-500">{hit.overview}</p> : null}
                    </div>
                  </button>
                </li>
              ))}
            </ul>
          )}
        </div>

        <div className="flex gap-3 border-t border-pitflix-card px-5 py-3">
          <button
            type="button"
            className="flex-1 rounded-lg border border-zinc-600 py-2.5 text-sm font-medium text-zinc-200 hover:bg-zinc-800"
            onClick={onClose}
            disabled={saving}
          >
            Cancel
          </button>
          {picked ? (
            <button
              type="button"
              className="flex flex-1 items-center justify-center gap-2 rounded-lg bg-pitflix-primary py-2.5 text-sm font-semibold text-white hover:opacity-90 disabled:opacity-50"
              onClick={submit}
              disabled={saving || !episode}
            >
              <Tv className="h-4 w-4" strokeWidth={2} />
              {saving ? "Linking…" : "Link episode"}
            </button>
          ) : null}
        </div>
      </div>
    </div>
  );
}
