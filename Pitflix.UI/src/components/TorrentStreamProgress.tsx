import { invoke, isTauri } from "@tauri-apps/api/core";
import { Activity, Download, X, Users } from "lucide-react";
import { useEffect, useState } from "react";

export interface TorrentStreamStatus {
  active: boolean;
  state: string;
  progressBytes: number;
  totalBytes: number;
  progressPercent: number;
  downloadSpeedMibps: number;
  uploadSpeedMibps: number;
  peersLive: number;
  peersSeen: number;
  finished: boolean;
  error?: string | null;
}

interface TorrentStreamProgressProps {
  infoHash: string;
  label?: string;
  variant?: "panel" | "overlay";
  error?: string | null;
  onCancel?: () => void;
}

function formatBytes(value: number): string {
  if (!Number.isFinite(value) || value <= 0) return "0 B";
  const units = ["B", "KB", "MB", "GB", "TB"];
  const unit = Math.min(Math.floor(Math.log(value) / Math.log(1024)), units.length - 1);
  const amount = value / 1024 ** unit;
  return `${amount.toFixed(unit >= 3 ? 2 : 1)} ${units[unit]}`;
}

function stageLabel(status: TorrentStreamStatus | null): string {
  if (!status?.active) {
    return status?.state === "finding_metadata" ? "Finding torrent metadata…" : "Starting torrent engine…";
  }
  if (status.error) return "Torrent error";
  if (status.finished) return "Download complete";
  if (status.peersLive === 0) return "Looking for peers…";
  return "Streaming and downloading";
}

export function TorrentStreamProgress({
  infoHash,
  label,
  variant = "panel",
  error,
  onCancel,
}: TorrentStreamProgressProps) {
  const [status, setStatus] = useState<TorrentStreamStatus | null>(null);

  useEffect(() => {
    if (!isTauri() || !infoHash) return;
    let cancelled = false;

    const refresh = async () => {
      try {
        const next = await invoke<TorrentStreamStatus>("torrent_stream_status", { infoHash });
        if (!cancelled) setStatus(next);
      } catch {
        // Start/stop can briefly race with a poll. The next poll will recover.
      }
    };

    void refresh();
    const interval = window.setInterval(() => void refresh(), 750);
    return () => {
      cancelled = true;
      window.clearInterval(interval);
    };
  }, [infoHash]);

  const prebufferTarget = Math.min(status?.totalBytes ?? 0, 16 * 1024 * 1024);
  const displayedPercent =
    variant === "panel" && prebufferTarget > 0
      ? ((status?.progressBytes ?? 0) / prebufferTarget) * 100
      : (status?.progressPercent ?? 0);
  const percent = Math.max(0, Math.min(100, displayedPercent));
  const speed = status?.downloadSpeedMibps ?? 0;
  const panelClass =
    variant === "overlay"
      ? "pointer-events-none fixed right-5 top-16 z-[90] w-[min(360px,calc(100vw-2.5rem))] border-white/15 bg-black/80 shadow-2xl backdrop-blur-md"
      : "mx-4 mt-3 border-emerald-500/25 bg-emerald-500/[0.07]";

  return (
    <div className={`rounded-xl border p-3 text-xs text-white ${panelClass}`}>
      <div className="flex items-start justify-between gap-3">
        <div className="min-w-0">
          <div className={`flex items-center gap-1.5 font-semibold ${error ? "text-red-300" : "text-emerald-300"}`}>
            <Activity className="h-3.5 w-3.5" />
            {error
              ? "Stream is not ready"
              : variant === "panel" && status?.active
                ? "Checking stream speed…"
                : stageLabel(status)}
          </div>
          {label ? <p className="mt-0.5 truncate text-[10px] text-white/55">{label}</p> : null}
        </div>
        <div className="flex shrink-0 items-center gap-2">
          <span className="font-mono text-emerald-200">{percent.toFixed(1)}%</span>
          {onCancel ? (
            <button
              type="button"
              onClick={onCancel}
              className="pointer-events-auto flex items-center gap-1 rounded-md border border-white/15 px-2 py-1 text-[10px] text-white/75 hover:border-red-400/50 hover:text-red-200"
            >
              <X className="h-3 w-3" />
              {error ? "Dismiss" : "Cancel"}
            </button>
          ) : null}
        </div>
      </div>

      <div className="mt-2 h-1.5 overflow-hidden rounded-full bg-white/10">
        <div
          className="h-full rounded-full bg-gradient-to-r from-emerald-500 to-cyan-400 transition-[width] duration-500"
          style={{ width: `${percent}%` }}
        />
      </div>

      <div className="mt-2 grid grid-cols-3 gap-2 text-[10px] text-white/65">
        <span className="flex items-center gap-1" title="Current download speed">
          <Download className="h-3 w-3 text-emerald-300" />
          {speed < 0.01 ? "0 MiB/s" : `${speed.toFixed(2)} MiB/s`}
        </span>
        <span className="flex items-center justify-center gap-1" title="Connected and discovered peers">
          <Users className="h-3 w-3 text-cyan-300" />
          {status?.peersLive ?? 0}/{status?.peersSeen ?? 0} peers
        </span>
        <span className="truncate text-right" title="Downloaded bytes and selected size">
          {formatBytes(status?.progressBytes ?? 0)}
          {status?.totalBytes ? ` / ${formatBytes(status.totalBytes)}` : ""}
        </span>
      </div>

      {error || status?.error ? (
        <p className="mt-2 text-[10px] leading-relaxed text-red-300">{error ?? status?.error}</p>
      ) : null}
    </div>
  );
}
