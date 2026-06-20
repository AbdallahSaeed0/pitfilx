import { invoke, isTauri } from "@tauri-apps/api/core";
import { useQuery, useQueryClient } from "@tanstack/react-query";
import { Link } from "react-router-dom";
import axios from "axios";
import { BarChart3, Bell, Eye, EyeOff, FolderMinus, FolderOpen, HelpCircle, Key, MonitorPlay, Play, RefreshCw, Shield, Wrench, Zap } from "lucide-react";
import { useEffect, useMemo, useState } from "react";
import { open } from "@tauri-apps/plugin-dialog";
import {
  cleanupLibrary,
  cleanupMissingFiles,
  type LibraryTitleRow,
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
  verifyMdblistKey,
  verifyOpenSubtitlesKey,
  verifySubDlKey,
  verifyTmdbKey,
  verifyTvdbKey,
} from "../api/settings";
import {
  queueRatingsLibraryBackfill,
  queueRatingsStaleSweep,
} from "../api/ratings";
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
import { useBackgroundTasks } from "../context/BackgroundTasksContext";
import { useAppPrefsStore } from "../store/appPrefsStore";

type SettingsTab = "library" | "stats" | "providers" | "playback" | "app" | "maintenance" | "help";

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
  const {
    awardsStatus,
    libraryPrefetch,
    requestAwardsPreload,
    requestAwardsClear,
    startLibraryMetadataPrefetch,
    stopLibraryMetadataPrefetch,
    ratingsQueueStatus,
    ratingsQueueWatching,
    ratingsQueueFetched,
    ratingsQueueFetching,
    startWatchingRatingsQueue,
    refetchRatingsQueue,
  } = useBackgroundTasks();
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
  // useBuiltinPlayer + builtinBusy state removed with the toggle UI.
  const [libraryScanDesktopToasts, setLibraryScanDesktopToasts] = useState(true);
  const [scanToastsBusy, setScanToastsBusy] = useState(false);
  const [removeOpen, setRemoveOpen] = useState(false);
  const [removeBrowseKind, setRemoveBrowseKind] = useState<null | "movies" | "series">(null);
  const [pendingRemove, setPendingRemove] = useState<RemoveTitlePick | null>(null);
  const [resetDbInfoOpen, setResetDbInfoOpen] = useState(false);
  const [awardsClearConfirmOpen, setAwardsClearConfirmOpen] = useState(false);
  const [removeQuery, setRemoveQuery] = useState("");
  const removeQ = useDebounce(removeQuery, 300);
  const [searchHits, setSearchHits] = useState<{ movies: LibraryTitleRow[]; shows: LibraryTitleRow[] } | null>(
    null,
  );
  const [tmdbKeyInput, setTmdbKeyInput] = useState("");
  const [osKeyInput, setOsKeyInput] = useState("");
  const [sdlKeyInput, setSdlKeyInput] = useState("");
  const [mdblistKeyInput, setMdblistKeyInput] = useState("");
  const [tvdbKeyInput, setTvdbKeyInput] = useState("");
  const [showTmdbKey, setShowTmdbKey] = useState(false);
  const [showOsKey, setShowOsKey] = useState(false);
  const [showSdlKey, setShowSdlKey] = useState(false);
  const [showMdblistKey, setShowMdblistKey] = useState(false);
  const [showTvdbKey, setShowTvdbKey] = useState(false);
  const [apiKeyMsg, setApiKeyMsg] = useState<string | null>(null);
  const [apiKeyBusy, setApiKeyBusy] = useState(false);
  const [tmdbVerifyBusy, setTmdbVerifyBusy] = useState(false);
  const [osVerifyBusy, setOsVerifyBusy] = useState(false);
  const [sdlVerifyBusy, setSdlVerifyBusy] = useState(false);
  const [mdblistVerifyBusy, setMdblistVerifyBusy] = useState(false);
  const [tvdbVerifyBusy, setTvdbVerifyBusy] = useState(false);
  const [addlSourcesMsg, setAddlSourcesMsg] = useState<string | null>(null);
  const [addlSourcesOpen, setAddlSourcesOpen] = useState(false);
  const [autostartBusy, setAutostartBusy] = useState(false);
  const [autostartMessage, setAutostartMessage] = useState<string | null>(null);
  const [settingsTab, setSettingsTab] = useState<SettingsTab>("library");
  const offlineMode = useAppPrefsStore((s) => s.offlineMode);
  const setOfflineMode = useAppPrefsStore((s) => s.setOfflineMode);
  const defaultSpoilerProtection = useAppPrefsStore((s) => s.defaultSpoilerProtection);
  const setDefaultSpoilerProtection = useAppPrefsStore((s) => s.setDefaultSpoilerProtection);

  const { data: autostartStatus } = useQuery({
    queryKey: ["autostart-status"],
    queryFn: () => getDesktopAutostartState(),
    staleTime: 30_000,
  });

  useEffect(() => {
    if (!data || playerFieldTouched) return;
    setMediaPlayerPath(String((data as { mediaPlayerPath?: string }).mediaPlayerPath ?? ""));
  }, [data, playerFieldTouched]);

  // (formerly: sync useBuiltinPlayer from settings — toggle UI removed.)

  useEffect(() => {
    if (!data) return;
    const t = (data as { libraryScanDesktopToasts?: boolean }).libraryScanDesktopToasts;
    setLibraryScanDesktopToasts(t !== false);
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
              : "Cannot reach Pitflix.API. Run the API (dotnet run in Pitflix.API), then try again. If the API uses another port, set VITE_API_ORIGIN in .env (e.g. http://127.0.0.1:5280).";
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
            "Cannot reach Pitflix.API. Run the API on Windows, then try again. Set VITE_API_ORIGIN if the port is not 5280.";
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
    <div className="mx-auto max-w-4xl space-y-5 p-4 md:p-8">
      <header className="border-b border-white/[0.08] pb-6">
        <h1 className="text-3xl font-bold tracking-tight text-white">Settings</h1>
        <p className="mt-2 max-w-xl text-sm leading-relaxed text-pitflix-muted">
          Manage your library, integrations, playback, and app preferences.
        </p>
      </header>

      <nav className="sticky top-2 z-20 flex flex-wrap gap-1.5 rounded-2xl border border-white/[0.12] bg-pitflix-bg/95 px-2.5 py-2.5 shadow-xl shadow-black/40 backdrop-blur-md">
        {(
          [
            ["library",     "Library",      FolderOpen,  "text-violet-400",  "bg-violet-500/15 text-violet-200  border-violet-500/30"],
            ["stats",       "Stats",        BarChart3,   "text-sky-400",     "bg-sky-500/15    text-sky-200     border-sky-500/30"],
            ["providers",   "API keys",     Key,         "text-amber-400",   "bg-amber-500/15  text-amber-200   border-amber-500/30"],
            ["playback",    "Playback",     Play,        "text-green-400",   "bg-green-500/15  text-green-200   border-green-500/30"],
            ["app",         "App",          RefreshCw,   "text-orange-400",  "bg-orange-500/15 text-orange-200  border-orange-500/30"],
            ["maintenance", "Maintenance",  Wrench,      "text-rose-400",    "bg-rose-500/15   text-rose-200    border-rose-500/30"],
            ["help",        "Help",         HelpCircle,  "text-teal-400",    "bg-teal-500/15   text-teal-200    border-teal-500/30"],
          ] as const
        ).map(([id, label, Icon, iconClass, activeClass]) => (
          <button
            key={id}
            type="button"
            onClick={() => setSettingsTab(id)}
            className={cn(
              "inline-flex items-center gap-1.5 rounded-xl border px-3.5 py-2 text-[11px] font-semibold transition-all duration-200 sm:text-xs",
              settingsTab === id
                ? `${activeClass} shadow-md`
                : "border-transparent text-pitflix-muted hover:bg-white/[0.07] hover:text-white",
            )}
          >
            <Icon className={cn("h-3.5 w-3.5 shrink-0", settingsTab === id ? "" : iconClass)} strokeWidth={2} />
            {label}
          </button>
        ))}
      </nav>

      <div>
        <ApiHealthCheck />
      </div>

      <div className="space-y-4">
        <div className={cn(settingsTab !== "library" && "hidden", "space-y-4")}>
          <section
            id="settings-library"
            className="rounded-2xl border border-white/[0.09] bg-pitflix-surface/50 p-6 shadow-xl shadow-black/30 backdrop-blur-sm"
          >
            <div className="mb-4 flex items-center justify-between gap-2 border-b border-white/[0.09] pb-3">
              <h2 className="flex items-center gap-2 text-[15px] font-bold text-white">
                <FolderOpen className="h-4 w-4 text-violet-400" strokeWidth={2} />
                Library folders
              </h2>
              <button
                type="button"
                disabled={pathBusy}
                className="shrink-0 rounded-xl bg-pitflix-primary px-3.5 py-2 text-xs font-semibold text-white transition-all hover:bg-pitflix-light disabled:opacity-50"
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
                    className="group flex items-center justify-between gap-2 rounded-xl border border-white/[0.08] bg-pitflix-bg/60 px-3 py-2 transition-colors hover:border-pitflix-primary/25 hover:bg-pitflix-primary/[0.04]"
                  >
                    <p className="truncate text-[11px] text-white" title={p}>
                      {p}
                    </p>
                    <button
                      type="button"
                      className="shrink-0 text-[10px] text-pitflix-subtle transition-colors hover:text-red-400"
                      onClick={() => {
                        setPathBusy(true);
                        void removeLibraryPath(p)
                          .then(() => {
                            void refetchSettings();
                          })
                          .catch(() => setToast("Could not remove library folder."))
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
                className="min-w-0 flex-1 rounded-lg border border-pitflix-card bg-pitflix-bg px-2.5 py-2 text-xs text-white placeholder:text-pitflix-subtle focus:border-pitflix-primary/70 focus:outline-none focus:ring-2 focus:ring-pitflix-primary/15"
              />
              <button
                type="button"
                onClick={() => void handleAddManual()}
                disabled={pathBusy}
                className="shrink-0 rounded-xl bg-pitflix-primary px-3.5 py-2 text-xs font-semibold text-white transition-all hover:bg-pitflix-light disabled:opacity-50"
              >
                Add
              </button>
            </div>
            {libraryPickMessage ? <p className="mt-2 text-[11px] text-red-400/90">{libraryPickMessage}</p> : null}
          </section>

          <section className="rounded-2xl border border-white/[0.09] bg-pitflix-surface/50 p-6 shadow-xl shadow-black/30 backdrop-blur-sm">
            <div className="mb-4 flex items-center justify-between gap-2 border-b border-white/[0.09] pb-3">
              <h2 className="flex items-center gap-2 text-[15px] font-bold text-white">
                <Zap className="h-4 w-4 text-emerald-400" strokeWidth={2} />
                Auto-scan folders
              </h2>
              <button
                type="button"
                disabled={pinnedBusy}
                className="shrink-0 rounded-xl border border-pitflix-primary/40 bg-pitflix-bg px-3.5 py-2 text-xs font-semibold text-white transition-all hover:border-pitflix-primary/60 hover:bg-pitflix-primary/15 disabled:opacity-50"
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
                    className="group flex items-center justify-between gap-2 rounded-xl border border-white/[0.08] bg-pitflix-bg/60 px-3 py-2 transition-colors hover:border-pitflix-primary/25 hover:bg-pitflix-primary/[0.04]"
                  >
                    <p className="truncate text-[11px] text-white" title={p}>
                      {p}
                    </p>
                    <button
                      type="button"
                      className="shrink-0 text-[10px] text-pitflix-subtle transition-colors hover:text-red-400"
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
                className="min-w-0 flex-1 rounded-lg border border-pitflix-card bg-pitflix-bg px-2.5 py-2 text-xs text-white placeholder:text-pitflix-subtle focus:border-pitflix-primary/70 focus:outline-none focus:ring-2 focus:ring-pitflix-primary/15"
              />
              <button
                type="button"
                onClick={() => void handleAddPinnedManual()}
                disabled={pinnedBusy}
                className="shrink-0 rounded-xl border border-pitflix-primary/40 bg-pitflix-bg px-3.5 py-2 text-xs font-semibold text-white transition-all hover:border-pitflix-primary/60 hover:bg-pitflix-primary/15 disabled:opacity-50"
              >
                Add
              </button>
            </div>
            {pinnedPickMessage ? <p className="mt-2 text-[11px] text-red-400/90">{pinnedPickMessage}</p> : null}
          </section>

          <section className="rounded-2xl border border-white/[0.09] bg-pitflix-surface/50 p-6 shadow-xl shadow-black/30 backdrop-blur-sm">
            <h2 className="mb-4 flex items-center gap-2 border-b border-white/[0.09] pb-4 text-[15px] font-bold tracking-tight text-white">
              <Bell className="h-4 w-4 text-amber-400" strokeWidth={2} />
              Scan desktop toasts
            </h2>
            <p className="mt-1 text-[10px] leading-relaxed text-pitflix-subtle">
              When pinned folders or the hourly library pass indexes something, Pitflix can show a small notification
              (matched vs needs review). Turn this off if you don’t want those popups; scans still run in the background.
              Toasts show at most once per file path once it’s already in the scan log.
            </p>
            <label className="mt-4 flex cursor-pointer items-center gap-3 rounded-xl border border-white/[0.05] bg-white/[0.02] px-3 py-2.5 text-xs text-white transition-colors hover:bg-white/[0.04]">
              <input
                type="checkbox"
                checked={libraryScanDesktopToasts}
                disabled={scanToastsBusy}
                onChange={(e) => {
                  const next = e.target.checked;
                  setLibraryScanDesktopToasts(next);
                  setScanToastsBusy(true);
                  void saveSettings({ libraryScanDesktopToasts: next })
                    .then(() => refetchSettings())
                    .catch(() => setLibraryScanDesktopToasts(!next))
                    .finally(() => setScanToastsBusy(false));
                }}
                className="h-4 w-4 cursor-pointer rounded border-pitflix-card accent-pitflix-primary disabled:opacity-50"
              />
              Notify when background scan adds or updates a discovery
            </label>
          </section>

          <section className="rounded-2xl border border-white/[0.09] bg-pitflix-surface/50 p-6 shadow-xl shadow-black/30 backdrop-blur-sm">
            <div className="mb-4 flex items-center justify-between gap-2 border-b border-white/[0.09] pb-3">
              <h2 className="flex items-center gap-2 text-[15px] font-bold text-white">
                <FolderMinus className="h-4 w-4 text-rose-400" strokeWidth={2} />
                Excluded folders
              </h2>
              <button
                type="button"
                disabled={excludedBusy}
                className="shrink-0 rounded-xl border border-rose-500/40 bg-pitflix-bg px-3.5 py-2 text-xs font-semibold text-rose-200 transition-all hover:border-rose-500/60 hover:bg-rose-500/15 disabled:opacity-50"
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
                    className="group flex items-center justify-between gap-2 rounded-xl border border-white/[0.08] bg-pitflix-bg/60 px-3 py-2 transition-colors hover:border-pitflix-primary/25 hover:bg-pitflix-primary/[0.04]"
                  >
                    <p className="truncate text-[11px] text-white" title={p}>
                      {p}
                    </p>
                    <button
                      type="button"
                      className="shrink-0 text-[10px] text-pitflix-subtle transition-colors hover:text-red-400"
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
                className="min-w-0 flex-1 rounded-lg border border-pitflix-card bg-pitflix-bg px-2.5 py-2 text-xs text-white placeholder:text-pitflix-subtle focus:border-pitflix-primary/70 focus:outline-none focus:ring-2 focus:ring-pitflix-primary/15"
              />
              <button
                type="button"
                onClick={() => void handleAddExcludedManual()}
                disabled={excludedBusy}
                className="shrink-0 rounded-xl border border-red-500/40 bg-pitflix-bg px-3.5 py-2 text-xs font-semibold text-red-200 transition-all hover:border-red-500/60 hover:bg-red-500/15 disabled:opacity-50"
              >
                Add
              </button>
            </div>
            {excludedPickMessage ? <p className="mt-2 text-[11px] text-red-400/90">{excludedPickMessage}</p> : null}
          </section>
        </div>

        <div className={cn(settingsTab !== "playback" && "hidden", "space-y-4")}>
          {isTauri() ? (
            <>
            <section
              id="settings-builtin-player"
              className="rounded-2xl border border-white/[0.09] bg-pitflix-surface/50 p-6 shadow-xl shadow-black/30 backdrop-blur-sm"
            >
              <h2 className="mb-4 flex items-center gap-2 border-b border-white/[0.09] pb-4 text-[15px] font-bold tracking-tight text-white">
                <Play className="h-4 w-4 text-green-400" strokeWidth={2} />
                Built-in player
              </h2>
              <p className="mt-1 text-[10px] text-pitflix-subtle">
                Bundled mpv with Pitflix scripts. Pick where it renders below.
              </p>
              {/* Player-engine choice — two supported modes. */}
              <div className="mt-4">
                <label className="block text-xs font-medium text-white/80 mb-2">
                  Player engine
                </label>
                <select
                  className="h-9 w-full rounded-xl border border-white/10 bg-pitflix-bg px-3 text-xs text-white"
                  defaultValue={
                    (typeof localStorage !== "undefined" &&
                      localStorage.getItem("pitflix-player-engine")) ||
                    "libmpv-embedded"
                  }
                  onChange={(e) => {
                    try {
                      localStorage.setItem("pitflix-player-engine", e.target.value);
                    } catch {
                      /* ignore */
                    }
                  }}
                >
                  <option value="libmpv-embedded">Embedded inside Pitflix (recommended)</option>
                  <option value="pitflix">External window (mpv with scripts)</option>
                </select>
                <p className="mt-1.5 text-[10px] text-pitflix-subtle">
                  Effective on next play.
                </p>
              </div>
            </section>

            {/* ── Player test launcher ───────────────────────────────────── */}
            <section
              id="settings-player-launcher"
              className="rounded-2xl border border-white/[0.09] bg-pitflix-surface/50 p-6 shadow-xl shadow-black/30 backdrop-blur-sm"
            >
              <h2 className="mb-4 flex items-center gap-2 border-b border-white/[0.09] pb-4 text-[15px] font-bold tracking-tight text-white">
                <Play className="h-4 w-4 text-green-400" strokeWidth={2} />
                Player
              </h2>
              <button
                type="button"
                className="h-9 rounded-xl border border-pitflix-primary/40 bg-pitflix-bg px-3.5 text-xs font-medium text-white transition-all hover:border-pitflix-primary/60 hover:bg-pitflix-primary/15"
                onClick={() => { void invoke("player3_open", {}); }}
              >
                Launch Player (Test)
              </button>
              <p className="mt-2 text-[10px] text-pitflix-subtle">
                Requires an active playback session from /api/player/play
              </p>
            </section>
</>
          ) : null}
          <section
            id="settings-playback"
            className="rounded-2xl border border-white/[0.09] bg-pitflix-surface/50 p-6 shadow-xl shadow-black/30 backdrop-blur-sm"
          >
            <h2 className="mb-4 flex items-center gap-2 border-b border-white/[0.09] pb-4 text-[15px] font-bold tracking-tight text-white">
              <MonitorPlay className="h-4 w-4 text-green-400" strokeWidth={2} />
              External player
            </h2>
            <p className="mt-1 text-[10px] text-pitflix-subtle">
              PATH name or full .exe — resume uses VLC / mpv flags when possible.
            </p>
            <div className="mt-3 flex flex-wrap gap-2">
              <button
                type="button"
                disabled={playerBusy}
                className="h-9 rounded-xl border border-pitflix-primary/40 bg-pitflix-bg px-3.5 text-xs font-medium text-white transition-all hover:border-pitflix-primary/60 hover:bg-pitflix-primary/15 disabled:opacity-50"
                onClick={() => savePlayerPath("vlc", "VLC")}
              >
                VLC
              </button>
              <button
                type="button"
                disabled={playerBusy}
                className="h-9 rounded-xl border border-pitflix-primary/40 bg-pitflix-bg px-3.5 text-xs font-medium text-white transition-all hover:border-pitflix-primary/60 hover:bg-pitflix-primary/15 disabled:opacity-50"
                onClick={() => savePlayerPath("mpv", "mpv")}
              >
                MPV
              </button>
              {uniquePlayerCandidates.slice(0, 6).map(({ path, label }) => (
                <button
                  key={path}
                  type="button"
                  disabled={playerBusy}
                  className="h-9 max-w-[140px] truncate rounded-xl border border-white/[0.08] bg-pitflix-bg px-2 text-[11px] text-white transition-all hover:border-pitflix-primary/50 disabled:opacity-50"
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
                className="min-w-[120px] flex-1 rounded-lg border border-pitflix-card bg-pitflix-bg px-2.5 py-2 text-xs text-white focus:border-pitflix-primary/70 focus:outline-none focus:ring-2 focus:ring-pitflix-primary/15"
              />
              <button
                type="button"
                disabled={playerBusy}
                className="h-9 rounded-xl border border-white/[0.08] px-3 text-xs text-white transition-all hover:border-pitflix-primary/50 disabled:opacity-50"
                onClick={() => void handleBrowsePlayerExe()}
              >
                Browse
              </button>
              <button
                type="button"
                disabled={playerBusy}
                className="h-9 rounded-xl bg-pitflix-primary px-3.5 text-xs font-semibold text-white shadow-sm shadow-pitflix-primary/25 transition-all hover:bg-pitflix-light disabled:opacity-50"
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

        <div className={cn(settingsTab !== "app" && "hidden", "space-y-4")}>
          <section
            id="settings-app"
            className="rounded-2xl border border-white/[0.09] bg-pitflix-surface/50 p-6 shadow-xl shadow-black/30 backdrop-blur-sm"
          >
            <h2 className="mb-4 flex items-center gap-2 border-b border-white/[0.09] pb-4 text-[15px] font-bold tracking-tight text-white">
              <RefreshCw className="h-4 w-4 text-orange-400" strokeWidth={2} />
              Application
            </h2>
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

            <div className="mt-4 border-t border-white/5 pt-4 flex items-center justify-between gap-3">
              <div className="flex-1">
                <p className="text-xs font-medium text-white">Offline mode</p>
                <p className="mt-0.5 text-[10px] text-pitflix-subtle">
                  Disables all internet features — online streaming, trailers, and TMDB lookups. Local library still works.
                </p>
              </div>
              <button
                type="button"
                onClick={() => setOfflineMode(!offlineMode)}
                className={`relative inline-flex h-6 w-11 shrink-0 cursor-pointer rounded-full border-2 border-transparent transition-colors duration-200 ease-in-out focus:outline-none focus:ring-2 focus:ring-orange-500 focus:ring-offset-2 focus:ring-offset-pitflix-bg ${
                  offlineMode ? "bg-orange-500" : "bg-pitflix-card"
                }`}
                role="switch"
                aria-checked={offlineMode}
              >
                <span
                  className={`pointer-events-none inline-block h-5 w-5 transform rounded-full bg-white shadow ring-0 transition duration-200 ease-in-out ${
                    offlineMode ? "translate-x-5" : "translate-x-0"
                  }`}
                />
              </button>
            </div>

            <div className="mt-4 border-t border-white/5 pt-4 flex items-center justify-between gap-3">
              <div className="flex-1">
                <p className="flex items-center gap-1.5 text-xs font-medium text-white">
                  {defaultSpoilerProtection ? <EyeOff className="h-3.5 w-3.5 text-amber-400" /> : <Eye className="h-3.5 w-3.5 text-pitflix-muted" />}
                  Spoiler protection by default
                </p>
                <p className="mt-0.5 text-[10px] text-pitflix-subtle">
                  When on, episode pages open with titles, overviews, and thumbnails hidden. You can still toggle it off per page from the episodes toolbar.
                </p>
              </div>
              <button
                type="button"
                onClick={() => setDefaultSpoilerProtection(!defaultSpoilerProtection)}
                className={`relative inline-flex h-6 w-11 shrink-0 cursor-pointer rounded-full border-2 border-transparent transition-colors duration-200 ease-in-out focus:outline-none focus:ring-2 focus:ring-amber-500 focus:ring-offset-2 focus:ring-offset-pitflix-bg ${
                  defaultSpoilerProtection ? "bg-amber-500" : "bg-pitflix-card"
                }`}
                role="switch"
                aria-checked={defaultSpoilerProtection}
              >
                <span
                  className={`pointer-events-none inline-block h-5 w-5 transform rounded-full bg-white shadow ring-0 transition duration-200 ease-in-out ${
                    defaultSpoilerProtection ? "translate-x-5" : "translate-x-0"
                  }`}
                />
              </button>
            </div>
          </section>

          <div id="settings-updates">
            <AppUpdateSection />
          </div>
        </div>

        <div className={cn(settingsTab !== "stats" && "hidden", "space-y-4")}>
          <section
            id="settings-stats"
            className="rounded-2xl border border-white/[0.09] bg-pitflix-surface/50 p-6 shadow-xl shadow-black/30 backdrop-blur-sm"
          >
            <h2 className="mb-4 flex items-center gap-2 border-b border-white/[0.09] pb-4 text-[15px] font-bold tracking-tight text-white">
              <BarChart3 className="h-4 w-4 text-sky-400" strokeWidth={2} />
              Library stats
            </h2>
            <div className="grid grid-cols-3 gap-3">
              <div className="rounded-xl bg-gradient-to-br from-sky-950/60 to-pitflix-card p-4 text-center ring-1 ring-sky-500/10">
                <p className="text-2xl font-bold tabular-nums text-white md:text-3xl">{data?.matchedMovies ?? "—"}</p>
                <p className="mt-1 text-[11px] font-medium text-sky-300/70">Movies</p>
              </div>
              <div className="rounded-xl bg-gradient-to-br from-violet-950/60 to-pitflix-card p-4 text-center ring-1 ring-violet-500/10">
                <p className="text-2xl font-bold tabular-nums text-white md:text-3xl">{data?.matchedSeries ?? "—"}</p>
                <p className="mt-1 text-[11px] font-medium text-violet-300/70">Series</p>
              </div>
              <div className="rounded-xl bg-gradient-to-br from-amber-950/60 to-pitflix-card p-4 text-center ring-1 ring-amber-500/10">
                <p className="text-2xl font-bold tabular-nums text-white md:text-3xl">{data?.unmatchedCount ?? "—"}</p>
                <p className="mt-1 text-[11px] font-medium text-amber-300/70">Unmatched</p>
              </div>
            </div>
          </section>

          <section className="rounded-2xl border border-white/[0.09] bg-pitflix-surface/50 p-6 shadow-xl shadow-black/30 backdrop-blur-sm">
            <h2 className="mb-4 flex items-center gap-2 border-b border-white/[0.09] pb-4 text-[15px] font-bold tracking-tight text-white">
              <BarChart3 className="h-4 w-4 text-sky-400" strokeWidth={2} />
              Watch overview
            </h2>
            <p className="mb-3 text-[10px] text-pitflix-subtle">Matched library titles only.</p>
            <div className="grid grid-cols-3 gap-3 text-center">
              <div className="rounded-xl border border-white/[0.06] bg-pitflix-bg/80 py-3">
                <p className="text-lg font-bold text-white">{watchNotStarted}</p>
                <p className="mt-0.5 text-[10px] text-pitflix-muted">Not watched</p>
              </div>
              <div className="rounded-xl border border-amber-500/10 bg-amber-950/20 py-3">
                <p className="text-lg font-bold text-amber-100">{watchProgress}</p>
                <p className="mt-0.5 text-[10px] text-amber-300/60">In progress</p>
              </div>
              <div className="rounded-xl border border-emerald-500/10 bg-emerald-950/20 py-3">
                <p className="text-lg font-bold text-emerald-100">{watchDone}</p>
                <p className="mt-0.5 text-[10px] text-emerald-300/60">Watched</p>
              </div>
            </div>
          </section>
        </div>

        <div className={cn(settingsTab !== "providers" && "hidden", "space-y-4")}>
          {/* API Setup Guide */}
          <section className="rounded-2xl border border-pitflix-primary/25 bg-gradient-to-br from-pitflix-primary/[0.08] via-pitflix-primary/[0.04] to-transparent p-5">
            <h2 className="mb-4 flex items-center gap-2 text-[15px] font-bold text-pitflix-light">
              <Shield className="h-4 w-4 text-pitflix-primary" strokeWidth={2} />
              API Setup Guide
            </h2>
            <div className="space-y-4 text-[11px] text-pitflix-subtle">
              <div>
                <p className="font-semibold text-white">1. TMDB API key — required for library matching &amp; streaming search</p>
                <ol className="mt-1 list-decimal pl-4 space-y-0.5">
                  <li>Go to <a href="https://www.themoviedb.org/settings/api" target="_blank" rel="noreferrer" className="text-pitflix-primary hover:underline">themoviedb.org/settings/api</a></li>
                  <li>Create an account → request an API key (choose "Developer")</li>
                  <li>Copy the "API Key (v3 auth)" value and paste it below</li>
                </ol>
              </div>
              <div>
                <p className="font-semibold text-white">2. OpenSubtitles API key — optional, for subtitle search</p>
                <ol className="mt-1 list-decimal pl-4 space-y-0.5">
                  <li>Go to <a href="https://www.opensubtitles.com/en/consumers" target="_blank" rel="noreferrer" className="text-pitflix-primary hover:underline">opensubtitles.com/en/consumers</a></li>
                  <li>Register and create an API consumer — get a free API key</li>
                  <li>Paste the key below</li>
                </ol>
              </div>
              <div>
                <p className="font-semibold text-white">3. SubDL API key — optional, alternative subtitle provider</p>
                <ol className="mt-1 list-decimal pl-4 space-y-0.5">
                  <li>Go to <a href="https://subdl.com/login" target="_blank" rel="noreferrer" className="text-pitflix-primary hover:underline">subdl.com</a> and register</li>
                  <li>Go to your profile → API keys → generate a key</li>
                  <li>Paste the key below</li>
                </ol>
              </div>
            </div>
          </section>

          <section
            id="settings-providers"
            className="rounded-2xl border border-white/[0.09] bg-pitflix-surface/50 p-6 shadow-xl shadow-black/30 backdrop-blur-sm"
          >
            <h2 className="mb-4 flex items-center gap-2 border-b border-white/[0.09] pb-4 text-[15px] font-bold tracking-tight text-white">
              <Key className="h-4 w-4 text-amber-400" strokeWidth={2} />
              API keys
            </h2>
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
                    className="min-w-0 flex-1 rounded-lg border border-pitflix-card bg-pitflix-bg px-2.5 py-2 text-xs text-white placeholder:text-pitflix-subtle focus:border-pitflix-primary/70 focus:outline-none focus:ring-2 focus:ring-pitflix-primary/15"
                  />
                  <button
                    type="button"
                    className="shrink-0 rounded-xl border border-white/10 px-2.5 py-2 text-pitflix-muted transition-colors hover:border-white/20 hover:text-white"
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
                    className="rounded-xl border border-white/10 px-3.5 py-1.5 text-[11px] text-white transition-all hover:border-pitflix-primary/50 hover:bg-pitflix-primary/10 disabled:opacity-50"
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
                    className="min-w-0 flex-1 rounded-lg border border-pitflix-card bg-pitflix-bg px-2.5 py-2 text-xs text-white placeholder:text-pitflix-subtle focus:border-pitflix-primary/70 focus:outline-none focus:ring-2 focus:ring-pitflix-primary/15"
                  />
                  <button
                    type="button"
                    className="shrink-0 rounded-xl border border-white/10 px-2.5 py-2 text-pitflix-muted transition-colors hover:border-white/20 hover:text-white"
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
                    className="rounded-xl border border-white/10 px-3.5 py-1.5 text-[11px] text-white transition-all hover:border-pitflix-primary/50 hover:bg-pitflix-primary/10 disabled:opacity-50"
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
              <div>
                <div className="flex items-center justify-between gap-2">
                  <span className="text-[11px] font-medium text-pitflix-muted">SubDL API key</span>
                  <span
                    className="truncate text-[10px] text-pitflix-subtle"
                    title={data?.subDlApiKey ?? ""}
                  >
                    {data?.subDlApiKey ? `Saved: ${data.subDlApiKey}` : "Not set"}
                  </span>
                </div>
                <div className="mt-1 flex gap-2">
                  <input
                    type={showSdlKey ? "text" : "password"}
                    value={sdlKeyInput}
                    onChange={(e) => setSdlKeyInput(e.target.value)}
                    placeholder="Enter SubDL API key…"
                    autoComplete="off"
                    className="min-w-0 flex-1 rounded-lg border border-pitflix-card bg-pitflix-bg px-2.5 py-2 text-xs text-white placeholder:text-pitflix-subtle focus:border-pitflix-primary/70 focus:outline-none focus:ring-2 focus:ring-pitflix-primary/15"
                  />
                  <button
                    type="button"
                    className="shrink-0 rounded-xl border border-white/10 px-2.5 py-2 text-pitflix-muted transition-colors hover:border-white/20 hover:text-white"
                    aria-label={showSdlKey ? "Hide key" : "Show key"}
                    onClick={() => setShowSdlKey((v) => !v)}
                  >
                    {showSdlKey ? <EyeOff className="h-4 w-4" /> : <Eye className="h-4 w-4" />}
                  </button>
                </div>
                <div className="mt-2 flex flex-wrap gap-2">
                  <button
                    type="button"
                    disabled={sdlVerifyBusy}
                    className="rounded-xl border border-white/10 px-3.5 py-1.5 text-[11px] text-white transition-all hover:border-pitflix-primary/50 hover:bg-pitflix-primary/10 disabled:opacity-50"
                    onClick={() => {
                      setApiKeyMsg(null);
                      const k = sdlKeyInput.trim();
                      if (!k) {
                        setApiKeyMsg("Type a SubDL key to verify.");
                        return;
                      }
                      setSdlVerifyBusy(true);
                      void verifySubDlKey(k)
                        .then((r) =>
                          setApiKeyMsg(
                            r.valid ? "SubDL: key is valid." : `SubDL: ${r.error ?? "invalid"}`,
                          ),
                        )
                        .catch(() => setApiKeyMsg("SubDL verify failed."))
                        .finally(() => setSdlVerifyBusy(false));
                    }}
                  >
                    {sdlVerifyBusy ? "Verifying…" : "Verify"}
                  </button>
                </div>
                <p className="mt-1 text-[10px] text-pitflix-subtle">
                  Get a free key at subdl.com — enables SubDL subtitle search.
                </p>
              </div>

              <button
                type="button"
                disabled={apiKeyBusy}
                className="w-full rounded-xl bg-pitflix-primary py-2.5 text-xs font-semibold text-white shadow-sm shadow-pitflix-primary/25 transition-all hover:bg-pitflix-light hover:shadow-pitflix-primary/40 disabled:opacity-50"
                onClick={() => {
                  setApiKeyMsg(null);
                  if (!tmdbKeyInput.trim() && !osKeyInput.trim() && !sdlKeyInput.trim()) {
                    setApiKeyMsg("Enter at least one key to save, or use Verify only.");
                    return;
                  }
                  setApiKeyBusy(true);
                  void saveSettings({
                    ...(tmdbKeyInput.trim() ? { tmdbApiKey: tmdbKeyInput.trim() } : {}),
                    ...(osKeyInput.trim() ? { openSubtitlesApiKey: osKeyInput.trim() } : {}),
                    ...(sdlKeyInput.trim() ? { subDlApiKey: sdlKeyInput.trim() } : {}),
                  })
                    .then(() => {
                      setApiKeyMsg("Saved.");
                      setTmdbKeyInput("");
                      setOsKeyInput("");
                      setSdlKeyInput("");
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

          {/* ── Additional Sources ────────────────────────────────── */}
          <section className="rounded-2xl border border-white/[0.09] bg-pitflix-surface/50 shadow-xl shadow-black/30 backdrop-blur-sm overflow-hidden">
            <button
              type="button"
              className="flex w-full items-center justify-between gap-3 px-6 py-4 text-left"
              onClick={() => setAddlSourcesOpen((o) => !o)}
            >
              <span className="flex items-center gap-2 text-[15px] font-bold tracking-tight text-white">
                <span className="text-pitflix-primary">⊕</span>
                Additional Sources
              </span>
              <span className="text-[11px] text-white/30">{addlSourcesOpen ? "▲ Collapse" : "▼ Expand"}</span>
            </button>
            {addlSourcesOpen && (
              <div className="border-t border-white/[0.06] px-6 pb-6 pt-4">
                <p className="mb-4 text-[11px] text-pitflix-subtle">
                  Optional enrichment sources. MDBList adds aggregated ratings (RT, Metacritic, Letterboxd). TVDB adds
                  artwork and character data.
                </p>
                <div className="space-y-5">
                  {/* MDBList */}
                  <div>
                    <div className="flex items-center justify-between gap-2">
                      <span className="text-[11px] font-medium text-pitflix-muted">MDBList API key</span>
                      <span className="truncate text-[10px] text-pitflix-subtle">
                        {(data as { mdblistApiKey?: string } | undefined)?.mdblistApiKey
                          ? `Saved: ${(data as { mdblistApiKey?: string }).mdblistApiKey}`
                          : "Not set"}
                      </span>
                    </div>
                    <div className="mt-1 flex gap-2">
                      <input
                        type={showMdblistKey ? "text" : "password"}
                        value={mdblistKeyInput}
                        onChange={(e) => setMdblistKeyInput(e.target.value)}
                        placeholder="Enter MDBList API key…"
                        autoComplete="off"
                        className="min-w-0 flex-1 rounded-lg border border-pitflix-card bg-pitflix-bg px-2.5 py-2 text-xs text-white placeholder:text-pitflix-subtle focus:border-pitflix-primary/70 focus:outline-none focus:ring-2 focus:ring-pitflix-primary/15"
                      />
                      <button
                        type="button"
                        className="shrink-0 rounded-xl border border-white/10 px-2.5 py-2 text-pitflix-muted transition-colors hover:border-white/20 hover:text-white"
                        aria-label={showMdblistKey ? "Hide key" : "Show key"}
                        onClick={() => setShowMdblistKey((v) => !v)}
                      >
                        {showMdblistKey ? <EyeOff className="h-4 w-4" /> : <Eye className="h-4 w-4" />}
                      </button>
                    </div>
                    <div className="mt-2 flex flex-wrap gap-2">
                      <button
                        type="button"
                        disabled={mdblistVerifyBusy}
                        className="rounded-xl border border-white/10 px-3.5 py-1.5 text-[11px] text-white transition-all hover:border-pitflix-primary/50 hover:bg-pitflix-primary/10 disabled:opacity-50"
                        onClick={() => {
                          setAddlSourcesMsg(null);
                          const k = mdblistKeyInput.trim();
                          if (!k) { setAddlSourcesMsg("Type a key to save & test."); return; }
                          setMdblistVerifyBusy(true);
                          // Save first, then verify — so the key is always persisted before use
                          void saveSettings({ mdblistApiKey: k })
                            .then(() => refetchSettings())
                            .then(() => verifyMdblistKey(k))
                            .then((r) =>
                              setAddlSourcesMsg(
                                r.valid
                                  ? `Saved. MDBList connected — Shawshank IMDb: ${r.imdbScore ?? "n/a"}`
                                  : `Saved, but key test failed: ${r.error ?? "invalid"}`,
                              ),
                            )
                            .catch(() => setAddlSourcesMsg("Save or test failed."))
                            .finally(() => { setMdblistVerifyBusy(false); setMdblistKeyInput(""); });
                        }}
                      >
                        {mdblistVerifyBusy ? "Saving…" : "Save & Test"}
                      </button>
                    </div>
                    <p className="mt-1 text-[10px] text-pitflix-subtle">
                      Free at{" "}
                      <a href="https://mdblist.com" target="_blank" rel="noreferrer" className="text-pitflix-primary hover:underline">
                        mdblist.com
                      </a>{" "}
                      — 1 000 req/day on the free tier.
                    </p>
                  </div>

                  {/* TVDB */}
                  <div>
                    <div className="flex items-center justify-between gap-2">
                      <span className="text-[11px] font-medium text-pitflix-muted">TVDB API key</span>
                      <span className="truncate text-[10px] text-pitflix-subtle">
                        {(data as { tvdbApiKey?: string } | undefined)?.tvdbApiKey
                          ? `Saved: ${(data as { tvdbApiKey?: string }).tvdbApiKey}`
                          : "Not set"}
                      </span>
                    </div>
                    <div className="mt-1 flex gap-2">
                      <input
                        type={showTvdbKey ? "text" : "password"}
                        value={tvdbKeyInput}
                        onChange={(e) => setTvdbKeyInput(e.target.value)}
                        placeholder="Enter TVDB v4 API key…"
                        autoComplete="off"
                        className="min-w-0 flex-1 rounded-lg border border-pitflix-card bg-pitflix-bg px-2.5 py-2 text-xs text-white placeholder:text-pitflix-subtle focus:border-pitflix-primary/70 focus:outline-none focus:ring-2 focus:ring-pitflix-primary/15"
                      />
                      <button
                        type="button"
                        className="shrink-0 rounded-xl border border-white/10 px-2.5 py-2 text-pitflix-muted transition-colors hover:border-white/20 hover:text-white"
                        aria-label={showTvdbKey ? "Hide key" : "Show key"}
                        onClick={() => setShowTvdbKey((v) => !v)}
                      >
                        {showTvdbKey ? <EyeOff className="h-4 w-4" /> : <Eye className="h-4 w-4" />}
                      </button>
                    </div>
                    <div className="mt-2 flex flex-wrap gap-2">
                      <button
                        type="button"
                        disabled={tvdbVerifyBusy}
                        className="rounded-xl border border-white/10 px-3.5 py-1.5 text-[11px] text-white transition-all hover:border-pitflix-primary/50 hover:bg-pitflix-primary/10 disabled:opacity-50"
                        onClick={() => {
                          setAddlSourcesMsg(null);
                          const k = tvdbKeyInput.trim();
                          if (!k) { setAddlSourcesMsg("Type a key to save & test."); return; }
                          setTvdbVerifyBusy(true);
                          void saveSettings({ tvdbApiKey: k })
                            .then(() => refetchSettings())
                            .then(() => verifyTvdbKey(k))
                            .then((r) =>
                              setAddlSourcesMsg(
                                r.valid ? "Saved. TVDB connected — token obtained." : `Saved, but key test failed: ${r.error ?? "invalid"}`,
                              ),
                            )
                            .catch(() => setAddlSourcesMsg("Save or test failed."))
                            .finally(() => { setTvdbVerifyBusy(false); setTvdbKeyInput(""); });
                        }}
                      >
                        {tvdbVerifyBusy ? "Saving…" : "Save & Test"}
                      </button>
                    </div>
                    <p className="mt-1 text-[10px] text-pitflix-subtle">
                      Free at{" "}
                      <a href="https://thetvdb.com/api-information" target="_blank" rel="noreferrer" className="text-pitflix-primary hover:underline">
                        thetvdb.com/api-information
                      </a>
                    </p>
                  </div>

                  {addlSourcesMsg ? <p className="text-[11px] text-pitflix-muted">{addlSourcesMsg}</p> : null}
                </div>
              </div>
            )}
          </section>
        </div>

        <div className={cn(settingsTab !== "maintenance" && "hidden", "space-y-4")}>
          <section
            id="settings-maintenance"
            className="rounded-2xl border border-white/[0.09] bg-pitflix-surface/50 p-6 shadow-xl shadow-black/30 backdrop-blur-sm"
          >
            <h2 className="mb-4 flex items-center gap-2 border-b border-white/[0.09] pb-4 text-[15px] font-bold tracking-tight text-white">
              <Wrench className="h-4 w-4 text-rose-400" strokeWidth={2} />
              Maintenance
            </h2>
            <div className="grid grid-cols-2 gap-3">
              <button
                type="button"
                disabled={scanBusy}
                className="h-10 rounded-xl bg-pitflix-primary text-xs font-semibold text-white shadow-sm shadow-pitflix-primary/30 transition-all hover:bg-pitflix-light hover:shadow-pitflix-primary/40 disabled:opacity-50"
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
                className="h-10 rounded-xl border border-pitflix-primary/40 bg-pitflix-bg text-xs font-medium text-white transition-all hover:border-pitflix-primary/60 hover:bg-pitflix-primary/15 disabled:opacity-50"
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
              <div className="col-span-2 rounded-xl border border-blue-500/20 bg-blue-950/20 px-4 py-3.5">
                <p className="mb-1.5 text-[10px] font-semibold uppercase tracking-wide text-pitflix-muted">
                  Trailers
                </p>
                <p className="mb-2 text-[11px] leading-snug text-pitflix-muted">
                  Ingestion runs automatically on a schedule while the API is running. Use the button below when you
                  want an immediate refresh.
                </p>
                <button
                  type="button"
                  disabled={trailerIngestionBusy}
                  className="w-full rounded-xl border border-blue-500/35 bg-pitflix-bg py-2 text-xs font-medium text-blue-100 transition-all hover:border-blue-500/55 hover:bg-blue-500/15 disabled:opacity-50"
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
              <div className="col-span-2 rounded-xl border border-amber-500/25 bg-amber-950/15 px-4 py-3.5">
                <p className="mb-1.5 text-[10px] font-semibold uppercase tracking-wide text-pitflix-muted">
                  Awards data cache
                </p>
                <p className="mb-2 text-[11px] leading-snug text-pitflix-muted">
                  <strong className="text-white">Update cache</strong> downloads only missing editions — already-cached
                  ceremonies are skipped instantly so the run is fast after the first download.{" "}
                  <strong className="text-white">Clear Awards Cache</strong> wipes everything so the next update
                  re-downloads all editions from scratch. Runs need a valid TMDB key and show progress in the panel below.
                </p>
                <div className="flex flex-wrap gap-2">
                  <button
                    type="button"
                    className="h-9 rounded-xl border border-amber-500/40 bg-pitflix-bg px-3 text-xs font-medium text-amber-100 transition-all hover:border-amber-500/60 hover:bg-amber-500/12"
                    onClick={() => {
                      setMaintMessage(null);
                      void requestAwardsPreload()
                        .then((r) => {
                          setMaintMessage(
                            r.started
                              ? "Awards cache update started — watch the bottom progress panel."
                              : "An update is already running — progress is in the bottom panel.",
                          );
                        })
                        .catch((err) => setMaintMessage(formatScanOrApiError(err)));
                    }}
                  >
                    Update awards cache
                  </button>
                  <button
                    type="button"
                    className="h-9 rounded-xl border border-zinc-600/50 bg-pitflix-bg px-3 text-xs font-medium text-zinc-200 transition-all hover:bg-zinc-800/80"
                    onClick={() => {
                      setMaintMessage(null);
                      setAwardsClearConfirmOpen(true);
                    }}
                  >
                    Clear Awards Cache
                  </button>
                </div>
                {awardsStatus ? (
                  <div className="mt-2 space-y-1 rounded-md border border-white/5 bg-black/20 px-2 py-1.5 text-[10px] text-pitflix-subtle">
                    <p>
                      <span className="text-pitflix-muted">Phase:</span> {awardsStatus.phase}
                      {awardsStatus.running ? " (running)" : ""}
                    </p>
                    <p>
                      <span className="text-pitflix-muted">Progress:</span> {awardsStatus.processedNominees} /{" "}
                      {awardsStatus.totalNominees} nominees
                      {awardsStatus.skippedNominees > 0
                        ? ` (${awardsStatus.skippedNominees} already cached, skipped)`
                        : ""}
                    </p>
                    <p>
                      <span className="text-pitflix-muted">Rows written:</span> {awardsStatus.successCount} ·{" "}
                      <span className="text-pitflix-muted">Failed (nominees):</span> {awardsStatus.failedCount}
                    </p>
                    <p>
                      <span className="text-pitflix-muted">DB rows:</span> {awardsStatus.cachedRowCount}
                    </p>
                    {awardsStatus.awardId ? (
                      <p>
                        <span className="text-pitflix-muted">Current:</span> {awardsStatus.awardId} · {awardsStatus.year}{" "}
                        {awardsStatus.categoryId ? ` · ${awardsStatus.categoryId}` : ""}
                      </p>
                    ) : null}
                    {awardsStatus.lastCompletedAt ? (
                      <p>
                        <span className="text-pitflix-muted">Last updated:</span>{" "}
                        {new Date(awardsStatus.lastCompletedAt).toLocaleString()}
                      </p>
                    ) : null}
                    {awardsStatus.lastError ? (
                      <p className="text-rose-200/90">Last error: {awardsStatus.lastError}</p>
                    ) : null}
                  </div>
                ) : null}
              </div>
              <div className="col-span-2 rounded-xl border border-violet-500/20 bg-violet-950/20 px-4 py-3.5">
                <p className="mb-1.5 text-[10px] font-semibold uppercase tracking-wide text-pitflix-muted">
                  Ratings (persisted)
                </p>
                <p className="mb-2 text-[10px] leading-snug text-pitflix-subtle">
                  Enrichment runs in the API background (~32 titles per burst). Ratings on movie pages update as each
                  title is processed — stay on this panel to watch progress.
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
                    className="h-10 rounded-xl border border-violet-400/35 bg-pitflix-bg text-xs font-medium text-violet-100 transition-all hover:border-violet-400/55 hover:bg-violet-500/15 disabled:opacity-50"
                    onClick={() => {
                      setRatingsMaintMsg(null);
                      setRatingsBackfillBusy(true);
                      void queueRatingsLibraryBackfill({
                        limit: 500,
                        maintenanceKey: ratingsMaintKey.trim() || undefined,
                      })
                        .then((r) => {
                          startWatchingRatingsQueue();
                          setRatingsMaintMsg(
                            `Queued ${r.accepted} jobs (${r.movies} movies + ${r.shows} series, cap ${r.cap}).`,
                          );
                          void qc.invalidateQueries({
                            predicate: (q) => q.queryKey[0] === "ratings-display",
                          });
                          refetchRatingsQueue();
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
                    className="h-10 rounded-xl border border-violet-400/25 bg-pitflix-bg text-xs font-medium text-violet-100/95 transition-all hover:border-violet-400/45 hover:bg-violet-500/12 disabled:opacity-50"
                    onClick={() => {
                      setRatingsMaintMsg(null);
                      setRatingsStaleBusy(true);
                      void queueRatingsStaleSweep(ratingsMaintKey.trim() || undefined)
                        .then((r) => {
                          startWatchingRatingsQueue();
                          setRatingsMaintMsg(
                            r.queued === "stale_sweep"
                              ? "Stale ratings refresh queued."
                              : "Request sent.",
                          );
                          void qc.invalidateQueries({
                            predicate: (q) => q.queryKey[0] === "ratings-display",
                          });
                          refetchRatingsQueue();
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
                {ratingsQueueWatching && ratingsQueueStatus ? (
                  <div className="mt-3 space-y-2 rounded-md border border-violet-400/20 bg-black/25 px-2.5 py-2">
                    <div className="flex flex-wrap items-center justify-between gap-2 text-[11px]">
                      <span className="text-violet-100/95">
                        {ratingsQueueStatus.isProcessing ? "Processing…" : "Idle"}
                        {ratingsQueueStatus.queueDepth > 0
                          ? ` · ${ratingsQueueStatus.queueDepth} queued`
                          : ratingsQueueStatus.active
                            ? ""
                            : " · queue empty"}
                      </span>
                      <span className="tabular-nums text-pitflix-subtle">
                        {ratingsQueueStatus.processedTotal.toLocaleString()} processed (session)
                      </span>
                    </div>
                    {ratingsQueueStatus.coverage.total > 0 ? (
                      <>
                        <div className="h-1.5 overflow-hidden rounded-full bg-white/10">
                          <div
                            className="h-full rounded-full bg-violet-400/80 transition-[width] duration-500"
                            style={{
                              width: `${Math.min(
                                100,
                                (ratingsQueueStatus.coverage.withImdb / ratingsQueueStatus.coverage.total) * 100,
                              )}%`,
                            }}
                          />
                        </div>
                        <p className="text-[10px] leading-snug text-pitflix-subtle">
                          Library snapshots: {ratingsQueueStatus.coverage.withImdb} with IMDb,{" "}
                          {ratingsQueueStatus.coverage.withRottenTomatoes} with Rotten Tomatoes,{" "}
                          {ratingsQueueStatus.coverage.tmdbOnly} TMDB-only
                          {ratingsQueueStatus.coverage.hasImdbIdButNoImdbScore > 0
                            ? ` · ${ratingsQueueStatus.coverage.hasImdbIdButNoImdbScore} waiting for IMDb`
                            : ""}
                        </p>
                      </>
                    ) : (
                      <p className="text-[10px] text-pitflix-subtle">No snapshots yet — open a title to seed ratings.</p>
                    )}
                    {ratingsQueueStatus.lastError ? (
                      <p className="text-[10px] text-rose-200/90">Last error: {ratingsQueueStatus.lastError}</p>
                    ) : null}
                    {!ratingsQueueStatus.active && ratingsQueueStatus.queueDepth === 0 && !ratingsQueueStatus.isProcessing ? (
                      <p className="text-[10px] text-emerald-200/90">Background queue finished for now. Progress is also shown in the floating panel.</p>
                    ) : (
                      <p className="text-[10px] text-pitflix-subtle">
                        OMDb free tier is ~1,000 requests/day — large libraries finish over multiple sessions.
                      </p>
                    )}
                  </div>
                ) : ratingsQueueWatching && ratingsQueueFetched && ratingsQueueStatus == null ? (
                  <p className="mt-2 text-[11px] text-amber-200/95">
                    Queue status unavailable — restart Pitflix.API (<code className="text-[10px]">dotnet run</code> in
                    Pitflix.API) so the new endpoint loads, then try again.
                  </p>
                ) : ratingsQueueWatching && ratingsQueueFetching ? (
                  <p className="mt-2 text-[11px] text-pitflix-subtle">Loading queue status…</p>
                ) : null}
              </div>
              <button
                type="button"
                disabled={cleanupBusy}
                className="h-10 rounded-xl border border-white/[0.08] bg-pitflix-bg text-xs font-medium text-white transition-all hover:border-pitflix-primary/40 disabled:opacity-50"
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
                className="h-10 rounded-xl border border-amber-500/35 bg-pitflix-bg text-xs font-medium text-amber-200 transition-all hover:bg-amber-500/10 disabled:opacity-50"
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
              <Link
                to="/duplicates"
                className="flex h-10 items-center justify-center rounded-xl border border-amber-500/30 bg-pitflix-bg px-4 text-xs font-medium text-amber-100 transition-all hover:bg-amber-500/10"
              >
                🔍 Find Duplicates
              </Link>
              <button
                type="button"
                className="h-10 rounded-xl border border-red-500/35 bg-pitflix-bg text-xs font-medium text-red-200 transition-all hover:bg-red-500/10"
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
                className="h-10 rounded-xl border border-white/[0.08] bg-pitflix-bg text-xs text-white transition-all hover:border-pitflix-primary/40"
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
                className="h-10 rounded-xl border border-amber-500/30 bg-pitflix-bg text-xs text-amber-100 transition-all hover:bg-amber-500/10"
                onClick={() => setResetDbInfoOpen(true)}
              >
                🔁 Reset DB
              </button>
              <div className="col-span-2 flex flex-col gap-2.5 rounded-xl border border-emerald-500/15 bg-emerald-950/10 px-4 py-3">
                <p className="text-[11px] leading-snug text-pitflix-muted">
                  Only downloads metadata for titles that have never completed a prefetch (empty{" "}
                  <span className="font-mono text-[10px]">MetadataRefreshedAt</span> in the library DB). Titles already
                  prefetched are skipped and shown as counts. Progress stays in the floating panel at the bottom if you
                  navigate away.
                </p>
                <div className="flex gap-2">
                  <button
                    type="button"
                    disabled={libraryPrefetch.running}
                    className="h-10 min-w-0 flex-1 rounded-xl border border-emerald-600/35 bg-pitflix-bg text-xs font-medium text-emerald-100 transition-all hover:border-emerald-600/55 hover:bg-emerald-600/12 disabled:opacity-50"
                    onClick={() => startLibraryMetadataPrefetch()}
                  >
                    {libraryPrefetch.running
                      ? "Downloading metadata…"
                      : "📥 Pre-download metadata (pending titles only)"}
                  </button>
                  {libraryPrefetch.running ? (
                    <button
                      type="button"
                      className="h-10 shrink-0 rounded-xl border border-zinc-600/70 px-3 text-xs font-medium text-zinc-200 transition-all hover:bg-zinc-800"
                      onClick={() => stopLibraryMetadataPrefetch()}
                    >
                      Stop
                    </button>
                  ) : null}
                </div>
                {libraryPrefetch.running ? (
                  <div className="rounded-lg border border-pitflix-card/60 bg-pitflix-bg/80 p-2">
                    <div className="h-1.5 w-full overflow-hidden rounded-full bg-zinc-800">
                      <div
                        className="h-full rounded-full bg-emerald-600 transition-[width] duration-200"
                        style={{ width: `${Math.round(libraryPrefetch.pct)}%` }}
                      />
                    </div>
                    {libraryPrefetch.liveLine ? (
                      <p className="mt-2 text-[11px] leading-snug text-pitflix-muted">{libraryPrefetch.liveLine}</p>
                    ) : null}
                    {libraryPrefetch.log.length > 0 ? (
                      <div className="mt-2 max-h-28 overflow-y-auto rounded border border-pitflix-card/40 bg-black/20 px-2 py-1 font-mono text-[10px] text-zinc-400">
                        {libraryPrefetch.log.slice(-12).map((line, i) => (
                          <div key={`${libraryPrefetch.log.length}-${i}`} className="truncate">
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
            {libraryPrefetch.message ? (
              <p className="mt-2 text-[11px] text-pitflix-muted">{libraryPrefetch.message}</p>
            ) : null}
            {cleanupMessage ? <p className="mt-2 text-[11px] text-pitflix-muted">{cleanupMessage}</p> : null}
            {maintMessage ? <p className="mt-2 text-[11px] text-pitflix-muted">{maintMessage}</p> : null}
          </section>
        </div>

        <div className={cn(settingsTab !== "help" && "hidden", "space-y-4")}>
          <section className="rounded-2xl border border-white/[0.09] bg-pitflix-surface/50 p-6 shadow-xl shadow-black/30 backdrop-blur-sm">
            <h2 className="mb-4 flex items-center gap-2 border-b border-white/[0.09] pb-4 text-[15px] font-bold tracking-tight text-white">
              <HelpCircle className="h-4 w-4 text-teal-400" strokeWidth={2} />
              Help &amp; FAQ
            </h2>
            <div>
              <div className="-mx-3">
              {([
                {
                  q: "How do I get a TMDB API key?",
                  a: "Go to themoviedb.org → sign up → Settings → API → Request an API key. Choose \"Developer\" use, fill in the form. Copy the API Read Access Token (v4 auth) or the API Key (v3). Paste it in the API keys tab and click Save keys.",
                },
                {
                  q: "Why does my library show 0 movies / series?",
                  a: "Make sure you've added at least one Library folder in the Library tab, saved it, then run Scan Library in Maintenance. The scan walks your folders looking for video files. Check that the folder path is accessible to the API process.",
                },
                {
                  q: "How do I get subtitles for a movie?",
                  a: "Open a movie or episode, then click the Subtitles button in the player. Pitflix uses OpenSubtitles (needs an API key) and SubDL (needs a separate key). Add both keys in the API keys tab for the best coverage.",
                },
                {
                  q: "Where do I get an OpenSubtitles API key?",
                  a: "Register at opensubtitles.com, then go to your profile → API Consumers → add a consumer. The key is your REST API key. Add it in the API keys tab.",
                },
                {
                  q: "Where do I get a SubDL API key?",
                  a: "Register at subdl.com, log in, go to your profile → API keys, and generate a key. It's free. Paste it in the API keys tab under SubDL.",
                },
                {
                  q: "Trailers are empty or not updating. What do I do?",
                  a: "Make sure your TMDB API key is valid. Then go to the Trailers page and click \"Refresh trailers\" — this triggers a fresh fetch from TMDB. You can also run trailer ingestion from Settings → Maintenance.",
                },
                {
                  q: "How does Online Streaming work?",
                  a: "The Online Streaming page searches TMDB for any movie or TV show. Click a result to open the detail page, then choose a streaming provider (StreamIMDB or CorsFlix) and press Play. Streams are embedded in-app via an iframe — availability depends on the third-party provider.",
                },
                {
                  q: "Awards page is empty. How do I populate it?",
                  a: "Go to Settings → Maintenance and click \"Update awards cache\". This downloads nominees for Oscar, Emmy, BAFTA, and Golden Globe ceremonies. It runs in the background — a panel at the bottom shows progress.",
                },
                {
                  q: "The app crashed or I see a blank screen. What next?",
                  a: "Make sure Pitflix.API is running (check the system tray or run \"dotnet run\" in the Pitflix.API folder). If the API is up but the UI still shows errors, open Settings → API Health Check to see which endpoints are failing. Check that your TMDB key is valid.",
                },
                {
                  q: "What is the difference between StreamIMDB and CorsFlix?",
                  a: "Both are online streaming providers embedded inside Pitflix. StreamIMDB uses the IMDb ID of the title to find a stream — it requires a valid IMDb ID. CorsFlix uses the TMDB ID instead and works even when an IMDb ID is unavailable. If one doesn't work, try the other with the provider toggle on the stream details page.",
                },
                {
                  q: "How do I add a movie or series to My List?",
                  a: "Open any movie or series detail page, or navigate to Online Streaming and open a title. Click the heart icon or \"Add to My List\" button. From Awards, use the Watchlist button on any nominee card. Your list is accessible from the sidebar under My Lists.",
                },
                {
                  q: "How do I remove an item from My List?",
                  a: "Go to My Lists, open the list, hover over any poster and click the red trash icon that appears in the top-right corner of the card. You can also open the title's detail page and click \"Remove from list\".",
                },
                {
                  q: "Why does a cast member's actor page only show library titles?",
                  a: "The person page shows your local library matches first, then loads the actor's full TMDB filmography below under \"Filmography\". Those cards link to the online streaming detail page. A valid TMDB API key is required to load the filmography.",
                },
                {
                  q: "Can I resume a movie or episode from where I left off?",
                  a: "Yes. Pitflix saves your playback position every few seconds and whenever you pause. The next time you open the same title, you'll be offered the option to resume from the last position. You can also see your continue-watching history on the Home page.",
                },
                {
                  q: "Can I use Pitflix without an internet connection?",
                  a: "Yes for local library playback — your files play through the built-in player with no internet needed. Subtitles search (OpenSubtitles / SubDL), poster images, trailers, awards data, online streaming, and TMDB metadata all require an internet connection.",
                },
                {
                  q: "Why are some posters missing or showing a placeholder?",
                  a: "Posters come from TMDB and are cached locally after the first load. If TMDB can't be reached or the key is missing, a placeholder is shown. Run \"Scan Library\" or \"Update metadata\" in Maintenance to trigger a fresh fetch. You can also manually pick a poster from the title's detail page (select from TMDB).",
                },
                {
                  q: "How do I change or set a custom media player?",
                  a: "Go to Settings → Library and set the Media Player Path to the full path of your player executable (e.g., C:\\Program Files\\VLC\\vlc.exe). Leave it empty to use your system's default app for the file type. The built-in libmpv player is available when no external player is configured.",
                },
                {
                  q: "How do I update Pitflix?",
                  a: "Go to Settings → App & Updates. If an update is available from GitHub, you'll see a download button. On Windows the updater can apply the update automatically. You can also check manually by clicking \"Check for updates\".",
                },
                {
                  q: "SubDL returns 'too many requests'. What do I do?",
                  a: "SubDL's free API has a rate limit. Pitflix automatically retries once after a short delay when a 429 response is received. If searches still fail, wait a minute and try again, or upgrade your SubDL plan for a higher quota.",
                },
                {
                  q: "How do I watch a specific episode from the Awards page?",
                  a: "On an award nominee card, click Stream to go directly to the streaming detail page for that series. From there, click on the season you want to open the season page, then click the Play button next to any episode.",
                },
              ] as { q: string; a: string }[]).map(({ q, a }, i) => (
                <div key={i} className="rounded-xl border border-transparent px-3 py-3.5 transition-colors hover:border-white/[0.06] hover:bg-white/[0.03] border-b-[0px]">
                  <div className="border-b border-white/[0.05] pb-3.5 last:border-0 last:pb-0">
                    <p className="text-sm font-semibold text-white">{q}</p>
                    <p className="mt-1.5 text-[12px] leading-relaxed text-pitflix-subtle">{a}</p>
                  </div>
                </div>
              ))}
              </div>
            </div>
          </section>
        </div>
      </div>

      {removeOpen ? (
        <div className="mt-6 rounded-2xl border border-white/[0.09] bg-pitflix-surface/50 p-5">
          <h3 className="text-sm font-semibold text-white">Remove a title</h3>
          <p className="mt-1 text-[11px] text-pitflix-subtle">
            Open a poster grid for movies or series, or search by any part of the title (capitalization doesn&apos;t
            matter).
          </p>
          <div className="mt-2 flex flex-wrap gap-2">
            <button
              type="button"
              className="rounded-xl border border-white/[0.08] bg-pitflix-bg px-3.5 py-1.5 text-[11px] text-white transition-all hover:border-pitflix-primary/50"
              onClick={() => {
                setRemoveQuery("");
                setRemoveBrowseKind("movies");
              }}
            >
              Browse movies
            </button>
            <button
              type="button"
              className="rounded-xl border border-white/[0.08] bg-pitflix-bg px-3.5 py-1.5 text-[11px] text-white transition-all hover:border-pitflix-primary/50"
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
            className="mt-2 w-full rounded-lg border border-pitflix-card bg-pitflix-bg px-3 py-2 text-sm text-white focus:border-pitflix-primary/70 focus:outline-none focus:ring-2 focus:ring-pitflix-primary/15"
          />
          {combinedHits.length > 0 ? (
            <div className="mt-3 grid max-h-[min(55vh,480px)] grid-cols-1 gap-2 overflow-y-auto pr-1 sm:grid-cols-2">
              {combinedHits.map((row) => (
                <div
                  key={`${row.kind}-${row.id}`}
                  className="flex items-center justify-between gap-3 rounded-xl border border-white/[0.08] bg-pitflix-bg/60 px-3 py-2.5 transition-colors hover:border-pitflix-primary/20 hover:bg-pitflix-primary/[0.04]"
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
        open={awardsClearConfirmOpen}
        title="Clear awards cache?"
        description="This removes all precomputed awards nominee rows from your library database. Award pages will load more slowly until you run “Update awards cache” again."
        confirmLabel="Clear cache"
        cancelLabel="Cancel"
        variant="danger"
        onConfirm={() => {
          void requestAwardsClear()
            .then(() => {
              setMaintMessage("Awards cache cleared.");
              setAwardsClearConfirmOpen(false);
            })
            .catch((err) => {
              setMaintMessage(formatScanOrApiError(err));
              setAwardsClearConfirmOpen(false);
            });
        }}
        onCancel={() => setAwardsClearConfirmOpen(false)}
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

      <footer className="mt-20 border-t border-white/[0.08] pt-10 text-center">
        <p className="text-xs font-medium tracking-wider text-pitflix-subtle uppercase">Crafted with care</p>
        <p className="mt-2 text-base font-semibold text-white/90">
          Abdallah Saeed <span aria-hidden="true">🍕</span>
        </p>
        <p className="mt-1.5 text-xs text-pitflix-subtle/70">Pitflix · premium library experience</p>
      </footer>

      {toast ? (
        <div
          className="fixed bottom-5 left-1/2 z-[235] max-w-md -translate-x-1/2 rounded-2xl border border-pitflix-primary/40 bg-pitflix-surface px-5 py-3.5 text-sm text-white shadow-2xl shadow-black/60 backdrop-blur-sm animate-slide-in-from-bottom"
          role="status"
        >
          {toast}
        </div>
      ) : null}
    </div>
  );
}
