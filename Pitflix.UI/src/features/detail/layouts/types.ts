import type { ButtonHTMLAttributes, ComponentProps, MouseEvent, ReactNode, Ref } from "react";
import type { NavigateFunction } from "react-router-dom";
import type { SeasonSummary } from "../../../api/series";
import type { MediaVideoItem } from "../../../api/movies";
import type { DetailToolbar } from "../../../components/DetailToolbar";
import type { CastPerson, CrewMember } from "../detailComponents";

export type SimilarTitle = {
  tmdbId: number;
  title: string;
  posterUrl: string | null;
  year: string | null;
  isInLibrary: boolean;
  libraryId: number | null;
  watchStatus?: string | null;
};

export type DetailCompany = {
  id: number;
  name: string;
  logoUrl: string | null;
  kind: "network" | "company";
};

export type PlayableEpisode = {
  id: number;
  filePath: string;
  episodeNumber: number;
  title?: string | null;
};

/**
 * Everything the alternative detail layouts need, assembled by MovieDetailPage / ShowDetailPage
 * from their existing queries and handlers — the layouts only render, they never fetch the title.
 */
export type DetailViewModel = {
  kind: "movie" | "series";
  libraryId: number;
  tmdbId: number;
  title: string;
  year?: number | null;
  overview?: string | null;
  genres: string[];
  contentRating: string | null;
  runtimeMinutes?: number | null;
  backdrop?: string;
  poster?: string;
  clearLogoUrl?: string | null;
  watchStatus?: string;
  imdbId: string | null;

  /** Main play button. `buttonProps` carries the movie's long-press handlers; `extra` its popover. */
  primary: {
    label: string;
    sub?: string | null;
    progressPercent?: number | null;
    again?: boolean;
    title?: string;
    buttonRef?: Ref<HTMLButtonElement>;
    buttonProps?: ButtonHTMLAttributes<HTMLButtonElement>;
    onClick?: () => void;
    extra?: ReactNode;
  } | null;

  /** DetailToolbar props (matching / delete); layouts pick the variant and add `extraItems`. */
  toolbar: Omit<ComponentProps<typeof DetailToolbar>, "variant">;

  cast: CastPerson[];
  crew: CrewMember[];
  similar: SimilarTitle[];
  companies: DetailCompany[];
  collection?: { id: number; name: string } | null;
  extras: MediaVideoItem[];

  ratingsRefresh: { refreshing: boolean; onRefresh: () => void };
  /** "On this device" actions for the ⋯ menu / side list (open folder, change artwork, drop…). */
  deviceActions: import("../../../components/DetailToolbar").DetailToolbarExtraItem[];
  /** Folder (series) or file (movie) path, for display. */
  localPath: string | null;

  onPosterClick: () => void;
  onContextMenu: (e: MouseEvent) => void;
  navigate: NavigateFunction;

  series?: {
    seasonsSummary: SeasonSummary[];
    /** Season the hero progress and Episodes tab open on (next episode's season, else the first). */
    focusSeason: number | null;
    isDropped: boolean;
    playEpisode: (ep: PlayableEpisode, season: number) => void;
    onDownloadSeason: (season: number) => void;
  };

  movie?: {
    filePath: string | null;
    rewatchCount: number;
    onSubtitles: () => void;
  };
};
