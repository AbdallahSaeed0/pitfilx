import { RotateCcw, Save, X } from "lucide-react";
import { useCallback, useEffect, useState } from "react";
import { cn } from "../../../utils/cn";
import { ConfirmDialog } from "../../../components/ui/ConfirmDialog";
import { usePlayerLayoutPrefs } from "../../../hooks/usePlayerLayoutPrefs";
import { layoutPrefsEqual } from "../../player/playerLayoutStorage";
import { moveControlInZone, setControlZone } from "../../player/playerLayoutOrder";
import { CONTROL_SCALE_DEFAULT } from "../../player/playerLayoutSizes";
import {
  DEFAULT_PLAYER_LAYOUT_PREFS,
  isLayoutControlId,
  type PlayerLayoutEditorSelectionId,
  type PlayerLayoutPrefs,
  type PlayerSeekBarPrefs,
} from "../../player/playerLayoutTypes";
import { PlayerLayoutEditorInspector } from "./PlayerLayoutEditorInspector";
import { PlayerLayoutEditorPreview } from "./PlayerLayoutEditorPreview";

type Props = {
  onClose?: () => void;
};

export function PlayerLayoutEditor({ onClose }: Props) {
  const { layoutPrefs: saved, commitLayoutPrefs } = usePlayerLayoutPrefs();
  const [draft, setDraft] = useState<PlayerLayoutPrefs>(saved);
  const [selectedId, setSelectedId] = useState<PlayerLayoutEditorSelectionId | null>("playPause");
  const [savedToast, setSavedToast] = useState(false);
  const [closeConfirmOpen, setCloseConfirmOpen] = useState(false);

  useEffect(() => {
    setDraft(saved);
  }, [saved]);

  const dirty = !layoutPrefsEqual(draft, saved);

  const patchDraft = (patch: Partial<PlayerLayoutPrefs> | ((prev: PlayerLayoutPrefs) => PlayerLayoutPrefs)) => {
    setDraft((prev) => (typeof patch === "function" ? patch(prev) : { ...prev, ...patch }));
  };

  const handleSave = () => {
    commitLayoutPrefs(draft);
    setSavedToast(true);
    window.setTimeout(() => setSavedToast(false), 2200);
  };

  const handleReset = () => {
    setDraft(DEFAULT_PLAYER_LAYOUT_PREFS);
    setSelectedId("playPause");
  };

  const handleDiscard = () => {
    setDraft(saved);
  };

  const requestClose = useCallback(() => {
    if (!onClose) return;
    if (dirty) {
      setCloseConfirmOpen(true);
      return;
    }
    onClose();
  }, [dirty, onClose]);

  useEffect(() => {
    if (!onClose) return;
    const onKey = (e: KeyboardEvent) => {
      if (e.key === "Escape") requestClose();
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [onClose, requestClose]);

  const selectedControlId = selectedId && isLayoutControlId(selectedId) ? selectedId : null;

  return (
    <section
      id="settings-player-layout"
      className="flex h-full min-h-0 flex-col overflow-hidden rounded-2xl border border-white/[0.1] bg-[#08070e] shadow-2xl shadow-black/50"
    >
      <header className="shrink-0 flex flex-wrap items-center justify-between gap-4 border-b border-white/[0.08] px-5 py-3 md:px-6">
        <div>
          <p className="text-[10px] font-bold uppercase tracking-[0.22em] text-white/35">
            Layout editor · Pitflix Player
          </p>
          <h2 className="mt-1 font-serif text-xl font-medium tracking-tight text-white md:text-2xl">
            Click any control to edit it
          </h2>
          <p className="mt-1 max-w-lg text-[11px] leading-relaxed text-white/40">
            Buttons, seek bar, and time labels — position, size, and visibility. Save when you&apos;re happy.
          </p>
        </div>
        <div className="flex flex-wrap items-center gap-2">
          {dirty ? (
            <button
              type="button"
              onClick={handleDiscard}
              className="h-9 rounded-full border border-white/10 px-4 text-[11px] font-medium text-white/55 transition hover:border-white/25 hover:text-white"
            >
              Discard
            </button>
          ) : null}
          <button
            type="button"
            onClick={handleReset}
            className="inline-flex h-9 items-center gap-1.5 rounded-full border border-white/10 px-4 text-[11px] font-medium text-white/70 transition hover:border-white/25 hover:text-white"
          >
            <RotateCcw className="h-3.5 w-3.5" />
            Reset
          </button>
          <button
            type="button"
            onClick={handleSave}
            disabled={!dirty}
            className={cn(
              "inline-flex h-9 items-center gap-1.5 rounded-full px-5 text-[11px] font-semibold transition-all",
              dirty
                ? "bg-emerald-500 text-black shadow-[0_0_20px_rgba(52,211,153,0.35)] hover:bg-emerald-400"
                : "cursor-not-allowed bg-white/10 text-white/35",
            )}
          >
            <Save className="h-3.5 w-3.5" />
            Save layout
          </button>
          {onClose ? (
            <button
              type="button"
              onClick={requestClose}
              className="flex h-9 w-9 items-center justify-center rounded-full border border-white/10 text-white/60 transition hover:border-white/25 hover:text-white"
              aria-label="Close editor"
            >
              <X className="h-4 w-4" />
            </button>
          ) : null}
        </div>
      </header>

      <div className="flex min-h-0 flex-1 flex-col overflow-hidden">
        <div className="min-h-0 flex-1 overflow-hidden p-3 md:p-4">
          <PlayerLayoutEditorPreview
            prefs={draft}
            selectedId={selectedId}
            onSelect={(id) => setSelectedId(id)}
          />
        </div>

        {selectedId ? (
          <div className="shrink-0 border-t border-white/[0.08] bg-[#0c0b12]/95">
            <PlayerLayoutEditorInspector
            prefs={draft}
            selectedId={selectedId}
            onZoneChange={(zone) => {
              if (!selectedControlId) return;
              patchDraft((prev) => setControlZone(prev, selectedControlId, zone));
            }}
            onVisibleChange={(visible) => {
              if (!selectedControlId) return;
              patchDraft((prev) => ({
                ...prev,
                visible: { ...prev.visible, [selectedControlId]: visible },
              }));
            }}
            onGlobalControlSizeChange={(controlSize) => patchDraft({ controlSize })}
            onControlScaleChange={(scale) => {
              if (!selectedControlId) return;
              patchDraft((prev) => {
                const controlScales = { ...prev.controlScales };
                const controlSizes = { ...prev.controlSizes };
                if (scale == null || scale === CONTROL_SCALE_DEFAULT) {
                  delete controlScales[selectedControlId];
                  delete controlSizes[selectedControlId];
                } else {
                  controlScales[selectedControlId] = scale;
                  delete controlSizes[selectedControlId];
                }
                return { ...prev, controlScales, controlSizes };
              });
            }}
            onMoveInZone={(direction) => {
              if (!selectedControlId) return;
              patchDraft((prev) => moveControlInZone(prev, selectedControlId, direction));
            }}
            onSelect={(id) => setSelectedId(id)}
            onReorderInZone={(id, direction) =>
              patchDraft((prev) => moveControlInZone(prev, id, direction))
            }
            onSeekBarChange={(patch: Partial<PlayerSeekBarPrefs>) =>
              patchDraft((prev) => ({ ...prev, seekBar: { ...prev.seekBar, ...patch } }))
            }
            />
          </div>
        ) : (
          <p className="shrink-0 border-t border-white/[0.08] py-3 text-center text-[11px] text-white/35">
            Select a button, the seek bar, or a time label in the preview above
          </p>
        )}
      </div>

      {savedToast ? (
        <div
          className="fixed bottom-6 left-1/2 z-[240] -translate-x-1/2 rounded-full border border-emerald-400/40 bg-[#0a1a12] px-5 py-2.5 text-sm font-medium text-emerald-200 shadow-xl shadow-black/50"
          role="status"
        >
          Layout saved — open players update instantly.
        </div>
      ) : null}

      {dirty ? (
        <div className="border-t border-amber-400/20 bg-amber-500/[0.06] px-5 py-2.5 text-center text-[11px] text-amber-200/80">
          You have unsaved layout changes
        </div>
      ) : null}

      <ConfirmDialog
        open={closeConfirmOpen}
        title="Discard layout changes?"
        description="You have unsaved changes. Close without saving, or save first."
        confirmLabel="Discard & close"
        cancelLabel="Keep editing"
        variant="danger"
        onConfirm={() => {
          setCloseConfirmOpen(false);
          setDraft(saved);
          onClose?.();
        }}
        onCancel={() => setCloseConfirmOpen(false)}
      />
    </section>
  );
}
