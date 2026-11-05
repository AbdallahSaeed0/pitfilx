import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { getWatchingCurrently } from "../../../api/homeDiscover";
import { setShowDropped } from "../../../api/series";
import { HOME_COLD_START_RETRY } from "../../../api/client";
import { useResumeBeforePlay } from "../../../hooks/useResumeBeforePlay";
import type { LibrarySectionsStyle } from "../../../store/appPrefsStore";
import type { WatchHistoryRow } from "../../../types/homeSection";
import { continueReturnContext } from "../ContinueWatchingHero";
import { BillboardLayout } from "./BillboardLayout";
import { PreviewLayout } from "./PreviewLayout";
import { BackdropRowLayout } from "./BackdropRowLayout";
import { PosterShelfLayout } from "./PosterShelfLayout";

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
    ...HOME_COLD_START_RETRY,
  });

  const dismissMut = useMutation({
    mutationFn: (showId: number) => setShowDropped(showId, true),
    onSuccess: () => {
      void qc.invalidateQueries({ queryKey: ["home-watching-currently"] });
    },
  });

  const { requestPlay, ResumePromptModal } = useResumeBeforePlay();

  const playFeatured = (row: WatchHistoryRow) =>
    void requestPlay({
      filePath: row.filePath,
      title: row.title,
      posterPath: row.posterLocalPath ?? null,
      mediaType: row.mediaType || "Movie",
      durationSeconds: row.fileDurationSeconds ?? 0,
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
        {style === "billboard" ? <BillboardLayout {...props} /> : null}
        {style === "preview" ? <PreviewLayout {...props} /> : null}
        {style === "backdropRow" ? <BackdropRowLayout {...props} /> : null}
        {style === "posterShelf" ? <PosterShelfLayout {...props} /> : null}
      </div>
    </>
  );
}
