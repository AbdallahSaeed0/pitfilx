import { useQueryClient } from "@tanstack/react-query";
import { HardDriveDownload } from "lucide-react";
import { useState } from "react";
import { refreshImdbRatings, startOfflinePreload } from "../../api/offline";
import { useOfflineStatusQuery } from "../../hooks/useOfflineStatus";

function fmtWhen(iso: string | null | undefined): string {
  if (!iso) return "never";
  const d = new Date(iso);
  return Number.isNaN(d.getTime()) ? "never" : d.toLocaleString();
}

/**
 * Offline library: the backend saves every movie/show page (details, seasons, episode lists, images)
 * in the background so the library opens without internet, plus IMDb's own episode ratings dataset.
 */
export function SettingsOfflineLibrarySection() {
  const qc = useQueryClient();
  const { data: status } = useOfflineStatusQuery();
  const [message, setMessage] = useState<string | null>(null);

  const run = async (action: () => Promise<{ ok: boolean; error?: string }>, started: string) => {
    setMessage(null);
    try {
      const r = await action();
      setMessage(r.ok ? started : (r.error ?? "Couldn't start."));
    } catch (e) {
      setMessage(e instanceof Error ? e.message : String(e));
    }
    void qc.invalidateQueries({ queryKey: ["offline-status"] });
  };

  const preload = status?.preload;
  const imdb = status?.imdbRatings;
  const pct = preload && preload.total > 0 ? Math.round((preload.done / preload.total) * 100) : 0;

  return (
    <section id="offline-library" className="rounded-xl border border-pitflix-card/50 bg-pitflix-card p-5">
      <h2 className="flex items-center gap-2 text-sm font-semibold text-white">
        <HardDriveDownload className="h-4 w-4 text-pitflix-primary" strokeWidth={2} />
        Offline library
      </h2>
      <p className="mt-2 text-[10px] leading-relaxed text-pitflix-subtle">
        Pitflix saves every movie and show page — details, seasons, episode lists and their pictures — in the
        background, so your library opens normally without internet. New titles are prepared automatically
        every few hours.
      </p>

      {!status ? (
        <p className="mt-4 text-xs text-pitflix-muted">Loading…</p>
      ) : (
        <div className="mt-4 space-y-3">
          <div className="rounded-lg border border-white/5 bg-pitflix-bg/60 px-3 py-2">
            <p className="text-xs font-medium text-white">
              {preload!.readyTitles} of {preload!.totalTitles} titles ready offline
            </p>
            {preload!.running ? (
              <>
                <div className="mt-2 h-1.5 overflow-hidden rounded-full bg-white/10">
                  <div className="h-full rounded-full bg-pitflix-primary transition-all" style={{ width: `${pct}%` }} />
                </div>
                <p className="mt-1 truncate text-[10px] text-pitflix-subtle">
                  Preparing {preload!.done}/{preload!.total}
                  {preload!.current ? ` — ${preload!.current}` : ""}
                </p>
              </>
            ) : (
              <p className="mt-0.5 text-[10px] text-pitflix-subtle">
                Last run: {fmtWhen(preload!.lastCompletedUtc)}
                {preload!.lastError ? ` · ${preload!.lastError}` : ""}
              </p>
            )}
          </div>

          <div className="rounded-lg border border-white/5 bg-pitflix-bg/60 px-3 py-2">
            <p className="text-xs font-medium text-white">Episode ratings (IMDb data)</p>
            <p className="mt-0.5 text-[10px] text-pitflix-subtle">
              {imdb!.refreshing
                ? "Downloading and building…"
                : imdb!.available
                  ? `Updated ${fmtWhen(imdb!.builtAtUtc)} · refreshes daily`
                  : "Not downloaded yet — starts automatically shortly after launch"}
              {imdb!.lastError ? ` · ${imdb!.lastError}` : ""}
            </p>
          </div>

          <div className="flex flex-wrap gap-2">
            <button
              type="button"
              disabled={preload!.running || status.offline}
              onClick={() => void run(startOfflinePreload, "Preparing the library in the background…")}
              className="rounded-lg border border-pitflix-card bg-pitflix-bg px-3 py-2 text-xs font-medium text-white hover:border-pitflix-primary/50 disabled:opacity-50"
            >
              {preload!.running ? "Preparing…" : "Update offline library now"}
            </button>
            <button
              type="button"
              disabled={imdb!.refreshing || status.offline}
              onClick={() => void run(refreshImdbRatings, "Refreshing IMDb ratings in the background…")}
              className="rounded-lg border border-pitflix-card bg-pitflix-bg px-3 py-2 text-xs font-medium text-white hover:border-pitflix-primary/50 disabled:opacity-50"
            >
              Refresh IMDb ratings
            </button>
          </div>
          {status.offline ? (
            <p className="text-[10px] text-orange-400">
              {status.forcedOffline ? "Offline mode is on" : "No internet connection"} — showing saved data.
            </p>
          ) : null}
          {message ? <p className="text-[10px] text-pitflix-muted">{message}</p> : null}
        </div>
      )}
    </section>
  );
}
