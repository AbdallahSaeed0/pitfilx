//! Path B player host: Pitflix-owned window + stable command/event boundary.

pub mod commands;
#[cfg(windows)]
pub mod d3d11;
pub mod events;
pub mod playback_orchestrator;
pub mod libmpv;
#[cfg(windows)]
pub mod mpv_gl_win;
#[cfg(windows)]
pub mod windows_libmpv_host;
pub mod tauri_commands;
pub mod subtitle_generator;

#[cfg(windows)]
pub mod windows_host;

use std::sync::Mutex;

use tauri::AppHandle;

use self::commands::PlayerOpen;
use self::events::Player2NativeState;

pub struct PlayerHostState(pub Mutex<Option<PlayerHost>>);

pub struct PlayerHost {
  #[allow(dead_code)]
  app: AppHandle,
  #[cfg(windows)]
  windows: windows_host::WindowsPlayerHost,
}

impl PlayerHost {
  pub fn new(app: AppHandle) -> Self {
    Self {
      app: app.clone(),
      #[cfg(windows)]
      windows: windows_host::WindowsPlayerHost::new(app),
    }
  }

  pub fn open(&self, payload: PlayerOpen) -> Result<(), String> {
    #[cfg(windows)]
    {
      return self.windows.open(payload);
    }
    #[cfg(not(windows))]
    {
      let _ = payload;
      Err("Player Path B not implemented on this platform yet.".to_string())
    }
  }

  pub fn close(&self) {
    #[cfg(windows)]
    {
      self.windows.close();
    }
  }

  pub fn send(&self, cmd: commands::PlayerCommand) -> Result<(), String> {
    #[cfg(windows)]
    {
      return self.windows.send(cmd);
    }
    #[cfg(not(windows))]
    {
      let _ = cmd;
      Err("Player Path B not implemented on this platform yet.".to_string())
    }
  }

  pub fn pause_with_confirmation(&self) -> Result<(), String> {
    #[cfg(windows)]
    {
      return self.windows.pause_with_confirmation();
    }
    #[cfg(not(windows))]
    {
      Err("Player Path B not implemented on this platform yet.".to_string())
    }
  }

  /// Resume via correlated mpv JSON IPC (`request_id`); blocks until verified or returns `Err` (inline retry in UI).
  pub fn resume_with_confirmation(&self) -> Result<(), String> {
    #[cfg(windows)]
    {
      return self.windows.resume_with_confirmation();
    }
    #[cfg(not(windows))]
    {
      Err("Player Path B not implemented on this platform yet.".to_string())
    }
  }

  pub fn set_video_bounds(&self, x: i32, y: i32, width: i32, height: i32) -> Result<(), String> {
    #[cfg(windows)]
    {
      return self.windows.set_video_bounds(x, y, width, height);
    }
    #[cfg(not(windows))]
    {
      let _ = (x, y, width, height);
      Ok(())
    }
  }

  pub fn get_native_state(&self) -> Player2NativeState {
    #[cfg(windows)]
    {
      return self.windows.get_native_state();
    }
    #[cfg(not(windows))]
    {
      Player2NativeState {
        session_active: false,
        backend: "none".to_string(),
        session_id: None,
        video_hwnd: None,
        ipc_mirror: None,
        libmpv_pause_property: None,
        libmpv_property_error: Some("Path B player is Windows-only".to_string()),
        pause_verification: None,
        render_frame_count: 0,
        last_render_error: None,
        window_thread_id: None,
      }
    }
  }

  pub fn list_external_subtitle_files(&self) -> Result<Vec<String>, String> {
    #[cfg(windows)]
    {
      return self.windows.list_external_subtitle_files();
    }
    #[cfg(not(windows))]
    {
      Ok(Vec::new())
    }
  }

  pub fn test_ipc_osd(&self) -> Result<(), String> {
    #[cfg(windows)]
    {
      return self.windows.test_ipc_osd();
    }
    #[cfg(not(windows))]
    {
      Err("Player Path B not implemented on this platform yet.".to_string())
    }
  }

  pub fn test_toggle_pause(&self) -> Result<(), String> {
    #[cfg(windows)]
    {
      return self.windows.test_toggle_pause();
    }
    #[cfg(not(windows))]
    {
      Err("Player Path B not implemented on this platform yet.".to_string())
    }
  }

  pub fn recover_external_session(&self) -> Result<(), String> {
    #[cfg(windows)]
    {
      return self.windows.recover_external_session();
    }
    #[cfg(not(windows))]
    {
      Err("Player Path B not implemented on this platform yet.".to_string())
    }
  }

  pub fn recover_external_session_no_config(&self) -> Result<(), String> {
    #[cfg(windows)]
    {
      return self.windows.recover_external_session_no_config();
    }
    #[cfg(not(windows))]
    {
      Err("Player Path B not implemented on this platform yet.".to_string())
    }
  }

  pub fn get_last_mpv_exit_report(&self) -> Option<windows_host::MpvExitReport> {
    #[cfg(windows)]
    {
      return self.windows.get_last_mpv_exit_report();
    }
    #[cfg(not(windows))]
    {
      None
    }
  }

  pub fn open_detached_no_wid(&self, payload: PlayerOpen) -> Result<(), String> {
    #[cfg(windows)]
    {
      return self.windows.open_detached_no_wid(payload);
    }
    #[cfg(not(windows))]
    {
      let _ = payload;
      Err("Player Path B not implemented on this platform yet.".to_string())
    }
  }

  pub fn open_detached(&self, payload: PlayerOpen) -> Result<(), String> {
    #[cfg(windows)]
    {
      return self.windows.open_detached(payload);
    }
    #[cfg(not(windows))]
    {
      let _ = payload;
      Err("Player Path B not implemented on this platform yet.".to_string())
    }
  }

  pub fn open_embedded_minimal_no_config(&self, payload: PlayerOpen) -> Result<(), String> {
    #[cfg(windows)]
    {
      return self.windows.open_embedded_minimal_no_config(payload);
    }
    #[cfg(not(windows))]
    {
      let _ = payload;
      Err("Player Path B not implemented on this platform yet.".to_string())
    }
  }

  pub fn set_embedded_safe_mode(&self, enabled: bool) {
    #[cfg(windows)]
    {
      self.windows.set_embedded_safe_mode(enabled);
    }
    #[cfg(not(windows))]
    {
      let _ = enabled;
    }
  }
}

