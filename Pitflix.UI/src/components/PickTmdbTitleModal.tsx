import { Search } from "lucide-react";
import { useEffect, useMemo, useState } from "react";
import {
  matchLibraryEpisodeTmdb,
  matchLibraryMovieTmdb,
  matchLibrarySeriesTmdb,
} from "../api/library";
import { searchUnmatched } from "../api/unmatched";
import { useDebounce } from "../hooks/useDebounce";
import { MediaImage } from "./ui/MediaImage";
import { Spinner } from "./ui/Spinner";

export type PickTmdbMatchTarget =
  | { kind: "movie"; libraryId: number }
  | { kind: "series"; libraryId: number }
  | { kind: "episode"; episodeId: number }
  | { kind: "episode-bulk"; episodeIds: number[] };

type SearchHit = {
  id: number;
  title: string;
  year?: string;
  overview?: string | null;
  posterUrl?: string | null;
};

function mapResults(data: unknown): SearchHit[] {
  if (!Array.isArray(data)) return [];
  return data.map((raw) => {
    const r = raw as Record<string, unknown>;
    const id = Number(r.id ?? 0);
    const title = String(r.title ?? "");
    const year = typeof r.year === "string" && r.year.length >= 4 ? r.year.slice(0, 4) : undefined;
    const overview = typeof r.overview === "string" ? r.overview : null;
    const posterUrl = typeof r.posterUrl === "string" ? r.posterUrl : null;
    return { id, title, year, overview, posterUrl };
  });
}

export type PickTmdbMatchResult = {
  libraryId?: number;
  showId?: number;
  episodeId?: number;
};

type PickTmdbTitleModalProps = {
  open: boolean;
  onClose: () => void;
  target: PickTmdbMatchTarget | null;
  hintTitle?: string;
  onMatched: (result: PickTmdbMatchResult) => void;
};

export function PickTmdbTitleModal({ open, onClose, target, hintTitle, onMatched }: PickTmdbTitleModalProps) {
  const [q, setQ] = useState("");
  const debounced = useDebounce(q, 400);
  const [results, setResults] = useState<SearchHit[]>([]);
  const [loading, setLoading] = useState(false);
  const [applyingId, setApplyingId] = useState<number | null>(null);
  const [error, setError] = useState<string | null>(null);

  const mediaType = useMemo(() => (target?.kind === "movie" ? "Movie" : "Series"), [target?.kind]);

  const heading = useMemo(() => {
    if (!target) return "";
    if (target.kind === "movie") return "Pick the correct movie";
    if (target.kind === "series") return "Pick the correct series";
    return target.kind === "episode-bulk"
      ? "Attach selected episodes to the right series"
      : "Attach this episode to the right series";
  }, [target]);

  const placeholder = target?.kind === "movie" ? "Search movies on TMDB…" : "Search TV shows on TMDB…";

  useEffect(() => {
    if (!open) {
      setQ("");
      setResults([]);
      setError(null);
    }
  }, [open]);

  useEffect(() => {
    if (!open || !target) return;
    const term = debounced.trim();
    if (term.length < 2) {
      setResults([]);
      setLoading(false);
      return;
    }
    setLoading(true);
    setError(null);
    void searchUnmatched({ query: term, mediaType })
      .then((data) => setResults(mapResults(data)))
      .catch(() => {
        setResults([]);
        setError("Search failed. Check TMDB key and network.");
      })
      .finally(() => setLoading(false));
  }, [open, debounced, mediaType, target]);

  const pick = (tmdbId: number) => {
    if (!target) return;
    setApplyingId(tmdbId);
    setError(null);

    const done = () => setApplyingId(null);

    if (target.kind === "movie") {
      void matchLibraryMovieTmdb(target.libraryId, tmdbId)
        .then((r) => {
          if (!r.success) {
            setError(r.error ?? "Could not apply this title.");
            return;
          }
          onMatched({ libraryId: r.libraryId ?? target.libraryId });
          onClose();
        })
        .catch(() => setError("Could not reach the API."))
        .finally(done);
      return;
    }

    if (target.kind === "series") {
      void matchLibrarySeriesTmdb(target.libraryId, tmdbId)
        .then((r) => {
          if (!r.success) {
            setError(r.error ?? "Could not apply this series.");
            return;
          }
          onMatched({ libraryId: r.libraryId ?? target.libraryId });
          onClose();
        })
        .catch(() => setError("Could not reach the API."))
        .finally(done);
      return;
    }

    if (target.kind === "episode-bulk") {
      const episodeIds = [...new Set(target.episodeIds.filter((x) => Number.isFinite(x) && x > 0))];
      if (episodeIds.length === 0) {
        setError("No episodes selected.");
        done();
        return;
      }
      void Promise.all(episodeIds.map((id) => matchLibraryEpisodeTmdb(id, tmdbId)))
        .then((rows) => {
          const failed = rows.filter((r) => !r.success);
          if (failed.length > 0) {
            setError(`Could not re-link ${failed.length} episode(s).`);
            return;
          }
          onMatched({ showId: rows[0]?.showId });
          onClose();
        })
        .catch(() => setError("Could not reach the API."))
        .finally(done);
      return;
    }

    void matchLibraryEpisodeTmdb(target.episodeId, tmdbId)
      .then((r) => {
        if (!r.success) {
          setError(r.error ?? "Could not re-link this episode.");
          return;
        }
        onMatched({ showId: r.showId, episodeId: r.episodeId });
        onClose();
      })
      .catch(() => setError("Could not reach the API."))
      .finally(done);
  };

  if (!open || !target) return null;

  return (
    <div className="fixed inset-0 z-[60] flex items-center justify-center bg-black/80 px-4 backdrop-blur-sm">
      <div className="flex max-h-[85vh] w-full max-w-lg flex-col rounded-xl border border-pitflix-card bg-zinc-900 shadow-2xl">
        <div className="border-b border-pitflix-card px-5 py-4">
          <h3 className="text-lg font-semibold text-white">{heading}</h3>
          <p className="mt-1 text-sm text-zinc-400">
            Search TMDB and choose the title that matches your media
            {hintTitle ? ` (“${hintTitle}”)` : ""}.
          </p>
          <div className="relative mt-3">
            <Search className="absolute left-3 top-1/2 h-4 w-4 -translate-y-1/2 text-zinc-500" strokeWidth={2} />
            <input
              autoFocus
              value={q}
              onChange={(e) => setQ(e.target.value)}
              placeholder={placeholder}
              className="w-full rounded-lg border border-pitflix-card bg-pitflix-bg py-2.5 pl-10 pr-4 text-sm text-white placeholder:text-zinc-500 focus:border-pitflix-primary focus:outline-none"
            />
          </div>
        </div>

        <div className="min-h-0 flex-1 overflow-y-auto px-3 py-3">
          {error ? <p className="px-2 text-sm text-red-400">{error}</p> : null}
          {loading ? (
            <div className="flex justify-center py-12">
              <Spinner />
            </div>
          ) : debounced.trim().length < 2 ? (
            <p className="px-2 py-8 text-center text-sm text-zinc-500">Type at least 2 characters to search.</p>
          ) : results.length === 0 ? (
            <p className="px-2 py-8 text-center text-sm text-zinc-500">No results.</p>
          ) : (
            <ul className="space-y-2">
              {results.map((hit) => (
                <li key={hit.id}>
                  <button
                    type="button"
                    disabled={applyingId !== null}
                    onClick={() => pick(hit.id)}
                    className="flex w-full gap-3 rounded-lg border border-transparent p-2 text-left transition-colors hover:border-pitflix-primary/40 hover:bg-white/5 disabled:opacity-50"
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
                      {hit.overview ? (
                        <p className="mt-0.5 line-clamp-2 text-xs text-zinc-500">{hit.overview}</p>
                      ) : null}
                      <p className="mt-1 text-xs text-pitflix-primary">
                        {applyingId === hit.id ? "Applying…" : "Use this title →"}
                      </p>
                    </div>
                  </button>
                </li>
              ))}
            </ul>
          )}
        </div>

        <div className="border-t border-pitflix-card px-5 py-3">
          <button
            type="button"
            className="w-full rounded-lg border border-zinc-600 py-2.5 text-sm font-medium text-zinc-200 hover:bg-zinc-800"
            onClick={onClose}
            disabled={applyingId !== null}
          >
            Cancel
          </button>
        </div>
      </div>
    </div>
  );
}
