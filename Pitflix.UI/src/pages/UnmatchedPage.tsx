import { useQuery, useQueryClient } from "@tanstack/react-query";
import { Lightbulb, Search, Trash2 } from "lucide-react";
import { useMemo, useState } from "react";
import { API_ORIGIN } from "../api/client";
import { clearAllUnmatched, searchUnmatched, skipUnmatched } from "../api/unmatched";
import { useDebounce } from "../hooks/useDebounce";
import { useUnmatchedPage } from "../hooks/useUnmatched";
import { Badge } from "../components/ui/Badge";
import { DeterminateMatchBar, IndeterminateMatchBar } from "../components/ui/MatchProgressBar";
import { Pagination } from "../components/ui/Pagination";
import { Spinner } from "../components/ui/Spinner";
import { getUnmatchedMatchHints } from "../utils/pathFolderHints";
import { startSmartScan } from "../api/smartMatch";
import { getStats } from "../api/stats";

export type ParsedSuggestion = {
  id: number;
  title: string;
  year?: string;
  overview?: string;
  posterUrl?: string | null;
  mediaType?: string;
};

function parseSuggestions(raw: unknown): ParsedSuggestion[] {
  if (!Array.isArray(raw)) return [];
  const out: ParsedSuggestion[] = [];
  for (const s of raw) {
    if (!s || typeof s !== "object") continue;
    const o = s as Record<string, unknown>;
    const id = Number(o.id ?? o.Id ?? 0);
    if (!id) continue;
    const title = String(o.title ?? o.Title ?? "Unknown");
    const releaseDate = o.releaseDate ?? o.ReleaseDate;
    let year: string | undefined;
    if (typeof releaseDate === "string" && releaseDate.length >= 4) year = releaseDate.slice(0, 4);
    const item: ParsedSuggestion = { id, title };
    if (year !== undefined) item.year = year;
    out.push(item);
  }
  return out;
}

type UnmatchedRowItem = {
  id: number;
  cleanName: string;
  filePath: string;
  suggestions?: unknown;
  mediaType: string;
  scannedAt?: string;
};

export type BulkConfirmState = {
  count: number;
  ids: number[];
  title: string;
  tmdbId: number;
  mediaType: string;
};

function UnmatchedRow({
  item,
  onDone,
  onSiblingsPrompt,
}: {
  item: UnmatchedRowItem;
  onDone: () => void;
  onSiblingsPrompt: (p: BulkConfirmState) => void;
}) {
  const [searching, setSearching] = useState(false);
  const [query, setQuery] = useState("");
  const [results, setResults] = useState<ParsedSuggestion[]>([]);
  const [loading, setLoading] = useState(false);
  const [matching, setMatching] = useState(false);
  /** TMDB search mode: Auto uses the row guess; Both queries movies and TV together. */
  const [searchKind, setSearchKind] = useState<"auto" | "Movie" | "Series" | "Both">("auto");

  const suggestions = parseSuggestions(item.suggestions);
  const rowGuessType = item.mediaType || "Movie";
  const searchApiMediaType =
    searchKind === "auto" ? rowGuessType : searchKind === "Both" ? "Both" : searchKind;
  const folderHints = useMemo(
    () => getUnmatchedMatchHints(item.filePath, item.cleanName ?? "", 3),
    [item.filePath, item.cleanName],
  );

  const resolveMatchMediaType = (pickedSuggestion?: ParsedSuggestion) => {
    const fromResult = pickedSuggestion?.mediaType;
    if (fromResult === "Movie" || fromResult === "Series") return fromResult;
    if (searchKind === "Movie" || searchKind === "Series") return searchKind;
    return rowGuessType;
  };

  const mapSearchResults = (data: unknown): ParsedSuggestion[] => {
    const mapped: ParsedSuggestion[] = (Array.isArray(data) ? data : []).map((raw) => {
      const r = raw as Record<string, unknown>;
      const id = Number(r.id ?? r.Id ?? 0);
      const title = String(
        r.title ?? r.name ?? r.titleMovie ?? r.titleTv ?? r.Title ?? r.TitleMovie ?? "",
      );
      const year =
        typeof r.year === "string" && r.year.length >= 4 ? r.year.slice(0, 4) : undefined;
      const overview = typeof r.overview === "string" ? r.overview : undefined;
      const posterUrl =
        typeof r.posterUrl === "string"
          ? r.posterUrl
          : typeof r.poster_url === "string"
            ? r.poster_url
            : null;
      const mediaTypeOut =
        typeof r.mediaType === "string"
          ? r.mediaType
          : searchApiMediaType === "Both"
            ? rowGuessType
            : searchApiMediaType;
      return { id, title, year, overview, posterUrl, mediaType: mediaTypeOut };
    });
    return mapped.filter((x) => x.id > 0 && x.title);
  };

  const runSearchWithQuery = async (q: string) => {
    const trimmed = q.trim();
    if (!trimmed) return;
    setQuery(trimmed);
    setLoading(true);
    try {
      const data = (await searchUnmatched({ query: trimmed, mediaType: searchApiMediaType })) as Record<
        string,
        unknown
      >[];
      setResults(mapSearchResults(data));
    } finally {
      setLoading(false);
    }
  };

  const handleSearch = async () => {
    if (!query.trim()) return;
    await runSearchWithQuery(query);
  };

  const handleMatch = async (tmdbId: number, pickedTitle: string, picked?: ParsedSuggestion) => {
    const mt = resolveMatchMediaType(picked);
    setMatching(true);
    try {
      const r = await fetch(`${API_ORIGIN}/api/unmatched/${item.id}/match`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ tmdbId, mediaType: mt }),
      });
      const res = (await r.json()) as Record<string, unknown>;
      console.log("Match response:", res);
      if (!r.ok) {
        console.error("Match failed:", res);
        return;
      }
      if (res.success !== true) {
        console.error("Match unsuccessful:", res);
        return;
      }

      onDone();

      const siblingsFound = Number(res.siblingsFound ?? res.SiblingsFound ?? 0);
      const rawIds = res.siblingIds ?? res.SiblingIds;
      const siblingIds = Array.isArray(rawIds)
        ? rawIds.map((x) => Number(x)).filter((n) => Number.isFinite(n) && n > 0)
        : [];
      const title = pickedTitle.trim() || String(res.matchedTitle ?? res.MatchedTitle ?? tmdbId);

      if (siblingsFound > 0 && siblingIds.length > 0) {
        onSiblingsPrompt({
          count: siblingsFound,
          ids: siblingIds,
          title,
          tmdbId,
          mediaType: mt,
        });
      }
    } catch (err) {
      console.error("Match failed:", err);
    } finally {
      setMatching(false);
    }
  };

  return (
    <div className="group mb-3 rounded-xl border border-pitflix-card bg-pitflix-card p-4">
      <div className="flex flex-wrap items-start justify-between gap-4">
        <div className="min-w-0 flex-1">
          <p className="font-semibold text-white">{item.cleanName}</p>
          <p className="mt-0.5 truncate text-xs text-pitflix-subtle">{item.filePath}</p>
        </div>
        <Badge className="shrink-0 border-pitflix-subtle/50 text-pitflix-muted">{rowGuessType}</Badge>
      </div>

      <div className="mt-2 flex flex-wrap items-center gap-2">
        <span className="text-[10px] text-pitflix-subtle">Search as:</span>
        {(["auto", "Movie", "Series", "Both"] as const).map((k) => (
          <button
            key={k}
            type="button"
            disabled={matching}
            onClick={() => setSearchKind(k)}
            className={`rounded-md px-2 py-1 text-[10px] font-medium transition-colors disabled:opacity-50 ${
              searchKind === k
                ? "bg-pitflix-primary text-white"
                : "border border-pitflix-card bg-pitflix-bg text-pitflix-muted hover:text-white"
            }`}
          >
            {k === "auto" ? "Auto" : k === "Both" ? "Movies + TV" : k}
          </button>
        ))}
      </div>

      {matching ? <IndeterminateMatchBar label="Contacting TMDB and updating library…" /> : null}

      {suggestions.length > 0 ? (
        <div className="mt-3 flex flex-wrap gap-2">
          {suggestions.map((s) => (
            <button
              key={s.id}
              type="button"
              disabled={matching}
              onClick={() => void handleMatch(s.id, s.title, s)}
              className="rounded-lg border border-pitflix-primary/50 px-3 py-1.5 text-xs text-white transition-colors hover:bg-pitflix-primary disabled:opacity-50"
            >
              ✓ {s.title}
              {s.year ? ` (${s.year})` : ""}
            </button>
          ))}
        </div>
      ) : null}

      <div className="mt-3 flex flex-wrap items-center gap-2">
        <button
          type="button"
          disabled={matching}
          className="inline-flex items-center gap-1.5 rounded-lg border border-pitflix-primary/35 bg-pitflix-primary/10 px-3 py-2 text-xs font-medium text-pitflix-light transition-colors hover:border-pitflix-primary/60 hover:bg-pitflix-primary/20 disabled:opacity-50 disabled:hover:border-pitflix-primary/35 disabled:hover:bg-pitflix-primary/10"
          onClick={() => setSearching(!searching)}
        >
          <Search className="h-3.5 w-3.5 opacity-90" strokeWidth={2} />
          {searching ? "Hide manual search" : "Search TMDB"}
        </button>
      </div>

      {folderHints.length > 0 ? (
        <div className="mt-4 overflow-hidden rounded-xl border border-pitflix-primary/20 bg-gradient-to-b from-pitflix-surface/90 to-pitflix-bg/80 shadow-inner shadow-black/20">
          <div className="flex items-start gap-3 border-b border-white/5 px-4 py-3">
            <div className="mt-0.5 flex h-8 w-8 shrink-0 items-center justify-center rounded-lg bg-pitflix-primary/20 text-pitflix-primary">
              <Lightbulb className="h-4 w-4" strokeWidth={2} />
            </div>
            <div className="min-w-0 flex-1">
              <p className="text-sm font-semibold text-white">Quick search suggestions</p>
              <p className="mt-0.5 text-xs leading-relaxed text-pitflix-subtle">
                One tap runs a TMDB lookup using a cleaned guess from the folder or file path.
              </p>
            </div>
          </div>
          <div className="grid gap-2 p-4 sm:grid-cols-2">
            {folderHints.map((h) => (
              <button
                key={h}
                type="button"
                disabled={matching || loading}
                onClick={() => {
                  setSearching(true);
                  void runSearchWithQuery(h);
                }}
                className="flex min-h-[2.75rem] items-center justify-center rounded-lg border border-pitflix-card bg-pitflix-card/60 px-3 py-2.5 text-left text-xs font-medium leading-snug text-white shadow-sm transition-all hover:border-pitflix-primary/55 hover:bg-pitflix-primary/15 hover:shadow-md disabled:opacity-50"
              >
                <span className="line-clamp-2">{h}</span>
              </button>
            ))}
          </div>
        </div>
      ) : null}

      {searching ? (
        <div className="mt-2 flex flex-wrap gap-2 border-t border-pitflix-surface pt-3">
          <input
            value={query}
            onChange={(e) => setQuery(e.target.value)}
            placeholder="Search title…"
            className="min-w-[160px] flex-1 rounded-lg border border-pitflix-surface bg-pitflix-bg px-3 py-2 text-sm text-white"
            onKeyDown={(e) => e.key === "Enter" && void handleSearch()}
          />
          <button
            type="button"
            disabled={loading}
            onClick={() => void handleSearch()}
            className="rounded-lg bg-pitflix-primary px-3 py-2 text-xs font-medium text-white disabled:opacity-50"
          >
            {loading ? "…" : "Search"}
          </button>
        </div>
      ) : null}

      {results.length > 0 ? (
        <div className="mt-3 space-y-0 rounded-lg border border-pitflix-card/50 overflow-hidden">
          {results.map((s) => (
            <button
              key={s.id}
              type="button"
              disabled={matching}
              onClick={() => void handleMatch(s.id, s.title, s)}
              className="flex w-full items-center gap-3 border-b border-pitflix-card/50 p-2 text-left transition-colors last:border-b-0 hover:bg-pitflix-primary/20 disabled:opacity-50"
            >
              {s.posterUrl ? (
                <img
                  src={s.posterUrl}
                  alt={s.title}
                  className="h-14 w-10 shrink-0 rounded object-cover"
                  onError={(e) => {
                    e.currentTarget.style.display = "none";
                  }}
                />
              ) : (
                <div className="flex h-14 w-10 shrink-0 items-center justify-center rounded bg-pitflix-card">
                  <span className="text-xs text-pitflix-subtle">?</span>
                </div>
              )}
              <div className="min-w-0 flex-1">
                <p className="truncate text-sm font-medium text-white">{s.title}</p>
                <p className="text-xs text-pitflix-muted">
                  {s.year ?? "—"} · {s.mediaType ?? rowGuessType}
                </p>
                {s.overview ? (
                  <p className="mt-0.5 line-clamp-1 text-xs text-pitflix-subtle">{s.overview}</p>
                ) : null}
              </div>
            </button>
          ))}
        </div>
      ) : null}

      <div className="mt-3 flex justify-end">
        <button
          type="button"
          disabled={matching}
          className="rounded-lg px-3 py-1 text-xs text-pitflix-subtle opacity-0 transition-opacity hover:bg-pitflix-surface group-hover:opacity-100 disabled:opacity-30"
          onClick={() =>
            void skipUnmatched(item.id).then(() => {
              onDone();
            })
          }
        >
          Skip
        </button>
      </div>
    </div>
  );
}

export function UnmatchedPage() {
  const qc = useQueryClient();
  const { data: stats } = useQuery({ queryKey: ["stats"], queryFn: getStats });
  const globalUnmatched = stats?.totalUnmatched ?? 0;
  const [search, setSearch] = useState("");
  const q = useDebounce(search, 220);
  const [type, setType] = useState("all");
  const [sortBy, setSortBy] = useState("date");
  const [sortDir, setSortDir] = useState("desc");
  const [page, setPage] = useState(1);
  const pageSize = 30;
  const { data, isLoading } = useUnmatchedPage({
    page,
    pageSize,
    search: q || undefined,
    type,
    sortBy,
    sortDir,
  });
  const [bulkConfirm, setBulkConfirm] = useState<BulkConfirmState | null>(null);
  const [bulkWorking, setBulkWorking] = useState(false);
  const [bulkProgress, setBulkProgress] = useState<{ current: number; total: number } | null>(null);
  const [smartStarting, setSmartStarting] = useState(false);
  const [clearBusy, setClearBusy] = useState(false);

  const refetchLists = () => {
    void qc.invalidateQueries({ queryKey: ["unmatched"] });
    void qc.invalidateQueries({ queryKey: ["stats"] });
    void qc.invalidateQueries({ queryKey: ["home-movies"] });
    void qc.invalidateQueries({ queryKey: ["home-series"] });
  };

  const handleBulkConfirm = async () => {
    if (!bulkConfirm || bulkWorking) return;
    const { ids, tmdbId, mediaType } = bulkConfirm;
    if (ids.length === 0) {
      setBulkConfirm(null);
      return;
    }

    setBulkWorking(true);
    setBulkProgress({ current: 0, total: ids.length });
    try {
      for (let i = 0; i < ids.length; i++) {
        const r = await fetch(`${API_ORIGIN}/api/unmatched/${ids[i]}/match`, {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ tmdbId, mediaType }),
        });
        if (!r.ok) {
          console.error("Bulk match step failed:", ids[i], await r.text());
        } else {
          const res = (await r.json()) as Record<string, unknown>;
          if (res.success !== true) console.error("Match unsuccessful:", ids[i], res);
        }
        setBulkProgress({ current: i + 1, total: ids.length });
      }
    } catch (err) {
      console.error("Bulk match failed:", err);
    } finally {
      setBulkWorking(false);
    }
    await new Promise((r) => setTimeout(r, 400));
    setBulkProgress(null);
    setBulkConfirm(null);
    refetchLists();
  };

  const runSmartScan = async () => {
    if (smartStarting) return;
    setSmartStarting(true);
    try {
      await startSmartScan();
      void qc.invalidateQueries({ queryKey: ["smartMatchProgress"] });
    } catch (e) {
      console.error(e);
    } finally {
      setSmartStarting(false);
    }
  };

  const runClearAllUnmatched = async () => {
    if (globalUnmatched === 0 || clearBusy) return;
    const filterNote = q.trim()
      ? "\n\nClears the entire unmatched list in the database, not only the current search results."
      : "";
    const ok = window.confirm(
      "Remove every unmatched entry from the library database?" +
        filterNote +
        "\n\nYour video files stay on disk. Run a library scan later if you want them to show up as unmatched again.",
    );
    if (!ok) return;
    setClearBusy(true);
    try {
      await clearAllUnmatched();
      refetchLists();
    } catch (e) {
      console.error(e);
    } finally {
      setClearBusy(false);
    }
  };

  return (
    <div>
      <div className="flex flex-wrap items-center justify-between gap-4">
        <h1 className="text-3xl font-bold text-white">Unmatched Files</h1>
        <div className="flex flex-wrap items-center gap-3">
          <button
            type="button"
            disabled={smartStarting}
            onClick={() => void runSmartScan()}
            className="rounded-lg bg-pitflix-primary px-4 py-2 text-sm font-medium text-white hover:bg-pitflix-light disabled:opacity-50"
          >
            {smartStarting ? "…" : "🤖 Smart Auto-Match"}
          </button>
          <button
            type="button"
            disabled={clearBusy || globalUnmatched === 0}
            onClick={() => void runClearAllUnmatched()}
            title="Delete all unmatched scan logs (files on disk are not removed)"
            className="inline-flex items-center gap-2 rounded-lg border border-red-900/60 bg-red-950/40 px-3 py-2 text-sm font-medium text-red-200 hover:bg-red-950/70 disabled:opacity-50"
          >
            <Trash2 className="h-4 w-4 opacity-90" strokeWidth={2} />
            {clearBusy ? "…" : "Remove all"}
          </button>
          <Badge>{data?.total ?? 0} total</Badge>
        </div>
      </div>
      <div className="mt-4 flex flex-wrap gap-3">
        <input
          value={search}
          onChange={(e) => {
            setSearch(e.target.value);
            setPage(1);
          }}
          placeholder="Search title, folder, or file name…"
          className="min-w-[200px] flex-1 rounded-lg border border-pitflix-card bg-pitflix-surface px-3 py-2 text-sm text-white"
        />
        <select
          value={type}
          onChange={(e) => {
            setType(e.target.value);
            setPage(1);
          }}
          className="rounded-lg border border-pitflix-card bg-pitflix-surface px-3 py-2 text-sm text-white"
        >
          <option value="all">All</option>
          <option value="movie">Movies</option>
          <option value="series">Series</option>
        </select>
        <select
          value={sortBy}
          onChange={(e) => {
            setSortBy(e.target.value);
            setPage(1);
          }}
          className="rounded-lg border border-pitflix-card bg-pitflix-surface px-3 py-2 text-sm text-white"
        >
          <option value="date">Date</option>
          <option value="name">Name</option>
          <option value="path">Path</option>
          <option value="media">Media type</option>
        </select>
        <select
          value={sortDir}
          onChange={(e) => {
            setSortDir(e.target.value);
            setPage(1);
          }}
          className="rounded-lg border border-pitflix-card bg-pitflix-surface px-3 py-2 text-sm text-white"
        >
          <option value="desc">Desc</option>
          <option value="asc">Asc</option>
        </select>
      </div>

      {bulkConfirm ? (
        <div
          className="sticky top-0 z-40 mb-4 mt-4 rounded-xl border border-pitflix-primary/40 bg-pitflix-primary/10 p-4"
          role="status"
          aria-busy={bulkWorking}
        >
          <div className="flex flex-col gap-3 sm:flex-row sm:items-center sm:justify-between">
            <div className="min-w-0">
              <p className="text-sm font-semibold text-white">
                📁 {bulkConfirm.count} more episodes found in the same show folder (all seasons)
              </p>
              <p className="mt-0.5 text-xs text-pitflix-muted">
                {bulkWorking
                  ? `Matching to "${bulkConfirm.title}"…`
                  : `Match all of them to "${bulkConfirm.title}"?`}
              </p>
            </div>
            <div className="flex shrink-0 gap-2">
              <button
                type="button"
                disabled={bulkWorking}
                onClick={() => void handleBulkConfirm()}
                className="rounded-lg bg-pitflix-primary px-4 py-2 text-sm font-medium text-white transition-colors hover:bg-pitflix-light disabled:opacity-50"
              >
                {bulkWorking ? "Matching…" : `✓ Match All ${bulkConfirm.count}`}
              </button>
              <button
                type="button"
                disabled={bulkWorking}
                onClick={() => setBulkConfirm(null)}
                className="rounded-lg border border-pitflix-card px-3 py-2 text-sm text-pitflix-muted transition-colors hover:text-white disabled:opacity-50"
              >
                Skip
              </button>
            </div>
          </div>
          {bulkWorking && bulkProgress ? (
            <DeterminateMatchBar
              className="mt-4"
              current={bulkProgress.current}
              total={bulkProgress.total}
              label="Episodes matched"
            />
          ) : null}
        </div>
      ) : null}

      {isLoading ? (
        <div className="flex justify-center py-20">
          <Spinner />
        </div>
      ) : (
        <>
          <div className="mt-6">
            {(data?.items ?? []).map((row: UnmatchedRowItem) => (
              <UnmatchedRow
                key={row.id}
                item={row}
                onDone={refetchLists}
                onSiblingsPrompt={setBulkConfirm}
              />
            ))}
          </div>
          <div className="mt-8">
            <Pagination
              currentPage={page}
              totalPages={data?.totalPages ?? 1}
              totalItems={data?.total ?? 0}
              pageSize={pageSize}
              onPageChange={setPage}
            />
          </div>
        </>
      )}
    </div>
  );
}
