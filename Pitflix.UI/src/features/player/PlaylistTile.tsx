import { isTauri } from "@tauri-apps/api/core";
import { useEffect, useState, type MouseEvent } from "react";
import { Antenna } from "lucide-react";
import { cn } from "../../utils/cn";
import { getPosterThumbnail, resolvePlaylistPoster } from "../../utils/videoThumbnailCache";
import { fileDisplayTitle, formatBytes } from "./playerFormat";
import type { DeviceFsEntry } from "./playerTypes";

/** Renders one playlist row with a thumbnail poster (lazy-fetched via Tauri) or a channel logo for live IPTV. */
export function PlaylistTile({
  entry,
  active,
  onSelect,
  onContextMenu,
}: {
  entry: DeviceFsEntry;
  active: boolean;
  onSelect: () => void;
  onContextMenu?: (e: MouseEvent) => void;
}) {
  const isLive = Boolean(entry.logoUrl !== undefined);
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
      <span className="relative flex h-[58px] w-[80px] shrink-0 items-center justify-center overflow-hidden rounded-[7px] bg-black/50">
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
        ) : thumbUrl ? (
          <img src={thumbUrl} alt="" className="h-full w-full object-cover" />
        ) : null}
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
            "block overflow-x-auto whitespace-nowrap font-semibold [scrollbar-width:none] [&::-webkit-scrollbar]:hidden",
            active ? "text-white" : "text-white/[0.88]",
          )}
        >
          {isLive ? entry.name : fileDisplayTitle(entry.name)}
        </span>
        {!isLive && entry.size_bytes != null ? (
          <span className="truncate text-[10.5px] text-white/40">{formatBytes(entry.size_bytes)}</span>
        ) : null}
      </span>
    </button>
  );
}
