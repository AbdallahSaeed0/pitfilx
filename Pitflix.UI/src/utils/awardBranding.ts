/** Static award ceremony art for hub cards (not TMDB title posters). Paths are served from `public/`. */
const BRANDING_BY_ID: Record<string, string> = {
  "academy-awards": "/awards/branding/academy-awards.svg",
  "primetime-emmys": "/awards/branding/primetime-emmys.svg",
  bafta: "/awards/branding/bafta.svg",
  "golden-globes": "/awards/branding/golden-globes.svg",
};

export function getAwardBrandingImageSrc(awardId: string): string | undefined {
  const src = BRANDING_BY_ID[awardId.trim()];
  return src;
}
