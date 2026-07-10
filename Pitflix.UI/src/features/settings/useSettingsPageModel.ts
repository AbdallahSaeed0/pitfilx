import { isTauri } from "@tauri-apps/api/core";
import { useQuery, useQueryClient } from "@tanstack/react-query";
import { useEffect, useMemo, useState } from "react";
import { open } from "@tauri-apps/plugin-dialog";
import {
  type LibraryTitleRow,
  removeLibraryMovie,
  removeLibraryShow,
  searchLibraryTitles,
} from "../../api/library";
import {
  addLibraryPath,
  addPinnedScanPath,
  addExcludedScanPath,
  getMediaPlayerCandidates,
  getSettings,
  nativePickExecutable,
  nativePickFolder,
  saveSettings,
} from "../../api/settings";
import { getStats } from "../../api/stats";
import { useDebounce } from "../../hooks/useDebounce";
import { normalizePlayerEngine, type PlayerEngineId } from "../../playback/playerEngine";
import type { RemoveTitlePick } from "../../components/RemoveTitleBrowseModal";
import { getDesktopAutostartState } from "../../utils/autostart";
import { useBackgroundTasks } from "../../context/BackgroundTasksContext";
import { useAppPrefsStore } from "../../store/appPrefsStore";
import {
  cancelLetterboxdSync,
  getLetterboxdAuthStatus,
  getLetterboxdSyncStatus,
  saveLetterboxdSession,
  startLetterboxdSync,
} from "../../api/letterboxd";
import type { SettingsTab } from "./settingsTypes";
import { formatScanOrApiError } from "./settingsTypes";

export function useSettingsPageModel() {
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
  const { data: letterboxdStatus, refetch: refetchLetterboxdStatus } = useQuery({
    queryKey: ["letterboxd-status"],
    queryFn: getLetterboxdAuthStatus,
  });
  const { data: letterboxdSyncStatus, refetch: refetchLetterboxdSyncStatus } = useQuery({
    queryKey: ["letterboxd-sync-status"],
    queryFn: getLetterboxdSyncStatus,
    refetchInterval: (q) => (q.state.data?.isRunning ? 3000 : false),
  });
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
  const [playerEngine, setPlayerEngine] = useState<PlayerEngineId>(() => {
    try {
      const raw = localStorage.getItem("pitflix-player-engine");
      const normalized = normalizePlayerEngine(raw);
      if (raw === "pitflix2" || raw === "pitflix") {
        localStorage.setItem("pitflix-player-engine", "external-mpv");
      }
      return normalized;
    } catch {
      return "libmpv-embedded";
    }
  });
  const setEngine = (value: PlayerEngineId) => {
    setPlayerEngine(value);
    try {
      localStorage.setItem("pitflix-player-engine", value);
    } catch {
      /* ignore */
    }
  };
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
  const [ssKeyInput, setSsKeyInput] = useState("");
  const [mdblistKeyInput, setMdblistKeyInput] = useState("");
  const [tvdbKeyInput, setTvdbKeyInput] = useState("");
  const [showTmdbKey, setShowTmdbKey] = useState(false);
  const [showOsKey, setShowOsKey] = useState(false);
  const [showSdlKey, setShowSdlKey] = useState(false);
  const [showSsKey, setShowSsKey] = useState(false);
  const [apiKeyGuide, setApiKeyGuide] = useState<
    "tmdb" | "opensubtitles" | "subdl" | "subsource" | "mdblist" | "tvdb" | null
  >(null);
  const [showMdblistKey, setShowMdblistKey] = useState(false);
  const [showTvdbKey, setShowTvdbKey] = useState(false);
  const [apiKeyMsg, setApiKeyMsg] = useState<string | null>(null);
  const [apiKeyBusy, setApiKeyBusy] = useState(false);
  const [tmdbVerifyBusy, setTmdbVerifyBusy] = useState(false);
  const [osVerifyBusy, setOsVerifyBusy] = useState(false);
  const [sdlVerifyBusy, setSdlVerifyBusy] = useState(false);
  const [ssVerifyBusy, setSsVerifyBusy] = useState(false);
  const [mdblistVerifyBusy, setMdblistVerifyBusy] = useState(false);
  const [tvdbVerifyBusy, setTvdbVerifyBusy] = useState(false);
  const [addlSourcesMsg, setAddlSourcesMsg] = useState<string | null>(null);
  const [addlSourcesOpen, setAddlSourcesOpen] = useState(false);
  const [letterboxdBusy, setLetterboxdBusy] = useState(false);
  const [letterboxdMsg, setLetterboxdMsg] = useState<string | null>(null);
  const [letterboxdUsernameInput, setLetterboxdUsernameInput] = useState("");
  const [letterboxdSessionInput, setLetterboxdSessionInput] = useState("");
  const [letterboxdUserAgentInput, setLetterboxdUserAgentInput] = useState("");
  const [letterboxdSessionBusy, setLetterboxdSessionBusy] = useState(false);
  const [autostartBusy, setAutostartBusy] = useState(false);
  const [autostartMessage, setAutostartMessage] = useState<string | null>(null);
  const [settingsTab, setSettingsTab] = useState<SettingsTab>("library");
  const offlineMode = useAppPrefsStore((s) => s.offlineMode);
  const setOfflineMode = useAppPrefsStore((s) => s.setOfflineMode);
  const liveTvEnabled = useAppPrefsStore((s) => s.liveTvEnabled);
  const setLiveTvEnabled = useAppPrefsStore((s) => s.setLiveTvEnabled);
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

  const handleOpenLetterboxdSignIn = () => {
    void import("@tauri-apps/plugin-opener").then(({ openUrl }) =>
      openUrl("https://letterboxd.com/sign-in/").catch(() => {}),
    );
  };

  const handleSaveLetterboxdSession = () => {
    const cookieHeader = letterboxdSessionInput.trim();
    const userAgent = letterboxdUserAgentInput.trim();
    if (!cookieHeader) {
      setLetterboxdMsg("Paste the Cookie header value first.");
      return;
    }
    if (!userAgent) {
      setLetterboxdMsg("Paste the User-Agent header value too — the session won't authenticate without it.");
      return;
    }
    setLetterboxdSessionBusy(true);
    setLetterboxdMsg(null);
    void saveLetterboxdSession(cookieHeader, userAgent)
      .then(() => refetchLetterboxdStatus())
      .then(() => setLetterboxdMsg("Logged in to Letterboxd."))
      .catch(() => setLetterboxdMsg("Could not save the Letterboxd session."))
      .finally(() => {
        setLetterboxdSessionBusy(false);
        setLetterboxdSessionInput("");
        setLetterboxdUserAgentInput("");
      });
  };

  const handleLetterboxdLogout = () => {
    setLetterboxdMsg(null);
    void saveLetterboxdSession("")
      .then(() => refetchLetterboxdStatus())
      .then(() => setLetterboxdMsg("Logged out of Letterboxd."))
      .catch(() => setLetterboxdMsg("Could not log out."));
  };

  const handleStartLetterboxdSync = () => {
    void startLetterboxdSync()
      .then(() => refetchLetterboxdSyncStatus())
      .catch(() => setLetterboxdMsg("Could not start the sync."));
  };

  const handleCancelLetterboxdSync = () => {
    void cancelLetterboxdSync()
      .then(() => refetchLetterboxdSyncStatus())
      .catch(() => {});
  };

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

  return {
    qc,
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
    data,
    isLoading,
    isPageLoading: isLoading && !data,
    letterboxdStatus,
    refetchLetterboxdStatus,
    watchStats,
    playerCandidates,
    uniquePlayerCandidates,
    manualPath, setManualPath,
    pinnedManualPath, setPinnedManualPath,
    excludedManualPath, setExcludedManualPath,
    pathBusy, setPathBusy,
    pinnedBusy, setPinnedBusy,
    excludedBusy, setExcludedBusy,
    libraryPickMessage, setLibraryPickMessage,
    pinnedPickMessage, setPinnedPickMessage,
    excludedPickMessage, setExcludedPickMessage,
    cleanupMessage, setCleanupMessage,
    cleanupBusy, setCleanupBusy,
    scanBusy, setScanBusy,
    scanMessage, setScanMessage,
    artworkBusy, setArtworkBusy,
    artworkMessage, setArtworkMessage,
    maintMessage, setMaintMessage,
    ratingsMaintKey, setRatingsMaintKey,
    ratingsBackfillBusy, setRatingsBackfillBusy,
    ratingsStaleBusy, setRatingsStaleBusy,
    ratingsMaintMsg, setRatingsMaintMsg,
    trailerIngestionBusy, setTrailerIngestionBusy,
    trailerIngestionMsg, setTrailerIngestionMsg,
    toast, setToast,
    removeBrowseRefresh, setRemoveBrowseRefresh,
    mediaPlayerPath, setMediaPlayerPath,
    playerFieldTouched, setPlayerFieldTouched,
    playerBusy, setPlayerBusy,
    playerMessage, setPlayerMessage,
    playerEngine, setEngine,
    libraryScanDesktopToasts, setLibraryScanDesktopToasts,
    scanToastsBusy, setScanToastsBusy,
    removeOpen, setRemoveOpen,
    removeBrowseKind, setRemoveBrowseKind,
    pendingRemove, setPendingRemove,
    resetDbInfoOpen, setResetDbInfoOpen,
    awardsClearConfirmOpen, setAwardsClearConfirmOpen,
    removeQuery, setRemoveQuery,
    removeQ,
    searchHits, setSearchHits,
    tmdbKeyInput, setTmdbKeyInput,
    osKeyInput, setOsKeyInput,
    sdlKeyInput, setSdlKeyInput,
    ssKeyInput, setSsKeyInput,
    mdblistKeyInput, setMdblistKeyInput,
    tvdbKeyInput, setTvdbKeyInput,
    showTmdbKey, setShowTmdbKey,
    showOsKey, setShowOsKey,
    showSdlKey, setShowSdlKey,
    showSsKey, setShowSsKey,
    apiKeyGuide, setApiKeyGuide,
    showMdblistKey, setShowMdblistKey,
    showTvdbKey, setShowTvdbKey,
    apiKeyMsg, setApiKeyMsg,
    apiKeyBusy, setApiKeyBusy,
    tmdbVerifyBusy, setTmdbVerifyBusy,
    osVerifyBusy, setOsVerifyBusy,
    sdlVerifyBusy, setSdlVerifyBusy,
    ssVerifyBusy, setSsVerifyBusy,
    mdblistVerifyBusy, setMdblistVerifyBusy,
    tvdbVerifyBusy, setTvdbVerifyBusy,
    addlSourcesMsg, setAddlSourcesMsg,
    addlSourcesOpen, setAddlSourcesOpen,
    letterboxdBusy, setLetterboxdBusy,
    letterboxdMsg, setLetterboxdMsg,
    letterboxdUsernameInput, setLetterboxdUsernameInput,
    letterboxdSessionInput, setLetterboxdSessionInput,
    letterboxdUserAgentInput, setLetterboxdUserAgentInput,
    letterboxdSessionBusy,
    handleOpenLetterboxdSignIn,
    handleSaveLetterboxdSession,
    handleLetterboxdLogout,
    letterboxdSyncStatus,
    handleStartLetterboxdSync,
    handleCancelLetterboxdSync,
    autostartBusy, setAutostartBusy,
    autostartMessage, setAutostartMessage,
    settingsTab, setSettingsTab,
    offlineMode, setOfflineMode,
    liveTvEnabled, setLiveTvEnabled,
    defaultSpoilerProtection, setDefaultSpoilerProtection,
    autostartStatus,
    combinedHits,
    refetchSettings,
    handleBrowse,
    handleBrowsePlayerExe,
    handleAddManual,
    handleBrowsePinned,
    handleAddPinnedManual,
    handleBrowseExcluded,
    handleAddExcludedManual,
    savePlayerPath,
    watchNotStarted,
    watchProgress,
    watchDone,
    libraryRowToPick,
    executeConfirmedRemove,
    formatScanOrApiError,
  };

}

export type SettingsPageModel = ReturnType<typeof useSettingsPageModel>;
