import { cn } from "../../utils/cn";

type PlayerQuickTipsProps = {
  className?: string;
};

export function PlayerQuickTips({ className }: PlayerQuickTipsProps) {
  return (
    <div className={cn("w-full max-w-4xl", className)}>
      <div className="rounded-xl bg-pitflix-bg-elevated/50 p-6 backdrop-blur-sm">
        <p className="mb-3 text-center text-caption font-semibold text-pitflix-text-secondary">
          Player Controls
        </p>
        <div className="grid grid-cols-2 gap-x-6 gap-y-2 text-micro text-pitflix-text-muted">
          <div className="flex items-center justify-between">
            <span>Play / Pause</span>
            <kbd className="rounded bg-pitflix-border-subtle px-2 py-0.5 font-mono text-pitflix-text-subtle">
              Space
            </kbd>
          </div>
          <div className="flex items-center justify-between">
            <span>Fullscreen</span>
            <kbd className="rounded bg-pitflix-border-subtle px-2 py-0.5 font-mono text-pitflix-text-subtle">
              F
            </kbd>
          </div>
          <div className="flex items-center justify-between">
            <span>Next episode</span>
            <kbd className="rounded bg-pitflix-border-subtle px-2 py-0.5 font-mono text-pitflix-text-subtle">
              Shift+N
            </kbd>
          </div>
          <div className="flex items-center justify-between">
            <span>Previous episode</span>
            <kbd className="rounded bg-pitflix-border-subtle px-2 py-0.5 font-mono text-pitflix-text-subtle">
              Shift+P
            </kbd>
          </div>
          <div className="flex items-center justify-between">
            <span>Seek 5s</span>
            <kbd className="rounded bg-pitflix-border-subtle px-2 py-0.5 font-mono text-pitflix-text-subtle">
              ← →
            </kbd>
          </div>
          <div className="flex items-center justify-between">
            <span>Volume</span>
            <kbd className="rounded bg-pitflix-border-subtle px-2 py-0.5 font-mono text-pitflix-text-subtle">
              Wheel
            </kbd>
          </div>
          <div className="flex items-center justify-between">
            <span>Mute</span>
            <kbd className="rounded bg-pitflix-border-subtle px-2 py-0.5 font-mono text-pitflix-text-subtle">
              M
            </kbd>
          </div>
          <div className="flex items-center justify-between">
            <span>Subtitles</span>
            <kbd className="rounded bg-pitflix-border-subtle px-2 py-0.5 font-mono text-pitflix-text-subtle">
              S
            </kbd>
          </div>
        </div>
        <p className="mt-4 text-center text-micro text-pitflix-text-subtle">
          MPV window controls: arrows seek, Shift+N/P episode switch, Ctrl+Up/Down subtitle size, Alt+Down/Up subtitle
          lower/higher, Ctrl+1..4 subtitle color/style presets. Companion page controls are secondary sync controls.
        </p>
      </div>
    </div>
  );
}
