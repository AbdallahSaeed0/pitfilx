import { Outlet } from "react-router-dom";
import { useScanStream } from "../../hooks/useScanProgress";
import { useWindowDragFromEmptySpace } from "../../hooks/useWindowDragFromEmptySpace";
import { useAppPrefsStore } from "../../store/appPrefsStore";
import { cn } from "../../utils/cn";
import { SmartMatchProgressOverlay } from "../SmartMatchProgressOverlay";
import { BackToPlayerChip } from "../ui/BackToPlayerChip";
import { AppFloatingDock } from "./appNav/AppFloatingDock";
import { AppTopDock } from "./appNav/AppTopDock";
import { LibraryAddToast } from "./LibraryAddToast";
import { ScanProgressOverlay } from "./ScanProgressOverlay";
import { Sidebar } from "./Sidebar";
import { TitleBar } from "./TitleBar";

export function MainLayout() {
  useScanStream();
  useWindowDragFromEmptySpace();
  const navLayout = useAppPrefsStore((s) => s.navLayout);

  const isSidebar = navLayout === "sidebar";
  const isTopDock = navLayout === "topDock";
  const isFloatingDock = navLayout === "floatingDock";

  return (
    <div
      className={cn(
        "flex h-screen overflow-hidden bg-pitflix-bg",
        isSidebar ? "flex-row" : "flex-col",
      )}
    >
      <TitleBar />
      {isSidebar ? <Sidebar /> : null}
      {isTopDock ? <AppTopDock /> : null}

      <main
        className={cn(
          "min-h-0 flex-1 overflow-y-auto px-6 pb-6 pt-12",
          isTopDock && "pt-2",
          isFloatingDock && "pb-40",
        )}
      >
        <Outlet />
      </main>

      {isFloatingDock ? <AppFloatingDock /> : null}

      <ScanProgressOverlay />
      <SmartMatchProgressOverlay />
      <LibraryAddToast />
      <BackToPlayerChip />
    </div>
  );
}
