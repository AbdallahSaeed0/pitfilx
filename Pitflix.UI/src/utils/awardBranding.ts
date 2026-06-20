/** New user-supplied images in /assets/awards/, existing fallbacks in /awards/branding/ */
const BRANDING: Record<string, { primary: string; fallback?: string }> = {
  "academy-awards": {
    primary: "/assets/awards/oscars.jpg",
    fallback: "/awards/branding/oscars.png",
  },
  "primetime-emmys": {
    primary: "/assets/awards/emmys.png",
    fallback: "/awards/branding/emmys.png",
  },
  bafta: {
    primary: "/assets/awards/bafta.png",
    fallback: "/awards/branding/bafta.png",
  },
  "golden-globes": {
    primary: "/assets/awards/golden-globes.png",
    fallback: "/awards/branding/golden-globes.png",
  },
};

export function getAwardBrandingImageSrc(awardId: string): string | undefined {
  return BRANDING[awardId.trim()]?.primary;
}

export function getAwardBrandingFallbackSrc(awardId: string): string | undefined {
  return BRANDING[awardId.trim()]?.fallback;
}
