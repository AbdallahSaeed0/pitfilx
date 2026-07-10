import { Captions, Search, SlidersHorizontal } from "lucide-react";
import { useCallback, useEffect, useRef, useState, type RefObject } from "react";
import { createPortal } from "react-dom";
import { cn } from "../../utils/cn";
import { DEFAULT_SUBTITLE_PREFS, persistEpSubPick } from "./playerStorage";
import { playbackEpisodeKey } from "../../playback/playbackApi";
import type { PlaybackLaunchState } from "../../types/playback";
import type { PlayerEmbeddedSubtitlesProps } from "./playerViewProps";

type Props = PlayerEmbeddedSubtitlesProps & {
  sessionBlocksTransport: boolean;
  launchStateRef: RefObject<PlaybackLaunchState | undefined>;
  send: (cmd: unknown) => Promise<void>;
  onFullscreenPointerActivity: () => void;
};

function trackLabel(
  type: "embedded" | "external",
  t?: { id?: number | null; lang?: string | null; title?: string | null; selected?: boolean },
  path?: string,
): string {
  if (type === "external" && path) {
    return path.replace(/^.*[/\\]/, "");
  }
  const base = (t?.lang || t?.title || `Track ${t?.id ?? ""}`).trim();
  return t?.selected ? `${base} (current)` : base;
}

type MenuPlacement = { bottom: number; left: number; maxHeight: number };

const PANEL_WIDTH_PX = 300;

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

  const closeMenu = useCallback(() => {
    setMenuOpen(false);
    setSubAppearanceOpen(false);
    setPlacement(null);
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

  const menuPanel = menuOpen && placement ? (
    <div
      ref={menuRef}
      id="pitflix-sub-menu-panel"
      className="fixed z-[200] flex w-[min(92vw,300px)] -translate-x-1/2 flex-col overflow-hidden rounded-lg border border-white/15 bg-black shadow-xl"
      style={{
        bottom: placement.bottom,
        left: placement.left,
        maxHeight: placement.maxHeight,
        height: placement.maxHeight,
      }}
      onClick={(e) => e.stopPropagation()}
    >
        <div className="flex shrink-0 items-center justify-between gap-2 border-b border-white/10 px-2 py-1.5">
          <label className="flex cursor-pointer items-center gap-2 text-[10px] text-white">
            <input
              type="checkbox"
              className="rounded border-white/30"
              checked={subVisible}
              disabled={sessionBlocksTransport}
              onChange={() => toggleSub()}
            />
            Show subtitles
          </label>
          <div className="flex shrink-0 items-center gap-0.5">
            <button
              type="button"
              aria-label="Search subtitles online"
              title="Search subtitles online"
              className="flex h-6 w-6 items-center justify-center rounded text-pitflix-primary hover:bg-white/10"
              onClick={(e) => {
                e.stopPropagation();
                closeMenu();
                onOpenSubtitleSearch();
              }}
            >
              <Search className="h-3.5 w-3.5" strokeWidth={2} />
            </button>
            <button
              type="button"
              aria-label="Subtitle appearance"
              title="Subtitle appearance"
              className={cn(
                "flex h-6 w-6 items-center justify-center rounded text-white hover:bg-white/10",
                subAppearanceOpen ? "bg-white/15" : "text-white/70",
              )}
              onClick={(e) => {
                e.stopPropagation();
                setSubAppearanceOpen((v) => !v);
              }}
            >
              <SlidersHorizontal className="h-3 w-3" />
            </button>
            <button
              type="button"
              aria-label="Close subtitles panel"
              className="flex h-6 w-6 items-center justify-center rounded text-white/70 hover:bg-white/10 hover:text-white"
              onClick={() => closeMenu()}
            >
              ✕
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
          <div className="px-1 py-1">
          <p className="px-2 py-1 text-[9px] font-semibold uppercase tracking-wide text-white/55">Track</p>
          <button
            type="button"
            disabled={sessionBlocksTransport}
            className={cn(
              "mb-0.5 flex w-full rounded px-2 py-1.5 text-left text-[11px] text-white hover:bg-white/10 disabled:opacity-40",
              subMenuValue === "" ? "bg-white/15" : "",
            )}
            onClick={() => pickTrack("")}
          >
            Off
          </button>
          {subTracks.map((t) => {
            const val = `e:${t.id ?? ""}`;
            return (
              <button
                key={`s-${t.id ?? ""}`}
                type="button"
                disabled={sessionBlocksTransport}
                className={cn(
                  "mb-0.5 flex w-full rounded px-2 py-1.5 text-left text-[11px] text-white hover:bg-white/10 disabled:opacity-40",
                  subMenuValue === val ? "bg-white/15" : "",
                )}
                onClick={() => pickTrack(val)}
              >
                {trackLabel("embedded", t)}
              </button>
            );
          })}
          {externalSubFiles.map((p) => {
            const val = `x:${encodeURIComponent(p)}`;
            return (
              <button
                key={`ext-${p}`}
                type="button"
                disabled={sessionBlocksTransport}
                className={cn(
                  "mb-0.5 flex w-full rounded px-2 py-1.5 text-left text-[11px] text-white hover:bg-white/10 disabled:opacity-40",
                  subMenuValue === val ? "bg-white/15" : "",
                )}
                title={p}
                onClick={() => pickTrack(val)}
              >
                <span className="line-clamp-2">{trackLabel("external", undefined, p)}</span>
              </button>
            );
          })}
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
