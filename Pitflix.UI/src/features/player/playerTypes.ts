export type DeviceFsEntry = {
  name: string;
  path: string;
  is_directory: boolean;
  media_kind?: string | null;
  /** Optional logo URL used for live IPTV channels in the playlist panel. */
  logoUrl?: string | null;
  size_bytes?: number | null;
};

/** Library episode metadata (title/rating/runtime/synopsis) used to enrich a folder
 * playlist row when the file resolves to a known series episode. Keyed by
 * `normalizeMediaPathKey(filePath)` in a lookup map. */
export type PlaylistEpisodeMeta = {
  title?: string | null;
  overview?: string | null;
  imdbVoteAverage?: number | null;
  runtimeMinutes?: number | null;
  stillUrl?: string | null;
  stillLocalPath?: string | null;
};

export type Player2Event =
  | {
      type: "State";
      payload: {
        loading: boolean;
        playing: boolean;
        paused: boolean;
        ended: boolean;
        time_pos: number;
        duration: number;
        mute: boolean;
        volume: number;
        sub_visible: boolean;
        sid: number;
        /** mpv `secondary-sid` (dual subtitles); -1 when off. Absent on older backends. */
        secondary_sid?: number;
        aid: number;
        /** Present when backend sends it (external IPC health). */
        ipc_healthy?: boolean;
        sub_delay?: number;
        /** Embedded mpv: bumped whenever a seek finishes (time_pos = landed position). */
        seek_seq?: number;
      };
    }
  | {
      type: "Tracks";
      payload: {
        tracks: {
          id?: number;
          track_type?: string;
          lang?: string;
          title?: string;
          selected?: boolean;
          external_filename?: string | null;
        }[];
      };
    }
  | { type: "Error"; payload: { message: string } }
  | { type: "AudioPassthroughStatus"; payload: { active: boolean } };

export type MpvTrack = {
  id?: number;
  type?: string;
  lang?: string;
  title?: string;
  selected?: boolean;
  /** Path of the file an external subtitle track was loaded from. */
  externalFilename?: string;
};

export type Player2IpcMirror = {
  time_pos?: number;
  time_pos_full?: number;
  duration?: number;
};

export type Player2NativeState = {
  session_active: boolean;
  backend: "libmpv" | "external_mpv" | "none" | string;
  ipc_mirror?: Player2IpcMirror | null;
  session_id?: number | null;
  render_frame_count?: number;
  last_render_error?: string | null;
  window_thread_id?: number | null;
};

export type PlayerSubtitlePrefs = {
  fontSize: number;
  textColor: string;
  borderColor: string;
  borderSize: number;
  backColor: string;
  shadowColor: string;
  shadowOffset: number;
  position: number;
  fontFamily: string;
};
