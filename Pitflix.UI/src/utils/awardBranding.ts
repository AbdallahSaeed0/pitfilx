import oscars from "../assets/awards/oscars.png";
import emmys from "../assets/awards/emmys.png";
import bafta from "../assets/awards/bafta.png";
import goldenGlobes from "../assets/awards/golden_globes.png";

/** Local ceremony logos (Vite-bundled from <code>src/assets/awards/</code>). SVG fallbacks stay in <code>public/awards/branding/</code>. */
const BRANDING: Record<string, { primary: string; fallback?: string }> = {
  "academy-awards": {
    primary: oscars,
    fallback: "/awards/branding/academy-awards.svg",
  },
  "primetime-emmys": {
    primary: emmys,
    fallback: "/awards/branding/primetime-emmys.svg",
  },
  bafta: {
    primary: bafta,
    fallback: "/awards/branding/bafta.svg",
  },
  "golden-globes": {
    primary: goldenGlobes,
    fallback: "/awards/branding/golden-globes.svg",
  },
};

export function getAwardBrandingImageSrc(awardId: string): string | undefined {
  return BRANDING[awardId.trim()]?.primary;
}

export function getAwardBrandingFallbackSrc(awardId: string): string | undefined {
  return BRANDING[awardId.trim()]?.fallback;
}
