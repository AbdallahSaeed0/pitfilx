import type { WatchingCurrentlyCard } from "../../../api/homeDiscover";
import type { WatchHistoryRow } from "../../../types/homeSection";

export type DirectionProps = {
  /** Active continue-watching item (history[currentIndex]). */
  featured: WatchHistoryRow;
  /** Full continue-watching list — featured plus the rest, used for queue/pagination UI. */
  history: WatchHistoryRow[];
  currentIndex: number;
  /** Up Next shelf — shows with a pending next episode, independent from the resume-position history above. */
  upNext: WatchingCurrentlyCard[];
  onManageContinue: (historyId: number) => void;
  onSelectFeatured: (index: number) => void;
  onDismissUpNext: (showId: number) => void;
  dismissingUpNextId: number | null;
  requestPlay: (row: WatchHistoryRow) => void;
};
