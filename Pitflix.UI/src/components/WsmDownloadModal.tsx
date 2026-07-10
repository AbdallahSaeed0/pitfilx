import { AnimatePresence, motion } from "framer-motion";
import { useEffect, useMemo, useState } from "react";
import { useQuery } from "@tanstack/react-query";
import { open, save } from "@tauri-apps/plugin-dialog";
import { openUrl } from "@tauri-apps/plugin-opener";
import { isTauri } from "@tauri-apps/api/core";
import { ArrowDown, ArrowUp, ArrowUpDown, Download, FileDown, X } from "lucide-react";
import { getEpisodePsaTorrents, getMoviePsaTorrents, getSeasonPsaTorrents } from "../api/psa";
import { getEpisodeTpbTorrents, getMovieTpbTorrents, getSeasonTpbTorrents } from "../api/tpb";
import { downloadWsmTorrent, getEpisodeWsmTorrents, getMovieWsmTorrents, getSeasonWsmTorrents, saveTorrentFile, type WsmTorrent } from "../api/wsm";
import { getMovieYtsTorrents } from "../api/yts";
import { Spinner } from "./ui/Spinner";

interface WsmDownloadModalProps {
  isOpen: boolean;
  onClose: () => void;
  mode: "movie" | "episode" | "season";
  tmdbId: number;
  /** WatchSoMuch's internal id is exactly the numeric part of this IMDb id — required to resolve the title. */
  imdbId?: string | null;
  title: string;
  season?: number;
  episode?: number;
  episodeLabel?: string;
  /** Required for movie mode — the release year must be exact, or the title page 404s. */
  year?: number | null;
}

type ProviderTab = "wsm" | "yts" | "tpb" | "psa";
type RowState = "idle" | "loading" | "ok" | "err";
type RowAction = "magnet" | "torrent";
type SortColumn = "quality" | "size";

const MOVIE_PROVIDERS: ProviderTab[] = ["wsm", "yts", "tpb", "psa"];
const SERIES_PROVIDERS: ProviderTab[] = ["wsm", "tpb", "psa"];

function torrentDefaultName(title: string): string {
  const name = title.replace(/[<>:"/\\|?*]/g, " ").replace(/\s+/g, " ").trim();
  return `${name || "download"}.torrent`;
}

function rowActionKey(provider: ProviderTab, idx: number, action: RowAction): string {
  return `${provider}-${idx}-${action}`;
}

function isSeedBadge(badge: string): boolean {
  return /\d+\s*seeds?/i.test(badge);
}

const QUALITY_RANK: Record<string, number> = { "4K": 4, "1080p": 3, "720p": 2, "480p": 1, Unknown: 0 };

function scoreEntry(torrent: WsmTorrent): number {
  let score = 0;
  const t = torrent.title.toLowerCase();
  const badges = torrent.badges.map((b) => b.toLowerCase());
  const quality = torrent.quality.toLowerCase();

  // Codec
  if (badges.includes("hevc") || t.includes("x265") || t.includes("h.265")) score += 3;
  else if (t.includes("x264") || t.includes("h.264")) score -= 1;

  // Bit depth
  if (badges.includes("10bit") || t.includes("10bit") || t.includes("10-bit")) score += 2;

  // Source
  if (badges.includes("remux") || t.includes("remux")) score += 4;
  else if (badges.includes("web-dl") || t.includes("web-dl")) score += 2;
  else if (badges.includes("webrip") || t.includes("webrip")) score += 1;
  else if (t.includes("telesync") || t.includes("ts ") || t.includes("cam") || t.includes("screener")) score -= 3;

  // Resolution
  if (quality === "4k") score += 3;
  else if (quality === "1080p") score += 2;
  else if (quality === "720p") score += 1;

  // Audio
  if (badges.includes("dolby") || t.includes("atmos") || t.includes("truehd")) score += 1;
  if (badges.includes("5.1ch") || badges.includes("7.1ch") || t.includes("dd5.1") || t.includes("ddp5.1")) score += 1;

  // Trusted rippers
  const trustedRippers = ["psa", "utr", "neonoir", "tigole", "megusta", "galaxy", "ion10", "qman"];
  if (trustedRippers.some((r) => t.includes(r))) score += 2;

  // HDR
  if (badges.includes("hdr10+") || badges.includes("hdr") || t.includes("hdr")) score += 1;

  return score;
}

function getTier(score: number): {
  label: string;
  color: string;
  textColor: string;
  icon: string;
} {
  if (score >= 10) return { label: "Excellent", color: "bg-yellow-500/20", textColor: "text-yellow-400", icon: "✦" };
  if (score >= 7) return { label: "Recommended", color: "bg-green-500/20", textColor: "text-green-400", icon: "✦" };
  if (score >= 4) return { label: "Good", color: "bg-gray-500/20", textColor: "text-gray-300", icon: "·" };
  if (score >= 1) return { label: "Average", color: "bg-gray-500/10", textColor: "text-gray-500", icon: "·" };
  return { label: "Low Quality", color: "bg-red-500/10", textColor: "text-red-400", icon: "✗" };
}

function parseSizeGb(size: string): number {
  const match = size.match(/([\d.]+)\s*(GB|MB)/i);
  if (!match) return 0;
  const value = parseFloat(match[1]);
  return match[2].toUpperCase() === "MB" ? value / 1024 : value;
}

function qualityBadgeClass(quality: string): string {
  switch (quality) {
    case "4K":
      return "bg-purple-500/20 text-purple-300 border-purple-500/30";
    case "1080p":
      return "bg-blue-500/20 text-blue-300 border-blue-500/30";
    case "720p":
      return "bg-green-500/20 text-green-300 border-green-500/30";
    case "480p":
      return "bg-gray-500/20 text-gray-300 border-gray-500/30";
    default:
      return "bg-gray-500/20 text-gray-300 border-gray-500/30";
  }
}

function badgeClass(badge: string): string {
  switch (badge) {
    case "HEVC":
    case "x264":
      return "bg-teal-500/20 text-teal-300";
    case "Dolby":
      return "bg-blue-900/40 text-blue-300";
    case "5.1Ch":
    case "7.1Ch":
      return "bg-gray-500/20 text-gray-300";
    case "HDR":
    case "HDR10+":
      return "bg-orange-500/20 text-orange-300";
    case "10bit":
      return "bg-slate-500/20 text-slate-300";
    case "Remux":
      return "bg-amber-500/20 text-amber-300";
    case "WEBRip":
    case "WEB-DL":
    case "WEB":
      return "bg-gray-500/20 text-gray-300";
    case "Bluray":
      return "bg-indigo-500/20 text-indigo-300";
    case "HDTV":
      return "bg-gray-500/20 text-gray-300";
    case "PSA":
      return "bg-violet-500/20 text-violet-300";
    default:
      return "bg-gray-500/20 text-gray-300";
  }
}

function providerLabel(tab: ProviderTab): string {
  switch (tab) {
    case "wsm":
      return "WatchSoMuch";
    case "yts":
      return "YTS";
    case "tpb":
      return "Pirate Bay";
    case "psa":
      return "PSA";
  }
}

/** Strip placeholder / subtitle suffixes so indexer searches use the core show name. */
function normalizeSearchTitle(raw: string): string {
  const trimmed = raw.trim();
  if (!trimmed || trimmed === "…") return "";
  const base = trimmed.split(":")[0]?.trim() ?? trimmed;
  return base;
}

function providerTabClass(tab: ProviderTab, active: boolean): string {
  if (!active) return "text-pitflix-muted hover:text-white";
  switch (tab) {
    case "wsm":
      return "border border-b-0 border-amber-500/30 bg-amber-500/10 text-amber-300";
    case "yts":
      return "border border-b-0 border-green-500/30 bg-green-500/10 text-green-300";
    case "tpb":
      return "border border-b-0 border-sky-500/30 bg-sky-500/10 text-sky-300";
    case "psa":
      return "border border-b-0 border-violet-500/30 bg-violet-500/10 text-violet-300";
  }
}

export function WsmDownloadModal({
  isOpen,
  onClose,
  mode,
  tmdbId,
  imdbId,
  title,
  season,
  episode,
  episodeLabel,
  year,
}: WsmDownloadModalProps) {
  const [provider, setProvider] = useState<ProviderTab>("wsm");
  const [rowState, setRowState] = useState<Record<string, RowState>>({});
  const [rowError, setRowError] = useState<Record<string, string>>({});
  const [sortColumn, setSortColumn] = useState<SortColumn | null>(null);
  const [sortDir, setSortDir] = useState<"asc" | "desc">("desc");
  const [showInfo, setShowInfo] = useState(false);

  const providerTabs = mode === "movie" ? MOVIE_PROVIDERS : SERIES_PROVIDERS;
  const activeProvider = providerTabs.includes(provider) ? provider : "wsm";

  const searchTitle = normalizeSearchTitle(title);
  const validYear = typeof year === "number" && Number.isFinite(year) && year > 1900 ? year : null;

  const hasWsmData = mode === "movie" ? !!imdbId && !!validYear : !!imdbId;
  const hasYtsData = mode === "movie" && !!searchTitle && !!validYear;
  const hasTpbData = mode === "movie" ? !!searchTitle && !!validYear : !!searchTitle;
  const hasPsaData = hasTpbData;

  useEffect(() => {
    if (isOpen) setProvider("wsm");
  }, [isOpen, tmdbId, mode, season, episode]);

  const wsmQuery = useQuery({
    queryKey: ["wsm", mode, tmdbId, season, episode, imdbId, title, validYear],
    queryFn: () => {
      if (mode === "movie") return getMovieWsmTorrents(tmdbId, imdbId!, title, validYear!);
      if (mode === "season") return getSeasonWsmTorrents(tmdbId, season ?? 0, imdbId!);
      return getEpisodeWsmTorrents(tmdbId, season ?? 0, episode ?? 0, imdbId!);
    },
    enabled: isOpen && hasWsmData,
    staleTime: 30 * 60 * 1000,
  });

  const ytsQuery = useQuery({
    queryKey: ["yts", "movie", tmdbId, imdbId, title, validYear],
    queryFn: () => getMovieYtsTorrents(tmdbId, imdbId, title, validYear!),
    enabled: isOpen && hasYtsData,
    staleTime: 30 * 60 * 1000,
  });

  const tpbQuery = useQuery({
    queryKey: ["tpb", mode, tmdbId, season, episode, title, validYear, imdbId],
    queryFn: () => {
      if (mode === "movie") return getMovieTpbTorrents(tmdbId, title, validYear!, imdbId);
      if (mode === "season") return getSeasonTpbTorrents(tmdbId, season ?? 0, title);
      return getEpisodeTpbTorrents(tmdbId, season ?? 0, episode ?? 0, title);
    },
    enabled: isOpen && hasTpbData,
    staleTime: 30 * 60 * 1000,
  });

  const psaQuery = useQuery({
    queryKey: ["psa", "v4", mode, tmdbId, season, episode, searchTitle, validYear],
    queryFn: () => {
      if (mode === "movie") return getMoviePsaTorrents(tmdbId, searchTitle, validYear!);
      if (mode === "season") return getSeasonPsaTorrents(tmdbId, season ?? 0, searchTitle);
      return getEpisodePsaTorrents(tmdbId, season ?? 0, episode ?? 0, searchTitle);
    },
    enabled: isOpen && hasPsaData,
    staleTime: 2 * 60 * 1000,
    refetchOnMount: "always",
  });

  const activeQuery =
    activeProvider === "yts"
      ? ytsQuery
      : activeProvider === "tpb"
        ? tpbQuery
        : activeProvider === "psa"
          ? psaQuery
          : wsmQuery;
  const hasRequiredData =
    activeProvider === "yts"
      ? hasYtsData
      : activeProvider === "tpb"
        ? hasTpbData
        : activeProvider === "psa"
          ? hasPsaData
          : hasWsmData;

  const activeQueryLoading =
    hasRequiredData &&
    (activeQuery.isFetching ||
      (activeQuery.isPending && activeQuery.fetchStatus !== "idle" && !activeQuery.isFetched));

  const rows = useMemo(() => {
    const items = activeQuery.data?.items ?? [];
    if (!sortColumn) {
      const sorted = [...items];
      sorted.sort((a, b) => scoreEntry(b) - scoreEntry(a));
      return sorted;
    }
    const sorted = [...items];
    sorted.sort((a, b) => {
      const av = sortColumn === "quality" ? QUALITY_RANK[a.quality] ?? 0 : parseSizeGb(a.size);
      const bv = sortColumn === "quality" ? QUALITY_RANK[b.quality] ?? 0 : parseSizeGb(b.size);
      return sortDir === "asc" ? av - bv : bv - av;
    });
    return sorted;
  }, [activeQuery.data, sortColumn, sortDir]);

  const toggleSort = (column: SortColumn) => {
    if (sortColumn === column) {
      setSortDir((d) => (d === "asc" ? "desc" : "asc"));
    } else {
      setSortColumn(column);
      setSortDir("desc");
    }
  };

  const handleMagnet = async (row: WsmTorrent, idx: number) => {
    if (!isTauri()) return;

    const rowKey = rowActionKey(activeProvider, idx, "magnet");
    setRowState((p) => ({ ...p, [rowKey]: "loading" }));
    setRowError((p) => {
      const next = { ...p };
      delete next[rowKey];
      return next;
    });

    const pickSavePath = async () => {
      const selected = await open({ directory: true, multiple: false, title: "Choose a save folder" });
      return typeof selected === "string" ? selected : Array.isArray(selected) ? selected[0] : null;
    };

    try {
      let result = await downloadWsmTorrent({ magnetLink: row.magnetLink });
      if (result.action === "open_magnet") {
        await openUrl(row.magnetLink);
      }
      setRowState((p) => ({ ...p, [rowKey]: "ok" }));
    } catch (e) {
      const axiosError = (e as { response?: { data?: { error?: string } } })?.response?.data?.error;
      const needsFolder =
        typeof axiosError === "string" && axiosError.toLowerCase().includes("save folder");

      if (needsFolder) {
        try {
          const savePath = await pickSavePath();
          if (!savePath) {
            setRowState((p) => ({ ...p, [rowKey]: "idle" }));
            return;
          }
          const result = await downloadWsmTorrent({ magnetLink: row.magnetLink, savePath });
          if (result.action === "open_magnet") {
            await openUrl(row.magnetLink);
          }
          setRowState((p) => ({ ...p, [rowKey]: "ok" }));
          return;
        } catch (retryErr) {
          const retryAxios = (retryErr as { response?: { data?: { error?: string } } })?.response?.data?.error;
          const retryMessage =
            retryErr instanceof Error ? retryErr.message : typeof retryErr === "string" ? retryErr : null;
          setRowError((p) => ({ ...p, [rowKey]: retryAxios ?? retryMessage ?? "Download failed." }));
          setRowState((p) => ({ ...p, [rowKey]: "err" }));
          return;
        }
      }

      const plainMessage = e instanceof Error ? e.message : typeof e === "string" ? e : null;
      setRowError((p) => ({ ...p, [rowKey]: axiosError ?? plainMessage ?? "Download failed." }));
      setRowState((p) => ({ ...p, [rowKey]: "err" }));
    }
  };

  const handleTorrentFile = async (row: WsmTorrent, idx: number) => {
    if (!isTauri()) return;
    if (!row.torrentFileUrl?.trim()) return;

    const rowKey = rowActionKey(activeProvider, idx, "torrent");
    setRowState((p) => ({ ...p, [rowKey]: "loading" }));
    setRowError((p) => {
      const next = { ...p };
      delete next[rowKey];
      return next;
    });

    try {
      const dest = await save({
        defaultPath: torrentDefaultName(row.title),
        filters: [{ name: "Torrent", extensions: ["torrent"] }],
        title: "Save torrent file",
      });
      if (!dest) {
        setRowState((p) => ({ ...p, [rowKey]: "idle" }));
        return;
      }

      await saveTorrentFile({
        torrentFileUrl: row.torrentFileUrl,
        savePath: dest,
        title: row.title,
      });
      setRowState((p) => ({ ...p, [rowKey]: "ok" }));
    } catch (e) {
      const axiosError = (e as { response?: { data?: { error?: string } } })?.response?.data?.error;
      const plainMessage = e instanceof Error ? e.message : typeof e === "string" ? e : null;
      setRowError((p) => ({ ...p, [rowKey]: axiosError ?? plainMessage ?? "Could not save torrent file." }));
      setRowState((p) => ({ ...p, [rowKey]: "err" }));
    }
  };

  const handleClose = () => {
    setShowInfo(false);
    onClose();
  };

  const handleProviderChange = (tab: ProviderTab) => {
    setProvider(tab);
    setSortColumn(null);
    setSortDir("desc");
    if (tab === "psa" && isOpen && hasPsaData) {
      void psaQuery.refetch();
    }
  };

  return (
    <AnimatePresence>
      {isOpen ? (
        <motion.div
          role="presentation"
          className="fixed inset-0 z-[100] flex items-center justify-center bg-black/70 p-4"
          initial={{ opacity: 0 }}
          animate={{ opacity: 1 }}
          exit={{ opacity: 0 }}
          onClick={handleClose}
        >
          <motion.div
            initial={{ opacity: 0, scale: 0.97 }}
            animate={{ opacity: 1, scale: 1 }}
            exit={{ opacity: 0, scale: 0.97 }}
            transition={{ type: "tween", duration: 0.18 }}
            onClick={(e) => e.stopPropagation()}
            className={`flex max-h-[80vh] w-full flex-col overflow-hidden rounded-2xl border border-pitflix-card bg-pitflix-surface shadow-2xl ${
              activeProvider === "tpb" || activeProvider === "psa" ? "max-w-[920px]" : "max-w-[800px]"
            }`}
          >
            <div className="flex items-center justify-between border-b border-pitflix-card px-4 py-3">
              <h2 className="flex min-w-0 items-center gap-2 truncate text-sm font-semibold text-white">
                <Download className="h-4 w-4 shrink-0" />
                <span className="truncate">
                  Download — {title}
                  {mode !== "movie" && episodeLabel ? ` ${episodeLabel}` : ""}
                </span>
              </h2>
              <div className="flex shrink-0 items-center gap-2">
                <button
                  type="button"
                  onClick={() => setShowInfo((prev) => !prev)}
                  className="flex h-6 w-6 items-center justify-center rounded-full border border-gray-600 text-sm text-gray-400 transition-colors hover:text-white"
                  title="How quality scores work"
                >
                  i
                </button>
                <button type="button" onClick={handleClose} className="text-pitflix-muted hover:text-white" aria-label="Close">
                  <X className="h-4 w-4" />
                </button>
              </div>
            </div>

            <div className="flex gap-1 border-b border-pitflix-card px-4 pt-2">
              {providerTabs.map((tab) => (
                <button
                  key={tab}
                  type="button"
                  onClick={() => handleProviderChange(tab)}
                  className={`rounded-t-lg px-3 py-2 text-xs font-semibold transition ${providerTabClass(tab, activeProvider === tab)}`}
                >
                  {providerLabel(tab)}
                </button>
              ))}
            </div>

            {showInfo && (
              <div className="mx-4 mb-3 space-y-2 rounded-lg border border-gray-700 bg-gray-800 p-3 text-sm text-gray-300">
                <p className="mb-2 font-medium text-white">How quality scores work</p>
                <p>Each torrent is scored based on codec, source, resolution, audio, and ripper reputation. Higher is better.</p>
                <div className="mt-2 grid grid-cols-2 gap-x-6 gap-y-1">
                  <div className="flex items-center gap-2">
                    <span className="font-medium text-yellow-400">✦ Excellent</span>
                    <span className="text-gray-500">score 10+</span>
                  </div>
                  <div className="text-gray-400">4K · Remux · Dolby · trusted ripper</div>
                  <div className="flex items-center gap-2">
                    <span className="font-medium text-green-400">✦ Recommended</span>
                    <span className="text-gray-500">score 7–9</span>
                  </div>
                  <div className="text-gray-400">HEVC · 10bit · WEBRip/WEB-DL · PSA/UTR/NeoNoir</div>
                  <div className="flex items-center gap-2">
                    <span className="font-medium text-gray-300">· Good</span>
                    <span className="text-gray-500">score 4–6</span>
                  </div>
                  <div className="text-gray-400">1080p x264 or 720p HEVC without trusted ripper</div>
                  <div className="flex items-center gap-2">
                    <span className="font-medium text-gray-500">· Average</span>
                    <span className="text-gray-500">score 1–3</span>
                  </div>
                  <div className="text-gray-400">YIFY/YTS standard encodes</div>
                  <div className="flex items-center gap-2">
                    <span className="font-medium text-red-400">✗ Low Quality</span>
                    <span className="text-gray-500">score ≤ 0</span>
                  </div>
                  <div className="text-gray-400">CAM · Screener · Telesync</div>
                </div>
                <p className="mt-2 text-xs text-gray-500">
                  Scoring signals: HEVC +3 · 10bit +2 · WEB-DL +2 · WEBRip +1 · Remux +4 ·
                  4K +3 · 1080p +2 · 720p +1 · Dolby/surround +1 · HDR +1 · trusted ripper +2 ·
                  x264 only −1 · CAM/Screener −3
                </p>
              </div>
            )}

            <div className="min-h-0 flex-1 overflow-x-hidden overflow-y-auto p-4">
              {!hasRequiredData ? (
                <p className="py-12 text-center text-sm text-pitflix-muted">
                  {activeProvider === "yts"
                    ? "Missing title or release year — can't search YTS."
                    : activeProvider === "tpb"
                      ? mode === "movie"
                        ? "Missing title or release year — can't search Pirate Bay."
                        : "Missing series title — can't search Pirate Bay."
                      : activeProvider === "psa"
                        ? mode === "movie"
                          ? "Missing title or release year — can't search PSA indexers."
                          : "Missing series title — can't search PSA indexers."
                        : mode === "movie"
                        ? "Missing IMDb ID or release year for this title — can't search WatchSoMuch."
                        : "Missing IMDb ID for this series — can't search WatchSoMuch."}
                </p>
              ) : activeQueryLoading ? (
                <div className="flex flex-1 flex-col items-center justify-center gap-3 py-16">
                  <Spinner />
                  <p className="text-sm text-pitflix-muted">Searching {providerLabel(activeProvider)}...</p>
                </div>
              ) : activeQuery.isError ? (
                <div className="flex flex-col items-center gap-3 py-12 text-center">
                  <p className="text-sm text-red-400">Could not search {providerLabel(activeProvider)}.</p>
                  <button
                    type="button"
                    onClick={() => void activeQuery.refetch()}
                    className="rounded-xl border border-white/10 px-3.5 py-1.5 text-[11px] text-white hover:border-pitflix-primary/50"
                  >
                    Retry
                  </button>
                </div>
              ) : rows.length === 0 ? (
                <p className="py-12 text-center text-sm text-pitflix-muted">
                  {activeProvider === "psa"
                    ? "No PSA releases found for this title. PSA may not have encoded it — try WatchSoMuch or Pirate Bay for other groups."
                    : `No torrents found on ${providerLabel(activeProvider)} for this title.`}
                </p>
              ) : (
                <table className="w-full table-fixed border-collapse text-left text-xs">
                  <thead>
                    <tr className="text-[10px] uppercase tracking-wide text-pitflix-subtle">
                      <th className={`px-2 py-2 font-medium ${activeProvider === "tpb" ? "w-[88px]" : "w-[100px]"}`}>Score</th>
                      <th className={`px-2 py-2 font-medium ${activeProvider === "tpb" ? "w-[68px]" : "w-[64px]"}`}>
                        <button
                          type="button"
                          onClick={() => toggleSort("quality")}
                          className="flex items-center gap-1 uppercase tracking-wide text-pitflix-subtle hover:text-white"
                        >
                          Quality
                          {sortColumn === "quality" ? (
                            sortDir === "asc" ? <ArrowUp className="h-3 w-3" /> : <ArrowDown className="h-3 w-3" />
                          ) : (
                            <ArrowUpDown className="h-3 w-3 opacity-50" />
                          )}
                        </button>
                      </th>
                      {activeProvider !== "tpb" ? (
                        <>
                          <th className="w-[118px] px-2 py-2 font-medium">Badges</th>
                          <th className="px-2 py-2 font-medium">Title</th>
                          <th className="w-[52px] px-2 py-2 font-medium">Format</th>
                        </>
                      ) : (
                        <th className="px-2 py-2 font-medium">Title</th>
                      )}
                      <th className={`px-2 py-2 text-right font-medium ${activeProvider === "tpb" ? "w-[76px]" : "w-[72px]"}`}>
                        <button
                          type="button"
                          onClick={() => toggleSort("size")}
                          className="ml-auto flex items-center gap-1 uppercase tracking-wide text-pitflix-subtle hover:text-white"
                        >
                          Size
                          {sortColumn === "size" ? (
                            sortDir === "asc" ? <ArrowUp className="h-3 w-3" /> : <ArrowDown className="h-3 w-3" />
                          ) : (
                            <ArrowUpDown className="h-3 w-3 opacity-50" />
                          )}
                        </button>
                      </th>
                      <th className={`px-2 py-2 text-right font-medium ${activeProvider === "tpb" ? "w-[76px]" : "w-[80px]"}`}>
                        Action
                      </th>
                    </tr>
                  </thead>
                  <tbody>
                    {rows.map((row, idx) => {
                      const magnetKey = rowActionKey(activeProvider, idx, "magnet");
                      const torrentKey = rowActionKey(activeProvider, idx, "torrent");
                      const magnetState = rowState[magnetKey] ?? "idle";
                      const torrentState = rowState[torrentKey] ?? "idle";
                      const score = scoreEntry(row);
                      const tier = getTier(score);
                      const codecBadges = row.badges.filter((b) => !isSeedBadge(b));
                      const seedBadge = row.badges.find(isSeedBadge);
                      const hasTorrentFile = !!row.torrentFileUrl?.trim();
                      const rowErr = rowError[magnetKey] ?? rowError[torrentKey];

                      return (
                        <tr key={`${activeProvider}-${idx}-${row.title}`} className="border-t border-pitflix-card/60">
                          <td className="px-2 py-2 align-top">
                            <div
                              className={`inline-flex max-w-full items-center gap-1 rounded px-1.5 py-0.5 text-[10px] font-medium ${tier.color} ${tier.textColor} ${
                                activeProvider === "tpb" ? "whitespace-nowrap" : "flex-wrap"
                              }`}
                              title={`${tier.label} (${score})`}
                            >
                              <span>{tier.icon}</span>
                              {activeProvider === "tpb" ? (
                                <span>{score}</span>
                              ) : (
                                <>
                                  <span>{tier.label}</span>
                                  <span className="text-gray-500">({score})</span>
                                </>
                              )}
                            </div>
                          </td>
                          <td className="px-2 py-2 align-top">
                            <span
                              className={`inline-block rounded-full border px-2 py-0.5 text-[10px] font-semibold ${qualityBadgeClass(row.quality)}`}
                            >
                              {row.quality}
                            </span>
                          </td>
                          {activeProvider !== "tpb" ? (
                            <>
                              <td className="px-2 py-2 align-top">
                                <div className="flex flex-wrap gap-1">
                                  {row.badges.map((b) => (
                                    <span key={b} className={`rounded px-1.5 py-0.5 text-[9px] font-medium ${badgeClass(b)}`}>
                                      {b}
                                    </span>
                                  ))}
                                </div>
                              </td>
                              <td className="min-w-0 px-2 py-2 align-top">
                                <p className="break-all text-white">{row.title}</p>
                              </td>
                              <td className="px-2 py-2 align-top text-pitflix-subtle">{row.format}</td>
                            </>
                          ) : (
                            <td className="px-2 py-2 align-top">
                              <p className="line-clamp-2 break-words text-[11px] leading-snug text-white" title={row.title}>
                                {row.title}
                              </p>
                              <div className="mt-1 flex flex-wrap gap-1">
                                {codecBadges.slice(0, 3).map((b) => (
                                  <span key={b} className={`rounded px-1 py-0.5 text-[8px] font-medium ${badgeClass(b)}`}>
                                    {b}
                                  </span>
                                ))}
                                {seedBadge ? (
                                  <span className="rounded px-1 py-0.5 text-[8px] font-medium text-pitflix-subtle">{seedBadge}</span>
                                ) : null}
                              </div>
                            </td>
                          )}
                          <td className="px-2 py-2 text-right align-top text-pitflix-muted whitespace-nowrap">
                            {row.size || "—"}
                          </td>
                          <td className="px-2 py-2 align-top">
                            <div className="flex justify-end gap-1">
                              <button
                                type="button"
                                disabled={magnetState === "loading"}
                                onClick={() => void handleMagnet(row, idx)}
                                title="Open magnet link"
                                className="flex h-7 w-7 items-center justify-center rounded-lg bg-pitflix-primary text-white disabled:opacity-50"
                              >
                                {magnetState === "loading" ? (
                                  <Spinner className="h-3 w-3" />
                                ) : magnetState === "ok" ? (
                                  "✓"
                                ) : (
                                  <Download className="h-3.5 w-3.5" />
                                )}
                              </button>
                              <button
                                type="button"
                                disabled={!hasTorrentFile || torrentState === "loading"}
                                onClick={() => void handleTorrentFile(row, idx)}
                                title={hasTorrentFile ? "Save .torrent file" : "No torrent file available"}
                                className="flex h-7 w-7 items-center justify-center rounded-lg border border-white/15 bg-white/5 text-white hover:bg-white/10 disabled:opacity-40"
                              >
                                {torrentState === "loading" ? (
                                  <Spinner className="h-3 w-3" />
                                ) : torrentState === "ok" ? (
                                  "✓"
                                ) : (
                                  <FileDown className="h-3.5 w-3.5" />
                                )}
                              </button>
                            </div>
                            {rowErr ? <p className="mt-1 max-w-[72px] text-right text-[9px] leading-tight text-red-400">{rowErr}</p> : null}
                          </td>
                        </tr>
                      );
                    })}
                  </tbody>
                </table>
              )}
            </div>
          </motion.div>
        </motion.div>
      ) : null}
    </AnimatePresence>
  );
}
