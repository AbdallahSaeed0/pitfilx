export function safePlayerExportBaseName(title: string): string {
  return title
    .replace(/[<>:"/\\|?*]/g, " ")
    .replace(/[·•]/g, "-")
    .replace(/\s+/g, " ")
    .trim()
    .slice(0, 80) || "pitflix";
}

/** Windows-safe time label for exported file names (no colons). */
export function fmtTimeForFilename(s: number): string {
  if (!Number.isFinite(s) || s < 0) return "0m00s";
  const sec = Math.floor(s % 60);
  const totalMin = Math.floor(s / 60);
  const h = Math.floor(totalMin / 60);
  const m = totalMin % 60;
  const ss = sec.toString().padStart(2, "0");
  if (h > 0) return `${h}h${m.toString().padStart(2, "0")}m${ss}s`;
  return `${m}m${ss}s`;
}

export function safePlayerExportFileName(title: string, suffix: string, ext: string): string {
  const base = safePlayerExportBaseName(title);
  const tail = suffix.replace(/[<>:"/\\|?*]/g, "-").replace(/\s+/g, " ").trim();
  return `${base} ${tail}.${ext}`.replace(/\s+/g, " ").trim();
}

export type PlayerExportSubtitleBurn = {
  includeSubtitles: boolean;
  subtitlePath?: string;
  subtitleStreamSi?: number;
  subtitleDelaySeconds: number;
};

function normalizePathKey(path: string): string {
  return path.replace(/\\/g, "/").toLowerCase();
}

function fileBaseName(path: string): string {
  return path.replace(/^.*[/\\]/, "");
}

function stripExtension(name: string): string {
  return name.replace(/\.[^.]+$/, "");
}

/** Match an mpv subtitle track label to a sidecar/external subtitle file path. */
export function resolveExternalSubtitlePath(
  track: { title?: string; lang?: string } | undefined,
  externalSubFiles: string[],
): string | undefined {
  if (!track || externalSubFiles.length === 0) return undefined;

  const label = (track.title || track.lang || "").trim();
  if (!label) return undefined;

  for (const p of externalSubFiles) {
    if (p === label) return p;
    if (normalizePathKey(p) === normalizePathKey(label)) return p;
  }

  if (/\.(srt|ass|ssa|vtt)$/i.test(label)) {
    const labelKey = normalizePathKey(label);
    const exact = externalSubFiles.find((p) => normalizePathKey(p) === labelKey);
    if (exact) return exact;
    if (label.includes("/") || label.includes("\\")) return label;
  }

  const labelBase = fileBaseName(label);
  const labelStem = stripExtension(labelBase).toLowerCase();
  for (const p of externalSubFiles) {
    const base = fileBaseName(p);
    if (labelBase === base || label.endsWith(base) || base.endsWith(labelBase)) return p;
    if (stripExtension(base).toLowerCase() === labelStem) return p;
  }

  return undefined;
}

export function isExternalSubTrack(
  track: { title?: string; lang?: string },
  externalSubFiles: string[],
): boolean {
  return resolveExternalSubtitlePath(track, externalSubFiles) != null;
}

/** Build the subtitle picker value for the active mpv track. */
export function resolveSubtitleMenuValue(
  sid: number | null,
  subTracks: { id?: number; title?: string; lang?: string }[],
  externalSubFiles: string[],
): string {
  if (sid == null || sid < 0) return "";
  const track = subTracks.find((t) => t.id === sid);
  if (!track) return `e:${sid}`;

  const externalPath = resolveExternalSubtitlePath(track, externalSubFiles);
  if (externalPath) return `x:${encodeURIComponent(externalPath)}`;

  return `e:${sid}`;
}

/** Resolve the subtitle track currently shown in the player for ffmpeg burn-in. */
export function resolvePlayerExportSubtitleBurn(args: {
  subVisible: boolean;
  sid: number | null;
  subDelay: number;
  subMenuValue: string;
  subTracks: { id?: number; title?: string; lang?: string }[];
  externalSubFiles: string[];
}): PlayerExportSubtitleBurn {
  const none: PlayerExportSubtitleBurn = { includeSubtitles: false, subtitleDelaySeconds: 0 };
  if (!args.subVisible || args.sid == null || args.sid < 0) return none;

  const delay = Number.isFinite(args.subDelay) ? args.subDelay : 0;
  const selected = args.subTracks.find((t) => t.id === args.sid);

  if (args.subMenuValue.startsWith("x:")) {
    const path = decodeURIComponent(args.subMenuValue.slice(2));
    if (!path.trim()) return none;
    return {
      includeSubtitles: true,
      subtitlePath: path,
      subtitleDelaySeconds: delay,
    };
  }

  const externalPath = resolveExternalSubtitlePath(selected, args.externalSubFiles);
  if (externalPath) {
    return {
      includeSubtitles: true,
      subtitlePath: externalPath,
      subtitleDelaySeconds: delay,
    };
  }

  if (args.subMenuValue.startsWith("e:") || selected) {
    const embeddedTracks = args.subTracks.filter((t) => !isExternalSubTrack(t, args.externalSubFiles));
    const si = embeddedTracks.findIndex((t) => t.id === args.sid);
    return {
      includeSubtitles: true,
      subtitleStreamSi: si >= 0 ? si : 0,
      subtitleDelaySeconds: delay,
    };
  }

  return none;
}
