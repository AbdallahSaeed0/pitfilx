import { useState } from "react";
import { useQuery, useQueryClient } from "@tanstack/react-query";
import { useNavigate } from "react-router-dom";
import {
  getDuplicates,
  removeLibraryMovie,
  bulkDeleteFromDevice,
  type DuplicateMovieGroup,
  type DuplicateEpisodeGroup,
} from "../api/library";
import { Spinner } from "../components/ui/Spinner";
import { cn } from "../utils/cn";

function fmtBytes(n: number | null): string {
  if (n == null) return "?";
  if (n < 1024) return `${n} B`;
  if (n < 1024 * 1024) return `${(n / 1024).toFixed(1)} KB`;
  if (n < 1024 * 1024 * 1024) return `${(n / 1024 / 1024).toFixed(1)} MB`;
  return `${(n / 1024 / 1024 / 1024).toFixed(2)} GB`;
}

function fmtPath(p: string): string {
  // Show only last two path segments for readability
  const parts = p.replace(/\\/g, "/").split("/").filter(Boolean);
  if (parts.length <= 2) return p;
  return `…/${parts.slice(-2).join("/")}`;
}

type CopyAction = "remove" | "delete";

function MovieDuplicateCard({
  group,
  onResolved,
}: {
  group: DuplicateMovieGroup;
  onResolved: () => void;
}) {
  const [busy, setBusy] = useState<number | null>(null);
  const [done, setDone] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const qc = useQueryClient();

  const act = async (copyId: number, _filePath: string, action: CopyAction) => {
    setBusy(copyId);
    setError(null);
    try {
      if (action === "delete") {
        await bulkDeleteFromDevice({ movieIds: [copyId] });
      } else {
        await removeLibraryMovie(copyId);
      }
      void qc.invalidateQueries({ queryKey: ["movies"] });
      void qc.invalidateQueries({ queryKey: ["duplicates"] });
      setDone(true);
      onResolved();
    } catch {
      setError("Action failed. Please try again.");
    } finally {
      setBusy(null);
    }
  };

  if (done) return null;

  return (
    <div className="rounded-xl border border-white/10 bg-pitflix-surface/60 p-4">
      <div className="mb-3 flex items-center gap-3">
        {group.posterUrl ? (
          <img
            src={group.posterUrl}
            alt={group.title}
            className="h-14 w-10 shrink-0 rounded object-cover shadow"
          />
        ) : (
          <div className="h-14 w-10 shrink-0 rounded bg-pitflix-card" />
        )}
        <div>
          <p className="font-semibold text-white">{group.title}</p>
          {group.year ? <p className="text-xs text-pitflix-muted">{group.year}</p> : null}
          <p className="mt-0.5 text-[11px] text-amber-400">{group.copies.length} copies</p>
        </div>
      </div>

      <div className="space-y-2">
        {group.copies.map((copy, i) => (
          <div
            key={copy.id}
            className={cn(
              "flex flex-col gap-2 rounded-lg border p-3 sm:flex-row sm:items-center sm:justify-between",
              copy.fileExists ? "border-white/10 bg-white/[0.03]" : "border-red-500/30 bg-red-950/20",
            )}
          >
            <div className="min-w-0 flex-1">
              <p className="truncate font-mono text-[11px] text-pitflix-muted" title={copy.filePath}>
                {fmtPath(copy.filePath)}
              </p>
              <div className="mt-0.5 flex flex-wrap gap-2 text-[10px] text-pitflix-subtle">
                <span>{fmtBytes(copy.fileSize)}</span>
                {!copy.fileExists && (
                  <span className="text-red-400">File missing</span>
                )}
                <span className="text-pitflix-muted">{copy.watchStatus}</span>
                {i === 0 && (
                  <span className="rounded bg-emerald-900/50 px-1 text-emerald-400">oldest</span>
                )}
              </div>
            </div>
            <div className="flex shrink-0 gap-2">
              <button
                type="button"
                disabled={busy != null}
                className="rounded border border-white/20 px-3 py-1 text-xs text-pitflix-muted transition hover:border-white/40 hover:text-white disabled:opacity-40"
                onClick={() => void act(copy.id, copy.filePath, "remove")}
              >
                {busy === copy.id ? <Spinner className="h-3 w-3" /> : "Remove"}
              </button>
              {copy.fileExists && (
                <button
                  type="button"
                  disabled={busy != null}
                  className="rounded border border-red-500/40 px-3 py-1 text-xs text-red-300 transition hover:border-red-400 hover:text-red-200 disabled:opacity-40"
                  onClick={() => void act(copy.id, copy.filePath, "delete")}
                >
                  {busy === copy.id ? <Spinner className="h-3 w-3" /> : "Delete file"}
                </button>
              )}
            </div>
          </div>
        ))}
      </div>

      {error ? (
        <p className="mt-2 text-xs text-red-400">{error}</p>
      ) : null}
    </div>
  );
}

function EpisodeDuplicateCard({
  group,
}: {
  group: DuplicateEpisodeGroup;
}) {
  // For episodes we only show info — direct per-copy removal requires the episode API which
  // doesn't have a standalone "remove single episode" endpoint.
  // We surface enough info for the user to clean up via the season detail page.

  return (
    <div className="rounded-xl border border-white/10 bg-pitflix-surface/60 p-4">
      <div className="mb-2 flex items-center justify-between">
        <div>
          <p className="font-semibold text-white">{group.showTitle}</p>
          <p className="text-xs text-pitflix-muted">
            S{String(group.season).padStart(2, "0")} E{String(group.episodeNumber).padStart(2, "0")}
            {group.episodeTitle ? ` — ${group.episodeTitle}` : ""}
          </p>
        </div>
        <span className="rounded-full bg-amber-900/50 px-2 py-0.5 text-[11px] font-semibold text-amber-400">
          {group.copies.length} copies
        </span>
      </div>

      <div className="space-y-1.5">
        {group.copies.map((copy) => (
          <div
            key={copy.id}
            className={cn(
              "rounded border p-2",
              copy.fileExists ? "border-white/10 bg-white/[0.03]" : "border-red-500/30 bg-red-950/20",
            )}
          >
            <p className="truncate font-mono text-[11px] text-pitflix-muted" title={copy.filePath}>
              {fmtPath(copy.filePath)}
            </p>
            <div className="mt-0.5 flex flex-wrap gap-2 text-[10px] text-pitflix-subtle">
              <span>{fmtBytes(copy.fileSize)}</span>
              {!copy.fileExists && <span className="text-red-400">File missing</span>}
              <span>{copy.watchStatus}</span>
            </div>
          </div>
        ))}
      </div>

      <p className="mt-2 text-[11px] text-pitflix-subtle">
        Open the season page to remove individual episode entries.
      </p>
    </div>
  );
}

export function DuplicatesPage() {
  const navigate = useNavigate();
  const qc = useQueryClient();
  const [resolvedCount, setResolvedCount] = useState(0);

  const { data, isLoading, isError, refetch } = useQuery({
    queryKey: ["duplicates"],
    queryFn: getDuplicates,
    staleTime: 60_000,
  });

  const totalGroups =
    (data?.totalMovieDuplicateGroups ?? 0) + (data?.totalEpisodeDuplicateGroups ?? 0);

  return (
    <div className="pb-12">
      <button
        type="button"
        onClick={() => navigate(-1)}
        className="mb-4 text-sm text-pitflix-muted hover:text-white"
      >
        ← Back
      </button>

      <div className="mb-6 flex items-center justify-between">
        <div>
          <h1 className="text-3xl font-bold text-white">Duplicate Files</h1>
          <p className="mt-1 text-sm text-pitflix-muted">
            Same title or TMDB ID matched to multiple files in your library.
          </p>
        </div>
        <button
          type="button"
          onClick={() => void refetch()}
          className="rounded-lg border border-white/20 px-3 py-1.5 text-xs text-pitflix-muted hover:text-white"
        >
          Refresh
        </button>
      </div>

      {isLoading && (
        <div className="flex justify-center py-24">
          <Spinner />
        </div>
      )}

      {isError && (
        <p className="text-sm text-red-400">Failed to load duplicates. Is the API running?</p>
      )}

      {!isLoading && !isError && data && (
        <>
          {totalGroups === 0 ? (
            <div className="flex flex-col items-center gap-3 py-24 text-center">
              <span className="text-5xl">✓</span>
              <p className="text-xl font-semibold text-white">No duplicates found</p>
              <p className="max-w-sm text-sm text-pitflix-muted">
                Every title in your library maps to a single file.
              </p>
            </div>
          ) : (
            <>
              <div className="mb-2 rounded-lg border border-amber-500/30 bg-amber-950/20 px-4 py-3">
                <p className="text-sm text-amber-300">
                  Found{" "}
                  <strong>
                    {totalGroups} duplicate group{totalGroups !== 1 ? "s" : ""}
                  </strong>{" "}
                  ({data.totalMovieDuplicateGroups} movie
                  {data.totalMovieDuplicateGroups !== 1 ? "s" : ""},&nbsp;
                  {data.totalEpisodeDuplicateGroups} episode
                  {data.totalEpisodeDuplicateGroups !== 1 ? "s" : ""}
                  ). For each group, keep one copy and remove or delete the rest.
                </p>
              </div>

              {data.movieDuplicates.length > 0 && (
                <section className="mt-6">
                  <h2 className="mb-3 text-lg font-semibold text-white">
                    Movies ({data.movieDuplicates.length})
                  </h2>
                  <div className="space-y-3">
                    {data.movieDuplicates.map((g) => (
                      <MovieDuplicateCard
                        key={`${g.tmdbId}-${g.title}`}
                        group={g}
                        onResolved={() => setResolvedCount((c) => c + 1)}
                      />
                    ))}
                  </div>
                </section>
              )}

              {data.episodeDuplicates.length > 0 && (
                <section className="mt-6">
                  <h2 className="mb-3 text-lg font-semibold text-white">
                    Episodes ({data.episodeDuplicates.length})
                  </h2>
                  <div className="space-y-3">
                    {data.episodeDuplicates.map((g) => (
                      <EpisodeDuplicateCard
                        key={`${g.showId}-${g.season}-${g.episodeNumber}`}
                        group={g}
                      />
                    ))}
                  </div>
                </section>
              )}

              {resolvedCount > 0 && (
                <div className="mt-6 rounded-lg border border-emerald-500/30 bg-emerald-950/20 px-4 py-3">
                  <p className="text-sm text-emerald-300">
                    {resolvedCount} duplicate{resolvedCount !== 1 ? "s" : ""} resolved this session.{" "}
                    <button
                      type="button"
                      className="underline hover:text-emerald-200"
                      onClick={() => {
                        setResolvedCount(0);
                        void qc.invalidateQueries({ queryKey: ["duplicates"] });
                      }}
                    >
                      Refresh list
                    </button>
                  </p>
                </div>
              )}
            </>
          )}
        </>
      )}
    </div>
  );
}
