import {
  AlertCircle,
  Bell,
  CalendarClock,
  CheckCircle2,
  Clapperboard,
  Eye,
  Info,
  RefreshCw,
  Smartphone,
  Ticket,
} from "lucide-react";
import { useEffect, useRef, useState } from "react";
import { useNavigate } from "react-router-dom";
import {
  useNotificationsStore,
  type PitflixNotification,
  type PitflixNotificationKind,
} from "../../store/notificationsStore";
import { cn } from "../../utils/cn";

function relativeTime(ts: number): string {
  const diff = Date.now() - ts;
  const s = Math.floor(diff / 1000);
  if (s < 60) return "just now";
  const m = Math.floor(s / 60);
  if (m < 60) return `${m}m ago`;
  const h = Math.floor(m / 60);
  if (h < 24) return `${h}h ago`;
  const d = Math.floor(h / 24);
  if (d < 7) return `${d}d ago`;
  return new Date(ts).toLocaleDateString();
}

function KindIcon({ kind }: { kind: PitflixNotificationKind }) {
  const cls = "h-4 w-4 shrink-0";
  switch (kind) {
    case "matched":
      return <CheckCircle2 className={cn(cls, "text-emerald-400")} />;
    case "unmatched":
      return <AlertCircle className={cn(cls, "text-amber-400")} />;
    case "scan":
      return <RefreshCw className={cn(cls, "text-sky-400")} />;
    case "sync":
      return <Smartphone className={cn(cls, "text-violet-400")} />;
    case "watched":
      return <Eye className={cn(cls, "text-pitflix-primary")} />;
    case "airdate":
      return <CalendarClock className={cn(cls, "text-cyan-400")} />;
    case "trailer":
      return <Clapperboard className={cn(cls, "text-rose-400")} />;
    case "tickets":
      return <Ticket className={cn(cls, "text-amber-400")} />;
    default:
      return <Info className={cn(cls, "text-pitflix-muted")} />;
  }
}

function Row({ n, onNavigate }: { n: PitflixNotification; onNavigate: () => void }) {
  const remove = useNotificationsStore((s) => s.remove);
  const navigate = useNavigate();
  // Rows persisted to localStorage before deep links existed carry no href. Fall back to the
  // section the kind implies so the backlog already sitting in the panel isn't dead clicks.
  const target =
    n.href ??
    (n.kind === "unmatched"
      ? "/unmatched"
      : n.kind === "trailer"
        ? "/trailers"
        : n.kind === "tickets"
          ? "/cinemas"
          : undefined);
  return (
    <li
      className={cn(
        "group flex items-start gap-3 px-4 py-2.5 transition-colors hover:bg-white/[0.05]",
        !n.read && "bg-pitflix-primary/[0.06]",
        target && "cursor-pointer",
      )}
      onClick={
        target
          ? () => {
              navigate(target);
              onNavigate();
            }
          : undefined
      }
    >
      <span className="mt-0.5">
        <KindIcon kind={n.kind} />
      </span>
      <div className="min-w-0 flex-1">
        <p className="truncate text-sm font-medium text-white">{n.title}</p>
        {n.message && <p className="mt-0.5 line-clamp-2 text-xs text-pitflix-muted">{n.message}</p>}
        <p className="mt-0.5 text-[11px] text-pitflix-subtle">{relativeTime(n.ts)}</p>
      </div>
      <button
        type="button"
        aria-label="Dismiss notification"
        onClick={(e) => {
          e.stopPropagation();
          remove(n.id);
        }}
        className="shrink-0 rounded p-0.5 text-pitflix-subtle opacity-0 transition-opacity hover:text-white group-hover:opacity-100"
      >
        ×
      </button>
    </li>
  );
}

export function NotificationsBell() {
  const items = useNotificationsStore((s) => s.items);
  const markAllRead = useNotificationsStore((s) => s.markAllRead);
  const clear = useNotificationsStore((s) => s.clear);
  const unread = items.reduce((acc, i) => acc + (i.read ? 0 : 1), 0);

  const [open, setOpen] = useState(false);
  const ref = useRef<HTMLDivElement>(null);

  // Close on outside click.
  useEffect(() => {
    if (!open) return;
    const onDown = (e: MouseEvent) => {
      if (ref.current && !ref.current.contains(e.target as Node)) setOpen(false);
    };
    document.addEventListener("mousedown", onDown);
    return () => document.removeEventListener("mousedown", onDown);
  }, [open]);

  // Opening the panel marks everything read (clears the badge).
  useEffect(() => {
    if (open && unread > 0) markAllRead();
  }, [open, unread, markAllRead]);

  return (
    <div className="relative" ref={ref}>
      <button
        type="button"
        title="Notifications"
        aria-label={unread > 0 ? `Notifications (${unread} unread)` : "Notifications"}
        onClick={() => setOpen((o) => !o)}
        className={cn(
          "relative flex h-9 w-9 items-center justify-center rounded-xl border transition-colors duration-150",
          open
            ? "border-pitflix-primary/50 bg-pitflix-primary/20 text-white"
            : "border-white/15 bg-white/[0.04] text-pitflix-muted hover:border-white/30 hover:text-white",
        )}
      >
        <Bell className="h-4 w-4" />
        {unread > 0 && (
          <span className="absolute -right-1 -top-1 flex h-4 min-w-4 items-center justify-center rounded-full bg-pitflix-primary px-1 text-[10px] font-bold leading-none text-white">
            {unread > 9 ? "9+" : unread}
          </span>
        )}
      </button>

      {open && (
        <div className="absolute right-0 top-full z-50 mt-1.5 w-80 overflow-hidden rounded-xl border border-white/10 bg-pitflix-surface shadow-xl shadow-black/60">
          <div className="flex items-center justify-between border-b border-white/10 px-4 py-2.5">
            <span className="text-sm font-semibold text-white">Notifications</span>
            {items.length > 0 && (
              <button
                type="button"
                onClick={() => clear()}
                className="text-xs font-medium text-pitflix-muted transition-colors hover:text-white"
              >
                Clear all
              </button>
            )}
          </div>

          {items.length === 0 ? (
            <div className="px-4 py-10 text-center">
              <Bell className="mx-auto mb-2 h-6 w-6 text-pitflix-subtle" />
              <p className="text-sm text-pitflix-muted">No notifications yet</p>
              <p className="mt-1 text-xs text-pitflix-subtle">
                Scans, matches, and sync activity show up here.
              </p>
            </div>
          ) : (
            <ul className="max-h-[22rem] divide-y divide-white/5 overflow-y-auto">
              {items.map((n) => (
                <Row key={n.id} n={n} onNavigate={() => setOpen(false)} />
              ))}
            </ul>
          )}
        </div>
      )}
    </div>
  );
}
