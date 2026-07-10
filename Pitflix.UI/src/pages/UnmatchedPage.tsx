import { useQuery, useQueryClient } from "@tanstack/react-query";
import { Bot, ChevronDown, ChevronUp, Film, Lightbulb, Search, SkipForward, Trash2, Tv } from "lucide-react";
import { useEffect, useMemo, useState } from "react";
import { API_ORIGIN } from "../api/client";
import { clearAllUnmatched, searchUnmatched, skipUnmatched } from "../api/unmatched";
import { useDebounce } from "../hooks/useDebounce";
import { useUnmatchedPage } from "../hooks/useUnmatched";
import { Badge } from "../components/ui/Badge";
import { DeterminateMatchBar, IndeterminateMatchBar } from "../components/ui/MatchProgressBar";
import { Pagination } from "../components/ui/Pagination";
import { Spinner } from "../components/ui/Spinner";
import { cn } from "../utils/cn";
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
  const [expanded, setExpanded] = useState(true);
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

  const isMovie = rowGuessType.toLowerCase() !== "series";
  const TypeIcon = isMovie ? Film : Tv;

  /* collapsed view: just the title row + auto-suggestions (no search panel) */
  return (
    <div className={cn(
      // border gives 1px on all sides; border-l-4 overrides just left to 4px accent stripe
      "overflow-hidden rounded-xl border border-l-4 transition-colors",
      // Left accent color varies by media type so each card is instantly recognisable
      matching
        ? "border-pitflix-primary/40 border-l-pitflix-primary bg-pitflix-primary/5"
        : isMovie
          ? "border-pitflix-card border-l-blue-500/70 bg-pitflix-card"
          : "border-pitflix-card border-l-violet-500/70 bg-pitflix-card",
    )}>
      {/* ── Header row ── */}
      <div className="flex items-center gap-3 px-4 py-3.5">
        {/* media-type icon pill */}
        <div className={cn(
          "flex h-8 w-8 shrink-0 items-center justify-center rounded-lg",
          isMovie ? "bg-blue-500/15 text-blue-300" : "bg-violet-500/15 text-violet-300",
        )}>
          <TypeIcon className="h-4 w-4" strokeWidth={1.75} />
        </div>

        {/* title + path */}
        <div className="min-w-0 flex-1">
          <p className="truncate text-sm font-semibold text-white">{item.cleanName}</p>
          <p className="mt-0.5 truncate text-[11px] text-pitflix-subtle">{item.filePath}</p>
        </div>

        {/* actions: skip + expand */}
        <div className="flex shrink-0 items-center gap-1">
          <button
            type="button"
            title="Skip this file"
            disabled={matching}
            onClick={() => void skipUnmatched(item.id).then(onDone)}
            className="flex h-7 w-7 items-center justify-center rounded-lg text-pitflix-subtle hover:bg-pitflix-surface hover:text-pitflix-muted disabled:opacity-30"
          >
            <SkipForward className="h-3.5 w-3.5" strokeWidth={2} />
          </button>
          <button
            type="button"
            onClick={() => setExpanded((v) => !v)}
            className="flex h-7 w-7 items-center justify-center rounded-lg text-pitflix-subtle hover:bg-pitflix-surface hover:text-white"
          >
            {expanded
              ? <ChevronUp className="h-4 w-4" />
              : <ChevronDown className="h-4 w-4" />}
          </button>
        </div>
      </div>

      {/* ── Auto-suggestions (always visible if present) ── */}
      {suggestions.length > 0 && !matching ? (
        <div className="flex flex-wrap gap-2 border-t border-white/5 px-4 pb-3 pt-2.5">
          <span className="self-center text-[10px] text-pitflix-subtle">Quick match:</span>
          {suggestions.map((s) => (
            <button
              key={s.id}
              type="button"
              disabled={matching}
              onClick={() => void handleMatch(s.id, s.title, s)}
              className="inline-flex items-center gap-1 rounded-lg border border-pitflix-primary/40 bg-pitflix-primary/10 px-2.5 py-1 text-xs font-medium text-white transition-colors hover:border-pitflix-primary/70 hover:bg-pitflix-primary/25 disabled:opacity-50"
            >
              <span className="text-pitflix-primary text-[10px]">✓</span>
              {s.title}
              {s.year ? <span className="text-pitflix-muted">({s.year})</span> : null}
            </button>
          ))}
        </div>
      ) : null}

      {matching ? (
        <div className="border-t border-white/5 px-4 pb-3 pt-2">
          <IndeterminateMatchBar label="Contacting TMDB and updating library…" />
        </div>
      ) : null}

      {/* ── Expanded panel ── */}
      {expanded ? (
        <div className="border-t border-white/10 bg-pitflix-bg/60 px-4 pb-4 pt-3 space-y-4">
          {/* Search-as type selector */}
          <div className="flex flex-wrap items-center gap-2">
            <span className="text-[10px] font-medium uppercase tracking-wide text-pitflix-muted">Search as</span>
            <div className="flex gap-1">
              {(["auto", "Movie", "Series", "Both"] as const).map((k) => (
                <button
                  key={k}
                  type="button"
                  disabled={matching}
                  onClick={() => setSearchKind(k)}
                  className={cn(
                    "rounded-md px-2.5 py-1 text-[11px] font-medium transition-colors disabled:opacity-50",
                    searchKind === k
                      ? "bg-pitflix-primary text-white"
                      : "border border-pitflix-card bg-pitflix-card/80 text-pitflix-muted hover:text-white",
                  )}
                >
                  {k === "auto" ? "Auto" : k === "Both" ? "Movies + TV" : k}
                </button>
              ))}
            </div>
          </div>

          {/* Folder hints */}
          {folderHints.length > 0 ? (
            <div className="rounded-xl border border-amber-500/15 bg-amber-950/10">
              <div className="flex items-center gap-2.5 border-b border-white/5 px-3 py-2.5">
                <Lightbulb className="h-3.5 w-3.5 shrink-0 text-amber-300/80" strokeWidth={2} />
                <p className="text-xs font-semibold text-white">Path hints</p>
                <p className="text-[10px] text-pitflix-subtle">— one tap searches TMDB</p>
              </div>
              <div className="grid gap-1.5 p-3 sm:grid-cols-2">
                {folderHints.map((h) => (
                  <button
                    key={h}
                    type="button"
                    disabled={matching || loading}
                    onClick={() => {
                      setSearching(true);
                      void runSearchWithQuery(h);
                    }}
                    className="flex min-h-[2.25rem] items-center rounded-lg border border-pitflix-card/80 bg-pitflix-card/40 px-3 py-2 text-left text-xs font-medium text-white transition-all hover:border-pitflix-primary/50 hover:bg-pitflix-primary/15 disabled:opacity-50"
                  >
                    <span className="line-clamp-2">{h}</span>
                  </button>
                ))}
              </div>
            </div>
          ) : null}

          {/* Manual search */}
          <div>
            <button
              type="button"
              disabled={matching}
              className={cn(
                "inline-flex items-center gap-1.5 rounded-lg border px-3 py-1.5 text-xs font-medium transition-colors disabled:opacity-50",
                searching
                  ? "border-pitflix-primary/50 bg-pitflix-primary/15 text-white"
                  : "border-pitflix-card/80 bg-pitflix-card/40 text-pitflix-muted hover:text-white",
              )}
              onClick={() => setSearching(!searching)}
            >
              <Search className="h-3.5 w-3.5" strokeWidth={2} />
              {searching ? "Hide search" : "Search TMDB manually"}
            </button>

            {searching ? (
              <div className="mt-2 flex gap-2">
                <input
                  autoFocus
                  value={query}
                  onChange={(e) => setQuery(e.target.value)}
                  placeholder="Search title…"
                  className="min-w-[160px] flex-1 rounded-lg border border-pitflix-card/80 bg-pitflix-bg px-3 py-2 text-sm text-white placeholder-pitflix-subtle focus:border-pitflix-primary/60 focus:outline-none"
                  onKeyDown={(e) => e.key === "Enter" && void handleSearch()}
                />
                <button
                  type="button"
                  disabled={loading || !query.trim()}
                  onClick={() => void handleSearch()}
                  className="rounded-lg bg-pitflix-primary px-3 py-2 text-xs font-medium text-white hover:bg-pitflix-light disabled:opacity-50"
                >
                  {loading ? "…" : "Search"}
                </button>
              </div>
            ) : null}
          </div>

          {/* Search results */}
          {results.length > 0 ? (
            <div className="overflow-hidden rounded-xl border border-pitflix-card/60">
              {results.map((s) => (
                <button
                  key={s.id}
                  type="button"
                  disabled={matching}
                  onClick={() => void handleMatch(s.id, s.title, s)}
                  className="flex w-full items-center gap-3 border-b border-pitflix-card/40 p-2.5 text-left transition-colors last:border-b-0 hover:bg-pitflix-primary/15 disabled:opacity-50"
                >
                  {s.posterUrl ? (
                    <img
                      src={s.posterUrl}
                      alt={s.title}
                      className="h-14 w-10 shrink-0 rounded-md object-cover shadow-md"
                      onError={(e) => { e.currentTarget.style.display = "none"; }}
                    />
                  ) : (
                    <div className="flex h-14 w-10 shrink-0 items-center justify-center rounded-md bg-pitflix-card/80">
                      <span className="text-xs text-pitflix-subtle">?</span>
                    </div>
                  )}
                  <div className="min-w-0 flex-1">
                    <p className="truncate text-sm font-semibold text-white">{s.title}</p>
                    <p className="mt-0.5 text-[11px] text-pitflix-muted">
                      {s.year ?? "—"} · {s.mediaType ?? rowGuessType}
                    </p>
                    {s.overview ? (
                      <p className="mt-0.5 line-clamp-2 text-[11px] text-pitflix-subtle">{s.overview}</p>
                    ) : null}
                  </div>
                  <span className="shrink-0 rounded-md bg-pitflix-primary/20 px-2 py-1 text-[10px] font-semibold text-pitflix-primary">
                    Match
                  </span>
                </button>
              ))}
            </div>
          ) : null}
        </div>
      ) : null}
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
  const [actionError, setActionError] = useState<string | null>(null);

  useEffect(() => {
    if (!actionError) return;
    const t = setTimeout(() => setActionError(null), 8000);
    return () => clearTimeout(t);
  }, [actionError]);

  const reportActionError = (message: string, e?: unknown) => {
    if (e !== undefined) console.error(e);
    setActionError(message);
  };

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
    let failed = 0;
    try {
      for (let i = 0; i < ids.length; i++) {
        const r = await fetch(`${API_ORIGIN}/api/unmatched/${ids[i]}/match`, {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ tmdbId, mediaType }),
        });
        if (!r.ok) {
          console.error("Bulk match step failed:", ids[i], await r.text());
          failed++;
        } else {
          const res = (await r.json()) as Record<string, unknown>;
          if (res.success !== true) {
            console.error("Match unsuccessful:", ids[i], res);
            failed++;
          }
        }
        setBulkProgress({ current: i + 1, total: ids.length });
      }
      if (failed > 0) {
        reportActionError(`Could not match ${failed} of ${ids.length} file(s).`);
      }
    } catch (err) {
      reportActionError("Bulk match failed. Please try again.", err);
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
      reportActionError("Could not start smart auto-match. Check TMDB key and try again.", e);
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
      reportActionError("Could not clear unmatched entries. Please try again.", e);
    } finally {
      setClearBusy(false);
    }
  };

  return (
    <div>
      {actionError ? (
        <div
          role="alert"
          className="mb-4 flex items-start justify-between gap-3 rounded-lg border border-red-900/60 bg-red-950/40 px-4 py-3 text-sm text-red-200"
        >
          <span>{actionError}</span>
          <button
            type="button"
            className="shrink-0 text-red-300/80 hover:text-red-100"
            onClick={() => setActionError(null)}
            aria-label="Dismiss"
          >
            ×
          </button>
        </div>
      ) : null}
      {/* ── Page header ── */}
      <div className="mb-6 flex flex-wrap items-start justify-between gap-4">
        <div>
          <h1 className="text-3xl font-bold text-white">Unmatched Files</h1>
          <p className="mt-1 text-sm text-pitflix-muted">
            {globalUnmatched > 0
              ? `${globalUnmatched} file${globalUnmatched === 1 ? "" : "s"} couldn't be matched to a title automatically.`
              : "All files are matched — nothing to do here."}
          </p>
        </div>
        <div className="flex flex-wrap items-center gap-2">
          <button
            type="button"
            disabled={smartStarting}
            onClick={() => void runSmartScan()}
            className="inline-flex items-center gap-2 rounded-xl bg-pitflix-primary px-4 py-2.5 text-sm font-semibold text-white hover:bg-pitflix-light disabled:opacity-50"
          >
            <Bot className="h-4 w-4" strokeWidth={2} />
            {smartStarting ? "Starting…" : "Smart Auto-Match"}
          </button>
          <button
            type="button"
            disabled={clearBusy || globalUnmatched === 0}
            onClick={() => void runClearAllUnmatched()}
            title="Delete all unmatched scan logs (files on disk are not removed)"
            className="inline-flex items-center gap-2 rounded-xl border border-red-900/60 bg-red-950/30 px-3 py-2.5 text-sm font-medium text-red-200 hover:bg-red-950/60 disabled:opacity-50"
          >
            <Trash2 className="h-4 w-4 opacity-90" strokeWidth={2} />
            {clearBusy ? "…" : "Clear all"}
          </button>
        </div>
      </div>

      {/* ── Filters ── */}
      <div className="mb-6 flex flex-wrap gap-2">
        <div className="relative flex-1 min-w-[200px]">
          <Search className="pointer-events-none absolute left-3 top-1/2 h-4 w-4 -translate-y-1/2 text-pitflix-subtle" />
          <input
            value={search}
            onChange={(e) => { setSearch(e.target.value); setPage(1); }}
            placeholder="Search title, folder, or file name…"
            className="w-full rounded-xl border border-pitflix-card bg-pitflix-card/60 py-2.5 pl-9 pr-3 text-sm text-white placeholder-pitflix-subtle focus:border-pitflix-primary/60 focus:outline-none"
          />
        </div>
        <select
          value={type}
          onChange={(e) => { setType(e.target.value); setPage(1); }}
          className="cursor-pointer rounded-xl border border-pitflix-card bg-pitflix-card/60 px-3 py-2.5 text-sm text-white focus:border-pitflix-primary/60 focus:outline-none"
        >
          <option value="all">All types</option>
          <option value="movie">Movies</option>
          <option value="series">Series</option>
        </select>
        <select
          value={sortBy}
          onChange={(e) => { setSortBy(e.target.value); setPage(1); }}
          className="cursor-pointer rounded-xl border border-pitflix-card bg-pitflix-card/60 px-3 py-2.5 text-sm text-white focus:border-pitflix-primary/60 focus:outline-none"
        >
          <option value="date">Sort: Date</option>
          <option value="name">Sort: Name</option>
          <option value="path">Sort: Path</option>
          <option value="media">Sort: Type</option>
        </select>
        <select
          value={sortDir}
          onChange={(e) => { setSortDir(e.target.value); setPage(1); }}
          className="cursor-pointer rounded-xl border border-pitflix-card bg-pitflix-card/60 px-3 py-2.5 text-sm text-white focus:border-pitflix-primary/60 focus:outline-none"
        >
          <option value="desc">↓ Newest</option>
          <option value="asc">↑ Oldest</option>
        </select>
        {data?.total != null ? (
          <div className="flex items-center self-center">
            <Badge>{data.total} result{data.total === 1 ? "" : "s"}</Badge>
          </div>
        ) : null}
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
      ) : (data?.total ?? 0) === 0 && !search && type === "all" ? (
        <div className="flex flex-col items-center gap-3 py-24 text-center">
          <p className="text-4xl">✅</p>
          <p className="text-lg font-semibold text-white">No unmatched files</p>
          <p className="max-w-sm text-sm text-pitflix-subtle">
            All scanned files have been matched to a title in your library.
          </p>
        </div>
      ) : (
        <>
          <div className="flex flex-col gap-4">
            {(data?.items ?? []).map((row: UnmatchedRowItem) => (
              <UnmatchedRow
                key={row.id}
                item={row}
                onDone={refetchLists}
                onSiblingsPrompt={setBulkConfirm}
              />
            ))}
            {(data?.items ?? []).length === 0 && search ? (
              <p className="py-12 text-center text-sm text-pitflix-muted">No results for "{search}".</p>
            ) : null}
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
