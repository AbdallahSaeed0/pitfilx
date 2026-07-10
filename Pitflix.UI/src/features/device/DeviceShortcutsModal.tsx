import { useEffect } from "react";
import { DEVICE_SHORTCUT_SECTIONS } from "./deviceShortcuts";

type Props = {
  open: boolean;
  onClose: () => void;
};

export function DeviceShortcutsModal({ open, onClose }: Props) {
  useEffect(() => {
    if (!open) return;
    const onKeyDown = (e: KeyboardEvent) => {
      if (e.key === "Escape") onClose();
    };
    window.addEventListener("keydown", onKeyDown);
    return () => window.removeEventListener("keydown", onKeyDown);
  }, [open, onClose]);

  if (!open) return null;

  return (
    <div
      className="fixed inset-0 z-[70] flex items-center justify-center bg-black/60 px-4 backdrop-blur-sm"
      onClick={onClose}
    >
      <div
        className="max-h-[min(88vh,640px)] w-full max-w-lg overflow-y-auto rounded-2xl border border-white/10 bg-zinc-900 p-5 shadow-xl"
        onClick={(e) => e.stopPropagation()}
      >
        <div className="flex items-start justify-between gap-4">
          <div>
            <h2 className="text-lg font-semibold text-white">Keyboard shortcuts</h2>
            <p className="mt-1 text-xs text-pitflix-muted">
              My Device shortcuts. Most work after opening a folder. Ctrl+Shift+S works from the filter box too.
            </p>
          </div>
          <button
            type="button"
            aria-label="Close"
            className="flex h-7 w-7 shrink-0 items-center justify-center rounded text-pitflix-muted hover:bg-white/10 hover:text-white"
            onClick={onClose}
          >
            ✕
          </button>
        </div>
        <div className="mt-5 space-y-5">
          {DEVICE_SHORTCUT_SECTIONS.map((section) => (
            <div key={section.title}>
              <p className="mb-2 text-[10px] font-semibold uppercase tracking-[0.18em] text-pitflix-muted">
                {section.title}
              </p>
              <div className="space-y-1">
                {section.rows.map((row) => (
                  <div
                    key={row.label}
                    className="flex items-center justify-between gap-4 rounded-lg px-2 py-1.5 text-sm hover:bg-white/[0.04]"
                  >
                    <span className="text-white/90">{row.label}</span>
                    <kbd className="shrink-0 rounded-md border border-white/10 bg-black/40 px-2 py-0.5 font-mono text-[11px] text-pitflix-subtle">
                      {row.keys}
                    </kbd>
                  </div>
                ))}
              </div>
            </div>
          ))}
        </div>
      </div>
    </div>
  );
}
