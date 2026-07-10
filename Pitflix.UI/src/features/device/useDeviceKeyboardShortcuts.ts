import { useEffect, type RefObject } from "react";

type KeyboardState = {
  currentPath: string | null;
  selectionMode: boolean;
  selectedCount: number;
  shortcutsOpen: boolean;
  renamingPath: string | null;
  entryRename: { path: string; name: string } | null;
  detailsPath: string | null;
  folderPicker: unknown;
  contextMenu: unknown;
  folderContextMenu: unknown;
  newFolderOpen: boolean;
  viewingImage: unknown;
  fsBusy: boolean;
  scanBusy: boolean;
};

type KeyboardActions = {
  toggleSelectionMode: () => void;
  exitSelectionMode: () => void;
  selectAllFiltered: () => void;
  renameSingleSelected: () => void;
  openMovePicker: () => void;
  openCopyPicker: () => void;
  showDetailsSingleSelected: () => void;
  sendToSelected: () => Promise<void>;
  deleteSelected: () => Promise<void>;
  goBackFromBrowse: () => void;
};

function isTypingTarget(target: EventTarget | null): boolean {
  if (!(target instanceof HTMLElement)) return false;
  if (target.isContentEditable) return true;
  const tag = target.tagName;
  return tag === "INPUT" || tag === "TEXTAREA";
}

function allowsWhileTyping(e: KeyboardEvent): boolean {
  return (
    e.key === "Escape" ||
    (e.ctrlKey && e.shiftKey && e.code === "KeyS") ||
    (e.ctrlKey && e.code === "KeyF")
  );
}

function blurActiveElement() {
  const active = document.activeElement;
  if (active instanceof HTMLElement) active.blur();
}

export function useDeviceKeyboardShortcuts(
  stateRef: RefObject<KeyboardState>,
  actionsRef: RefObject<KeyboardActions>,
  filterInputRef: RefObject<HTMLInputElement | null>,
  onOpenShortcuts: () => void,
  enabled: boolean,
) {
  useEffect(() => {
    if (!enabled) return;

    const onKeyDown = (e: KeyboardEvent) => {
      const s = stateRef.current;
      const a = actionsRef.current;
      if (!s || !a) return;

      const modalOpen =
        s.shortcutsOpen ||
        !!s.renamingPath ||
        !!s.entryRename ||
        !!s.detailsPath ||
        !!s.folderPicker ||
        !!s.contextMenu ||
        !!s.folderContextMenu ||
        s.newFolderOpen ||
        !!s.viewingImage;

      if (e.key === "Escape") {
        if (s.selectionMode && !modalOpen) {
          e.preventDefault();
          e.stopPropagation();
          blurActiveElement();
          a.exitSelectionMode();
        }
        return;
      }

      const typing = isTypingTarget(e.target);
      if (typing && !allowsWhileTyping(e)) return;
      if (modalOpen) return;

      if (e.ctrlKey && e.shiftKey && e.code === "KeyS") {
        e.preventDefault();
        e.stopPropagation();
        blurActiveElement();
        a.toggleSelectionMode();
        return;
      }

      if (e.ctrlKey && e.code === "KeyF") {
        e.preventDefault();
        e.stopPropagation();
        filterInputRef.current?.focus();
        filterInputRef.current?.select();
        return;
      }

      if (e.key === "?" || (e.shiftKey && e.code === "Slash")) {
        e.preventDefault();
        e.stopPropagation();
        onOpenShortcuts();
        return;
      }

      if (!s.currentPath) return;

      if (e.code === "Backspace" && !e.ctrlKey && !e.altKey && !e.metaKey && !typing) {
        e.preventDefault();
        e.stopPropagation();
        a.goBackFromBrowse();
        return;
      }

      if (!s.selectionMode) return;

      if (e.ctrlKey && e.code === "KeyA") {
        e.preventDefault();
        e.stopPropagation();
        blurActiveElement();
        a.selectAllFiltered();
        return;
      }

      if (s.selectedCount === 0 || s.fsBusy || s.scanBusy) return;

      if (e.code === "F2") {
        e.preventDefault();
        e.stopPropagation();
        blurActiveElement();
        a.renameSingleSelected();
        return;
      }

      if (e.ctrlKey && e.shiftKey && e.code === "KeyT") {
        e.preventDefault();
        e.stopPropagation();
        void a.sendToSelected();
        return;
      }

      if (e.ctrlKey && !e.shiftKey && e.code === "KeyM") {
        e.preventDefault();
        e.stopPropagation();
        a.openMovePicker();
        return;
      }

      if (e.ctrlKey && e.code === "KeyC") {
        e.preventDefault();
        e.stopPropagation();
        a.openCopyPicker();
        return;
      }

      if (e.code === "Delete") {
        e.preventDefault();
        e.stopPropagation();
        void a.deleteSelected();
        return;
      }

      if (e.altKey && e.code === "Enter") {
        e.preventDefault();
        e.stopPropagation();
        a.showDetailsSingleSelected();
      }
    };

    document.addEventListener("keydown", onKeyDown, true);
    return () => document.removeEventListener("keydown", onKeyDown, true);
  }, [enabled, actionsRef, filterInputRef, onOpenShortcuts, stateRef]);
}
