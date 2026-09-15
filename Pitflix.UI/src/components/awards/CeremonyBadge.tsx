import { useState } from "react";
import { Trophy, Globe, Tv, Star, Award, Film, Camera, PenLine } from "lucide-react";

/**
 * Award ceremony trophy images, resolved to a filename stem under /awards/. `CeremonyIcon` below
 * tries `<stem>.png` first (real transparent trophy renders the user drops in), then `<stem>.svg`
 * (older placeholder icons still shipped in the repo), before giving up to the Lucide fallback.
 */
const CEREMONY_IMAGE: Record<string, string> = {
  "academy-awards": "oscar",
  bafta: "bafta",
  "golden-globes": "golden-globe",
  emmys: "emmy",
  "primetime-emmys": "emmy",
  sag: "sag",
  "critics-choice": "critics-choice",
  dga: "dga",
  wga: "wga",
  pga: "pga",
  cesar: "cesar",
  saturn: "saturn",
};

export const CEREMONY_ACCENT: Record<string, string> = {
  "academy-awards": "#c9a227",
  bafta: "#f97316",
  "golden-globes": "#eab308",
  emmys: "#3b82f6",
  "primetime-emmys": "#3b82f6",
  sag: "#a78bfa",
  "critics-choice": "#10b981",
  cesar: "#e2c27d",
  saturn: "#818cf8",
};

export const CEREMONY_SHORT: Record<string, string> = {
  "academy-awards": "OSCAR",
  bafta: "BAFTA",
  "golden-globes": "GOLDEN GLOBE",
  emmys: "EMMY",
  "primetime-emmys": "EMMY",
  sag: "SAG",
  "critics-choice": "CRITICS' CHOICE",
  dga: "DGA",
  wga: "WGA",
  pga: "PGA",
  cesar: "CÉSAR",
  saturn: "SATURN",
};

/** Lucide fallback icons for ceremonies without a local trophy image. */
function FallbackIcon({ id, color }: { id: string; color: string }) {
  const p = { size: 18, color, strokeWidth: 1.8 } as const;
  switch (id) {
    case "academy-awards": return <Trophy {...p} />;
    case "bafta": return <Film {...p} />;
    case "golden-globes": return <Globe {...p} />;
    case "emmys":
    case "primetime-emmys": return <Tv {...p} />;
    case "sag": return <Star {...p} />;
    case "critics-choice": return <Award {...p} />;
    case "dga": return <Camera {...p} />;
    case "wga": return <PenLine {...p} />;
    default: return <Trophy {...p} />;
  }
}

type ImageAttempt = "png" | "svg" | "failed";

export function CeremonyIcon({ id, color }: { id: string; color: string }) {
  const stem = CEREMONY_IMAGE[id];
  const [attempt, setAttempt] = useState<ImageAttempt>("png");

  if (!stem || attempt === "failed") {
    return <FallbackIcon id={id} color={color} />;
  }

  return (
    <img
      src={`/awards/${stem}.${attempt}`}
      alt={id}
      className="h-[28px] w-auto object-contain drop-shadow-sm"
      onError={() => setAttempt((a) => (a === "png" ? "svg" : "failed"))}
    />
  );
}

export function ceremonyShortName(awardId: string, awardName: string): string {
  return CEREMONY_SHORT[awardId] ?? awardName.replace(" Awards", "").replace(" Award", "").toUpperCase();
}

export function ceremonyAccent(awardId: string): string {
  return CEREMONY_ACCENT[awardId] ?? "#6366f1";
}
