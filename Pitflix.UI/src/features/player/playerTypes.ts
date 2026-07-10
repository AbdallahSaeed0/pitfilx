export type DeviceFsEntry = {
  name: string;
  path: string;
  is_directory: boolean;
  media_kind?: string | null;
  /** Optional logo URL used for live IPTV channels in the playlist panel. */
  logoUrl?: string | null;
  size_bytes?: number | null;
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
        aid: number;
        /** Present when backend sends it (external IPC health). */
        ipc_healthy?: boolean;
        sub_delay?: number;
      };
    }
  | {
      type: "Tracks";
      payload: { tracks: { id?: number; track_type?: string; lang?: string; title?: string; selected?: boolean }[] };
    }
  | { type: "Error"; payload: { message: string } }
  | { type: "AudioPassthroughStatus"; payload: { active: boolean } };

export type MpvTrack = {
  id?: number;
  type?: string;
  lang?: string;
  title?: string;
  selected?: boolean;
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
