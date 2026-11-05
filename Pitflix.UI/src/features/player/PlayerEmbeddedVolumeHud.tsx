import { Volume, Volume1, Volume2, VolumeX } from "lucide-react";
import { LiquidGlass } from "../../components/ui/liquidGlass/LiquidGlass";

type Props = {
  volume: number;
  mute: boolean;
  visible: boolean;
  sessionBlocksTransport: boolean;
  setVolumePct: (pct: number) => void;
  toggleMute: () => void;
  /** Small horizontal pill for PiP / the in-app mini player, where the tall one covers the video. */
  compact?: boolean;
};

/** Left-side on-screen volume pill — appears on scroll/arrow-key volume changes, auto-hides after 1.6s. */
export function PlayerEmbeddedVolumeHud({
  volume,
  mute,
  visible,
  sessionBlocksTransport: _sessionBlocksTransport,
  setVolumePct: _setVolumePct,
  toggleMute: _toggleMute,
  compact = false,
}: Props) {
  if (!visible) return null;

  const pct = Math.round(volume);
  const fillPct = Math.min(100, Math.max(0, mute ? 0 : (pct / 200) * 100));

  const Icon = mute || pct === 0 ? VolumeX : pct < 50 ? Volume : pct < 100 ? Volume1 : Volume2;

  if (compact) {
    return (
      <div
        className="pointer-events-none absolute left-1/2 top-2 z-50 -translate-x-1/2 animate-volume-osd-in"
        aria-live="polite"
      >
        <LiquidGlass
          radius={11}
          bezel={8}
          strength={10}
          className="relative flex items-center gap-1.5 rounded-full border border-white/10 px-2 py-1"
          glassStyle={{ background: "rgba(12,9,28,0.58)" }}
          fallbackStyle={{ background: "rgba(12,9,28,0.82)", backdropFilter: "blur(28px)" }}
        >
          <Icon className="h-3 w-3 text-white" strokeWidth={2} />
          <div className="relative h-1 w-14 overflow-hidden rounded-full bg-white/10">
            <div
              className="absolute bottom-0 left-0 top-0 rounded-full transition-[width] duration-150 ease-out"
              style={{ width: `${fillPct}%`, background: "linear-gradient(to right, #5b21b6, #a78bfa)" }}
            />
          </div>
          <span className="w-6 text-right text-[10px] font-semibold tabular-nums text-white">{mute ? "0" : pct}</span>
        </LiquidGlass>
      </div>
    );
  }

  return (
    <div
      className="pointer-events-none absolute left-5 top-1/2 z-50 -translate-y-1/2 animate-volume-osd-in"
      aria-live="polite"
    >
      <LiquidGlass
        radius={16}
        bezel={12}
        strength={16}
        className="relative flex w-[46px] flex-col items-center gap-2.5 rounded-2xl border border-white/10 px-2.5 pb-3 pt-3.5"
        glassStyle={{ background: "rgba(12,9,28,0.58)" }}
        fallbackStyle={{
          background: "rgba(12,9,28,0.82)",
          backdropFilter: "blur(28px)",
          boxShadow: "0 16px 48px rgba(0,0,0,0.65), 0 0 0 1px rgba(124,58,237,0.12)",
        }}
      >
        <Icon className="h-4 w-4 text-white" strokeWidth={2} />
        <div className="relative h-20 w-1 overflow-hidden rounded-full bg-white/10">
          <div
            className="absolute bottom-0 left-0 right-0 rounded-full transition-[height] duration-150 ease-out"
            style={{
              height: `${fillPct}%`,
              background: "linear-gradient(to top, #5b21b6, #a78bfa)",
              boxShadow: "0 0 10px rgba(124,58,237,0.5)",
            }}
          />
        </div>
        <span className="text-[11px] font-semibold tabular-nums text-white">
          {mute ? "0" : pct}
        </span>
      </LiquidGlass>
    </div>
  );
}
