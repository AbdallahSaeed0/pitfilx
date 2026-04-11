import { useMutation, useQuery } from "@tanstack/react-query";
import { ExternalLink, Search, Sparkles } from "lucide-react";
import { useMemo, useState } from "react";
import { fetchRecommendations, type RecommendationFilter, type RecommendationItem } from "../api/recommendations";
import { searchUnmatched } from "../api/unmatched";
import { MediaImage } from "../components/ui/MediaImage";
import { Spinner } from "../components/ui/Spinner";
import { useDebounce } from "../hooks/useDebounce";
import { cn } from "../utils/cn";
import { formatCount, formatRating } from "../utils/format";

type SearchHit = {
  id: number;
  title: string;
  year: string | null;
  overview: string | null;
  posterUrl: string | null;
  mediaType: string;
};

export function RecommendationsPage() {
  const [q, setQ] = useState("");
  const debounced = useDebounce(q, 380);
  const [selected, setSelected] = useState<SearchHit | null>(null);
  const [filter, setFilter] = useState<RecommendationFilter>("both");

  const searchQ = useQuery({
    queryKey: ["rec-search", debounced],
    queryFn: () =>
      searchUnmatched({ query: debounced.trim(), mediaType: "Both" }) as Promise<SearchHit[]>,
    enabled: debounced.trim().length >= 2,
    staleTime: 30_000,
  });

  const recMutation = useMutation({
    mutationFn: () =>
      fetchRecommendations({
        tmdbId: selected!.id,
        mediaType: selected!.mediaType === "Series" || selected!.mediaType === "tv" ? "tv" : "movie",
        filter,
      }),
  });

  const recResult = recMutation.data;
  const recItems = recResult?.data.items ?? [];
  const recFailed =
    recResult && (recResult.status >= 400 || (recResult.data.error && recResult.data.error.length > 0));
  const recErrorMessage = recFailed
    ? recResult.data.error || (recResult.status >= 400 ? `Request failed (${recResult.status})` : null)
    : null;
  const recDetail = recResult?.data.detail;
  const recEmptyOk =
    recResult && recResult.status < 400 && !recResult.data.error && recItems.length === 0 && !recMutation.isPending;

  const hits = useMemo(() => searchQ.data ?? [], [searchQ.data]);

  const runRecommend = () => {
    if (!selected) return;
    recMutation.mutate();
  };

  return (
    <div className="mx-auto max-w-5xl space-y-10 pb-10">
      <div>
        <h1 className="flex items-center gap-2 text-2xl font-semibold text-white">
          <Sparkles className="h-7 w-7 text-pitflix-primary" />
          Recommendations
        </h1>
        <p className="mt-2 max-w-2xl text-sm leading-relaxed text-pitflix-subtle">
          Pick a film or series you love. We&apos;ll line up suggestions from TMDB using shared genres, themes, and
          popularity — not raw title matching — so moods line up even when names are nothing alike.
        </p>
      </div>

      <section className="rounded-xl border border-pitflix-card bg-pitflix-surface p-5">
        <label className="flex items-center gap-2 text-sm font-medium text-pitflix-muted">
          <Search className="h-4 w-4" />
          Title you enjoyed
        </label>
        <input
          type="search"
          value={q}
          onChange={(e) => {
            setQ(e.target.value);
            setSelected(null);
            recMutation.reset();
          }}
          placeholder="Search movies and series…"
          className="mt-2 w-full rounded-lg border border-pitflix-card bg-pitflix-bg px-3 py-2 text-sm text-white placeholder:text-pitflix-subtle focus:border-pitflix-primary focus:outline-none"
        />

        {debounced.trim().length >= 2 && searchQ.isFetching ? (
          <p className="mt-3 flex items-center gap-2 text-xs text-pitflix-subtle">
            <Spinner className="h-4 w-4" /> Searching…
          </p>
        ) : null}

        {searchQ.isError ? (
          <p className="mt-3 text-sm text-rose-200/90">Could not search. Is the API running?</p>
        ) : null}

        {debounced.trim().length >= 2 && !searchQ.isFetching && hits.length > 0 ? (
          <ul className="mt-4 max-h-64 space-y-1 overflow-y-auto rounded-lg border border-pitflix-card bg-pitflix-bg p-2">
            {hits.map((h) => (
              <li key={`${h.mediaType}-${h.id}`}>
                <button
                  type="button"
                  onClick={() => {
                    setSelected(h);
                    recMutation.reset();
                  }}
                  className={cn(
                    "flex w-full items-center gap-3 rounded-lg px-2 py-2 text-left text-sm transition-colors",
                    selected?.id === h.id && selected.mediaType === h.mediaType
                      ? "bg-pitflix-primary/25 text-white"
                      : "hover:bg-pitflix-card/70 text-pitflix-muted",
                  )}
                >
                  <MediaImage
                    src={h.posterUrl ?? undefined}
                    alt=""
                    className="h-14 w-10 shrink-0 overflow-hidden rounded bg-pitflix-card object-cover"
                    fallbackText={h.title.slice(0, 2)}
                  />
                  <span className="min-w-0 flex-1">
                    <span className="block truncate font-medium text-white">{h.title}</span>
                    <span className="text-xs text-pitflix-subtle">
                      {h.year ?? "—"} · {h.mediaType}
                    </span>
                  </span>
                </button>
              </li>
            ))}
          </ul>
        ) : null}

        <div className="mt-4 flex flex-wrap items-center gap-3">
          <span className="text-xs font-medium text-pitflix-muted">Include:</span>
          {(
            [
              { v: "both" as const, label: "Movies & series" },
              { v: "movie" as const, label: "Movies only" },
              { v: "tv" as const, label: "Series only" },
            ] as const
          ).map((x) => (
            <button
              key={x.v}
              type="button"
              onClick={() => {
                setFilter(x.v);
                recMutation.reset();
              }}
              className={cn(
                "rounded-full px-3 py-1 text-xs font-semibold transition-colors",
                filter === x.v
                  ? "bg-pitflix-primary text-white"
                  : "bg-pitflix-card text-pitflix-muted hover:text-white",
              )}
            >
              {x.label}
            </button>
          ))}
          <button
            type="button"
            disabled={!selected || recMutation.isPending}
            onClick={runRecommend}
            className="ml-auto rounded-lg bg-pitflix-primary px-4 py-2 text-sm font-semibold text-white hover:bg-pitflix-light disabled:opacity-50"
          >
            {recMutation.isPending ? "Building…" : "Get recommendations"}
          </button>
        </div>

        {recMutation.isError ? (
          <p className="mt-3 text-sm text-rose-200/90">Could not reach the server for recommendations.</p>
        ) : null}
        {recFailed && !recMutation.isError ? (
          <div className="mt-3 rounded-lg border border-rose-500/30 bg-rose-950/25 p-3 text-sm text-rose-100/90">
            <p className="font-medium">{recErrorMessage}</p>
            {recDetail ? <p className="mt-1 text-xs text-rose-200/80">{recDetail}</p> : null}
          </div>
        ) : null}
        {recEmptyOk ? (
          <p className="mt-3 text-sm text-pitflix-subtle">
            TMDB returned no suggestions for this title with the current filters. Try widening to “Movies & series” or another pick.
          </p>
        ) : null}
      </section>

      {recItems.length > 0 && !recFailed ? (
        <section>
          <h2 className="mb-4 text-lg font-semibold text-white">Because you liked {selected?.title}</h2>
          <div className="grid grid-cols-2 gap-4 sm:grid-cols-3 md:grid-cols-4">
            {recItems.map((item: RecommendationItem) => {
              const voteLine =
                item.voteCount > 0
                  ? `${formatCount(item.voteCount)} ${item.voteCount === 1 ? "vote" : "votes"} on TMDB`
                  : null;
              return (
              <a
                key={`${item.mediaType}-${item.tmdbId}`}
                href={`https://www.themoviedb.org/${item.mediaType}/${item.tmdbId}`}
                target="_blank"
                rel="noreferrer"
                className="group overflow-hidden rounded-xl border border-pitflix-card/60 bg-pitflix-surface/60 transition-all hover:border-pitflix-primary/50"
              >
                <div className="relative">
                  <MediaImage
                    src={item.posterUrl ?? undefined}
                    alt=""
                    className="aspect-[2/3] w-full object-cover"
                    fallbackText={item.title.slice(0, 2)}
                  />
                  <span
                    className="pointer-events-none absolute left-2 top-2 z-10 rounded-md bg-black/85 px-2 py-0.5 text-xs font-bold text-amber-300 shadow-md ring-1 ring-amber-500/45"
                    title={voteLine ?? "TMDB user score"}
                  >
                    ★ {formatRating(item.voteAverage)}
                  </span>
                </div>
                <div className="space-y-1 p-3">
                  <p className="line-clamp-2 text-sm font-semibold text-white group-hover:text-pitflix-primary">
                    {item.title}{" "}
                    <ExternalLink className="mb-0.5 inline h-3 w-3 opacity-60 group-hover:opacity-100" />
                  </p>
                  <p className="text-xs font-medium text-pitflix-muted">
                    <span className="text-amber-200/95">★ {formatRating(item.voteAverage)}</span>
                    <span className="text-pitflix-subtle"> · </span>
                    <span>
                      {item.year ?? "—"} · {item.mediaType === "tv" ? "Series" : "Movie"}
                    </span>
                  </p>
                  {voteLine ? (
                    <p className="text-[10px] leading-tight text-pitflix-muted">{voteLine}</p>
                  ) : null}
                  {item.overview ? (
                    <p className="line-clamp-3 text-[11px] leading-relaxed text-pitflix-muted">{item.overview}</p>
                  ) : null}
                </div>
              </a>
            );
            })}
          </div>
          <p className="mt-4 text-center text-[11px] text-pitflix-subtle">
            From TMDB recommendations and discover (genres, keywords). Links open on themoviedb.org — not limited to your library.
          </p>
        </section>
      ) : null}
    </div>
  );
}
