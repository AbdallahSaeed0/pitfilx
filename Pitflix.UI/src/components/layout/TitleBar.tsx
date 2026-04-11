import { isTauri } from "@tauri-apps/api/core";
import { getCurrentWindow } from "@tauri-apps/api/window";
import { Minus, Square, X } from "lucide-react";
import { cn } from "../../utils/cn";

export function TitleBar() {
  if (!isTauri()) {
    return (
      <div
        className={cn(
          "flex h-9 shrink-0 items-center border-b border-pitflix-card bg-pitflix-surface px-3",
        )}
      >
        <img
          src="/pitflix_icon_final.svg"
          alt=""
          className="h-6 w-6 shrink-0"
          draggable={false}
        />
        <span className="ml-1.5 text-xs font-bold text-pitflix-primary">Pitflix</span>
        <span className="ml-2 text-[10px] text-pitflix-subtle">(Vite preview)</span>
      </div>
    );
  }

  const appWindow = getCurrentWindow();

  return (
    <div
      data-tauri-drag-region
      className={cn(
        "flex h-9 shrink-0 select-none items-center justify-between border-b border-pitflix-card",
        "bg-pitflix-surface px-3",
      )}
    >
      <span
        data-tauri-drag-region
        className="flex items-center text-xs font-bold tracking-tight text-pitflix-primary"
      >
        <img
          src="/pitflix_icon_final.svg"
          alt=""
          className="mr-1.5 h-6 w-6 shrink-0"
          draggable={false}
        />
        Pitflix
      </span>
      <div data-tauri-drag-region className="h-full min-h-8 min-w-0 flex-1" />
      <div className="titlebar-no-drag flex gap-0.5">
        <button
          type="button"
          className="titlebar-no-drag flex h-7 w-9 items-center justify-center rounded text-pitflix-muted hover:bg-pitflix-card"
          onClick={(e) => {
            e.preventDefault();
            e.stopPropagation();
            void appWindow.minimize();
          }}
        >
          <Minus className="h-3.5 w-3.5" strokeWidth={2} />
        </button>
        <button
          type="button"
          className="titlebar-no-drag flex h-7 w-9 items-center justify-center rounded text-pitflix-muted hover:bg-pitflix-card"
          onClick={(e) => {
            e.preventDefault();
            e.stopPropagation();
            void appWindow.toggleMaximize();
          }}
        >
          <Square className="h-3 w-3" strokeWidth={2} />
        </button>
        <button
          type="button"
          className="titlebar-no-drag flex h-7 w-9 items-center justify-center rounded text-pitflix-muted hover:bg-red-600 hover:text-white"
          onClick={(e) => {
            e.preventDefault();
            e.stopPropagation();
            void appWindow.close();
          }}
        >
          <X className="h-3.5 w-3.5" strokeWidth={2} />
        </button>
      </div>
    </div>
  );
}
