import {
  DndContext,
  type DragEndEvent,
  KeyboardSensor,
  PointerSensor,
  closestCenter,
  useSensor,
  useSensors,
} from "@dnd-kit/core";
import { SortableContext, sortableKeyboardCoordinates, verticalListSortingStrategy } from "@dnd-kit/sortable";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { useEffect, useMemo, useState } from "react";
import { Link } from "react-router-dom";
import { fetchFeaturedFallback, fetchHomeLayout, saveHomeLayout } from "../api/homeLayout";
import { dismissHistoryEntry, getHistory } from "../api/history";
import { getStats } from "../api/stats";
import { ContinueWatchingHero, ContinueWatchingMenuDialog, FeaturedFallbackHero } from "../features/home/ContinueWatchingHero";
import { HomeSectionRenderer } from "../features/home/HomeSectionRenderer";
import { HomeSectionSlot } from "../features/home/HomeSectionSlot";
import { QuickActionsStrip } from "../features/home/QuickActionsStrip";
import { SectionEditorModal } from "../features/home/SectionEditorModal";
import { normalizeSectionOrders } from "../features/home/defaultHomeLayout";
import { useHomeCustomizeStore } from "../store/homeCustomizeStore";
import type { HomeSectionConfig, WatchHistoryRow } from "../types/homeSection";
import { cn } from "../utils/cn";

const FOLDERS_BANNER_KEY = "pitflix_banner_add_folders";

function HeroSkeleton() {
  return <div className="mb-10 h-[280px] w-full animate-pulse rounded-2xl bg-pitflix-card" />;
}

export function HomePage() {
  const [showFoldersBanner, setShowFoldersBanner] = useState(
    () => typeof sessionStorage !== "undefined" && sessionStorage.getItem(FOLDERS_BANNER_KEY) === "1",
  );
  const qc = useQueryClient();
  const [continueMenuId, setContinueMenuId] = useState<number | null>(null);
  const [continueError, setContinueError] = useState<string | null>(null);

  const isEditing = useHomeCustomizeStore((s) => s.isEditing);
  const draftSections = useHomeCustomizeStore((s) => s.draftSections);
  const setEditing = useHomeCustomizeStore((s) => s.setEditing);
  const beginEdit = useHomeCustomizeStore((s) => s.beginEdit);
  const cancelEdit = useHomeCustomizeStore((s) => s.cancelEdit);
  const reorderDraft = useHomeCustomizeStore((s) => s.reorderDraft);
  const updateSection = useHomeCustomizeStore((s) => s.updateSection);
  const removeSection = useHomeCustomizeStore((s) => s.removeSection);
  const addSection = useHomeCustomizeStore((s) => s.addSection);
  const editorTargetId = useHomeCustomizeStore((s) => s.editorTargetId);
  const openEditor = useHomeCustomizeStore((s) => s.openEditor);
  const closeEditor = useHomeCustomizeStore((s) => s.closeEditor);

  const sensors = useSensors(
    useSensor(PointerSensor, { activationConstraint: { distance: 6 } }),
    useSensor(KeyboardSensor, { coordinateGetter: sortableKeyboardCoordinates }),
  );

  useEffect(() => {
    if (!continueError) return;
    const t = window.setTimeout(() => setContinueError(null), 4500);
    return () => window.clearTimeout(t);
  }, [continueError]);

  const layoutQ = useQuery({
    queryKey: ["home-layout"],
    queryFn: fetchHomeLayout,
    staleTime: 30_000,
  });

  const historyQ = useQuery({
    queryKey: ["home-history"],
    queryFn: () => getHistory(14),
    staleTime: 0,
    refetchOnMount: "always",
  });

  const featuredQ = useQuery({
    queryKey: ["home-featured-fallback"],
    queryFn: fetchFeaturedFallback,
    enabled: (historyQ.data?.length ?? 0) === 0 && !historyQ.isLoading,
    staleTime: 120_000,
  });

  useQuery({ queryKey: ["stats"], queryFn: getStats, staleTime: 60_000 });

  const saveMutation = useMutation({
    mutationFn: saveHomeLayout,
    onSuccess: async () => {
      await qc.invalidateQueries({ queryKey: ["home-layout"] });
      await qc.invalidateQueries({
        predicate: (q) => q.queryKey[0] === "home-section",
      });
      cancelEdit();
      setEditing(false);
    },
  });

  const liveSections = layoutQ.data ?? [];
  const displaySections = useMemo(() => {
    const base = isEditing && draftSections ? draftSections : liveSections;
    return normalizeSectionOrders(base).filter((s) => s.enabled || isEditing);
  }, [isEditing, draftSections, liveSections]);

  const sortableIds = useMemo(() => displaySections.map((s) => s.id), [displaySections]);

  const invalidateAfterDismiss = (markCompleted: boolean) => {
    void qc.invalidateQueries({ queryKey: ["home-history"] });
    void qc.invalidateQueries({ queryKey: ["home-featured-fallback"] });
    if (markCompleted) {
      void qc.invalidateQueries({ queryKey: ["stats"] });
      void qc.invalidateQueries({ queryKey: ["movies"] });
      void qc.invalidateQueries({ queryKey: ["series"] });
      void qc.invalidateQueries({ queryKey: ["home-movies"] });
      void qc.invalidateQueries({ queryKey: ["home-series"] });
    }
    void qc.invalidateQueries({ predicate: (q) => q.queryKey[0] === "home-section" });
  };

  const dismissContinueOnly = () => {
    if (continueMenuId == null) return;
    const id = continueMenuId;
    setContinueMenuId(null);
    void dismissHistoryEntry(id, false)
      .then(() => invalidateAfterDismiss(false))
      .catch(() => setContinueError("Could not update. Is Pitflix.API running?"));
  };

  const dismissContinueAndMarkCompleted = () => {
    if (continueMenuId == null) return;
    const id = continueMenuId;
    setContinueMenuId(null);
    void dismissHistoryEntry(id, true)
      .then(() => invalidateAfterDismiss(true))
      .catch(() => setContinueError("Could not update. Is Pitflix.API running?"));
  };

  const history = (historyQ.data ?? []) as WatchHistoryRow[];
  const featured = history[0];
  const heroSide = history.slice(1, 5);

  const editingSection: HomeSectionConfig | null = useMemo(() => {
    if (editorTargetId == null) return null;
    const pool = draftSections ?? liveSections;
    if (editorTargetId === "new") return null;
    return pool.find((s) => s.id === editorTargetId) ?? null;
  }, [editorTargetId, draftSections, liveSections]);

  const onDragEnd = (e: DragEndEvent) => {
    const { active, over } = e;
    if (!over || active.id === over.id) return;
    reorderDraft(String(active.id), String(over.id));
  };

  const handleSaveLayout = () => {
    const toSave = draftSections ?? liveSections;
    saveMutation.mutate(normalizeSectionOrders(toSave));
  };

  const handleSaveSection = (s: HomeSectionConfig) => {
    if (editorTargetId === "new") addSection(s);
    else updateSection(s.id, s);
    closeEditor();
  };

  return (
    <div className="pb-10">
      <div className="mb-6 flex flex-wrap items-end justify-between gap-4">
        <div>
          <h1 className="text-2xl font-bold text-white md:text-3xl">Home</h1>
          <p className="mt-1 text-sm text-pitflix-subtle">Your library — tuned the way you like it</p>
        </div>
        <div className="flex flex-wrap gap-2">
          {isEditing ? (
            <>
              <button
                type="button"
                className="rounded-xl border border-white/15 px-4 py-2 text-sm font-medium text-white hover:border-pitflix-primary/50"
                onClick={() => {
                  cancelEdit();
                  setEditing(false);
                }}
              >
                Cancel
              </button>
              <button
                type="button"
                disabled={saveMutation.isPending}
                className="rounded-xl bg-pitflix-primary px-4 py-2 text-sm font-semibold text-white hover:bg-pitflix-light disabled:opacity-50"
                onClick={() => handleSaveLayout()}
              >
                {saveMutation.isPending ? "Saving…" : "Save layout"}
              </button>
            </>
          ) : (
            <>
              <button
                type="button"
                className="rounded-xl border border-pitflix-primary/40 bg-pitflix-primary/15 px-4 py-2 text-sm font-semibold text-white hover:bg-pitflix-primary/25"
                onClick={() => {
                  beginEdit(normalizeSectionOrders(liveSections));
                  setEditing(true);
                }}
              >
                Customize Home
              </button>
              <button
                type="button"
                className="rounded-xl border border-white/15 px-4 py-2 text-sm text-pitflix-muted hover:border-white/30 hover:text-white"
                onClick={() => {
                  beginEdit(normalizeSectionOrders(liveSections));
                  setEditing(true);
                  openEditor("new");
                }}
              >
                Add section
              </button>
            </>
          )}
        </div>
      </div>

      {showFoldersBanner ? (
        <div className="mb-6 flex flex-wrap items-center gap-3 rounded-xl border border-amber-500/35 bg-amber-500/10 px-4 py-3 text-sm text-amber-100">
          <span>Add media folders in Settings to get started.</span>
          <Link
            to="/settings"
            className="font-semibold text-white underline-offset-2 hover:underline"
          >
            Open Settings
          </Link>
          <button
            type="button"
            className="ml-auto text-xs text-amber-100/85 hover:text-white"
            onClick={() => {
              sessionStorage.removeItem(FOLDERS_BANNER_KEY);
              setShowFoldersBanner(false);
            }}
          >
            Dismiss
          </button>
        </div>
      ) : null}

      {historyQ.isLoading ? (
        <HeroSkeleton />
      ) : featured ? (
        <ContinueWatchingHero
          featured={featured}
          side={heroSide}
          onManageContinue={setContinueMenuId}
        />
      ) : featuredQ.data ? (
        <FeaturedFallbackHero card={featuredQ.data} />
      ) : null}

      <QuickActionsStrip />

      {layoutQ.isLoading && !isEditing ? (
        <div className="space-y-8">
          {Array.from({ length: 4 }).map((_, i) => (
            <div key={i} className="h-48 animate-pulse rounded-2xl bg-pitflix-card/60" />
          ))}
        </div>
      ) : isEditing ? (
        <DndContext sensors={sensors} collisionDetection={closestCenter} onDragEnd={onDragEnd}>
          <SortableContext items={sortableIds} strategy={verticalListSortingStrategy}>
            <div className={cn("space-y-2", isEditing && "rounded-2xl border border-dashed border-white/15 p-3")}>
              {displaySections.map((section) => (
                <HomeSectionSlot
                  key={section.id}
                  section={section}
                  history={history}
                  onEdit={() => openEditor(section.id)}
                  onToggleEnabled={() =>
                    updateSection(section.id, { enabled: !section.enabled })
                  }
                  onContinueManage={setContinueMenuId}
                />
              ))}
            </div>
          </SortableContext>
        </DndContext>
      ) : (
        <div className="space-y-2">
          {displaySections.map((section) => (
            <HomeSectionRenderer
              key={section.id}
              section={section}
              isEditing={false}
              history={history}
              onContinueManage={setContinueMenuId}
            />
          ))}
        </div>
      )}

      <SectionEditorModal
        open={editorTargetId != null}
        existing={editorTargetId === "new" ? null : editingSection}
        onClose={closeEditor}
        onSave={handleSaveSection}
        onDelete={
          editorTargetId && editorTargetId !== "new"
            ? (id) => {
                removeSection(id);
                closeEditor();
              }
            : undefined
        }
      />

      <ContinueWatchingMenuDialog
        open={continueMenuId != null}
        onRemoveOnly={dismissContinueOnly}
        onMarkCompleted={dismissContinueAndMarkCompleted}
        onCancel={() => setContinueMenuId(null)}
      />

      {continueError ? (
        <div
          className="fixed bottom-5 left-1/2 z-[235] max-w-md -translate-x-1/2 rounded-xl border border-red-500/40 bg-pitflix-surface px-4 py-3 text-sm text-red-200 shadow-lg shadow-black/50"
          role="status"
        >
          {continueError}
        </div>
      ) : null}
    </div>
  );
}
