import type { PosterCardMetaHints } from "../../components/ui/PosterCard";
import type { HomeSectionConfig } from "../../types/homeSection";

export function posterMetaFromConfig(section: HomeSectionConfig): PosterCardMetaHints {
  const m = section.metadata;
  if (!m) return {};
  const details =
    m.showYear !== false || m.showRating !== false || m.showLang !== false;
  return {
    showTitle: m.showTitle !== false,
    showDetailsLine: details,
    showPosterRatingOnHover: m.showRating !== false,
  };
}
