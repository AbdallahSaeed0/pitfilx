import { isTauri } from "@tauri-apps/api/core";
import { useEffect, useRef, useState, type MouseEvent } from "react";
import { Antenna } from "lucide-react";
import { cn } from "../../utils/cn";
import { DeviceVideoHoverPreview } from "../device/DeviceThumbs";
import { getPosterThumbnail, resolvePlaylistPoster } from "../../utils/videoThumbnailCache";
import { fileDisplayTitle, formatBytes } from "./playerFormat";
import type { DeviceFsEntry, PlaylistEpisodeMeta } from "./playerTypes";

/** Renders one playlist row with a thumbnail poster (lazy-fetched via Tauri) or a channel logo for live IPTV.
 * When `episodeMeta` is provided (the file resolved to a library episode), the row renders as an episode
 * card — title, IMDb rating + runtime badges, and a clamped synopsis — instead of a bare filename. */
export function PlaylistTile({
  entry,
  active,
  episodeMeta,
  onSelect,
  onContextMenu,
}: {
  entry: DeviceFsEntry;
  active: boolean;
  episodeMeta?: PlaylistEpisodeMeta;
  onSelect: () => void;
  onContextMenu?: (e: MouseEvent) => void;
}) {
  const isLive = Boolean(entry.logoUrl !== undefined);
  const episodeStillUrl = episodeMeta?.stillLocalPath || episodeMeta?.stillUrl || null;
  const episodeTitle = episodeMeta?.title?.trim() || null;
  const hasBadges = Boolean(
    (episodeMeta?.imdbVoteAverage != null && episodeMeta.imdbVoteAverage > 0) ||
      (episodeMeta?.runtimeMinutes != null && episodeMeta.runtimeMinutes > 0),
  );
  const rowRef = useRef<HTMLButtonElement>(null);
  const [thumbUrl, setThumbUrl] = useState<string | null>(() =>
    entry.logoUrl ? entry.logoUrl : (getPosterThumbnail(entry.path) ?? null),
  );
  const [logoFailed, setLogoFailed] = useState(false);

  useEffect(() => {
    // For live channels use the logo directly — no Tauri thumb scan needed.
    if (isLive) {
      setThumbUrl(entry.logoUrl ?? null);
      setLogoFailed(false);
      return;
    }
    if (!isTauri()) return;
    const cached = getPosterThumbnail(entry.path);
    if (cached) {
      setThumbUrl(cached);
      return;
    }
    let cancelled = false;
    void resolvePlaylistPoster(entry.path).then((url) => {
      if (cancelled || !url) return;
      setThumbUrl(url);
    });
    return () => {
      cancelled = true;
    };
  }, [entry.path, entry.logoUrl, isLive]);

  return (
    <button
      ref={rowRef}
      type="button"
      data-own-context-menu="true"
      onClick={() => { if (!active) onSelect(); }}
      onPointerDown={(e) => { if (e.button === 2) e.stopPropagation(); }}
      onAuxClick={(e) => { if (e.button === 2) e.stopPropagation(); }}
      onContextMenu={(e) => {
        e.stopPropagation();
        onContextMenu?.(e);
      }}
      className={cn(
        "flex w-full items-center gap-[10px] border-l-[3px] px-[14px] py-[9px] text-left text-[13px] transition-colors",
        active ? "cursor-default border-l-[#7c3aed] bg-[rgba(124,58,237,0.1)]" : "border-l-transparent hover:bg-white/5",
      )}
      title={entry.name}
    >
      <span className="relative flex h-[72px] w-[104px] shrink-0 items-center justify-center overflow-hidden rounded-[7px] bg-black/50">
        {isLive ? (
          thumbUrl && !logoFailed ? (
            <img
              src={thumbUrl}
              alt=""
              className="h-full w-full object-contain p-1"
              onError={() => setLogoFailed(true)}
            />
          ) : (
            <Antenna className="h-6 w-6 text-white/30" />
          )
        ) : (
          <DeviceVideoHoverPreview path={entry.path} hoverContainerRef={rowRef}>
            {episodeStillUrl ? (
              <img src={episodeStillUrl} alt="" className="h-full w-full object-cover" />
            ) : thumbUrl ? (
              <img src={thumbUrl} alt="" className="h-full w-full object-cover" />
            ) : null}
          </DeviceVideoHoverPreview>
        )}
        {active ? (
          <span className="absolute inset-0 flex items-center justify-center bg-black/40">
            <span className="flex h-7 w-7 items-center justify-center rounded-full bg-[#7c3aed]">
              <span className="h-2.5 w-2.5 bg-white" style={{ clipPath: "polygon(0 0, 0 100%, 100% 50%)" }} />
            </span>
          </span>
        ) : null}
      </span>
      <span className="flex min-w-0 flex-1 flex-col gap-[3px]">
        {active ? (
          <span className="flex items-center gap-1.5 text-[10px] font-bold uppercase tracking-[0.07em] text-[#a78bfa]">
            <span className="rounded-[3px] bg-[#7c3aed] px-1.5 py-px text-[9px] text-white">
              {isLive ? "LIVE" : "NOW PLAYING"}
            </span>
          </span>
        ) : null}
        <span
          className={cn(
            "block overflow-x-auto whitespace-nowrap text-[11.5px] font-semibold [scrollbar-width:none] [&::-webkit-scrollbar]:hidden",
            active ? "text-white" : "text-white/[0.88]",
          )}
        >
          {isLive ? entry.name : episodeTitle ?? fileDisplayTitle(entry.name)}
        </span>
        {episodeMeta ? (
          <>
            {hasBadges ? (
              <span className="flex items-center gap-1.5">
                {episodeMeta.imdbVoteAverage != null && episodeMeta.imdbVoteAverage > 0 ? (
                  <span className="rounded-[3px] bg-[#2a2208] px-1.5 py-px text-[9.5px] font-semibold text-[#f5c518]">
                    IMDb {episodeMeta.imdbVoteAverage.toFixed(1)}
                  </span>
                ) : null}
                {episodeMeta.runtimeMinutes != null && episodeMeta.runtimeMinutes > 0 ? (
                  <span className="rounded-[3px] bg-white/10 px-1.5 py-px text-[9.5px] text-white/70">
                    {episodeMeta.runtimeMinutes}m
                  </span>
                ) : null}
              </span>
            ) : null}
            {episodeMeta.overview ? (
              <span className="line-clamp-2 text-[10.5px] leading-[1.25] text-white/45">{episodeMeta.overview}</span>
            ) : null}
          </>
        ) : !isLive && entry.size_bytes != null ? (
          <span className="truncate text-[10.5px] text-white/40">{formatBytes(entry.size_bytes)}</span>
        ) : null}
      </span>
    </button>
  );
}
