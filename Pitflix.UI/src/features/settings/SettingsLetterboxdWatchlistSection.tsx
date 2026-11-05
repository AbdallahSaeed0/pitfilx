import { useQuery, useQueryClient } from "@tanstack/react-query";
import { ListPlus, RefreshCw } from "lucide-react";
import { useState } from "react";
import {
  getLetterboxdWatchlistSync,
  runLetterboxdWatchlistSync,
  saveLetterboxdWatchlistSync,
} from "../../api/letterboxd";
import { getLists } from "../../api/lists";
import { formatListMenuLabel, isWatchLaterListName } from "../../utils/listMarks";

function fmtWhen(iso: string | null): string {
  if (!iso) return "never";
  const d = new Date(iso);
  return Number.isNaN(d.getTime()) ? "never" : d.toLocaleString();
}

/**
 * Letterboxd watchlist → Pitflix list. New films on the watchlist are added automatically (every 6 h
 * or on "Sync now"); films the sync added are removed again once they leave the watchlist. Items you
 * added yourself are never touched.
 */
export function SettingsLetterboxdWatchlistSection() {
  const qc = useQueryClient();
  const [busy, setBusy] = useState(false);
  const statusQ = useQuery({
    queryKey: ["letterboxd-watchlist-sync"],
    queryFn: getLetterboxdWatchlistSync,
    refetchInterval: (q) => (q.state.data?.running ? 2000 : 30_000),
  });
  const listsQ = useQuery({ queryKey: ["lists"], queryFn: getLists, staleTime: 60_000 });

  const status = statusQ.data;
  const lists = listsQ.data ?? [];
  // No explicit choice yet → the backend uses Watch Later; show that.
  const selectedId = status?.listId ?? lists.find((l) => isWatchLaterListName(l.name))?.id ?? lists[0]?.id ?? null;

  const refresh = () => {
    void qc.invalidateQueries({ queryKey: ["letterboxd-watchlist-sync"] });
    void qc.invalidateQueries({ queryKey: ["lists"] });
  };
  const save = async (enabled: boolean, listId: number | null) => {
    setBusy(true);
    try {
      await saveLetterboxdWatchlistSync(enabled, listId);
    } finally {
      setBusy(false);
      refresh();
    }
  };

  return (
    <section className="rounded-xl border border-pitflix-card/50 bg-pitflix-card p-5">
      <div className="flex items-start justify-between gap-3">
        <div>
          <h2 className="flex items-center gap-2 text-sm font-semibold text-white">
            <ListPlus className="h-4 w-4 text-pitflix-primary" strokeWidth={2} />
            Letterboxd watchlist
          </h2>
          <p className="mt-1.5 max-w-xl text-[10px] leading-relaxed text-pitflix-subtle">
            Adds new films from your Letterboxd watchlist to a Pitflix list automatically, and removes the ones you take
            off the watchlist (only ones this sync added — your own additions are never touched). Checks every 6 hours.
          </p>
        </div>
        <button
          type="button"
          role="switch"
          aria-checked={!!status?.enabled}
          disabled={!status || busy}
          onClick={() => void save(!status?.enabled, selectedId)}
          className={`relative inline-flex h-6 w-11 shrink-0 cursor-pointer rounded-full border-2 border-transparent transition-colors disabled:opacity-50 ${
            status?.enabled ? "bg-pitflix-primary" : "bg-pitflix-bg"
          }`}
        >
          <span
            className={`pointer-events-none inline-block h-5 w-5 rounded-full bg-white shadow transition ${
              status?.enabled ? "translate-x-5" : "translate-x-0"
            }`}
          />
        </button>
      </div>

      {status?.enabled ? (
        <div className="mt-4 space-y-3">
          <label className="block text-[11px] text-pitflix-muted">
            Add to list
            <select
              className="mt-1 block w-full max-w-xs rounded-lg border border-pitflix-card bg-pitflix-bg px-2.5 py-1.5 text-xs text-white"
              value={selectedId ?? ""}
              disabled={busy}
              onChange={(e) => void save(true, Number(e.currentTarget.value))}
            >
              {lists.map((l) => (
                <option key={l.id} value={l.id}>
                  {formatListMenuLabel(l.name)} ({l.itemCount})
                </option>
              ))}
            </select>
          </label>

          <div className="rounded-lg border border-white/5 bg-pitflix-bg/60 px-3 py-2">
            {status.running ? (
              <p className="flex items-center gap-2 text-xs text-white">
                <RefreshCw className="h-3.5 w-3.5 animate-spin text-pitflix-primary" />
                {status.phase ?? "Syncing…"}
              </p>
            ) : (
              <>
                <p className="text-xs text-white">
                  {status.onWatchlist > 0 ? `${status.onWatchlist} films on your watchlist` : "Not synced yet"}
                  {status.added > 0 || status.removed > 0
                    ? ` · last sync +${status.added} added, −${status.removed} removed`
                    : ""}
                </p>
                <p className="mt-0.5 text-[10px] text-pitflix-subtle">
                  Last synced: {fmtWhen(status.lastRunUtc)}
                  {status.unresolved > 0 ? ` · ${status.unresolved} couldn't be matched yet` : ""}
                </p>
              </>
            )}
            {status.lastError ? <p className="mt-1 text-[10px] text-amber-400">{status.lastError}</p> : null}
          </div>

          <button
            type="button"
            disabled={status.running || busy}
            onClick={() => {
              void runLetterboxdWatchlistSync().finally(refresh);
            }}
            className="rounded-lg border border-pitflix-card bg-pitflix-bg px-3 py-2 text-xs font-medium text-white hover:border-pitflix-primary/50 disabled:opacity-50"
          >
            {status.running ? "Syncing…" : "Sync now"}
          </button>
        </div>
      ) : null}
    </section>
  );
}
