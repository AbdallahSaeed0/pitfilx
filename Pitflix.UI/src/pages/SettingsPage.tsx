import { isTauri } from "@tauri-apps/api/core";
import { useQuery, useQueryClient } from "@tanstack/react-query";
import axios from "axios";
import { Eye, EyeOff } from "lucide-react";
import { useEffect, useMemo, useRef, useState } from "react";
import { open } from "@tauri-apps/plugin-dialog";
import {
  cleanupLibrary,
  cleanupMissingFiles,
  type LibraryTitleRow,
  prefetchLibraryMetadataStream,
  refreshLibraryArtwork,
  removeLibraryMovie,
  removeLibraryShow,
  searchLibraryTitles,
} from "../api/library";
import { clearImageCache } from "../api/maintenance";
import { runTrailerIngestion } from "../api/homeDiscover";
import {
  addLibraryPath,
  addPinnedScanPath,
  addExcludedScanPath,
  getMediaPlayerCandidates,
  getSettings,
  nativePickExecutable,
  nativePickFolder,
  removeLibraryPath,
  removePinnedScanPath,
  removeExcludedScanPath,
  saveSettings,
  verifyOpenSubtitlesKey,
  verifyTmdbKey,
} from "../api/settings";
import { queueRatingsLibraryBackfill, queueRatingsStaleSweep } from "../api/ratings";
import { startScan } from "../api/scan";
import { getStats } from "../api/stats";
import { Spinner } from "../components/ui/Spinner";
import { useDebounce } from "../hooks/useDebounce";
import { RemoveTitleBrowseModal } from "../components/RemoveTitleBrowseModal";
import type { RemoveTitlePick } from "../components/RemoveTitleBrowseModal";
import { ApiHealthCheck } from "../components/ApiHealthCheck";
import { ConfirmDialog } from "../components/ui/ConfirmDialog";
import { getDesktopAutostartState, isWindowsHost, setDesktopAutostart } from "../utils/autostart";
import { AppUpdateSection } from "../components/updater/AppUpdateSection";
import { cn } from "../utils/cn";

type SettingsTab = "library" | "stats" | "providers" | "playback" | "app" | "maintenance";

function formatScanOrApiError(err: unknown): string {
  if (axios.isAxiosError(err)) {
    const raw = err.response?.data;
    const data = raw && typeof raw === "object" ? (raw as Record<string, unknown>) : null;
    const message = data?.message;
    if (typeof message === "string" && message.trim()) return message;
    const code = data?.error;
    if (code === "NO_LIBRARY_FOLDERS") {
      return "No library folders are saved yet. Add at least one folder under “Library folders” above, save it, then run the scan again.";
    }
    if (typeof code === "string" && code.length > 0 && (code.includes(" ") || code.length < 32))
      return code;
    if (err.message?.toLowerCase().includes("network") || err.code === "ECONNABORTED") {
      return "Cannot reach Pitflix API. If you use a custom port, set VITE_API_ORIGIN and restart the app.";
    }
  }
  if (err instanceof Error) return err.message;
  return "Request failed.";
}

export function SettingsPage() {
  const qc = useQueryClient();
  const { data, isLoading } = useQuery({ queryKey: ["settings"], queryFn: getSettings });
  const { data: watchStats } = useQuery({ queryKey: ["stats"], queryFn: getStats });
  const { data: playerCandidates } = useQuery({
    queryKey: ["media-player-candidates"],
    queryFn: getMediaPlayerCandidates,
    staleTime: 120_000,
  });
  const uniquePlayerCandidates = useMemo(() => {
    const list = playerCandidates ?? [];
    const byPath = new Map<string, string>();
    for (const c of list) {
      if (c.path && !byPath.has(c.path)) byPath.set(c.path, c.label);
    }
    return [...byPath.entries()].map(([path, label]) => ({ path, label }));
  }, [playerCandidates]);
  const [manualPath, setManualPath] = useState("");
  const [pinnedManualPath, setPinnedManualPath] = useState("");
  const [excludedManualPath, setExcludedManualPath] = useState("");
  const [pathBusy, setPathBusy] = useState(false);
  const [pinnedBusy, setPinnedBusy] = useState(false);
  const [excludedBusy, setExcludedBusy] = useState(false);
  const [libraryPickMessage, setLibraryPickMessage] = useState<string | null>(null);
  const [pinnedPickMessage, setPinnedPickMessage] = useState<string | null>(null);
  const [excludedPickMessage, setExcludedPickMessage] = useState<string | null>(null);
  const [cleanupMessage, setCleanupMessage] = useState<string | null>(null);
  const [cleanupBusy, setCleanupBusy] = useState(false);
  const [scanBusy, setScanBusy] = useState(false);
  const [scanMessage, setScanMessage] = useState<string | null>(null);
  const [artworkBusy, setArtworkBusy] = useState(false);
  const [artworkMessage, setArtworkMessage] = useState<string | null>(null);
  const [prefetchBusy, setPrefetchBusy] = useState(false);
  const [prefetchMessage, setPrefetchMessage] = useState<string | null>(null);
  const [prefetchPct, setPrefetchPct] = useState(0);
  const [prefetchLiveLine, setPrefetchLiveLine] = useState("");
  const [prefetchLog, setPrefetchLog] = useState<string[]>([]);
  const prefetchAbortRef = useRef<AbortController | null>(null);
  const [maintMessage, setMaintMessage] = useState<string | null>(null);
  const [ratingsMaintKey, setRatingsMaintKey] = useState("");
  const [ratingsBackfillBusy, setRatingsBackfillBusy] = useState(false);
  const [ratingsStaleBusy, setRatingsStaleBusy] = useState(false);
  const [ratingsMaintMsg, setRatingsMaintMsg] = useState<string | null>(null);
  const [trailerIngestionBusy, setTrailerIngestionBusy] = useState(false);
  const [trailerIngestionMsg, setTrailerIngestionMsg] = useState<string | null>(null);
  const [toast, setToast] = useState<string | null>(null);
  const [removeBrowseRefresh, setRemoveBrowseRefresh] = useState(0);
  const [mediaPlayerPath, setMediaPlayerPath] = useState("");
  const [playerFieldTouched, setPlayerFieldTouched] = useState(false);
  const [playerBusy, setPlayerBusy] = useState(false);
  const [playerMessage, setPlayerMessage] = useState<string | null>(null);
  const [useBuiltinPlayer, setUseBuiltinPlayer] = useState(true);
  const [builtinBusy, setBuiltinBusy] = useState(false);
  const [removeOpen, setRemoveOpen] = useState(false);
  const [removeBrowseKind, setRemoveBrowseKind] = useState<null | "movies" | "series">(null);
  const [pendingRemove, setPendingRemove] = useState<RemoveTitlePick | null>(null);
  const [resetDbInfoOpen, setResetDbInfoOpen] = useState(false);
  const [removeQuery, setRemoveQuery] = useState("");
  const removeQ = useDebounce(removeQuery, 300);
  const [searchHits, setSearchHits] = useState<{ movies: LibraryTitleRow[]; shows: LibraryTitleRow[] } | null>(
    null,
  );
  const [tmdbKeyInput, setTmdbKeyInput] = useState("");
  const [osKeyInput, setOsKeyInput] = useState("");
  const [showTmdbKey, setShowTmdbKey] = useState(false);
  const [showOsKey, setShowOsKey] = useState(false);
  const [apiKeyMsg, setApiKeyMsg] = useState<string | null>(null);
  const [apiKeyBusy, setApiKeyBusy] = useState(false);
  const [tmdbVerifyBusy, setTmdbVerifyBusy] = useState(false);
  const [osVerifyBusy, setOsVerifyBusy] = useState(false);
  const [autostartBusy, setAutostartBusy] = useState(false);
  const [autostartMessage, setAutostartMessage] = useState<string | null>(null);
  const [settingsTab, setSettingsTab] = useState<SettingsTab>("library");

  const { data: autostartStatus } = useQuery({
    queryKey: ["autostart-status"],
    queryFn: () => getDesktopAutostartState(),
    staleTime: 30_000,
  });

  useEffect(() => {
    if (!data || playerFieldTouched) return;
    setMediaPlayerPath(String((data as { mediaPlayerPath?: string }).mediaPlayerPath ?? ""));
  }, [data, playerFieldTouched]);

  useEffect(() => {
    if (!data) return;
    const u = (data as { useBuiltinPlayer?: boolean }).useBuiltinPlayer;
    setUseBuiltinPlayer(u !== false);
  }, [data]);

  useEffect(() => {
    if (!removeOpen) {
      setSearchHits(null);
      return;
    }
    if (removeBrowseKind != null) return;
    if (removeQ.trim().length < 2) {
      setSearchHits(null);
      return;
    }
    let cancelled = false;
    void searchLibraryTitles(removeQ.trim())
      .then((r) => {
        if (!cancelled) setSearchHits(r);
      })
      .catch(() => {
        if (!cancelled) setSearchHits({ movies: [], shows: [] });
      });
    return () => {
      cancelled = true;
    };
  }, [removeOpen, removeQ, removeBrowseKind]);

  const libraryRowToPick = (row: LibraryTitleRow): RemoveTitlePick => ({
    kind: row.kind === "movie" ? "movie" : "series",
    id: row.id,
    title: row.title,
  });

  const executeConfirmedRemove = () => {
    const row = pendingRemove;
    if (!row) return;
    setPendingRemove(null);
    const p = row.kind === "movie" ? removeLibraryMovie(row.id) : removeLibraryShow(row.id);
    void p
      .then(() => {
        setToast(`Removed: ${row.title}`);
        void qc.invalidateQueries({ queryKey: ["stats"] });
        void qc.invalidateQueries({ queryKey: ["movies"] });
        void qc.invalidateQueries({ queryKey: ["series"] });
        void qc.invalidateQueries({ queryKey: ["home-top-rated"] });
        void qc.invalidateQueries({ queryKey: ["home-arabic"] });
        void qc.invalidateQueries({ queryKey: ["home-binge"] });
        void qc.invalidateQueries({ queryKey: ["home-movie-night"] });
        void qc.invalidateQueries({ queryKey: ["home-history"] });
        void qc.invalidateQueries({ queryKey: ["home-layout"] });
        void qc.invalidateQueries({ queryKey: ["home-featured-fallback"] });
        void qc.invalidateQueries({ predicate: (q) => q.queryKey[0] === "home-section" });
        setSearchHits((prev) => {
          if (!prev) return prev;
          return {
            movies: prev.movies.filter((x) => !(row.kind === "movie" && x.id === row.id)),
            shows: prev.shows.filter((x) => !(row.kind === "series" && x.id === row.id)),
          };
        });
        setRemoveBrowseRefresh((x) => x + 1);
      })
      .catch(() => setToast("Remove failed."));
  };

  useEffect(() => {
    if (!toast) return;
    const t = window.setTimeout(() => setToast(null), 4500);
    return () => window.clearTimeout(t);
  }, [toast]);

  if (isLoading && !data)
    return (
      <div className="flex justify-center py-24">
        <Spinner />
      </div>
    );

  const combinedHits: LibraryTitleRow[] = [
    ...(searchHits?.movies ?? []),
    ...(searchHits?.shows ?? []),
  ];

  const refetchSettings = () => {
    void qc.invalidateQueries({ queryKey: ["settings"] });
    void qc.invalidateQueries({ queryKey: ["stats"] });
  };

  const handleBrowse = async () => {
    setLibraryPickMessage(null);
    setPathBusy(true);
    try {
      let selected: string | null = null;

      if (isTauri()) {
        try {
          const r = await open({
            directory: true,
            multiple: false,
            title: "Select Media Folder",
          });
          if (typeof r === "string") selected = r;
        } catch (e) {
          console.error("Tauri folder dialog failed:", e);
          setLibraryPickMessage("Folder dialog failed in the desktop app. Check Tauri dialog permissions.");
          return;
        }
      } else {
        try {
          const d = await nativePickFolder();
          if (d.error) {
            setLibraryPickMessage(d.error);
            return;
          }
          selected = d.path ?? null;
        } catch (e) {
          const msg =
            e && typeof e === "object" && "code" in e && (e as { code?: string }).code === "ECONNABORTED"
              ? "Request timed out — if the folder dialog is open, select a folder or cancel."
              : "Cannot reach Pitflix.API. Run the API (dotnet run in Pitflix.API), then try again. If the API uses another port, set VITE_API_ORIGIN in .env (e.g. http://127.0.0.1:5001).";
          console.error("Native folder pick failed:", e);
          setLibraryPickMessage(
            e instanceof Error && e.message.toLowerCase().includes("network") ? msg : (e as Error).message || msg,
          );
          return;
        }
      }

      if (!selected) return;
      await addLibraryPath(selected);
      refetchSettings();
    } catch (err) {
      console.error("Folder browse failed:", err);
      setLibraryPickMessage(err instanceof Error ? err.message : "Could not add folder.");
    } finally {
      setPathBusy(false);
    }
  };

  const handleBrowsePlayerExe = async () => {
    setPlayerMessage(null);
    setPlayerBusy(true);
    try {
      let selected: string | null = null;

      if (isTauri()) {
        try {
          const r = await open({
            multiple: false,
            title: "Choose media player (.exe)",
            filters: [{ name: "Executable", extensions: ["exe"] }],
          });
          if (typeof r === "string") selected = r;
        } catch (e) {
          console.error("Tauri file dialog failed:", e);
          setPlayerMessage("File dialog failed in the desktop app. Check Tauri dialog permissions.");
          return;
        }
      } else {
        try {
          const d = await nativePickExecutable();
          if (d.error) {
            setPlayerMessage(d.error);
            return;
          }
          selected = d.path ?? null;
        } catch (e) {
          const msg =
            "Cannot reach Pitflix.API. Run the API on Windows, then try again. Set VITE_API_ORIGIN if the port is not 5001.";
          console.error("Native exe pick failed:", e);
          setPlayerMessage(e instanceof Error ? e.message || msg : msg);
          return;
        }
      }

      if (!selected) return;
      setMediaPlayerPath(selected);
      setPlayerFieldTouched(true);
      await saveSettings({ mediaPlayerPath: selected });
      setPlayerFieldTouched(false);
      refetchSettings();
      setPlayerMessage("Player saved.");
    } catch (err) {
      console.error(err);
      setPlayerMessage(err instanceof Error ? err.message : "Could not save player.");
    } finally {
      setPlayerBusy(false);
    }
  };

  const handleAddManual = async () => {
    const path = manualPath.trim();
    if (!path)
      return;
    setPathBusy(true);
    try
    {
      await addLibraryPath(path);
      setManualPath("");
      refetchSettings();
    }
    catch (err)
    {
      console.error("Add path failed:", err);
    }
    finally
    {
      setPathBusy(false);
    }
  };

  const handleBrowsePinned = async () => {
    setPinnedPickMessage(null);
    setPinnedBusy(true);
    try {
      let selected: string | null = null;
      if (isTauri()) {
        try {
          const r = await open({
            directory: true,
            multiple: false,
            title: "Select folder to watch for new media",
          });
          if (typeof r === "string") selected = r;
        } catch (e) {
          console.error(e);
          setPinnedPickMessage("Folder dialog failed.");
          return;
        }
      } else {
        try {
          const d = await nativePickFolder();
          if (d.error) {
            setPinnedPickMessage(d.error);
            return;
          }
          selected = d.path ?? null;
        } catch (e) {
          setPinnedPickMessage(
            e instanceof Error ? e.message : "Cannot reach Pitflix.API for folder pick.",
          );
          return;
        }
      }
      if (!selected) return;
      await addPinnedScanPath(selected);
      refetchSettings();
    } catch (err) {
      setPinnedPickMessage(err instanceof Error ? err.message : "Could not add pinned folder.");
    } finally {
      setPinnedBusy(false);
    }
  };

  const handleAddPinnedManual = async () => {
    const path = pinnedManualPath.trim();
    if (!path) return;
    setPinnedBusy(true);
    try {
      await addPinnedScanPath(path);
      setPinnedManualPath("");
      refetchSettings();
    } catch (err) {
      console.error(err);
    } finally {
      setPinnedBusy(false);
    }
  };

  const handleBrowseExcluded = async () => {
    setExcludedPickMessage(null);
    setExcludedBusy(true);
    try {
      let selected: string | null = null;
      if (isTauri()) {
        try {
          const r = await open({
            directory: true,
            multiple: false,
            title: "Select folder to exclude from scans",
          });
          if (typeof r === "string") selected = r;
        } catch (e) {
          console.error(e);
          setExcludedPickMessage("Folder dialog failed.");
          return;
        }
      } else {
        try {
          const d = await nativePickFolder();
          if (d.error) {
            setExcludedPickMessage(d.error);
            return;
          }
          selected = d.path ?? null;
        } catch (e) {
          setExcludedPickMessage(
            e instanceof Error ? e.message : "Cannot reach Pitflix.API for folder pick.",
          );
          return;
        }
      }
      if (!selected) return;
      await addExcludedScanPath(selected);
      refetchSettings();
    } catch (err) {
      setExcludedPickMessage(err instanceof Error ? err.message : "Could not add excluded folder.");
    } finally {
      setExcludedBusy(false);
    }
  };

  const handleAddExcludedManual = async () => {
    const path = excludedManualPath.trim();
    if (!path) return;
    setExcludedBusy(true);
    try {
      await addExcludedScanPath(path);
      setExcludedManualPath("");
      refetchSettings();
    } catch (err) {
      console.error(err);
    } finally {
      setExcludedBusy(false);
    }
  };

  const savePlayerPath = (path: string, label?: string) => {
    setPlayerMessage(null);
    setPlayerBusy(true);
    setMediaPlayerPath(path);
    setPlayerFieldTouched(true);
    void saveSettings({ mediaPlayerPath: path })
      .then(() => {
        setPlayerMessage(label ? `Using ${label}.` : "Saved.");
        setPlayerFieldTouched(false);
        refetchSettings();
      })
      .catch(() => setPlayerMessage("Could not save. Is the API running?"))
      .finally(() => setPlayerBusy(false));
  };

  const watchNotStarted =
    (watchStats?.moviesUnwatched ?? 0) + (watchStats?.seriesUnwatched ?? 0);
  const watchProgress =
    (watchStats?.moviesWatching ?? 0) + (watchStats?.seriesWatching ?? 0);
  const watchDone =
    (watchStats?.moviesCompleted ?? 0) + (watchStats?.seriesCompleted ?? 0);

  return (
    <div className="mx-auto max-w-4xl space-y-4 p-4 md:p-6">
      <header className="border-b border-white/5 pb-4">
        <h1 className="text-2xl font-bold tracking-tight text-white md:text-3xl">Settings</h1>
        <p className="mt-1.5 max-w-xl text-sm text-pitflix-subtle">
          Library paths, integrations, playback, and maintenance — switch tabs to focus one area.
        </p>
      </header>

      <nav className="sticky top-2 z-20 flex flex-wrap gap-1 rounded-xl border border-white/10 bg-pitflix-bg/95 px-2 py-1.5 shadow-lg shadow-black/20 backdrop-blur-md">
        {(
          [
            ["library", "Library"],
            ["stats", "Stats"],
            ["providers", "API keys"],
            ["playback", "Playback"],
            ["app", "App & updates"],
            ["maintenance", "Maintenance"],
          ] as const
        ).map(([id, label]) => (
          <button
            key={id}
            type="button"
            onClick={() => setSettingsTab(id)}
            className={cn(
              "rounded-lg px-2.5 py-1.5 text-[11px] font-medium transition-colors sm:px-3 sm:text-xs",
              settingsTab === id
                ? "bg-white/12 text-white"
                : "text-pitflix-muted hover:bg-white/5 hover:text-white",
            )}
          >
            {label}
          </button>
        ))}
      </nav>

      <div>
        <ApiHealthCheck />
      </div>

      <div className="space-y-3">
        <div className={cn(settingsTab !== "library" && "hidden", "space-y-3")}>
          <section
            id="settings-library"
            className="rounded-xl border border-white/8 bg-pitflix-surface/35 p-4 shadow-md shadow-black/20"
          >
            <div className="flex items-center justify-between gap-2">
              <h2 className="text-base font-semibold text-white">Library folders</h2>
              <button
                type="button"
                disabled={pathBusy}
                className="shrink-0 rounded-lg bg-pitflix-primary px-2.5 py-1.5 text-[11px] font-semibold text-white hover:bg-pitflix-light disabled:opacity-50"
                onClick={() => void handleBrowse()}
              >
                {pathBusy ? "…" : "Browse"}
              </button>
            </div>
            <p className="mt-1 text-[10px] leading-relaxed text-pitflix-subtle">
              Add each <span className="text-pitflix-muted">top-level</span> folder once (for example your whole{" "}
              <span className="text-pitflix-muted">Series</span> or <span className="text-pitflix-muted">Movies</span>{" "}
              directory). Everything inside it—including new seasons and episodes—is included automatically when you run
              Scan Library; you do not add a separate path per show. Pitflix also rechecks the library about once an hour in
              the background.
            </p>
            <p className="mt-1.5 text-[10px] text-pitflix-subtle">
              Browse: folder dialog runs on the API host (Alt+Tab if hidden).
            </p>
            <div className="mt-3 max-h-[140px] space-y-1.5 overflow-y-auto">
              {(data?.libraryPaths ?? []).length === 0 ? (
                <p className="text-xs text-pitflix-muted">No folders yet.</p>
              ) : (
                (data?.libraryPaths ?? []).map((p: string) => (
                  <div
                    key={p}
                    className="flex items-center justify-between gap-2 rounded-lg border border-pitflix-card bg-pitflix-bg/80 px-2.5 py-1.5"
                  >
                    <p className="truncate text-[11px] text-white" title={p}>
                      {p}
                    </p>
                    <button
                      type="button"
                      className="shrink-0 text-[10px] text-pitflix-muted hover:text-red-400"
                      onClick={() => {
                        setPathBusy(true);
                        void removeLibraryPath(p)
                          .then(() => refetchSettings())
                          .finally(() => setPathBusy(false));
                      }}
                    >
                      Remove
                    </button>
                  </div>
                ))
              )}
            </div>
            <div className="mt-3 flex gap-2">
              <input
                value={manualPath}
                onChange={(e) => setManualPath(e.target.value)}
                onKeyDown={(e) => e.key === "Enter" && void handleAddManual()}
                placeholder="Manual path…"
                className="min-w-0 flex-1 rounded-lg border border-pitflix-card bg-pitflix-bg px-2.5 py-2 text-xs text-white placeholder:text-pitflix-subtle focus:border-pitflix-primary focus:outline-none"
              />
              <button
                type="button"
                onClick={() => void handleAddManual()}
                disabled={pathBusy}
                className="shrink-0 rounded-lg bg-pitflix-primary px-3 py-2 text-xs font-semibold text-white hover:bg-pitflix-light disabled:opacity-50"
              >
                Add
              </button>
            </div>
            {libraryPickMessage ? <p className="mt-2 text-[11px] text-red-400/90">{libraryPickMessage}</p> : null}
          </section>

          <section className="rounded-xl border border-white/8 bg-pitflix-surface/35 p-4 shadow-md shadow-black/20">
            <div className="flex items-center justify-between gap-2">
              <h2 className="text-sm font-semibold text-white">Auto-scan folders</h2>
              <button
                type="button"
                disabled={pinnedBusy}
                className="shrink-0 rounded-lg border border-pitflix-primary/50 bg-pitflix-bg px-2.5 py-1.5 text-[11px] font-semibold text-white hover:bg-pitflix-primary/20 disabled:opacity-50"
                onClick={() => void handleBrowsePinned()}
              >
                {pinnedBusy ? "…" : "Browse"}
              </button>
            </div>
            <p className="mt-1 text-[10px] leading-relaxed text-pitflix-subtle">
              Pin download or inbox folders you want indexed quickly. Pitflix rescan these about every <span className="text-pitflix-muted">2 minutes</span>{" "}
              (plus the hourly pass over all library folders). You can still run <span className="text-pitflix-muted">Scan Library</span> anytime.
            </p>
            <div className="mt-3 max-h-[120px] space-y-1.5 overflow-y-auto">
              {(data?.pinnedScanPaths ?? []).length === 0 ? (
                <p className="text-xs text-pitflix-muted">No pinned folders — optional.</p>
              ) : (
                (data?.pinnedScanPaths ?? []).map((p: string) => (
                  <div
                    key={p}
                    className="flex items-center justify-between gap-2 rounded-lg border border-pitflix-card bg-pitflix-bg/80 px-2.5 py-1.5"
                  >
                    <p className="truncate text-[11px] text-white" title={p}>
                      {p}
                    </p>
                    <button
                      type="button"
                      className="shrink-0 text-[10px] text-pitflix-muted hover:text-red-400"
                      onClick={() => {
                        setPinnedBusy(true);
                        void removePinnedScanPath(p)
                          .then(() => refetchSettings())
                          .finally(() => setPinnedBusy(false));
                      }}
                    >
                      Remove
                    </button>
                  </div>
                ))
              )}
            </div>
            <div className="mt-3 flex gap-2">
              <input
                value={pinnedManualPath}
                onChange={(e) => setPinnedManualPath(e.target.value)}
                onKeyDown={(e) => e.key === "Enter" && void handleAddPinnedManual()}
                placeholder="Manual path for auto-scan…"
                className="min-w-0 flex-1 rounded-lg border border-pitflix-card bg-pitflix-bg px-2.5 py-2 text-xs text-white placeholder:text-pitflix-subtle focus:border-pitflix-primary focus:outline-none"
              />
              <button
                type="button"
                onClick={() => void handleAddPinnedManual()}
                disabled={pinnedBusy}
                className="shrink-0 rounded-lg border border-pitflix-primary/50 bg-pitflix-bg px-3 py-2 text-xs font-semibold text-white hover:bg-pitflix-primary/20 disabled:opacity-50"
              >
                Add
              </button>
            </div>
            {pinnedPickMessage ? <p className="mt-2 text-[11px] text-red-400/90">{pinnedPickMessage}</p> : null}
          </section>

          <section className="rounded-xl border border-white/8 bg-pitflix-surface/35 p-4 shadow-md shadow-black/20">
            <div className="flex items-center justify-between gap-2">
              <h2 className="text-sm font-semibold text-white">Excluded folders</h2>
              <button
                type="button"
                disabled={excludedBusy}
                className="shrink-0 rounded-lg border border-red-500/50 bg-pitflix-bg px-2.5 py-1.5 text-[11px] font-semibold text-red-200 hover:bg-red-500/20 disabled:opacity-50"
                onClick={() => void handleBrowseExcluded()}
              >
                {excludedBusy ? "…" : "Browse"}
              </button>
            </div>
            <p className="mt-1 text-[10px] leading-relaxed text-pitflix-subtle">
              Block specific folders from being scanned. Useful when you have a large drive (like <span className="text-pitflix-muted">F:</span>) 
              but want to exclude certain subfolders (like <span className="text-pitflix-muted">F:\System</span> or <span className="text-pitflix-muted">F:\Temp</span>). 
              Excluded folders and all their subfolders will be skipped during all scans.
            </p>
            <div className="mt-3 max-h-[120px] space-y-1.5 overflow-y-auto">
              {(data?.excludedScanPaths ?? []).length === 0 ? (
                <p className="text-xs text-pitflix-muted">No excluded folders — optional.</p>
              ) : (
                (data?.excludedScanPaths ?? []).map((p: string) => (
                  <div
                    key={p}
                    className="flex items-center justify-between gap-2 rounded-lg border border-pitflix-card bg-pitflix-bg/80 px-2.5 py-1.5"
                  >
                    <p className="truncate text-[11px] text-white" title={p}>
                      {p}
                    </p>
                    <button
                      type="button"
                      className="shrink-0 text-[10px] text-pitflix-muted hover:text-red-400"
                      onClick={() => {
                        setExcludedBusy(true);
                        void removeExcludedScanPath(p)
                          .then(() => refetchSettings())
                          .finally(() => setExcludedBusy(false));
                      }}
                    >
                      Remove
                    </button>
                  </div>
                ))
              )}
            </div>
            <div className="mt-3 flex gap-2">
              <input
                value={excludedManualPath}
                onChange={(e) => setExcludedManualPath(e.target.value)}
                onKeyDown={(e) => e.key === "Enter" && void handleAddExcludedManual()}
                placeholder="Manual path to exclude…"
                className="min-w-0 flex-1 rounded-lg border border-pitflix-card bg-pitflix-bg px-2.5 py-2 text-xs text-white placeholder:text-pitflix-subtle focus:border-pitflix-primary focus:outline-none"
              />
              <button
                type="button"
                onClick={() => void handleAddExcludedManual()}
                disabled={excludedBusy}
                className="shrink-0 rounded-lg border border-red-500/50 bg-pitflix-bg px-3 py-2 text-xs font-semibold text-red-200 hover:bg-red-500/20 disabled:opacity-50"
              >
                Add
              </button>
            </div>
            {excludedPickMessage ? <p className="mt-2 text-[11px] text-red-400/90">{excludedPickMessage}</p> : null}
          </section>
        </div>

        <div className={cn(settingsTab !== "playback" && "hidden", "space-y-3")}>
          {isTauri() ? (
            <section
              id="settings-builtin-player"
              className="rounded-xl border border-white/8 bg-pitflix-surface/35 p-4 shadow-md shadow-black/20"
            >
              <h2 className="text-sm font-semibold text-white">Built-in player</h2>
              <p className="mt-1 text-[10px] text-pitflix-subtle">
                Uses bundled mpv in the desktop app. Turn off to launch an external player (VLC, mpv, etc.) via Play.
              </p>
              <label className="mt-3 flex cursor-pointer items-center gap-2 text-xs text-white">
                <input
                  type="checkbox"
                  checked={useBuiltinPlayer}
                  disabled={builtinBusy}
                  onChange={(e) => {
                    const next = e.target.checked;
                    setUseBuiltinPlayer(next);
                    setBuiltinBusy(true);
                    void saveSettings({ useBuiltinPlayer: next })
                      .then(() => refetchSettings())
                      .catch(() => setUseBuiltinPlayer(!next))
                      .finally(() => setBuiltinBusy(false));
                  }}
                  className="h-4 w-4 rounded border-pitflix-card"
                />
                Use bundled Pitflix player (mpv)
              </label>
            </section>
          ) : null}
          <section
            id="settings-playback"
            className="rounded-xl border border-white/8 bg-pitflix-surface/35 p-4 shadow-md shadow-black/20"
          >
            <h2 className="text-sm font-semibold text-white">External player</h2>
            <p className="mt-1 text-[10px] text-pitflix-subtle">
              PATH name or full .exe — resume uses VLC / mpv flags when possible.
            </p>
            <div className="mt-3 flex flex-wrap gap-2">
              <button
                type="button"
                disabled={playerBusy}
                className="h-9 rounded-lg border border-pitflix-primary/50 bg-pitflix-bg px-3 text-xs font-medium text-white hover:bg-pitflix-primary/20 disabled:opacity-50"
                onClick={() => savePlayerPath("vlc", "VLC")}
              >
                VLC
              </button>
              <button
                type="button"
                disabled={playerBusy}
                className="h-9 rounded-lg border border-pitflix-primary/50 bg-pitflix-bg px-3 text-xs font-medium text-white hover:bg-pitflix-primary/20 disabled:opacity-50"
                onClick={() => savePlayerPath("mpv", "mpv")}
              >
                MPV
              </button>
              {uniquePlayerCandidates.slice(0, 6).map(({ path, label }) => (
                <button
                  key={path}
                  type="button"
                  disabled={playerBusy}
                  className="h-9 max-w-[140px] truncate rounded-lg border border-pitflix-card bg-pitflix-bg px-2 text-[11px] text-white hover:border-pitflix-primary/50 disabled:opacity-50"
                  title={label}
                  onClick={() => savePlayerPath(path, label)}
                >
                  {label}
                </button>
              ))}
            </div>
            <div className="mt-3 flex flex-wrap gap-2">
              <input
                value={mediaPlayerPath}
                onChange={(e) => {
                  setPlayerFieldTouched(true);
                  setMediaPlayerPath(e.target.value);
                }}
                placeholder="vlc"
                className="min-w-[120px] flex-1 rounded-lg border border-pitflix-card bg-pitflix-bg px-2.5 py-2 text-xs text-white focus:border-pitflix-primary focus:outline-none"
              />
              <button
                type="button"
                disabled={playerBusy}
                className="h-9 rounded-lg border border-pitflix-card px-3 text-xs text-white hover:border-pitflix-primary/50 disabled:opacity-50"
                onClick={() => void handleBrowsePlayerExe()}
              >
                Browse
              </button>
              <button
                type="button"
                disabled={playerBusy}
                className="h-9 rounded-lg bg-pitflix-primary px-3 text-xs font-semibold text-white hover:bg-pitflix-light disabled:opacity-50"
                onClick={() => {
                  setPlayerMessage(null);
                  setPlayerBusy(true);
                  void saveSettings({ mediaPlayerPath: mediaPlayerPath.trim() })
                    .then(() => {
                      setPlayerMessage("Saved.");
                      setPlayerFieldTouched(false);
                      refetchSettings();
                    })
                    .catch(() => setPlayerMessage("Could not save."))
                    .finally(() => setPlayerBusy(false));
                }}
              >
                Save
              </button>
            </div>
            {playerMessage ? <p className="mt-2 text-[11px] text-pitflix-muted">{playerMessage}</p> : null}
          </section>
        </div>

        <div className={cn(settingsTab !== "app" && "hidden", "space-y-3")}>
          <section
            id="settings-app"
            className="rounded-xl border border-white/8 bg-pitflix-surface/35 p-4 shadow-md shadow-black/20"
          >
            <h2 className="text-sm font-semibold text-white">Application</h2>
            <p className="mt-1 text-[10px] text-pitflix-subtle">
              Desktop app settings
            </p>
            {autostartStatus?.supported ? (
              <div className="mt-4 flex items-center justify-between gap-3">
                <div className="flex-1">
                  <p className="text-xs font-medium text-white">Open when Windows starts</p>
                  <p className="mt-0.5 text-[10px] text-pitflix-subtle">
                    Launch Pitflix automatically when you log in
                  </p>
                </div>
                <button
                  type="button"
                  disabled={autostartBusy}
                  onClick={() => {
                    setAutostartMessage(null);
                    setAutostartBusy(true);
                    const newState = !autostartStatus.enabled;
                    void setDesktopAutostart(newState)
                      .then(() => {
                        setAutostartMessage(newState ? "Enabled startup" : "Disabled startup");
                        void qc.invalidateQueries({ queryKey: ["autostart-status"] });
                      })
                      .catch((err) => {
                        setAutostartMessage(
                          err instanceof Error ? err.message : "Failed to update startup setting"
                        );
                      })
                      .finally(() => setAutostartBusy(false));
                  }}
                  className={`relative inline-flex h-6 w-11 shrink-0 cursor-pointer rounded-full border-2 border-transparent transition-colors duration-200 ease-in-out focus:outline-none focus:ring-2 focus:ring-pitflix-primary focus:ring-offset-2 focus:ring-offset-pitflix-bg disabled:opacity-50 ${
                    autostartStatus.enabled ? "bg-pitflix-primary" : "bg-pitflix-card"
                  }`}
                  role="switch"
                  aria-checked={autostartStatus.enabled}
                >
                  <span
                    className={`pointer-events-none inline-block h-5 w-5 transform rounded-full bg-white shadow ring-0 transition duration-200 ease-in-out ${
                      autostartStatus.enabled ? "translate-x-5" : "translate-x-0"
                    }`}
                  />
                </button>
              </div>
            ) : isWindowsHost() && !isTauri() ? (
              <p className="mt-3 text-xs text-pitflix-muted">
                Startup launch works in the Pitflix desktop app. The browser build cannot register Windows startup.
              </p>
            ) : (
              <p className="mt-3 text-xs text-pitflix-muted">
                Open when Windows starts is only available on Windows.
              </p>
            )}
            {autostartMessage ? <p className="mt-2 text-[11px] text-pitflix-muted">{autostartMessage}</p> : null}
          </section>

          <div id="settings-updates">
            <AppUpdateSection />
          </div>
        </div>

        <div className={cn(settingsTab !== "stats" && "hidden", "space-y-3")}>
          <section
            id="settings-stats"
            className="rounded-xl border border-white/8 bg-pitflix-surface/35 p-4 shadow-md shadow-black/20"
          >
            <h2 className="mb-3 text-xs font-semibold uppercase tracking-wide text-pitflix-muted">Library stats</h2>
            <div className="grid grid-cols-3 gap-2">
              <div className="rounded-xl bg-pitflix-card p-3 text-center ring-1 ring-white/5">
                <p className="text-xl font-bold tabular-nums text-white md:text-2xl">{data?.matchedMovies ?? "—"}</p>
                <p className="text-[10px] text-pitflix-subtle">Movies</p>
              </div>
              <div className="rounded-xl bg-pitflix-card p-3 text-center ring-1 ring-white/5">
                <p className="text-xl font-bold tabular-nums text-white md:text-2xl">{data?.matchedSeries ?? "—"}</p>
                <p className="text-[10px] text-pitflix-subtle">Series</p>
              </div>
              <div className="rounded-xl bg-pitflix-card p-3 text-center ring-1 ring-white/5">
                <p className="text-xl font-bold tabular-nums text-white md:text-2xl">{data?.unmatchedCount ?? "—"}</p>
                <p className="text-[10px] text-pitflix-subtle">Unmatched</p>
              </div>
            </div>
          </section>

          <section className="rounded-xl border border-white/8 bg-pitflix-surface/35 p-4 shadow-md shadow-black/20">
            <h2 className="mb-2 text-xs font-semibold uppercase tracking-wide text-pitflix-muted">Watch overview</h2>
            <p className="mb-3 text-[10px] text-pitflix-subtle">Matched library titles only.</p>
            <div className="grid grid-cols-3 gap-2 text-center">
              <div className="rounded-lg bg-pitflix-bg/80 py-2">
                <p className="text-lg font-bold text-white">{watchNotStarted}</p>
                <p className="text-[10px] text-pitflix-muted">Not watched</p>
              </div>
              <div className="rounded-lg bg-pitflix-bg/80 py-2">
                <p className="text-lg font-bold text-white">{watchProgress}</p>
                <p className="text-[10px] text-pitflix-muted">In progress</p>
              </div>
              <div className="rounded-lg bg-pitflix-bg/80 py-2">
                <p className="text-lg font-bold text-white">{watchDone}</p>
                <p className="text-[10px] text-pitflix-muted">Watched</p>
              </div>
            </div>
          </section>
        </div>

        <div className={cn(settingsTab !== "providers" && "hidden", "space-y-3")}>
          <section
            id="settings-providers"
            className="rounded-xl border border-white/8 bg-pitflix-surface/35 p-4 shadow-md shadow-black/20"
          >
            <h2 className="mb-3 text-sm font-semibold text-white">API keys</h2>
            <p className="mb-4 text-[10px] text-pitflix-subtle">
              Stored in your Pitflix database for this Windows user — not in appsettings files.
            </p>
            <div className="space-y-4">
              <div>
                <div className="flex items-center justify-between gap-2">
                  <span className="text-[11px] font-medium text-pitflix-muted">TMDB API key</span>
                  <span className="truncate text-[10px] text-pitflix-subtle" title={data?.tmdbApiKey ?? ""}>
                    {data?.tmdbApiKey ? `Saved: ${data.tmdbApiKey}` : "Not set"}
                  </span>
                </div>
                <div className="mt-1 flex gap-2">
                  <input
                    type={showTmdbKey ? "text" : "password"}
                    value={tmdbKeyInput}
                    onChange={(e) => setTmdbKeyInput(e.target.value)}
                    placeholder="Enter new key to replace…"
                    autoComplete="off"
                    className="min-w-0 flex-1 rounded-lg border border-pitflix-card bg-pitflix-bg px-2.5 py-2 text-xs text-white placeholder:text-pitflix-subtle focus:border-pitflix-primary focus:outline-none"
                  />
                  <button
                    type="button"
                    className="shrink-0 rounded-lg border border-pitflix-card px-2.5 py-2 text-pitflix-muted hover:text-white"
                    aria-label={showTmdbKey ? "Hide key" : "Show key"}
                    onClick={() => setShowTmdbKey((v) => !v)}
                  >
                    {showTmdbKey ? <EyeOff className="h-4 w-4" /> : <Eye className="h-4 w-4" />}
                  </button>
                </div>
                <div className="mt-2 flex flex-wrap gap-2">
                  <button
                    type="button"
                    disabled={tmdbVerifyBusy}
                    className="rounded-lg border border-pitflix-card px-3 py-1.5 text-[11px] text-white hover:border-pitflix-primary/50 disabled:opacity-50"
                    onClick={() => {
                      setApiKeyMsg(null);
                      const k = tmdbKeyInput.trim();
                      if (!k) {
                        setApiKeyMsg("Type a key above to verify.");
                        return;
                      }
                      setTmdbVerifyBusy(true);
                      void verifyTmdbKey(k)
                        .then((r) =>
                          setApiKeyMsg(r.valid ? "TMDB: key is valid." : `TMDB: ${r.error ?? "invalid"}`),
                        )
                        .catch(() => setApiKeyMsg("TMDB verify failed."))
                        .finally(() => setTmdbVerifyBusy(false));
                    }}
                  >
                    {tmdbVerifyBusy ? "Verifying…" : "Verify"}
                  </button>
                </div>
              </div>
              <div>
                <div className="flex items-center justify-between gap-2">
                  <span className="text-[11px] font-medium text-pitflix-muted">OpenSubtitles API key</span>
                  <span
                    className="truncate text-[10px] text-pitflix-subtle"
                    title={data?.openSubtitlesApiKey ?? ""}
                  >
                    {data?.openSubtitlesApiKey ? `Saved: ${data.openSubtitlesApiKey}` : "Not set"}
                  </span>
                </div>
                <div className="mt-1 flex gap-2">
                  <input
                    type={showOsKey ? "text" : "password"}
                    value={osKeyInput}
                    onChange={(e) => setOsKeyInput(e.target.value)}
                    placeholder="Enter new key to replace…"
                    autoComplete="off"
                    className="min-w-0 flex-1 rounded-lg border border-pitflix-card bg-pitflix-bg px-2.5 py-2 text-xs text-white placeholder:text-pitflix-subtle focus:border-pitflix-primary focus:outline-none"
                  />
                  <button
                    type="button"
                    className="shrink-0 rounded-lg border border-pitflix-card px-2.5 py-2 text-pitflix-muted hover:text-white"
                    aria-label={showOsKey ? "Hide key" : "Show key"}
                    onClick={() => setShowOsKey((v) => !v)}
                  >
                    {showOsKey ? <EyeOff className="h-4 w-4" /> : <Eye className="h-4 w-4" />}
                  </button>
                </div>
                <div className="mt-2 flex flex-wrap gap-2">
                  <button
                    type="button"
                    disabled={osVerifyBusy}
                    className="rounded-lg border border-pitflix-card px-3 py-1.5 text-[11px] text-white hover:border-pitflix-primary/50 disabled:opacity-50"
                    onClick={() => {
                      setApiKeyMsg(null);
                      const k = osKeyInput.trim();
                      if (!k) {
                        setApiKeyMsg("Type an OpenSubtitles key to verify.");
                        return;
                      }
                      setOsVerifyBusy(true);
                      void verifyOpenSubtitlesKey(k)
                        .then((r) =>
                          setApiKeyMsg(
                            r.valid ? "OpenSubtitles: key is valid." : `OpenSubtitles: ${r.error ?? "invalid"}`,
                          ),
                        )
                        .catch(() => setApiKeyMsg("OpenSubtitles verify failed."))
                        .finally(() => setOsVerifyBusy(false));
                    }}
                  >
                    {osVerifyBusy ? "Verifying…" : "Verify"}
                  </button>
                </div>
              </div>
              <button
                type="button"
                disabled={apiKeyBusy}
                className="w-full rounded-lg bg-pitflix-primary py-2 text-xs font-semibold text-white hover:bg-pitflix-light disabled:opacity-50"
                onClick={() => {
                  setApiKeyMsg(null);
                  if (!tmdbKeyInput.trim() && !osKeyInput.trim()) {
                    setApiKeyMsg("Enter at least one key to save, or use Verify only.");
                    return;
                  }
                  setApiKeyBusy(true);
                  void saveSettings({
                    ...(tmdbKeyInput.trim() ? { tmdbApiKey: tmdbKeyInput.trim() } : {}),
                    ...(osKeyInput.trim() ? { openSubtitlesApiKey: osKeyInput.trim() } : {}),
                  })
                    .then(() => {
                      setApiKeyMsg("Saved.");
                      setTmdbKeyInput("");
                      setOsKeyInput("");
                      refetchSettings();
                    })
                    .catch(() => setApiKeyMsg("Save failed."))
                    .finally(() => setApiKeyBusy(false));
                }}
              >
                {apiKeyBusy ? "Saving…" : "Save keys"}
              </button>
              {apiKeyMsg ? <p className="text-[11px] text-pitflix-muted">{apiKeyMsg}</p> : null}
            </div>
          </section>
        </div>

        <div className={cn(settingsTab !== "maintenance" && "hidden", "space-y-3")}>
          <section
            id="settings-maintenance"
            className="rounded-xl border border-white/8 bg-pitflix-surface/35 p-4 shadow-md shadow-black/20"
          >
            <h2 className="mb-3 text-xs font-semibold uppercase tracking-wide text-pitflix-muted">Maintenance</h2>
            <div className="grid grid-cols-2 gap-2">
              <button
                type="button"
                disabled={scanBusy}
                className="h-10 rounded-lg bg-pitflix-primary text-xs font-semibold text-white hover:bg-pitflix-light disabled:opacity-50"
                onClick={() => {
                  setScanMessage(null);
                  if ((data?.libraryPaths ?? []).length === 0) {
                    setScanMessage("Add at least one library folder before scanning.");
                    return;
                  }
                  setScanBusy(true);
                  void startScan({ folders: [] })
                    .then(() => {
                      setScanMessage("Scan started. New files will be added; files already matched are skipped.");
                      void qc.invalidateQueries({ queryKey: ["scanProgress"] });
                    })
                    .catch((err) => {
                      console.error("Scan failed:", err);
                      setScanMessage(formatScanOrApiError(err));
                    })
                    .finally(() => setScanBusy(false));
                }}
              >
                🔄 Scan Library
              </button>
              <button
                type="button"
                disabled={artworkBusy}
                className="h-10 rounded-lg border border-pitflix-primary/40 bg-pitflix-bg text-xs font-medium text-white hover:bg-pitflix-primary/15 disabled:opacity-50"
                onClick={() => {
                  setArtworkMessage(null);
                  setArtworkBusy(true);
                  void refreshLibraryArtwork()
                    .then((r) => {
                      setArtworkMessage(
                        `Artwork: ${r.movies} movies, ${r.shows} series${r.failures > 0 ? ` (${r.failures} issues)` : ""}.`,
                      );
                      void qc.invalidateQueries({ queryKey: ["movies"] });
                      void qc.invalidateQueries({ queryKey: ["series"] });
                      void qc.invalidateQueries({ queryKey: ["home-movies"] });
                      void qc.invalidateQueries({ queryKey: ["home-series"] });
                      void qc.invalidateQueries({ queryKey: ["history"] });
                      void qc.invalidateQueries({ queryKey: ["home-history"] });
                      void qc.invalidateQueries({ queryKey: ["home-top-rated"] });
                      void qc.invalidateQueries({ queryKey: ["home-arabic"] });
                      void qc.invalidateQueries({ queryKey: ["home-binge"] });
                      void qc.invalidateQueries({ queryKey: ["home-movie-night"] });
                      void qc.invalidateQueries({ queryKey: ["home-layout"] });
                      void qc.invalidateQueries({ queryKey: ["home-featured-fallback"] });
                      void qc.invalidateQueries({ predicate: (q) => q.queryKey[0] === "home-section" });
                    })
                    .catch(() => setArtworkMessage("Refresh failed."))
                    .finally(() => setArtworkBusy(false));
                }}
              >
                🎨 Refresh Artwork
              </button>
              <div className="col-span-2 rounded-lg border border-blue-500/20 bg-blue-950/15 px-3 py-2.5">
                <p className="mb-1.5 text-[10px] font-semibold uppercase tracking-wide text-pitflix-muted">
                  Trailers
                </p>
                <button
                  type="button"
                  disabled={trailerIngestionBusy}
                  className="w-full rounded-lg border border-blue-500/35 bg-pitflix-bg text-xs font-medium text-blue-100 hover:bg-blue-500/15 disabled:opacity-50"
                  onClick={() => {
                    setTrailerIngestionMsg(null);
                    setTrailerIngestionBusy(true);
                    void runTrailerIngestion()
                      .then(() => {
                        setTrailerIngestionMsg("Trailer ingestion started. Check Trailers page in a moment.");
                        void qc.invalidateQueries({
                          predicate: (q) => q.queryKey[0] === "trailers" || q.queryKey[0] === "home",
                        });
                      })
                      .catch((err) => {
                        setTrailerIngestionMsg(formatScanOrApiError(err));
                      })
                      .finally(() => setTrailerIngestionBusy(false));
                  }}
                >
                  {trailerIngestionBusy ? "Ingesting…" : "🎬 Run Trailer Ingestion"}
                </button>
                {trailerIngestionMsg ? (
                  <p className="mt-2 text-[11px] leading-snug text-blue-100">{trailerIngestionMsg}</p>
                ) : null}
              </div>
              <div className="col-span-2 rounded-lg border border-violet-500/20 bg-violet-950/15 px-3 py-2.5">
                <p className="mb-1.5 text-[10px] font-semibold uppercase tracking-wide text-pitflix-muted">
                  Ratings (persisted)
                </p>
                <input
                  type="password"
                  autoComplete="off"
                  placeholder="Server maintenance key (only if configured in appsettings)"
                  value={ratingsMaintKey}
                  onChange={(e) => setRatingsMaintKey(e.target.value)}
                  className="mb-2 w-full rounded-md border border-white/10 bg-black/30 px-2 py-1.5 text-[11px] text-white placeholder:text-pitflix-muted"
                />
                <div className="grid grid-cols-2 gap-2">
                  <button
                    type="button"
                    disabled={ratingsBackfillBusy}
                    className="h-10 rounded-lg border border-violet-400/35 bg-pitflix-bg text-xs font-medium text-violet-100 hover:bg-violet-500/15 disabled:opacity-50"
                    onClick={() => {
                      setRatingsMaintMsg(null);
                      setRatingsBackfillBusy(true);
                      void queueRatingsLibraryBackfill({
                        limit: 500,
                        maintenanceKey: ratingsMaintKey.trim() || undefined,
                      })
                        .then((r) => {
                          setRatingsMaintMsg(
                            `Queued ${r.accepted} jobs (${r.movies} movies + ${r.shows} series, cap ${r.cap}). Processing runs in the background.`,
                          );
                          void qc.invalidateQueries({
                            predicate: (q) => q.queryKey[0] === "ratings-display",
                          });
                        })
                        .catch((err) => {
                          if (axios.isAxiosError(err) && err.response?.status === 401) {
                            setRatingsMaintMsg("Unauthorized — add the server ratings maintenance key if one is set.");
                          } else {
                            setRatingsMaintMsg(formatScanOrApiError(err));
                          }
                        })
                        .finally(() => setRatingsBackfillBusy(false));
                    }}
                  >
                    {ratingsBackfillBusy ? "Queuing…" : "📊 Queue library ratings"}
                  </button>
                  <button
                    type="button"
                    disabled={ratingsStaleBusy}
                    className="h-10 rounded-lg border border-violet-400/25 bg-pitflix-bg text-xs font-medium text-violet-100/95 hover:bg-violet-500/12 disabled:opacity-50"
                    onClick={() => {
                      setRatingsMaintMsg(null);
                      setRatingsStaleBusy(true);
                      void queueRatingsStaleSweep(ratingsMaintKey.trim() || undefined)
                        .then((r) => {
                          setRatingsMaintMsg(
                            r.queued === "stale_sweep"
                              ? "Stale ratings refresh queued (background)."
                              : "Request sent.",
                          );
                          void qc.invalidateQueries({
                            predicate: (q) => q.queryKey[0] === "ratings-display",
                          });
                        })
                        .catch((err) => {
                          if (axios.isAxiosError(err) && err.response?.status === 401) {
                            setRatingsMaintMsg("Unauthorized — add the server ratings maintenance key if one is set.");
                          } else {
                            setRatingsMaintMsg(formatScanOrApiError(err));
                          }
                        })
                        .finally(() => setRatingsStaleBusy(false));
                    }}
                  >
                    {ratingsStaleBusy ? "Queuing…" : "♻️ Queue stale refresh"}
                  </button>
                </div>
                {ratingsMaintMsg ? (
                  <p className="mt-2 text-[11px] leading-snug text-pitflix-subtle">{ratingsMaintMsg}</p>
                ) : null}
              </div>
              <button
                type="button"
                disabled={cleanupBusy}
                className="h-10 rounded-lg border border-pitflix-card bg-pitflix-bg text-xs font-medium text-white hover:border-pitflix-primary/40 disabled:opacity-50"
                onClick={() => {
                  setCleanupMessage(null);
                  setCleanupBusy(true);
                  void cleanupLibrary()
                    .then((r) => {
                      setCleanupMessage(
                        `Removed ${r.removedShows} shows, ${r.removedMovies} movies, ${r.removedEpisodes} episodes.`,
                      );
                      void qc.invalidateQueries({ queryKey: ["stats"] });
                      void qc.invalidateQueries({ queryKey: ["settings"] });
                      void qc.invalidateQueries({ queryKey: ["movies"] });
                      void qc.invalidateQueries({ queryKey: ["series"] });
                      void qc.invalidateQueries({ queryKey: ["home-history"] });
                      void qc.invalidateQueries({ queryKey: ["home-top-rated"] });
                      void qc.invalidateQueries({ queryKey: ["home-arabic"] });
                      void qc.invalidateQueries({ queryKey: ["home-binge"] });
                      void qc.invalidateQueries({ queryKey: ["home-movie-night"] });
                      void qc.invalidateQueries({ queryKey: ["home-layout"] });
                      void qc.invalidateQueries({ queryKey: ["home-featured-fallback"] });
                      void qc.invalidateQueries({ predicate: (q) => q.queryKey[0] === "home-section" });
                    })
                    .catch(() => setCleanupMessage("Cleanup failed."))
                    .finally(() => setCleanupBusy(false));
                }}
              >
                🧹 Clean Up
              </button>
              <button
                type="button"
                disabled={cleanupBusy}
                className="h-10 rounded-lg border border-amber-500/35 bg-pitflix-bg text-xs font-medium text-amber-200 hover:bg-amber-500/10 disabled:opacity-50"
                onClick={() => {
                  setCleanupMessage(null);
                  setCleanupBusy(true);
                  void cleanupMissingFiles()
                    .then((r) => {
                      setCleanupMessage(r.message || 
                        `Cleaned up ${r.removedEpisodes} episodes, ${r.removedMovies} movies, ${r.removedShows} shows with missing files.`
                      );
                      void qc.invalidateQueries({ queryKey: ["stats"] });
                      void qc.invalidateQueries({ queryKey: ["settings"] });
                      void qc.invalidateQueries({ queryKey: ["movies"] });
                      void qc.invalidateQueries({ queryKey: ["series"] });
                      void qc.invalidateQueries({ queryKey: ["show"] });
                      void qc.invalidateQueries({ queryKey: ["movie"] });
                      void qc.invalidateQueries({ queryKey: ["home-history"] });
                      void qc.invalidateQueries({ queryKey: ["home-top-rated"] });
                      void qc.invalidateQueries({ queryKey: ["home-arabic"] });
                      void qc.invalidateQueries({ queryKey: ["home-binge"] });
                      void qc.invalidateQueries({ queryKey: ["home-movie-night"] });
                      void qc.invalidateQueries({ queryKey: ["home-layout"] });
                      void qc.invalidateQueries({ queryKey: ["home-featured-fallback"] });
                      void qc.invalidateQueries({ predicate: (q) => q.queryKey[0] === "home-section" });
                    })
                    .catch(() => setCleanupMessage("Cleanup of missing files failed."))
                    .finally(() => setCleanupBusy(false));
                }}
              >
                🗂️ Clean Missing Files
              </button>
              <button
                type="button"
                className="h-10 rounded-lg border border-red-500/35 bg-pitflix-bg text-xs font-medium text-red-200 hover:bg-red-500/10"
                onClick={() => {
                  setRemoveOpen(true);
                  setRemoveQuery("");
                  setRemoveBrowseKind(null);
                  setSearchHits(null);
                }}
              >
                🗑️ Remove Title
              </button>
              <button
                type="button"
                className="h-10 rounded-lg border border-pitflix-card bg-pitflix-bg text-xs text-white hover:border-pitflix-primary/40"
                onClick={() => {
                  setMaintMessage(null);
                  void clearImageCache()
                    .then((r) => setMaintMessage(r.message))
                    .catch(() => setMaintMessage("Cache clear failed."));
                }}
              >
                💾 Clear Cache
              </button>
              <button
                type="button"
                className="h-10 rounded-lg border border-amber-500/30 bg-pitflix-bg text-xs text-amber-100 hover:bg-amber-500/10"
                onClick={() => setResetDbInfoOpen(true)}
              >
                🔁 Reset DB
              </button>
              <div className="col-span-2 flex flex-col gap-2">
                <div className="flex gap-2">
                  <button
                    type="button"
                    disabled={prefetchBusy}
                    className="h-10 min-w-0 flex-1 rounded-lg border border-emerald-600/35 bg-pitflix-bg text-xs font-medium text-emerald-100 hover:bg-emerald-600/10 disabled:opacity-50"
                    onClick={() => {
                      prefetchAbortRef.current?.abort();
                      const ac = new AbortController();
                      prefetchAbortRef.current = ac;
                      setPrefetchMessage(null);
                      setPrefetchPct(0);
                      setPrefetchLiveLine("");
                      setPrefetchLog([]);
                      setPrefetchBusy(true);
                      let moviesTotal = 0;
                      let seriesTotal = 0;
                      const pushLog = (s: string) =>
                        setPrefetchLog((prev) => [...prev.slice(-60), s].slice(-60));
                      void prefetchLibraryMetadataStream(
                        (ev) => {
                          if (ev.phase === "start") {
                            moviesTotal = ev.moviesTotal;
                            seriesTotal = ev.seriesTotal;
                            setPrefetchLiveLine(
                              `Starting: ${ev.moviesTotal} movies, ${ev.seriesTotal} series…`,
                            );
                            return;
                          }
                          if (ev.phase === "movie") {
                            const tot = moviesTotal + seriesTotal;
                            setPrefetchPct(tot > 0 ? Math.min(100, (ev.index / tot) * 100) : 0);
                            const st = `${ev.ok ? "OK" : "Failed"} — ${ev.title ?? `#${ev.libraryId}`}`;
                            setPrefetchLiveLine(`Movie ${ev.index}/${ev.itemTotal}: ${st}`);
                            pushLog(`Movie ${ev.index}/${ev.itemTotal}: ${ev.title ?? ev.libraryId} — ${ev.ok ? "OK" : ev.error ?? "fail"}`);
                            return;
                          }
                          if (ev.phase === "series") {
                            const tot = moviesTotal + seriesTotal;
                            setPrefetchPct(
                              tot > 0
                                ? Math.min(100, ((moviesTotal + ev.index) / tot) * 100)
                                : 0,
                            );
                            const st = `${ev.ok ? "OK" : "Failed"} — ${ev.title ?? `#${ev.libraryId}`}`;
                            setPrefetchLiveLine(`Series ${ev.index}/${ev.itemTotal}: ${st}`);
                            pushLog(`Series ${ev.index}/${ev.itemTotal}: ${ev.title ?? ev.libraryId} — ${ev.ok ? "OK" : ev.error ?? "fail"}`);
                            return;
                          }
                          if (ev.phase === "done") {
                            setPrefetchPct(100);
                            const nErr = ev.errors?.length ?? 0;
                            setPrefetchMessage(
                              `Finished: ${ev.moviesOk} movies, ${ev.seriesOk} series cached.${nErr > 0 ? ` ${nErr} title(s) had errors.` : ""}`,
                            );
                            setPrefetchLiveLine("");
                            void qc.invalidateQueries({ queryKey: ["movie"] });
                            void qc.invalidateQueries({ queryKey: ["show"] });
                            void qc.invalidateQueries({ queryKey: ["movies"] });
                            void qc.invalidateQueries({ queryKey: ["series"] });
                          }
                        },
                        { signal: ac.signal },
                      )
                        .catch((err: unknown) => {
                          if (err instanceof Error && err.name === "AbortError") {
                            setPrefetchMessage("Pre-download cancelled.");
                            setPrefetchLiveLine("");
                            return;
                          }
                          setPrefetchMessage(
                            err instanceof Error ? err.message : "Pre-download failed (network or API).",
                          );
                        })
                        .finally(() => {
                          setPrefetchBusy(false);
                          prefetchAbortRef.current = null;
                        });
                    }}
                  >
                    {prefetchBusy ? "Downloading metadata…" : "📥 Pre-download metadata (entire library)"}
                  </button>
                  {prefetchBusy ? (
                    <button
                      type="button"
                      className="h-10 shrink-0 rounded-lg border border-zinc-600 px-3 text-xs font-medium text-zinc-200 hover:bg-zinc-800"
                      onClick={() => prefetchAbortRef.current?.abort()}
                    >
                      Stop
                    </button>
                  ) : null}
                </div>
                {prefetchBusy ? (
                  <div className="rounded-lg border border-pitflix-card/60 bg-pitflix-bg/80 p-2">
                    <div className="h-1.5 w-full overflow-hidden rounded-full bg-zinc-800">
                      <div
                        className="h-full rounded-full bg-emerald-600 transition-[width] duration-200"
                        style={{ width: `${Math.round(prefetchPct)}%` }}
                      />
                    </div>
                    {prefetchLiveLine ? (
                      <p className="mt-2 text-[11px] leading-snug text-pitflix-muted">{prefetchLiveLine}</p>
                    ) : null}
                    {prefetchLog.length > 0 ? (
                      <div className="mt-2 max-h-28 overflow-y-auto rounded border border-pitflix-card/40 bg-black/20 px-2 py-1 font-mono text-[10px] text-zinc-400">
                        {prefetchLog.slice(-12).map((line, i) => (
                          <div key={`${prefetchLog.length}-${i}`} className="truncate">
                            {line}
                          </div>
                        ))}
                      </div>
                    ) : null}
                  </div>
                ) : null}
              </div>
            </div>
            <p className="mt-2 text-[10px] leading-relaxed text-pitflix-subtle">
              Scan Library looks for new video files in your saved folders; items you already matched are skipped. While
              Pitflix is open, the API also re-scans about once per hour to pick up additions automatically.
            </p>
            {scanMessage ? <p className="mt-2 text-[11px] text-pitflix-muted">{scanMessage}</p> : null}
            {artworkMessage ? <p className="mt-2 text-[11px] text-pitflix-muted">{artworkMessage}</p> : null}
            {prefetchMessage ? <p className="mt-2 text-[11px] text-pitflix-muted">{prefetchMessage}</p> : null}
            {cleanupMessage ? <p className="mt-2 text-[11px] text-pitflix-muted">{cleanupMessage}</p> : null}
            {maintMessage ? <p className="mt-2 text-[11px] text-pitflix-muted">{maintMessage}</p> : null}
          </section>
        </div>
      </div>

      {removeOpen ? (
        <div className="mt-6 rounded-xl border border-pitflix-card/50 bg-pitflix-card p-4">
          <h3 className="text-sm font-semibold text-white">Remove a title</h3>
          <p className="mt-1 text-[11px] text-pitflix-subtle">
            Open a poster grid for movies or series, or search by any part of the title (capitalization doesn&apos;t
            matter).
          </p>
          <div className="mt-2 flex flex-wrap gap-2">
            <button
              type="button"
              className="rounded-lg border border-pitflix-card bg-pitflix-bg px-3 py-1.5 text-[11px] text-white hover:border-pitflix-primary/50"
              onClick={() => {
                setRemoveQuery("");
                setRemoveBrowseKind("movies");
              }}
            >
              Browse movies
            </button>
            <button
              type="button"
              className="rounded-lg border border-pitflix-card bg-pitflix-bg px-3 py-1.5 text-[11px] text-white hover:border-pitflix-primary/50"
              onClick={() => {
                setRemoveQuery("");
                setRemoveBrowseKind("series");
              }}
            >
              Browse series
            </button>
          </div>
          <input
            autoFocus
            value={removeQuery}
            onChange={(e) => {
              setRemoveQuery(e.target.value);
              setRemoveBrowseKind(null);
            }}
            placeholder="Or search (2+ chars)…"
            className="mt-2 w-full rounded-lg border border-pitflix-card bg-pitflix-bg px-3 py-2 text-sm text-white focus:border-pitflix-primary focus:outline-none"
          />
          {combinedHits.length > 0 ? (
            <div className="mt-3 grid max-h-[min(55vh,480px)] grid-cols-1 gap-2 overflow-y-auto pr-1 sm:grid-cols-2">
              {combinedHits.map((row) => (
                <div
                  key={`${row.kind}-${row.id}`}
                  className="flex items-center justify-between gap-3 rounded-xl border border-pitflix-card bg-pitflix-bg/80 px-3 py-2.5"
                >
                  <div className="min-w-0">
                    <p className="text-[10px] font-semibold uppercase tracking-wide text-pitflix-primary">
                      {row.kind === "movie" ? "Movie" : "Series"}
                    </p>
                    <p className="truncate text-sm font-medium text-white">{row.title}</p>
                    {row.year != null ? <p className="text-xs text-pitflix-subtle">{row.year}</p> : null}
                  </div>
                  <button
                    type="button"
                    className="shrink-0 rounded-lg bg-red-600/85 px-3 py-1.5 text-xs font-semibold text-white hover:bg-red-500"
                    onClick={() => setPendingRemove(libraryRowToPick(row))}
                  >
                    Remove…
                  </button>
                </div>
              ))}
            </div>
          ) : removeQ.trim().length >= 2 ? (
            <p className="mt-2 text-xs text-pitflix-subtle">No matches.</p>
          ) : null}
          <button
            type="button"
            className="mt-3 text-xs text-pitflix-muted hover:text-white"
            onClick={() => {
              setRemoveOpen(false);
              setRemoveBrowseKind(null);
            }}
          >
            Close
          </button>
        </div>
      ) : null}

      <RemoveTitleBrowseModal
        open={removeBrowseKind != null}
        kind={removeBrowseKind ?? "movies"}
        onClose={() => setRemoveBrowseKind(null)}
        onRequestRemove={(row) => setPendingRemove(row)}
        refreshToken={removeBrowseRefresh}
      />

      <ConfirmDialog
        open={pendingRemove != null}
        title="Remove from library?"
        description={
          pendingRemove
            ? `Remove “${pendingRemove.title}” from your library? This cannot be undone.`
            : ""
        }
        confirmLabel="Remove"
        cancelLabel="Cancel"
        variant="danger"
        onConfirm={executeConfirmedRemove}
        onCancel={() => setPendingRemove(null)}
      />

      <ConfirmDialog
        open={resetDbInfoOpen}
        confirmOnly
        title="Reset database"
        description="Quit Pitflix.API, then delete the Pitflix SQLite file from your AppData Pitflix folder. Restart the API to recreate an empty library."
        confirmLabel="Got it"
        variant="default"
        onConfirm={() => setResetDbInfoOpen(false)}
        onCancel={() => setResetDbInfoOpen(false)}
      />

      <footer className="mt-20 border-t border-white/10 pt-10 text-center">
        <p className="text-sm font-medium tracking-wide text-pitflix-muted">Crafted with care</p>
        <p className="mt-2 text-base font-semibold text-white/95">
          Abdallah Saeed <span aria-hidden="true">🍕</span>
        </p>
        <p className="mt-1 text-xs text-pitflix-subtle">Pitflix · premium library experience</p>
      </footer>

      {toast ? (
        <div
          className="fixed bottom-5 left-1/2 z-[235] max-w-md -translate-x-1/2 rounded-xl border border-pitflix-primary/35 bg-pitflix-surface px-4 py-3 text-sm text-white shadow-lg shadow-black/50"
          role="status"
        >
          {toast}
        </div>
      ) : null}
    </div>
  );
}
