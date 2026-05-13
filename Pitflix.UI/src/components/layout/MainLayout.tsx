import { Outlet } from "react-router-dom";
import { useScanStream } from "../../hooks/useScanProgress";
import { SmartMatchProgressOverlay } from "../SmartMatchProgressOverlay";
import { LibraryAddToast } from "./LibraryAddToast";
import { ScanProgressOverlay } from "./ScanProgressOverlay";
import { Sidebar } from "./Sidebar";
import { TitleBar } from "./TitleBar";

export function MainLayout() {
  useScanStream();
  return (
    <div className="flex h-screen flex-col overflow-hidden bg-pitflix-bg">
      <TitleBar />
      <div className="flex min-h-0 flex-1">
        <Sidebar />
        <main className="min-h-0 flex-1 overflow-y-auto px-6 pb-6 pt-3">
          <Outlet />
        </main>
      </div>
      <ScanProgressOverlay />
      <SmartMatchProgressOverlay />
      <LibraryAddToast />
    </div>
  );
}
