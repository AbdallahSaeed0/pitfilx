import { Gauge } from "lucide-react";
import { cn } from "../../utils/cn";

export const PLAYBACK_SPEED_PRESETS = [0.75, 1, 1.25, 1.5, 1.75, 2] as const;

export function formatPlaybackSpeed(speed: number): string {
  const rounded = Math.round(speed * 100) / 100;
  return `${rounded % 1 === 0 ? rounded.toFixed(1) : rounded}x`;
}

type Props = {
  speed: number;
  onSpeedChange: (speed: number) => void;
  disabled?: boolean;
  onPointerActivity?: () => void;
  /** Wider popup for companion page hero actions. */
  variant?: "footer" | "inline";
};

/** Playback speed picker — sends `SetSpeed` to mpv via PlayerPage. */
export function PlayerSpeedControl({
  speed,
  onSpeedChange,
  disabled,
  onPointerActivity,
  variant = "footer",
}: Props) {
  const isFooter = variant === "footer";

  return (
    <details className="group relative">
      <summary
        className={cn(
          "flex cursor-pointer list-none items-center justify-center marker:content-none [&::-webkit-details-marker]:hidden",
          isFooter
            ? "h-9 min-w-[2.5rem] rounded-[7px] border border-white/10 bg-white/[0.07] px-[11px] text-[12.5px] font-semibold tabular-nums text-white hover:bg-white/[0.12]"
            : "h-9 gap-1.5 rounded-md bg-white/10 px-3 text-xs font-medium text-white hover:bg-white/20",
          speed !== 1 && isFooter && "text-[#c4b5fd]",
        )}
        title={`Playback speed (${formatPlaybackSpeed(speed)})`}
        onClick={() => onPointerActivity?.()}
      >
        {isFooter ? (
          formatPlaybackSpeed(speed)
        ) : (
          <>
            <Gauge className="h-4 w-4" />
            {formatPlaybackSpeed(speed)}
          </>
        )}
      </summary>
      <div
        className={cn(
          "absolute z-[60] min-w-[108px] rounded-[10px] border border-white/10 p-[5px] shadow-xl",
          isFooter ? "bottom-full right-0 mb-2" : "left-1/2 top-full mt-2 -translate-x-1/2 min-w-[10rem]",
        )}
        style={
          isFooter
            ? { background: "rgba(14,12,26,0.96)", backdropFilter: "blur(20px)" }
            : undefined
        }
      >
        {isFooter ? null : (
          <p className="mb-1.5 px-1 text-[9px] font-semibold uppercase tracking-wide text-white/55">Speed</p>
        )}
        <div className={isFooter ? "flex flex-col gap-0.5" : "grid grid-cols-3 gap-1"}>
          {PLAYBACK_SPEED_PRESETS.map((preset) => {
            const active = Math.abs(speed - preset) < 0.01;
            return (
              <button
                key={preset}
                type="button"
                disabled={disabled}
                className={
                  isFooter
                    ? cn(
                        "w-full rounded-md px-2.5 py-1.5 text-left text-[12px] tabular-nums transition disabled:opacity-40",
                        active
                          ? "bg-[rgba(124,58,237,0.18)] font-semibold text-[#c4b5fd]"
                          : "text-white/85 hover:bg-white/10",
                      )
                    : cn(
                        "rounded-md px-2 py-1.5 text-[11px] font-semibold tabular-nums transition",
                        active
                          ? "bg-pitflix-primary text-white"
                          : "bg-white/5 text-white/90 hover:bg-white/15 disabled:opacity-40",
                      )
                }
                onClick={() => onSpeedChange(preset)}
              >
                {formatPlaybackSpeed(preset)}
              </button>
            );
          })}
        </div>
      </div>
    </details>
  );
}
