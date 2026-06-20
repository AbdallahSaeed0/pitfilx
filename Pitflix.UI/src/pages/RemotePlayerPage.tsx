import { convertFileSrc, invoke, isTauri } from "@tauri-apps/api/core";
import { listen, type UnlistenFn } from "@tauri-apps/api/event";
import { useQuery, useQueryClient } from "@tanstack/react-query";
import { Film, FolderOpen, X } from "lucide-react";
import { useCallback, useEffect, useRef, useState } from "react";
import { useLocation, useNavigate } from "react-router-dom";
import { historyStopped, postHistoryProgress } from "../api/history";
import {
  getNextLibraryEpisode,
  getPreviousLibraryEpisode,
} from "../api/series";
import { MediaController } from "../components/player/MediaController";
import { usePlayback } from "../hooks/usePlayback";
import type { PlaybackLaunchState } from "../types/playback";
import { cn } from "../utils/cn";
import { navigateFromPlayer } from "../utils/playerExitNavigation";

// ─── Types ────────────────────────────────────────────────────────────────────

type RemoteState = {
  timePos: number | null;
  duration: number | null;
  paused: boolean;
  eof: boolean;
};

type DeviceFsEntry = {
  name: string;
  path: string;
  is_directory: boolean;
  media_kind?: string;
};

// ─── Video list thumbnail ─────────────────────────────────────────────────────

function VideoThumb({ path }: { path: string }) {
  const wrapRef = useRef<HTMLDivElement>(null);
  const [visible, setVisible] = useState(false);
  const [failed, setFailed] = useState(false);

  useEffect(() => {
    const el = wrapRef.current;
    if (!el || visible) return;
    const io = new IntersectionObserver(
      (entries) => {
        if (entries.some((x) => x.isIntersecting)) {
          setVisible(true);
          io.disconnect();
        }
      },
      { rootMargin: "120px 0px" },
    );
    io.observe(el);
    return () => io.disconnect();
  }, [visible]);

  const fileSrc = convertFileSrc(path);

  return (
    <div ref={wrapRef} className="h-full w-full bg-black/60">
      {visible ? (
        failed ? (
          <div className="flex h-full items-center justify-center">
            <Film className="h-5 w-5 text-white/30" />
          </div>
        ) : (
          <video
            src={fileSrc}
            className="h-full w-full object-cover"
            muted
            playsInline
            preload="metadata"
            onLoadedMetadata={(e) => {
              const el = e.currentTarget;
              const d = el.duration;
              if (Number.isFinite(d) && d > 0) {
                el.currentTime = Math.min(d * 0.1, 30);
              }
            }}
            onError={() => setFailed(true)}
          />
        )
      ) : (
        <div className="flex h-full items-center justify-center">
          <Film className="h-4 w-4 text-white/20" />
        </div>
      )}
    </div>
  );
}

// ─── Helpers ─────────────────────────────────────────────────────────────────

const VIDEO_EXTS = new Set(["mp4", "mkv", "avi", "mov", "webm", "m4v", "wmv", "mpg", "mpeg", "flv", "ts"]);

function isVideoFile(e: DeviceFsEntry) {
  if (e.is_directory) return false;
  if (e.media_kind === "video") return true;
  const ext = e.name.split(".").pop()?.toLowerCase() ?? "";
  return VIDEO_EXTS.has(ext);
}

function getParentDir(filePath: string): string {
  const last = Math.max(filePath.lastIndexOf("/"), filePath.lastIndexOf("\\"));
  return last > 0 ? filePath.slice(0, last) : filePath;
}

function epLabel(season: number, ep: number) {
  return `S${String(season).padStart(2, "0")}E${String(ep).padStart(2, "0")}`;
}

// ─── Component ───────────────────────────────────────────────────────────────

export function RemotePlayerPage() {
  const location = useLocation();
  const navigate = useNavigate();
  const qc = useQueryClient();
  const { play } = usePlayback();
  const launch = location.state as PlaybackLaunchState | null;

  const filePath = launch?.filePath ?? "";
  const title = launch?.title ?? "Playing";
  const historyId = launch?.historyId ?? null;
  const returnTo = launch?.returnTo;

  // ── Context detection ────────────────────────────────────────────────────
  const isEpisode = launch?.libraryShowId != null && launch?.libraryEpisodeId != null;
  const isMovie = launch?.libraryMovieId != null && !isEpisode;
  const isDevice = !isEpisode && !isMovie;

  // ── Player state ──────────────────────────────────────────────────────────
  const [remote, setRemote] = useState<RemoteState>({
    timePos: null, duration: null, paused: false, eof: false,
  });
  const [folderOpen, setFolderOpen] = useState(false);

  const remoteRef = useRef<RemoteState>(remote);
  remoteRef.current = remote;
  const closedRef = useRef(false);
  const progressTimer = useRef<ReturnType<typeof setInterval> | null>(null);
  /** Strict Mode guard — same pattern as PlayerPage's openedHistoryIdRef. */
  const openedHistoryIdRef = useRef<number | null>(null);

  // ── Episode queries (series only) ─────────────────────────────────────────
  const { data: nextEpData } = useQuery({
    queryKey: ["remote-next-ep", launch?.libraryShowId, launch?.libraryEpisodeId],
    queryFn: () =>
      getNextLibraryEpisode(launch!.libraryShowId!, launch?.libraryEpisodeId),
    enabled: isEpisode,
    staleTime: 60_000,
  });

  const { data: prevEpData } = useQuery({
    queryKey: ["remote-prev-ep", launch?.libraryShowId, launch?.libraryEpisodeId],
    queryFn: () =>
      getPreviousLibraryEpisode(launch!.libraryShowId!, launch!.libraryEpisodeId!),
    enabled: isEpisode,
    staleTime: 60_000,
  });

  const nextEp = nextEpData?.next ?? null;
  const prevEp = prevEpData?.previous ?? null;

  // ── Device folder query ────────────────────────────────────────────────────
  const parentDir = isDevice ? getParentDir(filePath) : "";

  const { data: folderEntries } = useQuery<DeviceFsEntry[]>({
    queryKey: ["remote-folder", parentDir],
    queryFn: () => invoke<DeviceFsEntry[]>("device_read_dir", { path: parentDir }),
    enabled: isDevice && parentDir.length > 0,
    staleTime: 30_000,
  });

  const folderVideos = (folderEntries ?? [])
    .filter(isVideoFile)
    .sort((a, b) => a.name.toLowerCase().localeCompare(b.name.toLowerCase()));

  const currentFolderIdx = folderVideos.findIndex(
    (v) => v.path.toLowerCase() === filePath.toLowerCase(),
  );
  const prevDeviceVideo = currentFolderIdx > 0 ? folderVideos[currentFolderIdx - 1] : null;
  const nextDeviceVideo =
    currentFolderIdx >= 0 && currentFolderIdx < folderVideos.length - 1
      ? folderVideos[currentFolderIdx + 1]
      : null;

  // ── Open mpv on mount (guarded against React Strict Mode double-invoke) ───
  useEffect(() => {
    if (!isTauri() || !filePath || historyId == null) return;
    if (openedHistoryIdRef.current === historyId) return;
    openedHistoryIdRef.current = historyId;
    void invoke("remote_open", { filePath, title });
    // No cleanup — real close via handleClose / remote://closed.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [historyId]);

  // ── Listen to Tauri events ────────────────────────────────────────────────
  useEffect(() => {
    if (!isTauri()) return;
    const listeners: Promise<UnlistenFn>[] = [
      listen<RemoteState>("remote://state", (ev) => setRemote(ev.payload)),
      listen<void>("remote://closed", () => {
        if (!closedRef.current) {
          closedRef.current = true;
          void finishSession();
        }
      }),
    ];
    return () => { void Promise.all(listeners).then((fns) => fns.forEach((fn) => fn())); };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  // ── Progress heartbeat ────────────────────────────────────────────────────
  useEffect(() => {
    if (!historyId) return;
    progressTimer.current = setInterval(() => {
      const pos = remoteRef.current.timePos;
      if (pos != null && pos > 0) {
        void postHistoryProgress(historyId, { positionSeconds: Math.floor(pos) }).catch(() => {});
      }
    }, 10_000);
    return () => { if (progressTimer.current) clearInterval(progressTimer.current); };
  }, [historyId]);

  // ── Helpers ───────────────────────────────────────────────────────────────

  const invalidateHistory = useCallback(() => {
    void qc.invalidateQueries({ queryKey: ["home-history"] });
    void qc.invalidateQueries({ queryKey: ["home-featured-fallback"] });
    void qc.invalidateQueries({ predicate: (q) => q.queryKey[0] === "home-section" });
    void qc.invalidateQueries({ queryKey: ["history"] });
  }, [qc]);

  const stopCurrentHistory = useCallback(async () => {
    if (progressTimer.current) clearInterval(progressTimer.current);
    if (historyId != null) {
      const pos = remoteRef.current.timePos;
      await historyStopped(historyId, {
        stoppedAt: new Date().toISOString(),
        ...(pos != null ? { positionSeconds: Math.floor(pos) } : {}),
      }).catch(() => {});
    }
  }, [historyId]);

  const finishSession = useCallback(async () => {
    await stopCurrentHistory();
    invalidateHistory();
    navigateFromPlayer(navigate, returnTo, true);
  }, [stopCurrentHistory, invalidateHistory, navigate, returnTo]);

  // ── Controls ──────────────────────────────────────────────────────────────

  const handlePlayPause = useCallback(() => {
    void invoke("remote_play_pause").catch(() => {});
  }, []);

  const handleSeek = useCallback((seconds: number) => {
    void invoke("remote_seek", { positionSeconds: seconds }).catch(() => {});
  }, []);

  const handleClose = useCallback(async () => {
    if (closedRef.current) return;
    closedRef.current = true;
    await invoke("remote_close").catch(() => {});
    await finishSession();
  }, [finishSession]);

  // Switch to another episode / device video
  const handleSwitchEpisode = useCallback(
    async (targetFilePath: string, targetTitle: string, targetEpId: number) => {
      await stopCurrentHistory();
      invalidateHistory();
      void play(targetFilePath, targetTitle, null, "Series", 0, {
        libraryShowId: launch?.libraryShowId,
        libraryEpisodeId: targetEpId,
        returnTo,
      });
    },
    [stopCurrentHistory, invalidateHistory, play, launch?.libraryShowId, returnTo],
  );

  const handleSwitchDevice = useCallback(
    async (targetFilePath: string, targetName: string) => {
      await stopCurrentHistory();
      invalidateHistory();
      void play(targetFilePath, targetName, null, "Video", 0, { returnTo });
    },
    [stopCurrentHistory, invalidateHistory, play, returnTo],
  );

  // ── Derived display ───────────────────────────────────────────────────────

  const duration = remote.duration ?? 0;
  const rawPos = remote.timePos ?? 0;

  // ── MediaController prop derivation ──────────────────────────────────────

  const ctrlPrev: (() => void) | null = isEpisode
    ? prevEp
      ? () => void handleSwitchEpisode(prevEp.filePath, prevEp.title ?? "Episode", prevEp.id)
      : null
    : isDevice
    ? prevDeviceVideo
      ? () => void handleSwitchDevice(prevDeviceVideo.path, prevDeviceVideo.name)
      : null
    : () => handleSeek(Math.max(0, rawPos - 10));

  const ctrlNext: (() => void) | null = isEpisode
    ? nextEp
      ? () => void handleSwitchEpisode(nextEp.filePath, nextEp.title ?? "Episode", nextEp.id)
      : null
    : isDevice
    ? nextDeviceVideo
      ? () => void handleSwitchDevice(nextDeviceVideo.path, nextDeviceVideo.name)
      : null
    : () => handleSeek(Math.min(duration || rawPos + 30, rawPos + 10));

  const ctrlPrevLabel: string | undefined = isEpisode
    ? prevEp
      ? epLabel(prevEp.season, prevEp.episodeNumber)
      : "Prev"
    : isDevice
    ? prevDeviceVideo
      ? prevDeviceVideo.name.replace(/\.[^.]+$/, "")
      : "Prev"
    : undefined; // movie → default "−10 s"

  const ctrlNextLabel: string | undefined = isEpisode
    ? nextEp
      ? epLabel(nextEp.season, nextEp.episodeNumber)
      : "Next"
    : isDevice
    ? nextDeviceVideo
      ? nextDeviceVideo.name.replace(/\.[^.]+$/, "")
      : "Next"
    : undefined; // movie → default "+10 s"

  // ── Render ────────────────────────────────────────────────────────────────

  return (
    <div className="flex min-h-screen flex-col items-center justify-center bg-pitflix-bg px-6 py-10 select-none">
      {/* Title */}
      <p className="mb-1 max-w-lg text-center text-xl font-semibold text-white">{title}</p>
      {isEpisode && launch?.season != null && launch?.episodeNumber != null && (
        <p className="mb-6 text-[12px] text-pitflix-subtle">
          {epLabel(launch.season, launch.episodeNumber)}
        </p>
      )}
      {!isEpisode && <div className="mb-6" />}

      {/* Media controller */}
      <div className="mb-4 w-full max-w-md">
        <MediaController
          position={rawPos}
          duration={duration}
          paused={remote.paused}
          onPlayPause={handlePlayPause}
          onSeek={handleSeek}
          onPrev={ctrlPrev}
          onNext={ctrlNext}
          prevLabel={ctrlPrevLabel}
          nextLabel={ctrlNextLabel}
        />
      </div>

      {/* Close + folder toggle */}
      <div className="mt-10 flex items-center gap-3">
        <button
          type="button"
          onClick={() => void handleClose()}
          className="flex items-center gap-2 rounded-xl border border-white/20 bg-white/[0.06] px-5 py-2.5 text-sm font-medium text-white transition hover:bg-white/[0.12] active:scale-95"
        >
          <X className="h-4 w-4" />
          Close
        </button>

        {isDevice && folderVideos.length > 1 && (
          <button
            type="button"
            onClick={() => setFolderOpen((o) => !o)}
            className={cn(
              "flex items-center gap-2 rounded-xl border px-5 py-2.5 text-sm font-medium text-white transition active:scale-95",
              folderOpen
                ? "border-pitflix-primary/60 bg-pitflix-primary/15"
                : "border-white/20 bg-white/[0.06] hover:bg-white/[0.12]",
            )}
          >
            <FolderOpen className="h-4 w-4" />
            Folder ({folderVideos.length})
          </button>
        )}
      </div>

      {/* Hint */}
      <p className="mt-3 text-[11px] text-pitflix-subtle">
        mpv is playing in a window — use this as a remote control.
      </p>

      {/* Device folder video list */}
      {isDevice && folderOpen && folderVideos.length > 0 && (
        <div className="mt-6 w-full max-w-2xl rounded-2xl border border-white/[0.09] bg-pitflix-surface/50 p-4">
          <p className="mb-3 text-[11px] font-semibold uppercase tracking-wider text-pitflix-subtle">
            {parentDir.split(/[/\\]/).pop() ?? "Folder"}
          </p>
          <div className="flex flex-col gap-1 max-h-72 overflow-y-auto pr-1">
            {folderVideos.map((v) => {
              const isCurrent = v.path.toLowerCase() === filePath.toLowerCase();
              return (
                <button
                  key={v.path}
                  type="button"
                  onClick={() => !isCurrent && void handleSwitchDevice(v.path, v.name)}
                  className={cn(
                    "flex items-center gap-3 rounded-xl border px-2 py-1.5 text-left transition",
                    isCurrent
                      ? "border-pitflix-primary/50 bg-pitflix-primary/10 cursor-default"
                      : "border-transparent hover:border-white/10 hover:bg-white/[0.05] cursor-pointer",
                  )}
                >
                  {/* Thumbnail */}
                  <div className="h-[54px] w-[96px] shrink-0 overflow-hidden rounded-lg bg-black/50">
                    <VideoThumb path={v.path} />
                  </div>
                  {/* Name */}
                  <div className="min-w-0 flex-1">
                    <p className={cn(
                      "truncate text-xs font-medium leading-tight",
                      isCurrent ? "text-pitflix-primary" : "text-white",
                    )}>
                      {v.name.replace(/\.[^.]+$/, "")}
                    </p>
                    <p className="mt-0.5 text-[10px] text-pitflix-subtle">
                      {v.name.split(".").pop()?.toUpperCase()}
                    </p>
                  </div>
                  {isCurrent && (
                    <span className="shrink-0 text-[10px] font-semibold text-pitflix-primary">
                      ▶ Playing
                    </span>
                  )}
                </button>
              );
            })}
          </div>
        </div>
      )}
    </div>
  );
}
