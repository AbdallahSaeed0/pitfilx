export type DeviceShortcutRow = {
  label: string;
  keys: string;
};

export type DeviceShortcutSection = {
  title: string;
  rows: DeviceShortcutRow[];
};

export const DEVICE_SHORTCUT_SECTIONS: DeviceShortcutSection[] = [
  {
    title: "Selection",
    rows: [
      { label: "Toggle selection mode", keys: "Ctrl + Shift + S (works from filter too)" },
      { label: "Select all items", keys: "Ctrl + A" },
      { label: "Clear selection / exit selection mode", keys: "Esc" },
    ],
  },
  {
    title: "Actions (selection mode)",
    rows: [
      { label: "Rename selected item", keys: "F2" },
      { label: "Move to subfolder here", keys: "Ctrl + M" },
      { label: "Send to another folder", keys: "Ctrl + Shift + T" },
      { label: "Copy to subfolder here", keys: "Ctrl + C" },
      { label: "Delete selected items", keys: "Delete" },
      { label: "Show details (one item)", keys: "Alt + Enter" },
    ],
  },
  {
    title: "Browse",
    rows: [
      { label: "Go back", keys: "Backspace" },
      { label: "Focus filter", keys: "Ctrl + F" },
      { label: "Search all locations", keys: "Ctrl + Shift + F" },
      { label: "Open context menu", keys: "Right-click" },
      { label: "Show keyboard shortcuts", keys: "?" },
    ],
  },
  {
    title: "Private Mode",
    rows: [
      { label: "Toggle Private Mode", keys: "Hold Ctrl + P for 3s" },
      { label: "Exit Private Mode", keys: "Esc, or the X next to the title" },
    ],
  },
];
