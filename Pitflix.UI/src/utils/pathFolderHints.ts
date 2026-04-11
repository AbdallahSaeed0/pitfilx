/** Library / language buckets (and common typos) — not show titles. */
const LIB_ROOT = new Set(
  ["english", "engilsh", "arabic", "movies", "series", "movie", "tv", "films", "عربي"].map((s) =>
    s.toLowerCase(),
  ),
);

const QUALITY = new Set(
  [
    "1080p",
    "720p",
    "480p",
    "2160p",
    "1440p",
    "4k",
    "uhd",
    "hd",
    "sd",
    "bluray",
    "blu-ray",
    "webrip",
    "web-dl",
    "webdl",
    "hdtv",
    "dvdrip",
    "remux",
    "hdr",
    "sdr",
    "x264",
    "x265",
    "hevc",
  ].map((s) => s.toLowerCase()),
);

const SPECIAL = new Set(
  ["specials", "extras", "featurettes", "deleted scenes"].map((s) => s.toLowerCase()),
);

function isWindowsDriveSegment(seg: string): boolean {
  return /^[a-z]:$/i.test(seg.trim());
}

function isSeasonLikeSegment(seg: string): boolean {
  const s = seg.trim();
  if (!s) return true;
  if (/^s\d{1,3}$/i.test(s)) return true;
  if (/^season[.\s_-]*\d{1,3}$/i.test(s)) return true;
  if (/^saison[.\s_-]*\d{1,3}$/i.test(s)) return true;
  if (/^staffel[.\s_-]*\d{1,3}$/i.test(s)) return true;
  if (/^temporada[.\s_-]*\d{1,3}$/i.test(s)) return true;
  if (/^seizoen[.\s_-]*\d{1,3}$/i.test(s)) return true;
  if (/^stagione[.\s_-]*\d{1,3}$/i.test(s)) return true;
  if (/^series[.\s_-]*\d{1,3}$/i.test(s)) return true;
  if (/^vol(?:ume)?[.\s_-]*\d{1,3}$/i.test(s)) return true;
  return false;
}

function isSkippableFolderSegment(seg: string): boolean {
  const key = seg.trim().toLowerCase();
  if (!key) return true;
  if (isWindowsDriveSegment(seg)) return true;
  if (LIB_ROOT.has(key)) return true;
  if (QUALITY.has(key)) return true;
  if (SPECIAL.has(key)) return true;
  return isSeasonLikeSegment(seg);
}

function cleanSegment(seg: string): string {
  return seg.replace(/\./g, " ").replace(/_/g, " ").replace(/\s+/g, " ").trim();
}

/** Strip S01E05 / episode tags and trailing release noise from scanner clean name. */
export function simplifyCleanNameForSearch(cleanName: string): string | null {
  let s = cleanName.replace(/\s+/g, " ").trim();
  if (s.length < 2) return null;
  s = s.replace(/\bs\d{1,2}\s*[._\s-]*\s*e\d{1,3}\b/gi, " ");
  s = s.replace(/\b(19\d{2}|20[0-2]\d|2030)\b/g, " ");
  const noise =
    /\b(720p|1080p|2160p|480p|web-?dl|webrip|bluray|brrip|x264|x265|hevc|hdtv|dvdrip|remux|\d+\s*mb|pahe|rarbg|yify|ettv|proper|repack)\b/gi;
  s = s.replace(noise, " ");
  s = s.replace(/\s+/g, " ").replace(/^[\s._-]+|[\s._-]+$/g, "").trim();
  return s.length >= 2 ? s : null;
}

function pathFolderHintsOnly(filePath: string, max: number): string[] {
  const norm = filePath.replace(/[/\\]+/g, "\\");
  const parts = norm.split("\\").filter((p) => p.length > 0);
  if (parts.length < 2) return [];
  parts.pop();

  const hints: string[] = [];
  const seen = new Set<string>();

  for (let i = parts.length - 1; i >= 0 && hints.length < max; i--) {
    const seg = parts[i];
    if (isSkippableFolderSegment(seg)) continue;
    const cleaned = cleanSegment(seg);
    if (cleaned.length < 2) continue;
    const k = cleaned.toLowerCase();
    if (seen.has(k)) continue;
    seen.add(k);
    hints.push(cleaned);
  }

  return hints;
}

/**
 * Up to `max` TMDB search strings: real show/folder names first, then filename-based guesses.
 * Skips drive letters, "English"/"Engilsh", season folders, etc.
 */
export function getUnmatchedMatchHints(filePath: string, cleanName: string, max = 3): string[] {
  const out: string[] = [];
  const seen = new Set<string>();

  const push = (s: string) => {
    const t = s.trim();
    if (t.length < 2) return;
    const k = t.toLowerCase();
    if (seen.has(k)) return;
    seen.add(k);
    out.push(t);
  };

  for (const h of pathFolderHintsOnly(filePath, max)) {
    push(h);
    if (out.length >= max) return out;
  }

  const fromName = simplifyCleanNameForSearch(cleanName);
  if (fromName) push(fromName);
  if (out.length >= max) return out.slice(0, max);

  const primary = pathFolderHintsOnly(filePath, 1)[0];
  if (primary && fromName && primary.length >= 3) {
    const words = fromName.split(" ").filter((w) => w.length > 1);
    const first = words[0];
    if (first && first.toLowerCase() !== primary.toLowerCase() && first.length >= 3) {
      push(first);
    }
  }

  return out.slice(0, max);
}
