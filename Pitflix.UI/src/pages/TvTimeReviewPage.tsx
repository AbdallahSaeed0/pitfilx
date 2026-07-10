import { useState } from "react";
import { useQuery, useQueryClient } from "@tanstack/react-query";
import { Clapperboard, SkipForward, Tv } from "lucide-react";
import { getTvTimeUnmatched, matchTvTimeShow, type TvTimeReviewItem } from "../api/tvtimeReview";
import { searchUnmatched } from "../api/unmatched";
import { Spinner } from "../components/ui/Spinner";
import { cn } from "../utils/cn";

type SearchResult = {
  id: number;
  title: string;
  year?: string;
  overview?: string;
  posterUrl?: string | null;
};

/**
 * TEMPORARY page: manually resolve the TV Time shows/movies tools/tvtime_import couldn't
 * confidently auto-match to a TMDB title (or flagged as low-confidence). Writes picks straight
 * into the relevant import script's on-disk cache (tmdb_show_map.json / tmdb_movie_map.json) via
 * /api/tvtime-review/match -- re-run the importer afterward to pick them up. Safe to delete this
 * page + its route once the TV Time import review is done.
 */
export function TvTimeReviewPage() {
  const [mediaType, setMediaType] = useState<"show" | "movie">("show");
  const queryClient = useQueryClient();
  const { data: items, isLoading } = useQuery({
    queryKey: ["tvtime-review-unmatched", mediaType],
    queryFn: () => getTvTimeUnmatched(mediaType),
  });

  return (
    <div className="mx-auto max-w-3xl px-4 py-8">
      <h1 className="text-xl font-semibold text-white">TV Time — unresolved titles</h1>
      <p className="mt-1 text-sm text-pitflix-subtle">
        Temporary tool. Search and confirm the right TMDB title for each one below, or skip it
        permanently. Picks are saved to the import cache for the next Trakt/PitFlix run.
      </p>

      <div className="mt-4 flex gap-1.5">
        {(["show", "movie"] as const).map((mt) => (
          <button
            key={mt}
            type="button"
            onClick={() => setMediaType(mt)}
            className={cn(
              "rounded-lg border px-3 py-1.5 text-xs font-semibold transition-colors",
              mediaType === mt
                ? "border-pitflix-primary/50 bg-pitflix-primary/15 text-pitflix-primary"
                : "border-transparent text-pitflix-muted hover:bg-white/[0.06]",
            )}
          >
            {mt === "show" ? "Shows" : "Movies"}
          </button>
        ))}
      </div>

      {isLoading ? (
        <div className="flex justify-center py-16">
          <Spinner />
        </div>
      ) : !items || items.length === 0 ? (
        <p className="mt-8 text-sm text-pitflix-muted">Nothing left to review.</p>
      ) : (
        <div className="mt-6 space-y-3">
          <p className="text-xs text-pitflix-muted">{items.length} remaining</p>
          {items.map((item) => (
            <ReviewRow
              key={item.name}
              item={item}
              mediaType={mediaType}
              onDone={() =>
                queryClient.invalidateQueries({ queryKey: ["tvtime-review-unmatched", mediaType] })
              }
            />
          ))}
        </div>
      )}
    </div>
  );
}

function ReviewRow({
  item,
  mediaType,
  onDone,
}: {
  item: TvTimeReviewItem;
  mediaType: "show" | "movie";
  onDone: () => void;
}) {
  const yearHint = item.name.match(/\((\d{4})\)\s*$/)?.[1] ?? "";
  const [query, setQuery] = useState(item.name.replace(/\s*\(\d{4}\)\s*$/, "").trim());
  const [year, setYear] = useState(yearHint);
  const [results, setResults] = useState<SearchResult[]>([]);
  const [loading, setLoading] = useState(false);
  const [busy, setBusy] = useState(false);

  const subtitle =
    mediaType === "show"
      ? (item.seasons ?? []).map((s) => `S${s.season}:${s.episodeCount}ep`).join(", ")
      : `watched ${item.watchCount ?? 1}×`;

  const runSearch = async () => {
    if (!query.trim()) return;
    setLoading(true);
    try {
      const parsedYear = year.trim() ? Number(year.trim()) : undefined;
      const data = (await searchUnmatched({
        query: query.trim(),
        mediaType: mediaType === "show" ? "Series" : "Movie",
        year: parsedYear && !Number.isNaN(parsedYear) ? parsedYear : undefined,
      })) as SearchResult[];
      setResults(Array.isArray(data) ? data : []);
    } finally {
      setLoading(false);
    }
  };

  const confirmMatch = async (result: SearchResult) => {
    setBusy(true);
    try {
      await matchTvTimeShow({ name: item.name, tmdbId: result.id, title: result.title, year: result.year, mediaType });
      onDone();
    } finally {
      setBusy(false);
    }
  };

  const skipPermanently = async () => {
    setBusy(true);
    try {
      await matchTvTimeShow({ name: item.name, tmdbId: null, mediaType });
      onDone();
    } finally {
      setBusy(false);
    }
  };

  const Icon = mediaType === "show" ? Tv : Clapperboard;

  return (
    <div className="overflow-hidden rounded-xl border border-pitflix-card bg-pitflix-card">
      <div className="flex items-center gap-3 px-4 py-3.5">
        <div className="flex h-8 w-8 shrink-0 items-center justify-center rounded-lg bg-violet-500/15 text-violet-300">
          <Icon className="h-4 w-4" strokeWidth={1.75} />
        </div>
        <div className="min-w-0 flex-1">
          <p className="truncate text-sm font-semibold text-white">{item.name}</p>
          <p className="mt-0.5 truncate text-[11px] text-pitflix-subtle">
            {subtitle}
            {item.status === "low" ? (
              <span className="ml-2 rounded bg-amber-500/15 px-1.5 py-0.5 text-[10px] font-semibold text-amber-300">
                low confidence — please confirm
              </span>
            ) : null}
          </p>
        </div>
        <button
          type="button"
          title="Skip permanently"
          disabled={busy}
          onClick={() => void skipPermanently()}
          className="flex h-7 w-7 shrink-0 items-center justify-center rounded-lg text-pitflix-subtle hover:bg-pitflix-surface hover:text-pitflix-muted disabled:opacity-30"
        >
          <SkipForward className="h-3.5 w-3.5" strokeWidth={2} />
        </button>
      </div>

      <div className="border-t border-white/5 px-4 pb-3 pt-2.5">
        <div className="flex gap-2">
          <input
            value={query}
            dir="auto"
            onChange={(e) => setQuery(e.target.value)}
            placeholder="Search title… (Arabic works too)"
            className="min-w-[160px] flex-1 rounded-lg border border-pitflix-card/80 bg-pitflix-bg px-3 py-2 text-sm text-white placeholder-pitflix-subtle focus:border-pitflix-primary/60 focus:outline-none"
            onKeyDown={(e) => e.key === "Enter" && void runSearch()}
          />
          <input
            value={year}
            onChange={(e) => setYear(e.target.value.replace(/\D/g, "").slice(0, 4))}
            placeholder="Year"
            inputMode="numeric"
            className="w-16 shrink-0 rounded-lg border border-pitflix-card/80 bg-pitflix-bg px-2 py-2 text-center text-sm text-white placeholder-pitflix-subtle focus:border-pitflix-primary/60 focus:outline-none"
            onKeyDown={(e) => e.key === "Enter" && void runSearch()}
          />
          <button
            type="button"
            disabled={loading || busy || !query.trim()}
            onClick={() => void runSearch()}
            className="rounded-lg bg-pitflix-primary px-3 py-2 text-xs font-medium text-white hover:bg-pitflix-light disabled:opacity-50"
          >
            {loading ? "…" : "Search"}
          </button>
        </div>

        {results.length > 0 ? (
          <div className="mt-2.5 overflow-hidden rounded-xl border border-pitflix-card/60">
            {results.map((r) => (
              <button
                key={r.id}
                type="button"
                disabled={busy}
                onClick={() => void confirmMatch(r)}
                className={cn(
                  "flex w-full items-center gap-3 border-b border-pitflix-card/40 p-2.5 text-left transition-colors last:border-b-0 hover:bg-pitflix-primary/15 disabled:opacity-50",
                )}
              >
                {r.posterUrl ? (
                  <img
                    src={r.posterUrl}
                    alt={r.title}
                    className="h-14 w-10 shrink-0 rounded-md object-cover shadow-md"
                    onError={(e) => { e.currentTarget.style.display = "none"; }}
                  />
                ) : (
                  <div className="flex h-14 w-10 shrink-0 items-center justify-center rounded-md bg-pitflix-card/80">
                    <span className="text-xs text-pitflix-subtle">?</span>
                  </div>
                )}
                <div className="min-w-0 flex-1">
                  <p className="truncate text-sm font-semibold text-white">{r.title}</p>
                  <p className="mt-0.5 text-[11px] text-pitflix-muted">{r.year ?? "—"}</p>
                  {r.overview ? (
                    <p className="mt-0.5 line-clamp-2 text-[11px] text-pitflix-subtle">{r.overview}</p>
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
    </div>
  );
}
