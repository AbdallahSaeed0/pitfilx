import { cn } from "../../utils/cn";

type PlayerQuickTipsProps = {
  className?: string;
};

type TipRow = { label: string; keys: string; scope?: "mpv" | "app" | "both" };

function Tip({ label, keys, scope }: TipRow) {
  const scopeLabel =
    scope === "mpv" ? "mpv" : scope === "app" ? "app" : scope === "both" ? "mpv · app" : null;
  return (
    <div className="flex items-start justify-between gap-2 text-micro text-pitflix-text-muted">
      <span className="min-w-0 flex-1 leading-snug">{label}</span>
      <span className="flex shrink-0 flex-col items-end gap-0.5">
        {scopeLabel ? (
          <span className="text-[9px] uppercase tracking-wide text-pitflix-text-subtle/80">{scopeLabel}</span>
        ) : null}
        <kbd className="rounded bg-pitflix-border-subtle px-2 py-0.5 font-mono text-[10px] text-pitflix-text-subtle">
          {keys}
        </kbd>
      </span>
    </div>
  );
}

const rows: TipRow[] = [
  { label: "Play / pause", keys: "Space", scope: "both" },
  { label: "Fullscreen", keys: "F", scope: "both" },
  { label: "Exit fullscreen only", keys: "Esc", scope: "both" },
  {
    label: "Leave companion — mpv keeps playing (external window)",
    keys: "Esc · ← Back",
    scope: "app",
  },
  { label: "Mute", keys: "M", scope: "mpv" },
  { label: "Seek ±5s", keys: "← →", scope: "both" },
  { label: "Fine seek ±1s", keys: "Shift+← Shift+→", scope: "mpv" },
  { label: "Volume", keys: "Wheel · ↑↓", scope: "both" },
  { label: "Next / previous episode", keys: "Shift+N · Shift+P", scope: "both" },
  { label: "Toggle subtitles (companion)", keys: "S", scope: "app" },
  { label: "Toggle / cycle subs (mpv)", keys: "S · V", scope: "mpv" },
  { label: "Cycle subtitle track (mpv)", keys: "B", scope: "mpv" },
  { label: "Strong subtitle outline", keys: "Ctrl+B", scope: "both" },
  { label: "Subtitle delay −0.1s / +0.1s", keys: "Z · X", scope: "mpv" },
  { label: "Subtitle menu / audio menu", keys: "Alt+S · A", scope: "mpv" },
  { label: "Cycle audio track", keys: "C", scope: "mpv" },
  { label: "Sub size − / +", keys: "Ctrl+↓ · Ctrl+↑", scope: "mpv" },
  { label: "Sub position lower / higher", keys: "Alt+↓ · Alt+↑", scope: "mpv" },
  { label: "Sub style presets", keys: "Ctrl+1 … Ctrl+4", scope: "mpv" },
  { label: "Frame step / back", keys: ". · ,", scope: "mpv" },
  { label: "Speed down / up / reset", keys: "[ · ] · Backspace", scope: "mpv" },
  { label: "Stats overlay", keys: "I · Shift+I", scope: "mpv" },
  { label: "Screenshot (with subs) / video only", keys: "Ctrl+Alt+S · Shift+S", scope: "mpv" },
  { label: "Quit mpv window", keys: "Q", scope: "mpv" },
];

export function PlayerQuickTips({ className }: PlayerQuickTipsProps) {
  return (
    <div className={cn("w-full max-w-4xl", className)}>
      <div className="rounded-xl bg-pitflix-bg-elevated/50 p-6 backdrop-blur-sm">
        <p className="mb-3 text-center text-caption font-semibold text-pitflix-text-secondary">
          Player controls
        </p>
        <p className="mb-4 text-center text-micro text-pitflix-text-subtle">
          <span className="font-medium text-pitflix-text-muted">mpv</span> = keys in the video window ·{" "}
          <span className="font-medium text-pitflix-text-muted">app</span> = Pitflix companion page when it has
          keyboard focus. The mpv uOSC bar shows only three buttons: previous episode, play/pause, next episode.
        </p>
        <div className="grid max-h-[min(52vh,28rem)] grid-cols-1 gap-x-6 gap-y-2 overflow-y-auto pr-1 sm:grid-cols-2">
          {rows.map((r) => (
            <Tip key={r.label} {...r} />
          ))}
        </div>
        <p className="mt-4 text-center text-micro text-pitflix-text-subtle">
          Subtitle appearance from the companion panel (size, colors, border width, position, font) syncs to mpv in
          real time. Press <span className="font-mono text-pitflix-text-muted">Ctrl+B</span> (mpv or companion) or use
          <span className="text-pitflix-text-muted"> Strong subtitle outline</span> in the subtitle menu for a quick
          stroke.
        </p>
      </div>
    </div>
  );
}
