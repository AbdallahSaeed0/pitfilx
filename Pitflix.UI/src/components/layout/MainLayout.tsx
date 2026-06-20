import { Outlet } from "react-router-dom";
import { useScanStream } from "../../hooks/useScanProgress";
import { useWindowDragFromEmptySpace } from "../../hooks/useWindowDragFromEmptySpace";
import { SmartMatchProgressOverlay } from "../SmartMatchProgressOverlay";
import { LibraryAddToast } from "./LibraryAddToast";
import { ScanProgressOverlay } from "./ScanProgressOverlay";
import { Sidebar } from "./Sidebar";
import { TitleBar } from "./TitleBar";
import { BackToPlayerChip } from "../ui/BackToPlayerChip";

export function MainLayout() {
  useScanStream();
  useWindowDragFromEmptySpace();
  return (
    <div className="flex h-screen overflow-hidden bg-pitflix-bg">
      <TitleBar />
      <Sidebar />
      <main className="min-h-0 flex-1 overflow-y-auto px-6 pb-6 pt-12">
        <Outlet />
      </main>
      <ScanProgressOverlay />
      <SmartMatchProgressOverlay />
      <LibraryAddToast />
      {/* Floating chip: visible when built-in player is running but user navigated away */}
      <BackToPlayerChip />
    </div>
  );
}
