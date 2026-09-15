import { useEffect, useRef } from "react";
import { useLocation, useNavigate } from "react-router-dom";
import { useScanStream } from "../../hooks/useScanProgress";
import { useSmoothWheelScroll } from "../../hooks/useSmoothWheelScroll";
import { useWindowDragFromEmptySpace } from "../../hooks/useWindowDragFromEmptySpace";
import { useAppPrefsStore } from "../../store/appPrefsStore";
import { cn } from "../../utils/cn";
import { SmartMatchProgressOverlay } from "../SmartMatchProgressOverlay";
import { BackToPlayerChip } from "../ui/BackToPlayerChip";
import { AppFloatingDock } from "./appNav/AppFloatingDock";
import { AppTopDock } from "./appNav/AppTopDock";
import { LibraryAddToast } from "./LibraryAddToast";
import { PageTransition } from "./PageTransition";
import { ScanProgressOverlay } from "./ScanProgressOverlay";
import { Sidebar } from "./Sidebar";
import { TitleBar } from "./TitleBar";

function isTextInputTarget(target: EventTarget | null): boolean {
  if (!(target instanceof HTMLElement)) return false;
  const tag = target.tagName;
  return tag === "INPUT" || tag === "TEXTAREA" || target.isContentEditable;
}

export function MainLayout() {
  useScanStream();
  useWindowDragFromEmptySpace();
  const navLayout = useAppPrefsStore((s) => s.navLayout);
  const navigate = useNavigate();
  const location = useLocation();

  useEffect(() => {
    const onKeyDown = (e: KeyboardEvent) => {
      // Ctrl+Home also means "cursor to start of text" in inputs/textareas — only hijack it
      // when focus isn't in a text field, so normal text editing keeps working everywhere.
      if (!e.ctrlKey || e.key !== "Home" || isTextInputTarget(e.target)) return;
      if (location.pathname === "/") return;
      e.preventDefault();
      navigate("/");
    };
    window.addEventListener("keydown", onKeyDown);
    return () => window.removeEventListener("keydown", onKeyDown);
  }, [navigate, location.pathname]);

  const isSidebar = navLayout === "sidebar";
  const isTopDock = navLayout === "topDock";
  const isFloatingDock = navLayout === "floatingDock";

  const mainRef = useRef<HTMLElement>(null);
  useSmoothWheelScroll(mainRef);

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
        ref={mainRef}
        className={cn(
          "relative min-h-0 flex-1 overflow-y-auto px-6 pb-6 pt-12",
          isTopDock && "pt-2",
          isFloatingDock && "pb-40",
        )}
      >
        <PageTransition />
      </main>

      {isFloatingDock ? <AppFloatingDock /> : null}

      <ScanProgressOverlay />
      <SmartMatchProgressOverlay />
      <LibraryAddToast />
      <BackToPlayerChip />
    </div>
  );
}
