import { Captions, Check, EyeOff, FileText, Search, SlidersHorizontal, X } from "lucide-react";
import { useCallback, useEffect, useMemo, useRef, useState, type RefObject } from "react";
import { createPortal } from "react-dom";
import { cn } from "../../utils/cn";
import { DEFAULT_SUBTITLE_PREFS, persistEpSubPick } from "./playerStorage";
import { playbackEpisodeKey } from "../../playback/playbackApi";
import type { PlaybackLaunchState } from "../../types/playback";
import type { MpvTrack } from "./playerTypes";
import type { PlayerEmbeddedSubtitlesProps } from "./playerViewProps";

type Props = PlayerEmbeddedSubtitlesProps & {
  sessionBlocksTransport: boolean;
  launchStateRef: RefObject<PlaybackLaunchState | undefined>;
  send: (cmd: unknown) => Promise<void>;
  onFullscreenPointerActivity: () => void;
};

function externalFileLabel(path: string): string {
  return path.replace(/^.*[/\\]/, "");
}

/** Primary language subtag from a BCP-47-ish tag, e.g. "en-US" / "es_419" / "pt-BR" -> "en"/"es"/"pt". */
function parseLangTag(code: string): { lang: string } {
  const lang = (code.split(/[-_]/)[0] || "").toLowerCase();
  return { lang };
}

/** Deterministic, good-contrast palette for the language-code badges — same language always gets the
 * same color within a session, and colors are spread out enough that adjacent rows read as distinct. */
const BADGE_COLORS = [
  "#EF4444", "#F97316", "#F59E0B", "#84CC16", "#10B981", "#14B8A6",
  "#06B6D4", "#3B82F6", "#6366F1", "#8B5CF6", "#A855F7", "#EC4899",
];

/** Flag emoji don't render as pictographs on Windows/WebView2 (this app's runtime) — they fall back to
 * the bare regional-indicator letters, which looks like a bug rather than a flag. A colored code badge
 * is legible everywhere and doubles as the track's short language code at a glance. */
function badgeColorForLang(key: string): string {
  let hash = 0;
  for (let i = 0; i < key.length; i++) hash = (hash * 31 + key.charCodeAt(i)) >>> 0;
  return BADGE_COLORS[hash % BADGE_COLORS.length]!;
}

type LangBadge = { text: string; color: string };

function resolveBadge(lang: string): LangBadge | null {
  if (!lang) return null;
  return { text: lang.slice(0, 2).toUpperCase(), color: badgeColorForLang(lang) };
}

let languageDisplayNames: Intl.DisplayNames | null | undefined;
function languageName(langCode: string): string | null {
  if (languageDisplayNames === undefined) {
    try {
      languageDisplayNames = new Intl.DisplayNames(["en"], { type: "language" });
    } catch {
      languageDisplayNames = null;
    }
  }
  if (!langCode) return null;
  try {
    return languageDisplayNames?.of(langCode) ?? null;
  } catch {
    return null;
  }
}

function detectBadges(title?: string | null): ("FORCED" | "SDH")[] {
  const lower = (title || "").toLowerCase();
  const badges: ("FORCED" | "SDH")[] = [];
  if (lower.includes("forced")) badges.push("FORCED");
  if (lower.includes("sdh") || lower.includes("hearing")) badges.push("SDH");
  return badges;
}

type EmbeddedTrackDisplay = {
  badge: LangBadge | null;
  primary: string;
  code: string | null;
  badges: ("FORCED" | "SDH")[];
  searchable: string;
};

/** Builds a display row per embedded track — human language name, colored code badge, forced/SDH
 * badges — and numbers same-language duplicates ("English 2") so they stay distinguishable. */
function buildEmbeddedTrackDisplays(tracks: MpvTrack[]): EmbeddedTrackDisplay[] {
  const seenCount = new Map<string, number>();
  return tracks.map((t) => {
    const rawLang = t.lang?.trim() || "";
    const { lang } = rawLang ? parseLangTag(rawLang) : { lang: "" };
    const name = lang ? languageName(lang) : null;
    const fallback = t.title?.trim() || `Track ${t.id ?? ""}`;
    const dedupeKey = name ?? fallback;
    const seen = seenCount.get(dedupeKey) ?? 0;
    seenCount.set(dedupeKey, seen + 1);
    const primary = seen > 0 ? `${name ?? fallback} ${seen + 1}` : (name ?? fallback);
    const badges = detectBadges(t.title);
    return {
      badge: resolveBadge(lang),
      primary,
      code: rawLang ? rawLang.toUpperCase() : null,
      badges,
      searchable: `${primary} ${rawLang} ${t.title ?? ""}`.toLowerCase(),
    };
  });
}

type ExternalSubDisplay = {
  badge: LangBadge | null;
  primary: string;
  filename: string;
  code: string | null;
};

/** External subtitle files are usually named "<release>.<lang>.srt" — pull the language subtag out
 * of the filename (when it's a real language code) so these read the same as embedded tracks instead
 * of a raw release-name wall of text. Falls back to the plain filename when no code is recognized. */
function buildExternalSubDisplay(path: string): ExternalSubDisplay {
  const filename = externalFileLabel(path);
  const m = /\.([a-z]{2,3}(?:-[a-z]{2})?)\.(?:srt|vtt|ass|ssa|sub)$/i.exec(filename);
  if (m) {
    const { lang } = parseLangTag(m[1]!);
    const name = languageName(lang);
    if (name) {
      return { badge: resolveBadge(lang), primary: name, filename, code: m[1]!.toUpperCase() };
    }
  }
  return { badge: null, primary: filename, filename, code: null };
}

type MenuPlacement = { bottom: number; left: number; maxHeight: number };

const PANEL_WIDTH_PX = 320;

function computeMenuPlacement(anchor: HTMLElement): MenuPlacement {
  const r = anchor.getBoundingClientRect();
  const spaceAbove = Math.max(120, r.top - 12);
  const maxHeight = Math.min(window.innerHeight * 0.88, spaceAbove);
  let left = r.left + r.width / 2;
  const half = Math.min(PANEL_WIDTH_PX / 2, window.innerWidth * 0.46);
  left = Math.max(half + 8, Math.min(window.innerWidth - half - 8, left));
  return {
    bottom: window.innerHeight - r.top + 8,
    left,
    maxHeight,
  };
}

/** Subtitle track picker + live appearance editor + Arabic-subtitle generation trigger. */
export function PlayerEmbeddedSubtitleMenu({
  subVisible,
  subTracks,
  externalSubFiles,
  subMenuValue,
  secondaryMenuValue,
  onPickSecondary,
  toggleSub,
  subAppearanceOpen,
  setSubAppearanceOpen,
  subtitlePrefs,
  setSubtitlePref,
  setSubtitlePrefs,
  generateArabicSubtitle,
  arabicSubtitleGenerating,
  arabicSubtitleError,
  sessionBlocksTransport,
  launchStateRef,
  send,
  onFullscreenPointerActivity,
  onOpenSubtitleSearch,
}: Props) {
  const anchorRef = useRef<HTMLButtonElement>(null);
  const menuRef = useRef<HTMLDivElement>(null);
  const [menuOpen, setMenuOpen] = useState(false);
  const [placement, setPlacement] = useState<MenuPlacement | null>(null);
  const [trackFilter, setTrackFilter] = useState("");
  /** Which subtitle the track list picks: the main one (bottom) or the second one (top, dual subs). */
  const [pickTarget, setPickTarget] = useState<"main" | "second">("main");

  const embeddedRows = useMemo(() => {
    const displays = buildEmbeddedTrackDisplays(subTracks);
    return subTracks.map((t, i) => ({ track: t, display: displays[i]! }));
  }, [subTracks]);
  const externalRows = useMemo(
    () => externalSubFiles.map((p) => ({ path: p, display: buildExternalSubDisplay(p) })),
    [externalSubFiles],
  );
  const filterQuery = trackFilter.trim().toLowerCase();
  const filteredEmbedded = filterQuery
    ? embeddedRows.filter((r) => r.display.searchable.includes(filterQuery))
    : embeddedRows;
  const filteredExternal = filterQuery
    ? externalRows.filter(
        (r) => r.display.primary.toLowerCase().includes(filterQuery) || r.display.filename.toLowerCase().includes(filterQuery),
      )
    : externalRows;
  const totalTrackCount = subTracks.length + externalSubFiles.length;
  const showGroupLabels = subTracks.length > 0 && externalSubFiles.length > 0;

  const closeMenu = useCallback(() => {
    setMenuOpen(false);
    setSubAppearanceOpen(false);
    setPlacement(null);
    setTrackFilter("");
  }, [setSubAppearanceOpen]);

  const openMenu = useCallback(() => {
    const anchor = anchorRef.current;
    if (!anchor) return;
    onFullscreenPointerActivity();
    setPlacement(computeMenuPlacement(anchor));
    setMenuOpen(true);
  }, [onFullscreenPointerActivity]);

  const toggleMenu = useCallback(() => {
    if (menuOpen) closeMenu();
    else openMenu();
  }, [menuOpen, closeMenu, openMenu]);

  const updatePlacement = useCallback(() => {
    const anchor = anchorRef.current;
    if (!anchor) {
      setPlacement(null);
      return;
    }
    setPlacement(computeMenuPlacement(anchor));
  }, []);

  useEffect(() => {
    if (!menuOpen) return;
    updatePlacement();
    window.addEventListener("resize", updatePlacement);
    window.addEventListener("scroll", updatePlacement, true);
    return () => {
      window.removeEventListener("resize", updatePlacement);
      window.removeEventListener("scroll", updatePlacement, true);
    };
  }, [menuOpen, updatePlacement]);

  useEffect(() => {
    if (menuOpen) updatePlacement();
  }, [menuOpen, subAppearanceOpen, subTracks.length, externalSubFiles.length, updatePlacement]);

  useEffect(() => {
    if (!menuOpen) return;
    const onPointerDown = (e: PointerEvent) => {
      const t = e.target as Node;
      if (anchorRef.current?.contains(t)) return;
      if (menuRef.current?.contains(t)) return;
      closeMenu();
    };
    document.addEventListener("pointerdown", onPointerDown, true);
    return () => document.removeEventListener("pointerdown", onPointerDown, true);
  }, [menuOpen, closeMenu]);

  const pickTrack = (v: string) => {
    const launch = launchStateRef.current;
    if (launch && launch.libraryEpisodeId != null && launch.libraryEpisodeId > 0) {
      persistEpSubPick(playbackEpisodeKey(launch), v);
    }
    if (v === "") void send({ type: "SetSid", payload: -1 });
    else if (v.startsWith("x:")) {
      const path = decodeURIComponent(v.slice(2));
      void send({ type: "SubAddSelect", payload: path });
    } else if (v.startsWith("e:")) {
      void send({ type: "SetSid", payload: Number(v.slice(2)) });
    }
  };

  const currentValue = pickTarget === "main" ? subMenuValue : secondaryMenuValue;
  /** The track already used by the other slot — mpv can't show one track in both. */
  const otherValue = pickTarget === "main" ? secondaryMenuValue : subMenuValue;
  const otherPickTitle = pickTarget === "main" ? "Already the second subtitle" : "Already the main subtitle";
  const choose = (v: string) => (pickTarget === "main" ? pickTrack(v) : onPickSecondary(v));

  const menuPanel = menuOpen && placement ? (
    <div
      ref={menuRef}
      id="pitflix-sub-menu-panel"
      className="fixed z-[200] flex w-[min(92vw,320px)] -translate-x-1/2 flex-col overflow-hidden rounded-lg border border-white/15 bg-black shadow-xl"
      style={{
        bottom: placement.bottom,
        left: placement.left,
        maxHeight: placement.maxHeight,
        height: placement.maxHeight,
      }}
      onClick={(e) => e.stopPropagation()}
    >
        <div className="flex shrink-0 items-center justify-between gap-2 border-b border-white/10 bg-white/[0.03] px-3 py-2.5">
          <div className="flex items-center gap-1.5">
            <Captions className="h-3.5 w-3.5 text-pitflix-primary" strokeWidth={2.5} />
            <span className="text-[12px] font-semibold text-white">Subtitles</span>
          </div>
          <div className="flex shrink-0 items-center gap-1">
            <button
              type="button"
              role="switch"
              aria-checked={subVisible}
              aria-label={subVisible ? "Hide subtitles" : "Show subtitles"}
              title={subVisible ? "Hide subtitles" : "Show subtitles"}
              disabled={sessionBlocksTransport}
              className={cn(
                "relative mr-1 h-5 w-9 shrink-0 rounded-full transition-colors disabled:cursor-not-allowed disabled:opacity-40",
                subVisible ? "bg-pitflix-primary" : "bg-white/15 hover:bg-white/20",
              )}
              onClick={() => toggleSub()}
            >
              <span
                className={cn(
                  "absolute left-0.5 top-0.5 h-4 w-4 rounded-full bg-white shadow-sm transition-transform",
                  subVisible ? "translate-x-4" : "translate-x-0",
                )}
              />
            </button>

            <div className="h-4 w-px shrink-0 bg-white/10" />

            <button
              type="button"
              aria-label="Search subtitles online"
              title="Search subtitles online"
              className="flex h-9 w-9 items-center justify-center rounded-md text-pitflix-primary transition-colors hover:bg-pitflix-primary/15"
              onClick={(e) => {
                e.stopPropagation();
                closeMenu();
                onOpenSubtitleSearch();
              }}
            >
              <Search className="h-[18px] w-[18px]" strokeWidth={2} />
            </button>
            <button
              type="button"
              aria-label="Subtitle appearance"
              title="Subtitle appearance"
              className={cn(
                "flex h-7 w-7 items-center justify-center rounded-md transition-colors",
                subAppearanceOpen
                  ? "bg-pitflix-primary/15 text-pitflix-primary"
                  : "text-white/70 hover:bg-white/10 hover:text-white",
              )}
              onClick={(e) => {
                e.stopPropagation();
                setSubAppearanceOpen((v) => !v);
              }}
            >
              <SlidersHorizontal className="h-3.5 w-3.5" />
            </button>
            <button
              type="button"
              aria-label="Close subtitles panel"
              title="Close"
              className="flex h-7 w-7 items-center justify-center rounded-md text-white/70 transition-colors hover:bg-white/10 hover:text-white"
              onClick={() => closeMenu()}
            >
              <X className="h-3.5 w-3.5" strokeWidth={2} />
            </button>
          </div>
        </div>

        <div className="min-h-0 flex-1 overflow-y-auto pitflix-sub-track-scroll">
          {subAppearanceOpen ? (
            <div className="space-y-2 p-2 pb-3">
            <p className="text-[9px] uppercase tracking-wide text-white/55">Appearance (live)</p>
            <button
              type="button"
              disabled={sessionBlocksTransport}
              className="w-full rounded-md border border-white/15 bg-white/5 px-2 py-1.5 text-[10px] text-white hover:bg-white/10 disabled:opacity-40"
              title="Black stroke around text for readability on bright scenes"
              onClick={() => {
                setSubtitlePref("borderColor", "#000000");
                setSubtitlePref("borderSize", 3);
              }}
            >
              Strong subtitle outline
            </button>
            <div className="border-t border-white/10 pt-2">
              <p className="mb-2 text-[9px] uppercase tracking-wide text-white/55">Generate Arabic Subtitle</p>
              <button
                type="button"
                disabled={sessionBlocksTransport || arabicSubtitleGenerating}
                className="w-full rounded-md border border-white/25 bg-white/5 px-2 py-1.5 text-[10px] text-white hover:bg-white/10 disabled:opacity-40"
                title="Extract English subtitle and translate to Arabic using Argos Translate"
                onClick={() => void generateArabicSubtitle()}
              >
                {arabicSubtitleGenerating ? "Generating..." : "Generate Arabic Subtitle"}
              </button>
              {arabicSubtitleError ? (
                <p className="mt-1 text-[9px] text-red-400">{arabicSubtitleError}</p>
              ) : null}
            </div>
            <div className="grid grid-cols-2 gap-2">
              <label className="block text-[10px] text-white/70">
                Size
                <input
                  type="range"
                  min={24}
                  max={72}
                  step={1}
                  value={subtitlePrefs.fontSize}
                  onChange={(e) => setSubtitlePref("fontSize", Number(e.currentTarget.value))}
                  className="mt-1 h-1.5 w-full cursor-pointer accent-white"
                />
              </label>
              <label className="block text-[10px] text-white/70">
                Position
                <input
                  type="range"
                  min={65}
                  max={95}
                  step={1}
                  value={subtitlePrefs.position}
                  onChange={(e) => setSubtitlePref("position", Number(e.currentTarget.value))}
                  className="mt-1 h-1.5 w-full cursor-pointer accent-white"
                />
              </label>
            </div>
            <div className="grid grid-cols-2 gap-2">
              <label className="block text-[10px] text-white/70">
                Text color
                <input
                  type="color"
                  value={subtitlePrefs.textColor}
                  onChange={(e) => setSubtitlePref("textColor", e.currentTarget.value.toUpperCase())}
                  className="mt-1 h-7 w-full cursor-pointer rounded border border-white/20 bg-black"
                />
              </label>
              <label className="block text-[10px] text-white/70">
                Border color
                <input
                  type="color"
                  value={subtitlePrefs.borderColor}
                  onChange={(e) => setSubtitlePref("borderColor", e.currentTarget.value.toUpperCase())}
                  className="mt-1 h-7 w-full cursor-pointer rounded border border-white/20 bg-black"
                />
              </label>
            </div>
            <div className="grid grid-cols-2 gap-2">
              <label className="block text-[10px] text-white/70">
                Back color
                <input
                  type="color"
                  value={subtitlePrefs.backColor.slice(0, 7)}
                  onChange={(e) =>
                    setSubtitlePref(
                      "backColor",
                      `${e.currentTarget.value.toUpperCase()}${subtitlePrefs.backColor.length === 9 ? subtitlePrefs.backColor.slice(7) : "00"}`,
                    )
                  }
                  className="mt-1 h-7 w-full cursor-pointer rounded border border-white/20 bg-black"
                />
              </label>
              <label className="block text-[10px] text-white/70">
                Shadow color
                <input
                  type="color"
                  value={subtitlePrefs.shadowColor.slice(0, 7)}
                  onChange={(e) =>
                    setSubtitlePref(
                      "shadowColor",
                      `${e.currentTarget.value.toUpperCase()}${subtitlePrefs.shadowColor.length === 9 ? subtitlePrefs.shadowColor.slice(7) : "88"}`,
                    )
                  }
                  className="mt-1 h-7 w-full cursor-pointer rounded border border-white/20 bg-black"
                />
              </label>
            </div>
            <div className="grid grid-cols-2 gap-2">
              <label className="block text-[10px] text-white/70">
                Border size
                <input
                  type="range"
                  min={0}
                  max={6}
                  step={0.5}
                  value={subtitlePrefs.borderSize}
                  onChange={(e) => setSubtitlePref("borderSize", Number(e.currentTarget.value))}
                  className="mt-1 h-1.5 w-full cursor-pointer accent-white"
                />
              </label>
              <label className="block text-[10px] text-white/70">
                Shadow offset
                <input
                  type="range"
                  min={0}
                  max={6}
                  step={0.5}
                  value={subtitlePrefs.shadowOffset}
                  onChange={(e) => setSubtitlePref("shadowOffset", Number(e.currentTarget.value))}
                  className="mt-1 h-1.5 w-full cursor-pointer accent-white"
                />
              </label>
            </div>
            <label className="block text-[10px] text-white/70">
              Font family (Arabic-friendly)
              <select
                className="mt-1 w-full rounded border border-white/15 bg-black px-2 py-1 text-[11px] text-white"
                value={subtitlePrefs.fontFamily}
                onChange={(e) => setSubtitlePref("fontFamily", e.currentTarget.value)}
              >
                <option value="Noto Naskh Arabic">Noto Naskh Arabic</option>
                <option value="Noto Sans Arabic">Noto Sans Arabic</option>
                <option value="Arial">Arial</option>
                <option value="Segoe UI">Segoe UI</option>
              </select>
            </label>
            <button
              type="button"
              className="w-full rounded border border-white/15 px-2 py-1 text-[10px] text-white/70 hover:bg-white/10"
              onClick={() => setSubtitlePrefs(DEFAULT_SUBTITLE_PREFS)}
            >
              Reset subtitle appearance
            </button>
            </div>
          ) : (
          <div className="px-1.5 py-1.5">
          <div className="mx-0.5 mb-1.5 grid grid-cols-2 gap-0.5 rounded-lg bg-white/[0.06] p-0.5">
            {(["main", "second"] as const).map((t) => (
              <button
                key={t}
                type="button"
                className={cn(
                  "flex items-center justify-center gap-1 rounded-md px-2 py-1 text-[10px] font-semibold transition-colors",
                  pickTarget === t ? "bg-pitflix-primary text-white" : "text-white/55 hover:text-white",
                )}
                onClick={() => setPickTarget(t)}
              >
                {t === "main" ? "Main subtitle" : "Second subtitle"}
                {t === "second" && secondaryMenuValue !== "" ? (
                  <span className="h-1.5 w-1.5 rounded-full bg-emerald-400" aria-label="on" />
                ) : null}
              </button>
            ))}
          </div>
          {pickTarget === "second" ? (
            <p className="mb-1 px-2 text-[9px] leading-snug text-white/40">
              Shown at the top together with the main subtitle — e.g. English above, Arabic below.
            </p>
          ) : null}
          <div className="flex items-center justify-between px-1.5 py-1">
            <p className="text-[9px] font-semibold uppercase tracking-wide text-white/55">Track</p>
            {totalTrackCount > 6 ? (
              <span className="text-[9px] tabular-nums text-white/35">
                {filteredEmbedded.length + filteredExternal.length}/{totalTrackCount}
              </span>
            ) : null}
          </div>

          {totalTrackCount > 6 ? (
            <div className="relative mx-0.5 mb-2">
              <Search className="pointer-events-none absolute left-2.5 top-1/2 h-3 w-3 -translate-y-1/2 text-white/35" />
              <input
                type="text"
                value={trackFilter}
                onChange={(e) => setTrackFilter(e.currentTarget.value)}
                placeholder="Filter languages…"
                className="w-full rounded-lg border border-white/10 bg-white/5 py-1.5 pl-7 pr-2 text-[11px] text-white placeholder:text-white/35 focus:border-pitflix-primary/50 focus:outline-none"
              />
            </div>
          ) : null}

          {!filterQuery ? (
            <button
              type="button"
              disabled={sessionBlocksTransport}
              className={cn(
                "mb-0.5 flex w-full items-center gap-2.5 rounded-lg px-2.5 py-2 text-left text-[12px] text-white transition-colors hover:bg-white/10 disabled:opacity-40",
                currentValue === "" ? "bg-pitflix-primary/15 ring-1 ring-inset ring-pitflix-primary/30" : "",
              )}
              onClick={() => choose("")}
            >
              <EyeOff className="h-3.5 w-3.5 shrink-0 text-white/50" />
              <span className="flex-1 font-medium">{pickTarget === "main" ? "Off" : "No second subtitle"}</span>
              {currentValue === "" ? <Check className="h-3.5 w-3.5 shrink-0 text-pitflix-primary" strokeWidth={2.5} /> : null}
            </button>
          ) : null}

          {showGroupLabels && filteredEmbedded.length > 0 ? (
            <p className="mb-0.5 mt-1.5 px-2.5 text-[8px] font-semibold uppercase tracking-wide text-white/35">Embedded</p>
          ) : null}

          {filteredEmbedded.map(({ track: t, display }) => {
            const val = `e:${t.id ?? ""}`;
            const active = currentValue === val;
            const isOtherPick = otherValue !== "" && otherValue === val;
            return (
              <button
                key={`s-${t.id ?? ""}`}
                type="button"
                disabled={sessionBlocksTransport || isOtherPick}
                title={isOtherPick ? otherPickTitle : undefined}
                className={cn(
                  "mb-0.5 flex w-full items-center gap-2.5 rounded-lg px-2.5 py-2 text-left text-[12px] text-white transition-colors hover:bg-white/10 disabled:opacity-40",
                  active ? "bg-pitflix-primary/15 ring-1 ring-inset ring-pitflix-primary/30" : "",
                )}
                onClick={() => choose(val)}
              >
                {display.badge ? (
                  <span
                    className="flex h-5 w-5 shrink-0 items-center justify-center rounded-full text-[8px] font-bold leading-none text-white"
                    style={{ backgroundColor: display.badge.color }}
                  >
                    {display.badge.text}
                  </span>
                ) : (
                  <span className="flex h-5 w-5 shrink-0 items-center justify-center rounded-full bg-white/5">
                    <Captions className="h-3 w-3 text-white/40" />
                  </span>
                )}
                <span className="min-w-0 flex-1 truncate font-medium">{display.primary}</span>
                {display.badges.map((b) => (
                  <span
                    key={b}
                    className={cn(
                      "shrink-0 rounded px-1 py-px text-[8px] font-bold leading-tight",
                      b === "FORCED" ? "bg-amber-500/20 text-amber-400" : "bg-sky-500/20 text-sky-400",
                    )}
                  >
                    {b}
                  </span>
                ))}
                {display.code ? (
                  <span className="shrink-0 font-mono text-[9px] text-white/35">{display.code}</span>
                ) : null}
                {active ? <Check className="h-3.5 w-3.5 shrink-0 text-pitflix-primary" strokeWidth={2.5} /> : null}
              </button>
            );
          })}

          {showGroupLabels && filteredExternal.length > 0 ? (
            <p className="mb-0.5 mt-1.5 px-2.5 text-[8px] font-semibold uppercase tracking-wide text-white/35">External files</p>
          ) : null}

          {filteredExternal.map(({ path: p, display }) => {
            const val = `x:${encodeURIComponent(p)}`;
            const active = currentValue === val;
            const isOtherPick = otherValue !== "" && otherValue === val;
            return (
              <button
                key={`ext-${p}`}
                type="button"
                disabled={sessionBlocksTransport || isOtherPick}
                className={cn(
                  "mb-0.5 flex w-full items-start gap-2.5 rounded-lg px-2.5 py-2 text-left text-[12px] text-white transition-colors hover:bg-white/10 disabled:opacity-40",
                  active ? "bg-pitflix-primary/15 ring-1 ring-inset ring-pitflix-primary/30" : "",
                )}
                title={isOtherPick ? otherPickTitle : p}
                onClick={() => choose(val)}
              >
                {display.badge ? (
                  <span
                    className="mt-px flex h-5 w-5 shrink-0 items-center justify-center rounded-full text-[8px] font-bold leading-none text-white"
                    style={{ backgroundColor: display.badge.color }}
                  >
                    {display.badge.text}
                  </span>
                ) : (
                  <span className="mt-px flex h-5 w-5 shrink-0 items-center justify-center rounded-full bg-white/5">
                    <FileText className="h-3 w-3 text-white/40" />
                  </span>
                )}
                <span className="min-w-0 flex-1">
                  <span className="flex items-center gap-1.5">
                    <span className="truncate font-medium">{display.primary}</span>
                    {display.code ? (
                      <span className="shrink-0 font-mono text-[9px] text-white/35">{display.code}</span>
                    ) : null}
                  </span>
                  {display.code ? (
                    <span className="line-clamp-1 block text-[9px] text-white/35">{display.filename}</span>
                  ) : null}
                </span>
                {active ? <Check className="mt-0.5 h-3.5 w-3.5 shrink-0 text-pitflix-primary" strokeWidth={2.5} /> : null}
              </button>
            );
          })}

          {filterQuery && filteredEmbedded.length === 0 && filteredExternal.length === 0 ? (
            <p className="px-2 py-3 text-center text-[10px] text-white/40">No tracks match "{trackFilter.trim()}"</p>
          ) : null}
          </div>
          )}
        </div>
    </div>
  ) : null;

  return (
    <>
      <button
        ref={anchorRef}
        type="button"
        className={cn(
          "flex h-9 items-center justify-center gap-1 rounded-[7px] border px-[11px] text-[11px] font-bold outline-none",
          subVisible
            ? "border-[rgba(124,58,237,0.32)] bg-[rgba(124,58,237,0.18)] text-[#c4b5fd]"
            : "border-transparent bg-white/[0.07] text-white hover:bg-white/[0.12]",
        )}
        title="Subtitles"
        aria-expanded={menuOpen}
        aria-haspopup="dialog"
        onClick={() => toggleMenu()}
      >
        <Captions className="h-3.5 w-3.5" strokeWidth={2.5} />
        CC
      </button>
      {typeof document !== "undefined" && menuPanel ? createPortal(menuPanel, document.body) : null}
    </>
  );
}
