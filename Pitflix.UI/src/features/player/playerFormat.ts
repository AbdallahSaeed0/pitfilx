import type { DeviceFsEntry } from "./playerTypes";

export function fileDisplayTitle(fileName: string): string {
  return fileName.replace(/\.[^/.]+$/, "").trim() || fileName;
}

export function parentDirectory(filePath: string): string {
  const s = filePath.trim().replace(/[/\\]+$/, "");
  const i = Math.max(s.lastIndexOf("\\"), s.lastIndexOf("/"));
  if (i <= 0) return "";
  return s.slice(0, i);
}

export function isPlayableSibling(e: DeviceFsEntry): boolean {
  if (e.is_directory) return false;
  if (e.media_kind === "video") return true;
  const n = e.name.toLowerCase();
  return /\.(mp3|m4a|aac|flac|wav|ogg|opus|wma|mka)$/i.test(n);
}

export function num(v: unknown): number {
  return typeof v === "number" && Number.isFinite(v) ? v : 0;
}

export function fmtTime(s: number) {
  if (!Number.isFinite(s) || s < 0) return "0:00";
  const sec = Math.floor(s % 60);
  const totalMin = Math.floor(s / 60);
  const h = Math.floor(totalMin / 60);
  const m = totalMin % 60;
  const ss = sec.toString().padStart(2, "0");
  if (h > 0) return `${h}:${m.toString().padStart(2, "0")}:${ss}`;
  return `${m}:${ss}`;
}

export function fmtSubDelayLabel(sec: number): string {
  if (!Number.isFinite(sec)) return "Sub delay: 0.0s";
  const sign = sec > 0 ? "+" : "";
  return `Sub delay: ${sign}${sec.toFixed(1)}s`;
}

export function normalizeMediaPathKey(path: string | undefined | null): string {
  if (!path) return "";
  return path.split("\\").join("/").trim().toLowerCase();
}

export function formatBytes(bytes: number): string {
  if (bytes < 1024) return `${bytes} B`;
  if (bytes < 1024 * 1024) return `${(bytes / 1024).toFixed(1)} KB`;
  if (bytes < 1024 * 1024 * 1024) return `${(bytes / (1024 * 1024)).toFixed(1)} MB`;
  return `${(bytes / (1024 * 1024 * 1024)).toFixed(2)} GB`;
}
