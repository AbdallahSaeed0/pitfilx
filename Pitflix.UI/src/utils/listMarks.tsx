import type { LucideIcon } from "lucide-react";
import {
  Clapperboard,
  Crown,
  Film,
  Flame,
  Gem,
  Heart,
  Moon,
  Palette,
  Sparkles,
  Trophy,
  Tv,
  Zap,
} from "lucide-react";

/** Stored prefix in list name: `::iconId:: Display title` */
const MARK_PREFIX_RE = /^::([\w-]+)::\s*(.*)$/;

export const LIST_MARK_OPTIONS: { id: string; label: string; Icon: LucideIcon }[] = [
  { id: "gem", label: "Gem", Icon: Gem },
  { id: "sparkles", label: "Sparkles", Icon: Sparkles },
  { id: "film", label: "Film", Icon: Film },
  { id: "clapperboard", label: "Clapperboard", Icon: Clapperboard },
  { id: "tv", label: "TV", Icon: Tv },
  { id: "heart", label: "Heart", Icon: Heart },
  { id: "moon", label: "Moon", Icon: Moon },
  { id: "crown", label: "Crown", Icon: Crown },
  { id: "flame", label: "Flame", Icon: Flame },
  { id: "trophy", label: "Trophy", Icon: Trophy },
  { id: "palette", label: "Palette", Icon: Palette },
  { id: "zap", label: "Zap", Icon: Zap },
];

const markIconById = Object.fromEntries(LIST_MARK_OPTIONS.map((o) => [o.id, o.Icon])) as Record<string, LucideIcon>;

export function encodeListName(iconId: string, displayTitle: string) {
  const t = displayTitle.trim();
  return `::${iconId}:: ${t}`;
}

export type DecodedListTitle =
  | { mode: "icon"; iconId: string; title: string; Icon: LucideIcon }
  | { mode: "legacy"; mark: string; title: string };

export function decodeListTitle(name: string): DecodedListTitle {
  const raw = name.trim();
  const m = MARK_PREFIX_RE.exec(raw);
  if (m) {
    const iconId = m[1] ?? "";
    const title = (m[2] ?? "").trim() || "Untitled";
    const Icon = markIconById[iconId] ?? Gem;
    return { mode: "icon", iconId, title, Icon };
  }
  const parts = raw.split(/\s+/);
  if (parts.length <= 1) return { mode: "legacy", mark: "📋", title: raw };
  return { mode: "legacy", mark: parts[0] ?? "📋", title: parts.slice(1).join(" ").trim() || raw };
}

/**
 * Labels for menus/selects: icon-backed lists show clean title; legacy lists keep leading emoji (e.g. "❤️ Favorites").
 */
export function formatListMenuLabel(storedName: string): string {
  const d = decodeListTitle(storedName);
  if (d.mode === "icon") return d.title;
  return `${d.mark} ${d.title}`.replace(/\s+/g, " ").trim();
}

/** Match built-in Favorites list whether stored as legacy emoji prefix or `::heart:: Favorites`. */
export function isFavoritesListName(storedName: string): boolean {
  const lower = storedName.toLowerCase();
  const title = decodeListTitle(storedName).title.toLowerCase();
  return title.includes("favorite") || lower.includes("favorite");
}

export function ListMarkGlyph({
  name,
  className,
}: {
  name: string;
  /** Icon size / legacy emoji sizing */
  className?: string;
}) {
  const d = decodeListTitle(name);
  if (d.mode === "icon") {
    const I = d.Icon;
    return <I className={className ?? "h-10 w-10 text-violet-300"} strokeWidth={1.35} />;
  }
  return <span className={className ?? "text-4xl leading-none"}>{d.mark}</span>;
}
