import { AnimatePresence, motion } from "framer-motion";
import { useEffect, useMemo, useRef, useState } from "react";
import { useQuery } from "@tanstack/react-query";
import { open, save } from "@tauri-apps/plugin-dialog";
import { openUrl } from "@tauri-apps/plugin-opener";
import { invoke, isTauri } from "@tauri-apps/api/core";
import { ArrowDown, ArrowUp, ArrowUpDown, Download, FileDown, Play, X } from "lucide-react";
import { getEpisodeEztvTorrents, getSeasonEztvTorrents } from "../api/eztv";
import { getEpisodePsaTorrents, getMoviePsaTorrents, getSeasonPsaTorrents } from "../api/psa";
import { getEpisodeTpbTorrents, getMovieTpbTorrents, getSeasonTpbTorrents } from "../api/tpb";
import { downloadWsmTorrent, getEpisodeWsmTorrents, getMovieWsmTorrents, getSeasonWsmTorrents, saveTorrentFile, type WsmTorrent } from "../api/wsm";
import { getMovieYtsTorrents } from "../api/yts";
import { getEpisodeStremioAddonStreams, getMovieStremioAddonStreams } from "../api/stremioAddon";
import { Spinner } from "./ui/Spinner";
import { usePlayback } from "../hooks/usePlayback";
import { TorrentStreamProgress } from "./TorrentStreamProgress";

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

type ProviderTab = "stremio" | "comet" | "wsm" | "yts" | "tpb" | "psa" | "eztv";
type RowState = "idle" | "loading" | "ok" | "err";
type RowAction = "magnet" | "torrent" | "stream";
type SortColumn = "quality" | "size";

const MOVIE_PROVIDERS: ProviderTab[] = ["stremio", "comet", "wsm", "yts", "tpb", "psa"];
// EZTV has no movie catalog — TV only.
const SERIES_PROVIDERS: ProviderTab[] = ["stremio", "comet", "wsm", "tpb", "psa", "eztv"];
const SEASON_PROVIDERS: ProviderTab[] = ["wsm", "tpb", "psa", "eztv"];

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

const COMET_JUNK_RESULT =
  /\b(trailer|teaser|featurette|interview|review|behind[\s._-]*the[\s._-]*scenes|promo|tv[\s._-]*spot|surveillance|classroom|lecture|reaction|explained|reveals?|clip)\b/i;
const TITLE_STOP_WORDS = new Set(["a", "an", "and", "at", "for", "in", "of", "on", "the", "to"]);

function normalizedWords(value: string): string[] {
  return value
    .normalize("NFKD")
    .toLowerCase()
    .replace(/[\u0300-\u036f]/g, "")
    .replace(/[^a-z0-9]+/g, " ")
    .trim()
    .split(/\s+/)
    .filter(Boolean);
}

function isRelevantCometResult(
  torrent: WsmTorrent,
  context: {
    mode: WsmDownloadModalProps["mode"];
    title: string;
    year: number | null;
    season?: number;
    episode?: number;
  },
): boolean {
  const resultText = torrent.title;
  const resultWords = new Set(normalizedWords(resultText));
  const titleWords = normalizedWords(context.title).filter(
    (word) => word.length > 1 && !TITLE_STOP_WORDS.has(word),
  );

  if (titleWords.length > 0 && !titleWords.every((word) => resultWords.has(word))) return false;
  if (COMET_JUNK_RESULT.test(resultText) || /\binternet[\s._-]*archive\b/i.test(resultText)) return false;

  const sizeGb = parseSizeGb(torrent.size);
  const minimumSizeGb = context.mode === "movie" ? 0.2 : 0.04;
  if (sizeGb > 0 && sizeGb < minimumSizeGb) return false;

  if (context.mode === "movie" && context.year) {
    const resultYears = Array.from(resultText.matchAll(/\b(?:19|20)\d{2}\b/g), (match) => Number(match[0]));
    if (resultYears.length > 0 && !resultYears.includes(context.year)) return false;
  }

  if (context.mode === "episode" && context.season != null && context.episode != null) {
    const episodeMarkers = Array.from(resultText.matchAll(/\bS(\d{1,2})E(\d{1,3})\b/gi));
    if (
      episodeMarkers.length > 0 &&
      !episodeMarkers.some(
        (match) => Number(match[1]) === context.season && Number(match[2]) === context.episode,
      )
    )
      return false;
  }

  return true;
}

function filterCometResults(
  items: WsmTorrent[],
  context: Parameters<typeof isRelevantCometResult>[1],
): WsmTorrent[] {
  const perQualityLimit: Record<string, number> = {
    "4K": 30,
    "1080p": 30,
    "720p": 25,
    "480p": 15,
    Unknown: 10,
  };
  const qualityCounts = new Map<string, number>();

  return items
    .filter((item) => isRelevantCometResult(item, context))
    .filter((item) => {
      const count = qualityCounts.get(item.quality) ?? 0;
      const limit = perQualityLimit[item.quality] ?? 15;
      if (count >= limit) return false;
      qualityCounts.set(item.quality, count + 1);
      return true;
    })
    .slice(0, 110);
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
    case "stremio":
      return "Torrentio";
    case "comet":
      return "Comet";
    case "wsm":
      return "WatchSoMuch";
    case "yts":
      return "YTS";
    case "tpb":
      return "Pirate Bay";
    case "psa":
      return "PSA";
    case "eztv":
      return "EZTV";
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
    case "stremio":
      return "border border-b-0 border-orange-500/30 bg-orange-500/10 text-orange-300";
    case "comet":
      return "border border-b-0 border-cyan-500/30 bg-cyan-500/10 text-cyan-300";
    case "wsm":
      return "border border-b-0 border-amber-500/30 bg-amber-500/10 text-amber-300";
    case "yts":
      return "border border-b-0 border-green-500/30 bg-green-500/10 text-green-300";
    case "tpb":
      return "border border-b-0 border-sky-500/30 bg-sky-500/10 text-sky-300";
    case "psa":
      return "border border-b-0 border-violet-500/30 bg-violet-500/10 text-violet-300";
    case "eztv":
      return "border border-b-0 border-rose-500/30 bg-rose-500/10 text-rose-300";
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
  const { play } = usePlayback();
  const [provider, setProvider] = useState<ProviderTab>("wsm");
  const [rowState, setRowState] = useState<Record<string, RowState>>({});
  const [rowError, setRowError] = useState<Record<string, string>>({});
  const [sortColumn, setSortColumn] = useState<SortColumn | null>(null);
  const [sortDir, setSortDir] = useState<"asc" | "desc">("desc");
  const [showInfo, setShowInfo] = useState(false);
  const [showUnfilteredComet, setShowUnfilteredComet] = useState(false);
  const [streamPreparation, setStreamPreparation] = useState<{
    infoHash: string;
    label: string;
    rowKey: string;
    error?: string;
  } | null>(null);
  const cancelledStreamsRef = useRef(new Set<string>());

  const providerTabs = mode === "movie" ? MOVIE_PROVIDERS : mode === "season" ? SEASON_PROVIDERS : SERIES_PROVIDERS;
  const activeProvider = providerTabs.includes(provider) ? provider : "wsm";

  const searchTitle = normalizeSearchTitle(title);
  const validYear = typeof year === "number" && Number.isFinite(year) && year > 1900 ? year : null;

  const hasWsmData = mode === "movie" ? !!imdbId && !!validYear : !!imdbId;
  const hasYtsData = mode === "movie" && !!searchTitle && !!validYear;
  const hasTpbData = mode === "movie" ? !!searchTitle && !!validYear : !!searchTitle;
  const hasPsaData = hasTpbData;
  // EZTV is ID-exact like WSM, not title-search like TPB/PSA — and TV-only.
  const hasEztvData = mode !== "movie" && !!imdbId;
  const hasStremioData = mode !== "season" && !!imdbId;

  useEffect(() => {
    if (isOpen) {
      setProvider(mode === "season" ? "wsm" : "stremio");
      setShowUnfilteredComet(false);
    }
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
    // PSA's scrape is the most expensive of the four (multi-query, multi-site cascade — see
    // PsaScraperService), and the backend now caches its results server-side too. Match WSM/TPB's
    // staleTime/refetch behavior instead of forcing a fresh network round-trip on every tab
    // switch/remount — that combo (2 min + refetchOnMount:"always") previously meant re-opening the
    // PSA tab almost always re-ran the whole cascade.
    staleTime: 30 * 60 * 1000,
  });

  const eztvQuery = useQuery({
    queryKey: ["eztv", mode, tmdbId, season, episode, imdbId],
    queryFn: () => {
      if (mode === "season") return getSeasonEztvTorrents(tmdbId, season ?? 0, imdbId!);
      return getEpisodeEztvTorrents(tmdbId, season ?? 0, episode ?? 0, imdbId!);
    },
    enabled: isOpen && hasEztvData,
    staleTime: 30 * 60 * 1000,
  });

  const stremioQuery = useQuery({
    queryKey: ["stremio-addon", "torrentio", mode, tmdbId, season, episode, imdbId],
    queryFn: () => {
      if (mode === "movie") return getMovieStremioAddonStreams(tmdbId, imdbId!, "torrentio");
      return getEpisodeStremioAddonStreams(tmdbId, season ?? 0, episode ?? 0, imdbId!, "torrentio");
    },
    enabled: isOpen && hasStremioData,
    staleTime: 15 * 60 * 1000,
  });

  const cometQuery = useQuery({
    queryKey: ["stremio-addon", "comet", mode, tmdbId, season, episode, imdbId],
    queryFn: () => {
      if (mode === "movie") return getMovieStremioAddonStreams(tmdbId, imdbId!, "comet");
      return getEpisodeStremioAddonStreams(tmdbId, season ?? 0, episode ?? 0, imdbId!, "comet");
    },
    enabled: isOpen && hasStremioData,
    staleTime: 15 * 60 * 1000,
  });

  const activeQuery =
    activeProvider === "stremio"
      ? stremioQuery
      : activeProvider === "comet"
        ? cometQuery
      : activeProvider === "yts"
      ? ytsQuery
      : activeProvider === "tpb"
        ? tpbQuery
        : activeProvider === "psa"
          ? psaQuery
          : activeProvider === "eztv"
            ? eztvQuery
            : wsmQuery;
  const hasRequiredData =
    activeProvider === "stremio" || activeProvider === "comet"
      ? hasStremioData
      : activeProvider === "yts"
      ? hasYtsData
      : activeProvider === "tpb"
        ? hasTpbData
        : activeProvider === "psa"
          ? hasPsaData
          : activeProvider === "eztv"
            ? hasEztvData
            : hasWsmData;

  const activeQueryLoading =
    hasRequiredData &&
    (activeQuery.isFetching ||
      (activeQuery.isPending && activeQuery.fetchStatus !== "idle" && !activeQuery.isFetched));

  /**
   * Per-tab progress, so a slow provider (EZTV in particular can take many seconds when its
   * upstream is struggling) doesn't hide the fact that other tabs already have results. All the
   * provider queries run in parallel from the moment the modal opens, so this is just surfacing
   * state we already have.
   */
  const providerStatus = useMemo(() => {
    const entry = (
      q: { isFetching: boolean; data?: { items?: unknown[] } | undefined; isFetched: boolean },
      available: boolean,
    ) => ({
      available,
      loading: available && q.isFetching,
      count: (q.data?.items ?? []).length,
      done: available && q.isFetched && !q.isFetching,
    });
    return {
      wsm: entry(wsmQuery, hasWsmData),
      yts: entry(ytsQuery, hasYtsData),
      tpb: entry(tpbQuery, hasTpbData),
      psa: entry(psaQuery, hasPsaData),
      eztv: entry(eztvQuery, hasEztvData),
      stremio: entry(stremioQuery, hasStremioData),
      comet: entry(cometQuery, hasStremioData),
    } as Record<ProviderTab, { available: boolean; loading: boolean; count: number; done: boolean }>;
  }, [
    wsmQuery, ytsQuery, tpbQuery, psaQuery, eztvQuery, stremioQuery, cometQuery,
    hasWsmData, hasYtsData, hasTpbData, hasPsaData, hasEztvData, hasStremioData,
  ]);

  const cometItems = cometQuery.data?.items ?? [];
  const relevantCometItems = useMemo(
    () =>
      filterCometResults(cometItems, {
        mode,
        title: searchTitle,
        year: validYear,
        season,
        episode,
      }),
    [cometQuery.data, mode, searchTitle, validYear, season, episode],
  );
  const cometHiddenCount = Math.max(0, cometItems.length - relevantCometItems.length);

  const rows = useMemo(() => {
    const items =
      activeProvider === "comet" && !showUnfilteredComet
        ? relevantCometItems
        : activeQuery.data?.items ?? [];
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
  }, [activeProvider, activeQuery.data, relevantCometItems, showUnfilteredComet, sortColumn, sortDir]);

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
    if (!row.magnetLink?.trim()) return;

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
      let result = await downloadWsmTorrent({ magnetLink: row.magnetLink, fileIndex: row.fileIndex });
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
          const result = await downloadWsmTorrent({
            magnetLink: row.magnetLink,
            savePath,
            fileIndex: row.fileIndex,
          });
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

  const handleStream = async (row: WsmTorrent, idx: number) => {
    if (!isTauri()) return;
    if (!row.directUrl && !row.infoHash) return;

    const rowKey = rowActionKey(activeProvider, idx, "stream");
    setRowState((previous) => ({ ...previous, [rowKey]: "loading" }));
    setRowError((previous) => {
      const next = { ...previous };
      delete next[rowKey];
      return next;
    });

    try {
      let streamUrl = row.directUrl?.trim() ?? "";
      let torrentInfoHash: string | undefined;
      if (!streamUrl) {
        cancelledStreamsRef.current.delete(row.infoHash!);
        setStreamPreparation({ infoHash: row.infoHash!, label: row.title, rowKey });
        const trackers = row.magnetLink?.trim()
          ? Array.from(new URL(row.magnetLink).searchParams.getAll("tr"))
          : [];
        const result = await invoke<{
          url: string;
          infoHash: string;
          fileIndex: number;
          filename: string;
          size: number;
        }>("torrent_stream_start", {
          infoHash: row.infoHash,
          fileIndex: row.fileIndex ?? null,
          trackers,
        });
        streamUrl = result.url;
        torrentInfoHash = result.infoHash;
        if (cancelledStreamsRef.current.has(result.infoHash)) {
          cancelledStreamsRef.current.delete(result.infoHash);
          await invoke("torrent_stream_stop", { infoHash: result.infoHash, deleteFiles: true }).catch(() => {});
          setRowState((previous) => ({ ...previous, [rowKey]: "idle" }));
          return;
        }
      }

      setRowState((previous) => ({ ...previous, [rowKey]: "ok" }));
      setStreamPreparation(null);
      setShowInfo(false);
      onClose();
      await play(
        streamUrl,
        title,
        null,
        mode === "movie" ? "Movie" : "Episode",
        0,
        {
          season,
          episodeNumber: episode,
          suppressContinueWatching: true,
          torrentInfoHash,
        },
        0,
      );
    } catch (error) {
      if (row.infoHash && cancelledStreamsRef.current.has(row.infoHash)) {
        cancelledStreamsRef.current.delete(row.infoHash);
        setRowState((previous) => ({ ...previous, [rowKey]: "idle" }));
        return;
      }
      const message = error instanceof Error ? error.message : String(error);
      if (row.infoHash) {
        setStreamPreparation({
          infoHash: row.infoHash,
          label: row.title,
          rowKey,
          error: message || "This torrent is not ready to stream.",
        });
      }
      setRowError((previous) => ({ ...previous, [rowKey]: message || "Could not start stream." }));
      setRowState((previous) => ({ ...previous, [rowKey]: "err" }));
    }
  };

  const handleCancelStream = () => {
    const preparation = streamPreparation;
    if (!preparation) return;
    cancelledStreamsRef.current.add(preparation.infoHash);
    setStreamPreparation(null);
    setRowState((previous) => ({ ...previous, [preparation.rowKey]: "idle" }));
    setRowError((previous) => {
      const next = { ...previous };
      delete next[preparation.rowKey];
      return next;
    });
    void invoke("torrent_stream_stop", {
      infoHash: preparation.infoHash,
      deleteFiles: true,
    }).catch(() => {});
  };

  const handleClose = () => {
    if (streamPreparation && !streamPreparation.error) {
      cancelledStreamsRef.current.add(streamPreparation.infoHash);
      void invoke("torrent_stream_stop", {
        infoHash: streamPreparation.infoHash,
        deleteFiles: true,
      }).catch(() => {});
    }
    setShowInfo(false);
    setStreamPreparation(null);
    onClose();
  };

  const handleProviderChange = (tab: ProviderTab) => {
    setProvider(tab);
    setSortColumn(null);
    setSortDir("desc");
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
              activeProvider === "tpb" ||
              activeProvider === "psa" ||
              activeProvider === "stremio" ||
              activeProvider === "comet"
                ? "max-w-[920px]"
                : "max-w-[800px]"
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
              {providerTabs.map((tab) => {
                const status = providerStatus[tab];
                return (
                  <button
                    key={tab}
                    type="button"
                    onClick={() => handleProviderChange(tab)}
                    className={`flex items-center gap-1.5 rounded-t-lg px-3 py-2 text-xs font-semibold transition ${providerTabClass(tab, activeProvider === tab)}`}
                  >
                    {providerLabel(tab)}
                    {status?.loading ? (
                      <Spinner className="h-3 w-3 opacity-70" />
                    ) : status?.done && status.count > 0 ? (
                      <span className="rounded-full bg-white/20 px-1.5 text-[10px] leading-4 tabular-nums">
                        {status.count}
                      </span>
                    ) : null}
                  </button>
                );
              })}
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

            {streamPreparation ? (
              <TorrentStreamProgress
                infoHash={streamPreparation.infoHash}
                label={streamPreparation.label}
                error={streamPreparation.error}
                onCancel={handleCancelStream}
              />
            ) : null}

            <div className="min-h-0 flex-1 overflow-x-hidden overflow-y-auto p-4">
              {!hasRequiredData ? (
                <p className="py-12 text-center text-sm text-pitflix-muted">
                  {activeProvider === "stremio" || activeProvider === "comet"
                    ? "Missing IMDb ID for this title — can't search the configured Stremio addon."
                    : activeProvider === "yts"
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
                <div className="flex flex-col items-center gap-3 py-12 text-center">
                  <p className="text-sm text-pitflix-muted">
                    {activeProvider === "psa"
                      ? "No PSA releases found for this title. PSA may not have encoded it — try WatchSoMuch or Pirate Bay for other groups."
                      : activeProvider === "comet" && cometHiddenCount > 0
                        ? `Comet returned ${cometHiddenCount} results, but none passed the title, year, size, and video-release filters.`
                        : `No torrents found on ${providerLabel(activeProvider)} for this title.`}
                  </p>
                  {activeProvider === "comet" && cometHiddenCount > 0 ? (
                    <button
                      type="button"
                      onClick={() => setShowUnfilteredComet(true)}
                      className="rounded-xl border border-white/10 px-3.5 py-1.5 text-[11px] text-white hover:border-cyan-400/50"
                    >
                      Show unfiltered results
                    </button>
                  ) : null}
                </div>
              ) : (
                <>
                  {activeProvider === "comet" && cometHiddenCount > 0 ? (
                    <div className="mb-2 flex items-center justify-between gap-3 rounded-lg border border-cyan-500/15 bg-cyan-500/5 px-3 py-2 text-[10px] text-cyan-100/70">
                      <span>
                        {showUnfilteredComet
                          ? `Showing all ${cometItems.length} Comet results.`
                          : `Filtered ${cometHiddenCount} likely trailers, clips, archive matches, tiny files, excess duplicates, or wrong-year releases.`}
                      </span>
                      <button
                        type="button"
                        onClick={() => setShowUnfilteredComet((value) => !value)}
                        className="shrink-0 font-semibold text-cyan-300 hover:text-cyan-200"
                      >
                        {showUnfilteredComet ? "Use safe filter" : "Show all"}
                      </button>
                    </div>
                  ) : null}
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
                      const streamKey = rowActionKey(activeProvider, idx, "stream");
                      const magnetState = rowState[magnetKey] ?? "idle";
                      const torrentState = rowState[torrentKey] ?? "idle";
                      const streamState = rowState[streamKey] ?? "idle";
                      const score = scoreEntry(row);
                      const tier = getTier(score);
                      const codecBadges = row.badges.filter((b) => !isSeedBadge(b));
                      const seedBadge = row.badges.find(isSeedBadge);
                      const hasTorrentFile = !!row.torrentFileUrl?.trim();
                      const hasMagnet = !!row.magnetLink?.trim();
                      const canStream = !!row.directUrl?.trim() || !!row.infoHash?.trim();
                      const rowErr = rowError[streamKey] ?? rowError[magnetKey] ?? rowError[torrentKey];

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
                                disabled={!canStream || streamState === "loading"}
                                onClick={() => void handleStream(row, idx)}
                                title={row.directUrl ? "Play direct stream" : "Stream torrent in Pitflix"}
                                className="flex h-7 w-7 items-center justify-center rounded-lg bg-emerald-600 text-white hover:bg-emerald-500 disabled:opacity-40"
                              >
                                {streamState === "loading" ? (
                                  <Spinner className="h-3 w-3" />
                                ) : streamState === "ok" ? (
                                  "✓"
                                ) : (
                                  <Play className="h-3.5 w-3.5 fill-current" />
                                )}
                              </button>
                              <button
                                type="button"
                                disabled={!hasMagnet || magnetState === "loading"}
                                onClick={() => void handleMagnet(row, idx)}
                                title={hasMagnet ? "Open magnet link" : "Direct stream playback is not enabled yet"}
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
                </>
              )}
            </div>
          </motion.div>
        </motion.div>
      ) : null}
    </AnimatePresence>
  );
}
