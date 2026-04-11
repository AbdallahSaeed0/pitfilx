import { create } from "zustand";
import type { HomeSectionConfig } from "../types/homeSection";

type HomeCustomizeState = {
  isEditing: boolean;
  draftSections: HomeSectionConfig[] | null;
  editorTargetId: string | null;
  /** Per-section shuffle keys (movie night, genre spotlight) */
  shuffleKeys: Record<string, number>;
  setEditing: (v: boolean) => void;
  beginEdit: (sections: HomeSectionConfig[]) => void;
  cancelEdit: () => void;
  setDraftSections: (sections: HomeSectionConfig[]) => void;
  updateSection: (id: string, patch: Partial<HomeSectionConfig>) => void;
  removeSection: (id: string) => void;
  addSection: (section: HomeSectionConfig) => void;
  reorderDraft: (activeId: string, overId: string) => void;
  openEditor: (id: string | null) => void;
  closeEditor: () => void;
  bumpShuffle: (sectionId: string) => void;
  shuffleSeedFor: (sectionId: string) => number | undefined;
};

function reorderList(items: HomeSectionConfig[], activeId: string, overId: string): HomeSectionConfig[] {
  const ixA = items.findIndex((x) => x.id === activeId);
  const ixO = items.findIndex((x) => x.id === overId);
  if (ixA < 0 || ixO < 0 || ixA === ixO) return items;
  const next = [...items];
  const [moved] = next.splice(ixA, 1);
  next.splice(ixO, 0, moved);
  return next.map((s, i) => ({ ...s, order: i }));
}

export const useHomeCustomizeStore = create<HomeCustomizeState>((set, get) => ({
  isEditing: false,
  draftSections: null,
  editorTargetId: null,
  shuffleKeys: {},
  setEditing: (v) => set({ isEditing: v }),
  beginEdit: (sections) =>
    set({
      isEditing: true,
      draftSections: structuredClone(sections).sort((a, b) => a.order - b.order),
    }),
  cancelEdit: () => set({ isEditing: false, draftSections: null, editorTargetId: null }),
  setDraftSections: (sections) =>
    set({
      draftSections: sections
        .slice()
        .sort((a, b) => a.order - b.order)
        .map((s, i) => ({ ...s, order: i })),
    }),
  updateSection: (id, patch) => {
    const cur = get().draftSections;
    if (!cur) return;
    set({
      draftSections: cur.map((s) => (s.id === id ? { ...s, ...patch } : s)),
    });
  },
  removeSection: (id) => {
    const cur = get().draftSections;
    if (!cur) return;
    set({
      draftSections: cur.filter((s) => s.id !== id).map((s, i) => ({ ...s, order: i })),
    });
  },
  addSection: (section) => {
    const cur = get().draftSections ?? [];
    const next = [...cur, { ...section, order: cur.length }];
    set({ draftSections: next.map((s, i) => ({ ...s, order: i })) });
  },
  reorderDraft: (activeId, overId) => {
    const cur = get().draftSections;
    if (!cur) return;
    set({ draftSections: reorderList(cur, activeId, overId).map((s, i) => ({ ...s, order: i })) });
  },
  openEditor: (id) => set({ editorTargetId: id }),
  closeEditor: () => set({ editorTargetId: null }),
  bumpShuffle: (sectionId) =>
    set((st) => ({
      shuffleKeys: { ...st.shuffleKeys, [sectionId]: (st.shuffleKeys[sectionId] ?? 0) + 1 },
    })),
  shuffleSeedFor: (sectionId) => get().shuffleKeys[sectionId],
}));
