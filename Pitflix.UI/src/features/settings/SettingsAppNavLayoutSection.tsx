import { LayoutPanelLeft, PanelTop, Sparkles } from "lucide-react";
import { cn } from "../../utils/cn";
import { useAppPrefsStore, type AppNavLayout } from "../../store/appPrefsStore";

const NAV_LAYOUT_OPTIONS: {
  id: AppNavLayout;
  title: string;
  description: string;
  Icon: typeof LayoutPanelLeft;
}[] = [
  {
    id: "sidebar",
    title: "Sidebar",
    description: "Wide left bar with labels — the Pitflix default.",
    Icon: LayoutPanelLeft,
  },
  {
    id: "topDock",
    title: "Top dock",
    description: "Horizontal nav under the title bar with pill links.",
    Icon: PanelTop,
  },
  {
    id: "floatingDock",
    title: "Floating dock",
    description: "macOS-style light pill at the bottom with circular icons.",
    Icon: Sparkles,
  },
];

function LayoutPreview({ layout }: { layout: AppNavLayout }) {
  return (
    <div className="relative aspect-[16/10] overflow-hidden rounded-lg border border-white/[0.08] bg-[#0a0912]">
      <div className="absolute inset-0 bg-gradient-to-br from-violet-500/10 via-transparent to-blue-500/10" />
      {layout === "sidebar" ? (
        <>
          <div className="absolute bottom-0 left-0 top-0 w-[28%] border-r border-white/10 bg-white/[0.06]" />
          <div className="absolute left-[6%] top-[14%] h-1.5 w-[14%] rounded-full bg-white/25" />
          <div className="absolute left-[6%] top-[24%] h-1 w-[18%] rounded-full bg-white/15" />
          <div className="absolute left-[6%] top-[32%] h-1 w-[16%] rounded-full bg-violet-400/70" />
          <div className="absolute left-[6%] top-[40%] h-1 w-[14%] rounded-full bg-white/12" />
        </>
      ) : null}
      {layout === "topDock" ? (
        <>
          <div className="absolute left-0 right-0 top-0 h-[22%] border-b border-white/10 bg-white/[0.06]" />
          <div className="absolute left-[8%] top-[8%] h-2 w-2 rounded-full bg-white/20" />
          <div className="absolute left-[16%] top-[7%] h-2.5 w-[10%] rounded-full bg-violet-400/70" />
          <div className="absolute left-[30%] top-[7%] h-2.5 w-[8%] rounded-full bg-white/15" />
          <div className="absolute left-[42%] top-[7%] h-2.5 w-[8%] rounded-full bg-white/15" />
        </>
      ) : null}
      {layout === "floatingDock" ? (
        <>
          <div className="absolute bottom-[10%] left-1/2 flex -translate-x-1/2 gap-1">
            <span className="h-0.5 w-1 rounded-full bg-white/25" />
            <span className="h-0.5 w-2.5 rounded-full bg-white/70" />
            <span className="h-0.5 w-1 rounded-full bg-white/25" />
          </div>
          <div className="absolute bottom-[4%] left-1/2 flex h-[16%] w-[58%] -translate-x-1/2 items-center justify-center gap-1 rounded-full border border-white/40 bg-gradient-to-b from-white/30 to-white/10 px-2">
            <span className="h-2.5 w-2.5 rounded-full bg-orange-400/90" />
            <span className="h-2 w-2 rounded-full bg-black/40" />
            <span className="h-2.5 w-2.5 rounded-full bg-black/50" />
            <span className="h-2 w-2 rounded-full bg-black/40" />
            <span className="h-2 w-2 rounded-full bg-black/40" />
          </div>
        </>
      ) : null}
      <div className="absolute inset-x-[34%] top-[28%] h-[38%] rounded-md border border-white/[0.06] bg-white/[0.03]" />
    </div>
  );
}

export function SettingsAppNavLayoutSection() {
  const navLayout = useAppPrefsStore((s) => s.navLayout);
  const setNavLayout = useAppPrefsStore((s) => s.setNavLayout);

  return (
    <section
      id="settings-app-nav-layout"
      className="rounded-2xl border border-white/[0.09] bg-pitflix-surface/50 p-5 shadow-xl shadow-black/30 backdrop-blur-sm sm:p-6"
    >
      <div className="mb-4">
        <h2 className="text-[15px] font-bold tracking-tight text-white">App navigation</h2>
        <p className="mt-1.5 max-w-xl text-[12px] leading-relaxed text-pitflix-muted">
          Choose where navigation lives in the app shell. Changes apply instantly across every page.
        </p>
      </div>

      <div className="grid gap-3 sm:grid-cols-3">
        {NAV_LAYOUT_OPTIONS.map(({ id, title, description, Icon }) => {
          const active = navLayout === id;
          return (
            <button
              key={id}
              type="button"
              onClick={() => setNavLayout(id)}
              className={cn(
                "flex flex-col gap-3 rounded-xl border p-3 text-left transition-all",
                active
                  ? "border-violet-400/50 bg-violet-500/10 shadow-[0_0_24px_rgba(124,58,237,0.15)]"
                  : "border-white/[0.08] bg-white/[0.02] hover:border-white/20 hover:bg-white/[0.04]",
              )}
            >
              <LayoutPreview layout={id} />
              <div>
                <p className="flex items-center gap-1.5 text-[13px] font-semibold text-white">
                  <Icon className={cn("h-3.5 w-3.5", active ? "text-violet-300" : "text-white/45")} />
                  {title}
                </p>
                <p className="mt-1 text-[11px] leading-relaxed text-pitflix-subtle">{description}</p>
              </div>
            </button>
          );
        })}
      </div>
    </section>
  );
}
