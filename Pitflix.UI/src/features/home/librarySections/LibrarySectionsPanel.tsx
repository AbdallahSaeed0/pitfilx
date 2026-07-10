import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { getWatchingCurrently } from "../../../api/homeDiscover";
import { setShowDropped } from "../../../api/series";
import { useResumeBeforePlay } from "../../../hooks/useResumeBeforePlay";
import type { LibrarySectionsStyle } from "../../../store/appPrefsStore";
import type { WatchHistoryRow } from "../../../types/homeSection";
import { continueReturnContext } from "../ContinueWatchingHero";
import { Direction1a } from "./Direction1a";
import { Direction1b } from "./Direction1b";
import { Direction1c } from "./Direction1c";
import { Direction1d } from "./Direction1d";

export function LibrarySectionsPanel({
  style,
  featured,
  history,
  currentIndex,
  onManageContinue,
  onSelectFeatured,
}: {
  style: Exclude<LibrarySectionsStyle, "classic">;
  featured: WatchHistoryRow;
  history: WatchHistoryRow[];
  currentIndex: number;
  onManageContinue: (historyId: number) => void;
  onSelectFeatured: (index: number) => void;
}) {
  const qc = useQueryClient();
  const upNextQ = useQuery({
    queryKey: ["home-watching-currently"],
    queryFn: getWatchingCurrently,
    staleTime: 45_000,
  });

  const dismissMut = useMutation({
    mutationFn: (showId: number) => setShowDropped(showId, true),
    onSuccess: () => {
      void qc.invalidateQueries({ queryKey: ["home-watching-currently"] });
    },
  });

  const { requestPlay, ResumePromptModal } = useResumeBeforePlay();

  const dur = featured.fileDurationSeconds ?? 0;
  const playFeatured = (row: WatchHistoryRow) =>
    void requestPlay({
      filePath: row.filePath,
      title: row.title,
      posterPath: row.posterLocalPath ?? null,
      mediaType: row.mediaType || "Movie",
      durationSeconds: dur,
      context: continueReturnContext(row),
    });

  const props = {
    featured,
    history,
    currentIndex,
    upNext: upNextQ.data ?? [],
    onManageContinue,
    onSelectFeatured,
    onDismissUpNext: (showId: number) => dismissMut.mutate(showId),
    dismissingUpNextId: dismissMut.isPending ? (dismissMut.variables ?? null) : null,
    requestPlay: playFeatured,
  };

  return (
    <>
      {ResumePromptModal}
      <div className="mb-8">
        {style === "1a" ? <Direction1a {...props} /> : null}
        {style === "1b" ? <Direction1b {...props} /> : null}
        {style === "1c" ? <Direction1c {...props} /> : null}
        {style === "1d" ? <Direction1d {...props} /> : null}
      </div>
    </>
  );
}
