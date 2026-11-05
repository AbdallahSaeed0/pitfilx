/**
 * Per-show audio / subtitle track memory.
 *
 * mpv track ids differ from episode to episode, so (unlike the per-episode pick in
 * `playerStorage.ts`) choices are stored by language + title and re-matched against each new
 * episode's track list. External sidecar subs are remembered by their filename suffix relative
 * to the video (e.g. `.ar.srt`), since the folder scan lists every episode's subtitles.
 */
import type { PlaybackLaunchState } from "../../types/playback";
import { MAX_SHOW_TRACK_PREFS, SHOW_TRACK_PREFS_STORAGE_KEY } from "./playerConstants";
import { parentDirectory } from "./playerFormat";
import type { MpvTrack } from "./playerTypes";

export type TrackIdentity = { lang?: string; title?: string };

export type ShowSubPref =
  | { off: true }
  | (TrackIdentity & { off?: false; /** Lower-cased sidecar suffix, e.g. `.ar.srt`. */ extSuffix?: string });

export type ShowTrackPref = {
  audio?: TrackIdentity;
  sub?: ShowSubPref;
  /** Dual subtitles: the second subtitle shown above the main one. */
  secondary?: ShowSubPref;
};

/** `show:<id>` for library shows; folder key for unmatched local episodes; null for movies. */
export function showTrackPrefKey(
  launch: Pick<PlaybackLaunchState, "libraryShowId" | "libraryMovieId" | "mediaType" | "filePath" | "liveChannels">,
): string | null {
  if (launch.libraryShowId != null && launch.libraryShowId > 0) return `show:${launch.libraryShowId}`;
  if (launch.libraryMovieId != null || launch.liveChannels?.length) return null;
  if (launch.mediaType === "Movie") return null;
  const dir = parentDirectory(launch.filePath);
  return dir ? `dir:${dir.replace(/\\/g, "/").toLowerCase()}` : null;
}

function loadAll(): Record<string, ShowTrackPref> {
  try {
    const raw = localStorage.getItem(SHOW_TRACK_PREFS_STORAGE_KEY);
    const o = raw ? (JSON.parse(raw) as unknown) : null;
    return o && typeof o === "object" ? (o as Record<string, ShowTrackPref>) : {};
  } catch {
    return {};
  }
}

export function loadShowTrackPref(key: string): ShowTrackPref | null {
  return loadAll()[key] ?? null;
}

export function saveShowTrackPref(key: string, patch: ShowTrackPref): void {
  try {
    const all = loadAll();
    const merged: ShowTrackPref = { ...all[key], ...patch };
    delete all[key];
    // Most-recent first so trimming drops the shows touched longest ago.
    const entries = [[key, merged] as const, ...Object.entries(all)].slice(0, MAX_SHOW_TRACK_PREFS);
    localStorage.setItem(SHOW_TRACK_PREFS_STORAGE_KEY, JSON.stringify(Object.fromEntries(entries)));
  } catch {
    /* storage unavailable — memory is best-effort */
  }
}

const norm = (s?: string) => (s ?? "").trim().toLowerCase();

function baseName(path: string): string {
  return path.replace(/\\/g, "/").split("/").pop() ?? path;
}

function stripExt(name: string): string {
  const i = name.lastIndexOf(".");
  return i > 0 ? name.slice(0, i) : name;
}

/** Suffix of a sidecar sub relative to its video (`Show.S01E02.ar.srt` → `.ar.srt`), or null when unrelated. */
export function sidecarSuffix(videoPath: string, subPath: string): string | null {
  const videoBase = norm(stripExt(baseName(videoPath)));
  const subName = norm(baseName(subPath));
  if (!videoBase || !subName.startsWith(videoBase)) return null;
  return subName.slice(videoBase.length);
}

/** Language tag inside a sidecar suffix, e.g. `.ar.forced.srt` → `ar`. */
function langFromSuffix(suffix: string): string | undefined {
  return suffix
    .split(".")
    .slice(0, -1)
    .find((p) => /^[a-z]{2,3}(-[a-z]{2})?$/.test(p));
}

export function identityOf(track: MpvTrack | undefined): TrackIdentity | undefined {
  if (!track) return undefined;
  const lang = track.lang?.trim() || undefined;
  const title = track.title?.trim() || undefined;
  return lang || title ? { lang, title } : undefined;
}

/** Sub pref from a sidecar file the user picked; falls back to language-only if it isn't this video's sidecar. */
export function subPrefFromExternal(videoPath: string, subPath: string): ShowSubPref | undefined {
  const suffix = sidecarSuffix(videoPath, subPath);
  const lang = langFromSuffix(suffix ?? norm(baseName(subPath)).replace(/^[^.]*/, ""));
  if (suffix) return { extSuffix: suffix, lang };
  return lang ? { lang } : undefined;
}

/** Best track for a remembered identity: exact lang+title, then lang alone, then title alone. */
export function matchTrack(tracks: MpvTrack[], want: TrackIdentity): MpvTrack | undefined {
  const lang = norm(want.lang);
  const title = norm(want.title);
  const withId = tracks.filter((t) => t.id != null);
  if (lang && title) {
    const exact = withId.find((t) => norm(t.lang) === lang && norm(t.title) === title);
    if (exact) return exact;
  }
  if (lang) {
    const sameLang = withId.filter((t) => norm(t.lang) === lang);
    if (sameLang.length > 0) {
      // Don't swap a full track for a forced/SDH one (or vice versa) when a closer one exists.
      const kind = (s: string) => (/forced/.test(s) ? "forced" : /sdh|hearing/.test(s) ? "sdh" : "full");
      return sameLang.find((t) => kind(norm(t.title)) === kind(title)) ?? sameLang[0];
    }
    return undefined;
  }
  return title ? withId.find((t) => norm(t.title) === title) : undefined;
}

/** External sidecar for this video carrying the remembered suffix. */
export function matchExternal(videoPath: string, externalFiles: string[], extSuffix: string): string | undefined {
  return externalFiles.find((p) => sidecarSuffix(videoPath, p) === extSuffix);
}
