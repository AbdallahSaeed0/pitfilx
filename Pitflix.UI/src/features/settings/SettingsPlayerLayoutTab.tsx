import { Pencil } from "lucide-react";
import { useEffect, useMemo, useState } from "react";
import { usePlayerLayoutPrefs } from "../../hooks/usePlayerLayoutPrefs";
import { PlayerLayoutEditorModal } from "./player-layout/PlayerLayoutEditorModal";
import { SettingsAppNavLayoutSection } from "./SettingsAppNavLayoutSection";
import { SettingsLibrarySectionsSection } from "./SettingsLibrarySectionsSection";

function capitalizeSize(size: string): string {
  return size.charAt(0).toUpperCase() + size.slice(1);
}

export function SettingsPlayerLayoutTab() {
  const { layoutPrefs } = usePlayerLayoutPrefs();
  const [editorOpen, setEditorOpen] = useState(false);

  const visibleCount = useMemo(
    () => Object.values(layoutPrefs.visible).filter(Boolean).length,
    [layoutPrefs.visible],
  );

  useEffect(() => {
    if (!editorOpen) return;
    const prev = document.body.style.overflow;
    document.body.style.overflow = "hidden";
    return () => {
      document.body.style.overflow = prev;
    };
  }, [editorOpen]);

  return (
    <>
      <SettingsAppNavLayoutSection />

      <SettingsLibrarySectionsSection />

      <section
        id="settings-player-layout"
        className="flex flex-col gap-5 rounded-2xl border border-white/[0.09] bg-pitflix-surface/50 p-5 shadow-xl shadow-black/30 backdrop-blur-sm sm:flex-row sm:items-center sm:justify-between sm:gap-8 sm:p-6"
      >
        <div className="min-w-0">
          <h2 className="text-[15px] font-bold tracking-tight text-white">Player layout</h2>
          <p className="mt-1.5 max-w-md text-[12px] leading-relaxed text-pitflix-muted">
            Click any control in the live preview to move, hide, or reorder it.
          </p>
          <p className="mt-1 text-[11px] text-pitflix-subtle">
            {visibleCount} visible on the {capitalizeSize(layoutPrefs.controlSize)} theme.
          </p>
        </div>

        <button
          type="button"
          onClick={() => setEditorOpen(true)}
          className="inline-flex shrink-0 items-center justify-center gap-2 self-start rounded-full bg-white px-5 py-2.5 text-[13px] font-semibold text-black shadow-lg shadow-black/25 transition hover:bg-white/90 sm:self-center"
        >
          <Pencil className="h-4 w-4" strokeWidth={2.25} />
          Edit player layout
        </button>
      </section>

      <PlayerLayoutEditorModal open={editorOpen} onClose={() => setEditorOpen(false)} />
    </>
  );
}
