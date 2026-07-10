import { Volume2, VolumeX } from "lucide-react";
import type { RefObject } from "react";
import type { PlayerEmbeddedVolumeProps } from "./playerViewProps";

type Props = PlayerEmbeddedVolumeProps & {
  sessionBlocksTransport: boolean;
  volumeDraggingRef: RefObject<boolean>;
  volumeWheelRef: RefObject<HTMLElement | null>;
  onFullscreenPointerActivity: () => void;
};

/** Footer volume icon — click opens a small slider popup; scroll wheel still works on the icon. */
export function PlayerEmbeddedVolumeControl({
  volume,
  mute,
  toggleMute,
  setVolumePct,
  sessionBlocksTransport,
  volumeDraggingRef,
  volumeWheelRef,
  onFullscreenPointerActivity,
}: Props) {
  return (
    <details className="group relative">
      <summary
        ref={volumeWheelRef}
        className="flex h-8 w-8 cursor-pointer list-none items-center justify-center rounded-md bg-white/10 text-white marker:content-none hover:bg-white/20 [&::-webkit-details-marker]:hidden"
        title={`Volume ${Math.round(volume)}% — scroll to adjust`}
        onClick={() => onFullscreenPointerActivity()}
      >
        {mute ? <VolumeX className="h-4 w-4" /> : <Volume2 className="h-4 w-4" />}
      </summary>
      <div className="absolute bottom-full right-0 z-[60] mb-2 flex items-center gap-2 rounded-lg border border-white/10 bg-black/95 p-2 shadow-xl backdrop-blur">
        <button
          type="button"
          title={mute ? "Unmute" : "Mute"}
          className="flex h-7 w-7 items-center justify-center rounded text-white hover:bg-white/15"
          onClick={() => toggleMute()}
        >
          {mute ? <VolumeX className="h-3.5 w-3.5" /> : <Volume2 className="h-3.5 w-3.5" />}
        </button>
        <input
          type="range"
          min={0}
          max={200}
          step={1}
          value={Math.round(volume)}
          disabled={sessionBlocksTransport}
          onPointerDown={() => {
            volumeDraggingRef.current = true;
          }}
          onInput={(e) => setVolumePct(Number(e.currentTarget.value))}
          onChange={(e) => setVolumePct(Number(e.currentTarget.value))}
          className="h-1.5 w-40 cursor-pointer accent-pitflix-primary disabled:opacity-40"
        />
        <span className="min-w-[2.5rem] select-none text-center text-[10px] tabular-nums text-pitflix-muted">
          {Math.round(volume)}
        </span>
      </div>
    </details>
  );
}
