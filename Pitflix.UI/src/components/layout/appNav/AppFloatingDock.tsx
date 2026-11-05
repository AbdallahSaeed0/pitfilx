import { ScanLine } from "lucide-react";
import { useCallback, useMemo, useRef } from "react";
import { cn } from "../../../utils/cn";
import { useLiquidGlass } from "../../ui/liquidGlass/useLiquidGlass";
import { selectEffectiveOffline, useAppPrefsStore } from "../../../store/appPrefsStore";
import { APP_NAV_ITEMS } from "./appNavItems";
import { FloatingDockItem } from "./FloatingDockItem";
import { FLOATING_DOCK_TRACK_HEIGHT } from "./floatingDockTheme";
import { useAppNavScan } from "./useAppNavScan";
import { useFloatingDockMagnification, type FloatingDockIconRefs } from "./useFloatingDockMagnification";

export function AppFloatingDock() {
  const offlineMode = useAppPrefsStore(selectEffectiveOffline);
  const liveTvEnabled = useAppPrefsStore((s) => s.liveTvEnabled);
  const cinemasEnabled = useAppPrefsStore((s) => s.cinemasEnabled);
  const { scanRunning, runScan } = useAppNavScan();

  const trackRef = useRef<HTMLDivElement>(null);
  const iconRefs = useRef<FloatingDockIconRefs[]>([]);

  const navItems = useMemo(
    () =>
      APP_NAV_ITEMS.filter(
        (item) => (item.to !== "/live" || liveTvEnabled) && (item.to !== "/cinemas" || cinemasEnabled),
      ),
    [liveTvEnabled, cinemasEnabled],
  );

  const labels = useMemo(() => [...navItems.map((item) => item.label), "Scan library"], [navItems]);

  const registerRefs = useCallback((index: number, refs: FloatingDockIconRefs) => {
    iconRefs.current[index] = refs;
  }, []);

  const tooltipRefs = useRef<{ root: HTMLDivElement | null; label: HTMLSpanElement | null }>({
    root: null,
    label: null,
  });

  useFloatingDockMagnification(trackRef, iconRefs, labels, tooltipRefs);
  const glass = useLiquidGlass(trackRef, { radius: 26, bezel: 20, strength: 26 });

  const scanIndex = navItems.length;

  return (
    <div
      className="titlebar-no-drag pointer-events-none fixed inset-x-0 bottom-2 z-40 flex flex-col items-center px-4"
      // "backwards", not "both": a held opacity/transform animation keeps blocking the dock's
      // backdrop blur (liquid glass) in Chromium after the slide-in has finished.
      style={{ animation: "floatingDockIn 0.65s 0.2s cubic-bezier(0.22, 1, 0.36, 1) backwards" }}
    >
      <div
        ref={trackRef}
        className={cn(
          "pointer-events-auto relative flex w-fit max-w-[min(100%,960px)] items-center gap-[7px] overflow-visible",
          "rounded-[26px] border border-white/[0.09] px-4 py-3",
          glass.active
            ? "liquid-glass bg-[rgba(14,12,28,0.6)]"
            : "bg-[rgba(12,10,24,0.88)] shadow-[0_24px_64px_rgba(0,0,0,0.55),0_0_0_0.5px_rgba(255,255,255,0.04),inset_0_1px_0_rgba(255,255,255,0.07)] backdrop-blur-[48px]",
        )}
        style={{ height: FLOATING_DOCK_TRACK_HEIGHT, ...glass.style }}
      >
        {glass.filter}
        <div
          ref={(el) => {
            tooltipRefs.current.root = el;
          }}
          className="pointer-events-none absolute z-30 whitespace-nowrap opacity-0"
          style={{
            bottom: "calc(100% + 10px)",
            transform: "translateX(-50%)",
            transition: "opacity 0.12s ease",
          }}
        >
          <span
            ref={(el) => {
              tooltipRefs.current.label = el;
            }}
            className="inline-block rounded-lg border border-white/10 bg-[rgba(8,6,20,0.96)] px-3 py-1 text-xs font-medium tracking-[0.01em] text-white/90 shadow-[0_4px_20px_rgba(0,0,0,0.5)] backdrop-blur-2xl"
          >
            Home
          </span>
        </div>

        <nav className="flex min-w-0 flex-1 items-center justify-center gap-[7px] overflow-x-auto overflow-y-visible [scrollbar-width:none] [&::-webkit-scrollbar]:hidden">
          {navItems.map((item, i) => (
            <FloatingDockItem
              key={item.to}
              index={i}
              label={item.label}
              icon={item.rawIcon}
              to={item.to}
              end={item.end}
              blocked={offlineMode && !!item.requiresInternet}
              registerRefs={registerRefs}
            />
          ))}
        </nav>

        <div className="h-[26px] w-px shrink-0 self-center rounded-sm bg-white/10" aria-hidden />

        <FloatingDockItem
          index={scanIndex}
          label="Scan library"
          icon={<ScanLine />}
          registerRefs={registerRefs}
          onClick={scanRunning ? undefined : runScan}
        />
      </div>

      <div
        className="pointer-events-none mt-0.5 h-5 w-[min(55%,420px)] blur-[5px]"
        style={{
          background: "radial-gradient(ellipse at center, rgba(124,58,237,0.2) 0%, transparent 70%)",
        }}
        aria-hidden
      />
    </div>
  );
}
