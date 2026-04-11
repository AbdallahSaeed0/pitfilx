import { useSortable } from "@dnd-kit/sortable";
import { CSS } from "@dnd-kit/utilities";
import { HomeSectionRenderer } from "./HomeSectionRenderer";
import { useHomeCustomizeStore } from "../../store/homeCustomizeStore";
import type { HomeSectionConfig, WatchHistoryRow } from "../../types/homeSection";

export function HomeSectionSlot({
  section,
  history,
  onEdit,
  onToggleEnabled,
  onContinueManage,
}: {
  section: HomeSectionConfig;
  history: WatchHistoryRow[];
  onEdit: () => void;
  onToggleEnabled: () => void;
  onContinueManage?: (id: number) => void;
}) {
  const isEditing = useHomeCustomizeStore((s) => s.isEditing);
  const { attributes, listeners, setNodeRef, transform, transition, isDragging } = useSortable({
    id: section.id,
    disabled: !isEditing,
  });

  const style = {
    transform: CSS.Transform.toString(transform),
    transition,
    opacity: isDragging ? 0.55 : 1,
  };

  return (
    <div ref={setNodeRef} style={isEditing ? style : undefined}>
      <HomeSectionRenderer
        section={section}
        isEditing={isEditing}
        history={history}
        onEdit={onEdit}
        onToggleEnabled={onToggleEnabled}
        onContinueManage={onContinueManage}
        dragHandle={
          isEditing ? { attributes, listeners: listeners as Record<string, unknown> } : undefined
        }
      />
    </div>
  );
}
