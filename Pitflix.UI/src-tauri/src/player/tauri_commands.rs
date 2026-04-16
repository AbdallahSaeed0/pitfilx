use std::fs::OpenOptions;
use std::io::Write;
use std::path::PathBuf;
use std::sync::Mutex;

use serde::Deserialize;
use tauri::Manager;
use tauri::State;

use super::{
  commands::{PlayerCommand, PlayerOpen},
  events::Player2NativeState,
  playback_orchestrator::{
    self, LoadEpisodePolRequest, PlaybackOrchestratorState, PlaybackStoreSnapshot, ResumeHints,
  },
  PlayerHostState,
};
use super::windows_host::MpvExitReport;

/// Serializes player debug log lines — `WM_MPV_RENDER` / mpv threads can log concurrently with the UI.
static PLAYER_DEBUG_LOG_MUTEX: Mutex<()> = Mutex::new(());

fn player_debug_log_path(app: Option<&tauri::AppHandle>) -> PathBuf {
  if let Some(app) = app {
    if let Ok(d) = app.path().app_log_dir() {
      return d.join("pitflix-player-debug.log");
    }
  }
  #[cfg(windows)]
  {
    if let Some(base) = std::env::var_os("LOCALAPPDATA") {
      return PathBuf::from(base).join("Pitflix").join("pitflix-player-debug.log");
    }
  }
  #[cfg(not(windows))]
  {
    if let Some(h) = std::env::var_os("HOME") {
      return PathBuf::from(h).join(".local/share/Pitflix/pitflix-player-debug.log");
    }
  }
  PathBuf::from("pitflix-player-debug.log")
}

pub(crate) fn append_player_debug_log(app: Option<&tauri::AppHandle>, line: &str) {
  let _lock = PLAYER_DEBUG_LOG_MUTEX
    .lock()
    .unwrap_or_else(|e| e.into_inner());
  let path = player_debug_log_path(app);
  if let Some(parent) = path.parent() {
    let _ = std::fs::create_dir_all(parent);
  }
  let Ok(mut f) = OpenOptions::new().create(true).append(true).open(&path) else {
    return;
  };
  let _ = writeln!(f, "{:?} {}", std::time::SystemTime::now(), line);
}

#[tauri::command]
pub fn player2_set_video_bounds(
  state: State<'_, PlayerHostState>,
  x: i32,
  y: i32,
  width: i32,
  height: i32,
) -> Result<(), String> {
  let g = (&*state).0.lock().map_err(|e| e.to_string())?;
  let Some(host) = g.as_ref() else {
    return Err("Player host not initialized".to_string());
  };
  host.set_video_bounds(x, y, width, height)
}

#[tauri::command]
pub fn player2_open(app: tauri::AppHandle, state: State<'_, PlayerHostState>, payload: PlayerOpen) -> Result<(), String> {
  let g = (&*state).0.lock().map_err(|e| e.to_string())?;
  let Some(host) = g.as_ref() else {
    return Err("Player host not initialized".to_string());
  };
  let _ = app;
  host.open(payload)
}

#[tauri::command]
pub fn player2_debug_log(app: tauri::AppHandle, line: String) -> Result<(), String> {
  append_player_debug_log(Some(&app), &line);
  Ok(())
}

#[tauri::command]
pub fn player2_get_state(state: State<'_, PlayerHostState>) -> Result<Player2NativeState, String> {
  let g = (&*state).0.lock().map_err(|e| e.to_string())?;
  let Some(host) = g.as_ref() else {
    return Err("Player host not initialized".to_string());
  };
  Ok(host.get_native_state())
}

#[tauri::command]
pub fn player2_send(state: State<'_, PlayerHostState>, cmd: PlayerCommand) -> Result<(), String> {
  let g = (&*state).0.lock().map_err(|e| e.to_string())?;
  let Some(host) = g.as_ref() else {
    return Err("Player host not initialized".to_string());
  };
  host.send(cmd)
}

#[tauri::command]
pub fn player2_pause(app: tauri::AppHandle, state: State<'_, PlayerHostState>) -> Result<(), String> {
  append_player_debug_log(Some(&app), "[player2_pause] invoked from frontend");
  let g = (&*state).0.lock().map_err(|e| e.to_string())?;
  let Some(host) = g.as_ref() else {
    return Err("Player host not initialized".to_string());
  };
  host.pause_with_confirmation()
}

#[tauri::command]
pub fn player2_resume(app: tauri::AppHandle, state: State<'_, PlayerHostState>) -> Result<(), String> {
  append_player_debug_log(Some(&app), "[player2_resume] invoked from frontend");
  let g = (&*state).0.lock().map_err(|e| e.to_string())?;
  let Some(host) = g.as_ref() else {
    return Err("Player host not initialized".to_string());
  };
  host.resume_with_confirmation()
}

#[tauri::command]
pub fn player2_close(app: tauri::AppHandle, state: State<'_, PlayerHostState>) -> Result<(), String> {
  let cmd_start = std::time::Instant::now();
  eprintln!("[close-tauri-cmd] entry elapsed=0ms");
  
  let lock_start = std::time::Instant::now();
  let mut g = (&*state).0.lock().map_err(|e| e.to_string())?;
  eprintln!("[close-tauri-cmd] lock_acquired elapsed={}ms duration={}ms", cmd_start.elapsed().as_millis(), lock_start.elapsed().as_millis());
  
  if let Some(host) = g.as_mut() {
    let close_start = std::time::Instant::now();
    host.close();
    eprintln!("[close-tauri-cmd] host_close_done elapsed={}ms duration={}ms", cmd_start.elapsed().as_millis(), close_start.elapsed().as_millis());
  }
  playback_orchestrator::notify_session_closed(&app);
  
  eprintln!("[close-tauri-cmd] return elapsed={}ms", cmd_start.elapsed().as_millis());
  Ok(())
}

#[tauri::command]
pub fn player2_list_external_subtitle_files(state: State<'_, PlayerHostState>) -> Result<Vec<String>, String> {
  let g = (&*state).0.lock().map_err(|e| e.to_string())?;
  let Some(host) = g.as_ref() else {
    return Err("Player host not initialized".to_string());
  };
  host.list_external_subtitle_files()
}

#[tauri::command]
pub fn player2_test_ipc_osd(app: tauri::AppHandle, state: State<'_, PlayerHostState>) -> Result<(), String> {
  append_player_debug_log(Some(&app), "[player2_test_ipc_osd] invoked from frontend");
  let g = (&*state).0.lock().map_err(|e| e.to_string())?;
  let Some(host) = g.as_ref() else {
    return Err("Player host not initialized".to_string());
  };
  host.test_ipc_osd()
}

#[tauri::command]
pub fn player2_test_toggle_pause(app: tauri::AppHandle, state: State<'_, PlayerHostState>) -> Result<(), String> {
  append_player_debug_log(Some(&app), "[player2_test_toggle_pause] invoked from frontend");
  let g = (&*state).0.lock().map_err(|e| e.to_string())?;
  let Some(host) = g.as_ref() else {
    return Err("Player host not initialized".to_string());
  };
  host.test_toggle_pause()
}

#[tauri::command]
pub fn player2_recover(app: tauri::AppHandle, state: State<'_, PlayerHostState>) -> Result<(), String> {
  append_player_debug_log(Some(&app), "[player2_recover] invoked from frontend");
  let g = (&*state).0.lock().map_err(|e| e.to_string())?;
  let Some(host) = g.as_ref() else {
    return Err("Player host not initialized".to_string());
  };
  host.recover_external_session()
}

#[tauri::command]
pub fn player2_recover_no_config(app: tauri::AppHandle, state: State<'_, PlayerHostState>) -> Result<(), String> {
  append_player_debug_log(Some(&app), "[player2_recover_no_config] invoked from frontend");
  let g = (&*state).0.lock().map_err(|e| e.to_string())?;
  let Some(host) = g.as_ref() else {
    return Err("Player host not initialized".to_string());
  };
  host.recover_external_session_no_config()
}

#[tauri::command]
pub fn player2_get_last_mpv_exit_report(state: State<'_, PlayerHostState>) -> Result<Option<MpvExitReport>, String> {
  let g = (&*state).0.lock().map_err(|e| e.to_string())?;
  let Some(host) = g.as_ref() else {
    return Err("Player host not initialized".to_string());
  };
  Ok(host.get_last_mpv_exit_report())
}

#[tauri::command]
pub fn player2_open_detached_no_wid(app: tauri::AppHandle, state: State<'_, PlayerHostState>, payload: PlayerOpen) -> Result<(), String> {
  append_player_debug_log(Some(&app), "[player2_open_detached_no_wid] invoked from frontend");
  let g = (&*state).0.lock().map_err(|e| e.to_string())?;
  let Some(host) = g.as_ref() else {
    return Err("Player host not initialized".to_string());
  };
  host.open_detached_no_wid(payload)
}

#[tauri::command]
pub fn player2_open_detached(app: tauri::AppHandle, state: State<'_, PlayerHostState>, payload: PlayerOpen) -> Result<(), String> {
  append_player_debug_log(Some(&app), "[player2_open_detached] invoked from frontend");
  let g = (&*state).0.lock().map_err(|e| e.to_string())?;
  let Some(host) = g.as_ref() else {
    return Err("Player host not initialized".to_string());
  };
  host.open_detached(payload)
}

#[tauri::command]
pub fn player2_open_embedded_minimal_no_config(app: tauri::AppHandle, state: State<'_, PlayerHostState>, payload: PlayerOpen) -> Result<(), String> {
  append_player_debug_log(Some(&app), "[player2_open_embedded_minimal_no_config] invoked from frontend");
  let g = (&*state).0.lock().map_err(|e| e.to_string())?;
  let Some(host) = g.as_ref() else {
    return Err("Player host not initialized".to_string());
  };
  host.open_embedded_minimal_no_config(payload)
}

#[tauri::command]
pub fn player2_set_embedded_safe_mode(app: tauri::AppHandle, state: State<'_, PlayerHostState>, enabled: bool) -> Result<(), String> {
  append_player_debug_log(
    Some(&app),
    &format!("[player2_set_embedded_safe_mode] invoked from frontend enabled={enabled}"),
  );
  let g = (&*state).0.lock().map_err(|e| e.to_string())?;
  let Some(host) = g.as_ref() else {
    return Err("Player host not initialized".to_string());
  };
  host.set_embedded_safe_mode(enabled);
  Ok(())
}

#[tauri::command]
pub fn playback_pol_load_episode_context(
  app: tauri::AppHandle,
  pol: State<'_, PlaybackOrchestratorState>,
  req: LoadEpisodePolRequest,
) -> Result<ResumeHints, String> {
  let mut g = pol.0.lock().map_err(|e| e.to_string())?;
  if !g.resume_store_ready() {
    g.set_app_paths(&app);
  }
  let hints = g.load_episode_context(req.current, req.next, req.autoplay_next);
  drop(g);
  playback_orchestrator::emit_snapshot_manual(&app);
  Ok(hints)
}

#[tauri::command]
pub fn playback_pol_get_snapshot(pol: State<'_, PlaybackOrchestratorState>) -> Result<PlaybackStoreSnapshot, String> {
  let g = pol.0.lock().map_err(|e| e.to_string())?;
  Ok(g.snapshot_from_last_engine())
}

#[tauri::command]
pub fn playback_pol_resume_hints_for_key(
  app: tauri::AppHandle,
  pol: State<'_, PlaybackOrchestratorState>,
  key: String,
) -> Result<ResumeHints, String> {
  let mut g = pol.0.lock().map_err(|e| e.to_string())?;
  if !g.resume_store_ready() {
    g.set_app_paths(&app);
  }
  Ok(g.resume_hints_for_episode(&key))
}

#[tauri::command]
pub fn playback_pol_set_next_autoplay(
  app: tauri::AppHandle,
  pol: State<'_, PlaybackOrchestratorState>,
  enabled: bool,
) -> Result<(), String> {
  let mut g = pol.0.lock().map_err(|e| e.to_string())?;
  g.set_next_autoplay_enabled(enabled);
  drop(g);
  playback_orchestrator::emit_snapshot_manual(&app);
  Ok(())
}

#[tauri::command]
pub fn playback_pol_cancel_next_countdown(app: tauri::AppHandle, pol: State<'_, PlaybackOrchestratorState>) -> Result<(), String> {
  let mut g = pol.0.lock().map_err(|e| e.to_string())?;
  g.cancel_next_countdown();
  drop(g);
  playback_orchestrator::emit_snapshot_manual(&app);
  Ok(())
}

#[tauri::command]
pub fn playback_pol_show_next_countdown(
  app: tauri::AppHandle,
  pol: State<'_, PlaybackOrchestratorState>,
  seconds: u32,
) -> Result<(), String> {
  let mut g = pol.0.lock().map_err(|e| e.to_string())?;
  g.show_next_countdown(seconds);
  drop(g);
  playback_orchestrator::emit_snapshot_manual(&app);
  Ok(())
}

#[tauri::command]
pub fn playback_pol_tick_next_countdown(app: tauri::AppHandle, pol: State<'_, PlaybackOrchestratorState>) -> Result<Option<u32>, String> {
  let mut g = pol.0.lock().map_err(|e| e.to_string())?;
  let rem = g.tick_countdown();
  drop(g);
  playback_orchestrator::emit_snapshot_manual(&app);
  Ok(rem)
}

#[tauri::command]
pub fn playback_pol_persist_progress(pol: State<'_, PlaybackOrchestratorState>) -> Result<(), String> {
  let mut g = pol.0.lock().map_err(|e| e.to_string())?;
  let (t, d) = g.engine_time_and_duration();
  g.persist_position_for_current(t, d);
  Ok(())
}

#[derive(Debug, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct ExtensionThumbnailsRequest {
  pub descriptor: Option<serde_json::Value>,
}

#[tauri::command]
pub fn playback_pol_set_extension_thumbnails(
  app: tauri::AppHandle,
  pol: State<'_, PlaybackOrchestratorState>,
  req: ExtensionThumbnailsRequest,
) -> Result<(), String> {
  let mut g = pol.0.lock().map_err(|e| e.to_string())?;
  g.set_extension_thumbnail_timeline(req.descriptor);
  drop(g);
  playback_orchestrator::emit_snapshot_manual(&app);
  Ok(())
}

#[derive(Debug, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct ExtensionSkipIntroRequest {
  #[serde(default)]
  pub windows: Vec<serde_json::Value>,
}

#[tauri::command]
pub fn playback_pol_set_extension_skip_intro(
  app: tauri::AppHandle,
  pol: State<'_, PlaybackOrchestratorState>,
  req: ExtensionSkipIntroRequest,
) -> Result<(), String> {
  let mut g = pol.0.lock().map_err(|e| e.to_string())?;
  g.set_extension_skip_intro_windows(req.windows);
  drop(g);
  playback_orchestrator::emit_snapshot_manual(&app);
  Ok(())
}

