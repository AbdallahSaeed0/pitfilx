import { Clapperboard, Heart, ListVideo, Settings } from "lucide-react";
import { Link } from "react-router-dom";
import { cn } from "../../utils/cn";

const actionClass =
  "inline-flex min-w-[132px] flex-1 items-center justify-center gap-2 rounded-xl border border-white/10 bg-pitflix-surface/80 px-4 py-3 text-sm font-medium text-white shadow-sm shadow-black/20 ring-1 ring-white/5 transition hover:border-pitflix-primary/45 hover:bg-pitflix-surface hover:shadow-md";

export function QuickActionsStrip({ className }: { className?: string }) {
  return (
    <div className={cn("mb-8", className)}>
      <p className="mb-3 text-xs font-semibold uppercase tracking-wider text-pitflix-muted">Quick actions</p>
      <div className="flex flex-wrap gap-3">
        <Link to="/movies" className={actionClass}>
          <Clapperboard className="h-4 w-4 text-pitflix-primary" />
          Movies
        </Link>
        <Link to="/series" className={actionClass}>
          <ListVideo className="h-4 w-4 text-pitflix-primary" />
          Series
        </Link>
        <Link to="/lists" className={actionClass}>
          <Heart className="h-4 w-4 text-pitflix-primary" />
          Lists
        </Link>
        <Link to="/settings" className={actionClass}>
          <Settings className="h-4 w-4 text-pitflix-primary" />
          Settings
        </Link>
      </div>
    </div>
  );
}
