import { invoke } from "@tauri-apps/api/core";

import { getCurrentWindow } from "@tauri-apps/api/window";

import { Captions, ExternalLink } from "lucide-react";

import { EpisodeNavigation } from "../../components/player/EpisodeNavigation";

import { CinematicPlayerShell } from "../../components/player/CinematicPlayerShell";

import { MediaHeroCard } from "../../components/player/MediaHeroCard";

import { PlaybackStatusBadge } from "../../components/player/PlaybackStatusBadge";

import { PlayerActionButton } from "../../components/player/PlayerActionButton";

import { PlayerQuickTips } from "../../components/player/PlayerQuickTips";

import { isNativeBackendExternal } from "../../utils/playerNativeBackend";

import { PlayerCompanionEpisodeList } from "./PlayerCompanionEpisodeList";
import { PlayerSpeedControl } from "./PlayerSpeedControl";

import { logPlayer2InvokeFailure } from "./playerDebug";

import type { PlayerCompanionViewProps } from "./playerViewProps";



export function PlayerCompanionView({

  state,

  ctxLabel,

  seriesDisplayTitle,

  episodeTitle,

  backdropPath,

  uiPct,

  uiTimePos,

  uiDuration,

  resumeMarkerSec,

  seasonEpisodes,

  seasonEpisodesLoading,

  seasonName,

  prevEp,

  nextEp,

  playPrevious,

  playNext,

  onSelectEpisode,

  playbackStatusMapped,

  polSeq,

  polSnap,

  effectiveEnded,

  effectiveSessionDead,

  transportError,

  setTransportError,

  setResumeOptimistic,

  nativeState,

  nativeStateRef,

  playerRootRef,

  browseWhilePlaying,

  exitAndClose,

  generateArabicSubtitle,

  arabicSubtitleGenerating,

  arabicSubtitleProgress,

  arabicSubtitleError,

  playbackSpeed,

  setPlaybackSpeed,

}: PlayerCompanionViewProps) {

  const isSeries = state.mediaType === "Series" && state.libraryShowId != null && state.season != null;



  return (

    <CinematicPlayerShell>

          <div

            className="h-1 w-full shrink-0 rounded-full bg-gradient-to-r from-violet-600 via-fuchsia-500 to-cyan-400 opacity-90 shadow-[0_0_24px_rgba(139,92,246,0.35)]"

            aria-hidden

          />

          {/* Header */}

          <header className="flex flex-wrap items-center justify-between gap-3">

            <button

              type="button"

              className="rounded-lg px-3 py-1.5 text-sm text-pitflix-text-muted ring-1 ring-white/10 transition-colors hover:bg-white/5 hover:text-pitflix-text-primary"

              onClick={() => {

                if (isNativeBackendExternal(nativeStateRef.current?.backend ?? "")) {

                  void browseWhilePlaying();

                } else {

                  void exitAndClose();

                }

              }}

            >

              ← Back

            </button>

            <div className="min-w-0 flex-1 text-center sm:order-none">

              <h1 className="truncate text-subtitle font-semibold text-pitflix-text-primary">{seriesDisplayTitle}</h1>

              {ctxLabel ? <p className="truncate text-caption text-pitflix-text-muted">{ctxLabel}</p> : null}

            </div>

            <PlaybackStatusBadge status={playbackStatusMapped} />

          </header>



          <MediaHeroCard

            posterPath={state.posterPath}

            backdropPath={backdropPath}

            title={seriesDisplayTitle}

            episode={ctxLabel}

            episodeTitle={episodeTitle}

            progress={uiPct}

            timePos={uiTimePos}

            duration={uiDuration}

            resumeFromSec={resumeMarkerSec}

          >

            {(() => {

              const live =

                !transportError &&

                (polSeq > 0 ? polSnap.phase !== "ended" && polSnap.phase !== "error" : !effectiveEnded && !effectiveSessionDead);

              return live ? (

                <div className="flex flex-wrap items-center justify-center gap-2">

                  <PlayerActionButton

                    variant="primary"

                    onClick={() => {

                      void getCurrentWindow().setFocus().catch(() => {});

                      playerRootRef.current?.focus({ preventScroll: true });

                    }}

                  >

                    <ExternalLink className="h-4 w-4" />

                    Bring mpv to front

                  </PlayerActionButton>

                  {isNativeBackendExternal(nativeState?.backend ?? "") ? (

                    <PlayerActionButton variant="secondary" onClick={() => void browseWhilePlaying()}>

                      Browse app

                    </PlayerActionButton>

                  ) : null}

                  <PlayerSpeedControl

                    speed={playbackSpeed}

                    onSpeedChange={setPlaybackSpeed}

                    disabled={!live}

                    variant="inline"

                  />

                  <PlayerActionButton 

                    variant="secondary" 

                    onClick={() => void generateArabicSubtitle()}

                    disabled={arabicSubtitleGenerating}

                  >

                    {arabicSubtitleGenerating ? (

                      <>

                        <span className="inline-block animate-spin mr-2">⟳</span>

                        {arabicSubtitleProgress 

                          ? `Generating (${arabicSubtitleProgress.current}/${arabicSubtitleProgress.total})...`

                          : "Generating Arabic..."

                        }

                      </>

                    ) : (

                      <>

                        <Captions className="h-4 w-4" />

                        Generate Arabic Subtitle

                      </>

                    )}

                  </PlayerActionButton>

                  {arabicSubtitleError && (

                    <div className="text-sm text-red-400 px-2 py-1 rounded bg-red-500/10 border border-red-500/20">

                      {arabicSubtitleError}

                    </div>

                  )}

                </div>

              ) : null;

            })()}

          </MediaHeroCard>



          {isSeries ? (

            <>

              <EpisodeNavigation

                className="mt-6 w-full max-w-4xl"

                prevEpisode={prevEp}

                nextEpisode={nextEp}

                onPrevious={() => void playPrevious()}

                onNext={() => void playNext()}

              />

              <div className="mt-4 w-full">
              <PlayerCompanionEpisodeList

                season={state.season!}

                seasonName={seasonName}

                episodes={seasonEpisodes}

                currentEpisodeId={state.libraryEpisodeId}

                loading={seasonEpisodesLoading}

                onSelectEpisode={onSelectEpisode}

              />
              </div>

            </>

          ) : null}



          {/* Quick Tips */}

          <PlayerQuickTips className="mt-6" />



          {/* Transport Error (if any) */}

          {transportError && (

            <div className="mt-4 flex flex-col items-center gap-3 rounded-xl border border-pitflix-status-error/30 bg-pitflix-status-error/10 p-4 text-center">

              <p className="text-sm text-red-300">{transportError}</p>

              <div className="flex gap-2">

                <PlayerActionButton

                  variant="secondary"

                  onClick={() => setTransportError(null)}

                >

                  Dismiss

                </PlayerActionButton>

                <PlayerActionButton

                  variant="primary"

                  onClick={() => {

                    setTransportError(null);

                    setResumeOptimistic(false);

                    void invoke("player2_recover").catch((e) => {

                      logPlayer2InvokeFailure("player2_recover", e);

                      setTransportError(e instanceof Error ? e.message : String(e));

                    });

                  }}

                >

                  Reopen Player

                </PlayerActionButton>

              </div>

            </div>

          )}

    </CinematicPlayerShell>

  );

}

