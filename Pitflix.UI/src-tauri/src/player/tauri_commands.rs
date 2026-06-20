use std::process::Command;

use serde::Deserialize;
use tauri::Emitter;
use tauri::Manager;
use tauri::State;

use super::{
  commands::{PlayerCommand, PlayerOpen},
  events::Player2NativeState,
  playback_orchestrator::{
    self, LoadEpisodePolRequest, PlaybackOrchestratorState, PlaybackStoreSnapshot, ResumeHints,
  },
  subtitle_generator,
  PlayerHostState,
};
use super::windows_host::MpvExitReport;

pub(crate) fn append_player_debug_log(_app: Option<&tauri::AppHandle>, line: &str) {
  eprintln!("[pitflix-player] {line}");
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

#[derive(Debug, Clone, Deserialize, Default)]
#[serde(rename_all = "camelCase")]
pub struct PlaybackPersistProgressRequest {
  #[serde(default)]
  pub history_id: Option<i32>,
}

#[tauri::command]
pub fn playback_pol_persist_progress(
  pol: State<'_, PlaybackOrchestratorState>,
  req: PlaybackPersistProgressRequest,
) -> Result<(), String> {
  let mut g = pol.0.lock().map_err(|e| e.to_string())?;
  let (t, d) = g.engine_time_and_duration();
  g.persist_position_for_current(t, d, req.history_id);
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

#[derive(Debug, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct SetFinalPositionRequest {
  pub key: String,
  pub time_pos: f64,
  pub duration: f64,
  #[serde(default)]
  pub history_id: Option<i32>,
}

/// Persist an explicit final position by episode key — does not need an active session.
/// Called from the close handler so the save doesn't race with `player2_close`/`clear_session`.
#[tauri::command]
pub fn playback_pol_set_final_position(
  app: tauri::AppHandle,
  pol: State<'_, PlaybackOrchestratorState>,
  req: SetFinalPositionRequest,
) -> Result<(), String> {
  let mut g = pol.0.lock().map_err(|e| e.to_string())?;
  if !g.resume_store_ready() {
    g.set_app_paths(&app);
  }
  g.set_position_for_key(&req.key, req.time_pos, req.duration, req.history_id);
  Ok(())
}

#[tauri::command]
pub fn playback_pol_set_subtitle_pick(
  app: tauri::AppHandle,
  pol: State<'_, PlaybackOrchestratorState>,
  key: String,
  val: String,
) -> Result<(), String> {
  let mut g = pol.0.lock().map_err(|e| e.to_string())?;
  if !g.resume_store_ready() {
    g.set_app_paths(&app);
  }
  g.set_subtitle_pick(&key, &val);
  Ok(())
}

#[tauri::command]
pub fn playback_pol_get_subtitle_pick(
  app: tauri::AppHandle,
  pol: State<'_, PlaybackOrchestratorState>,
  key: String,
) -> Result<Option<String>, String> {
  let mut g = pol.0.lock().map_err(|e| e.to_string())?;
  if !g.resume_store_ready() {
    g.set_app_paths(&app);
  }
  Ok(g.get_subtitle_pick(&key))
}

#[tauri::command]
pub fn get_subtitle_tracks(video_path: String) -> Result<Vec<subtitle_generator::SubtitleTrack>, String> {
  subtitle_generator::get_subtitle_tracks(&video_path)
}

#[tauri::command]
pub fn extract_subtitle(
  video_path: String,
  track_index: i32,
  output_path: String,
) -> Result<(), String> {
  subtitle_generator::extract_subtitle_to_srt(&video_path, track_index, &output_path)
}

#[tauri::command]
pub fn translate_srt_to_arabic(
  srt_path: String,
  output_path: String,
) -> Result<(), String> {
  let cues = subtitle_generator::parse_srt_file(&srt_path)?;
  let cues = subtitle_generator::merge_short_gap_cues(cues, 500);

  const SEP: &str = "\n<<<PITFLIX_SEP>>>\n";
  let mut full_text = String::new();
  for cue in &cues {
    full_text.push_str(&cue.text.replace('\n', " [BR] "));
    full_text.push_str(SEP);
  }

  let translated_full = translate_batch_with_argos(&full_text)?;
  let translated_lines: Vec<&str> = translated_full.split("<<<PITFLIX_SEP>>>").collect();

  let mut translated_cues = Vec::new();
  for (i, cue) in cues.iter().enumerate() {
    if let Some(text) = translated_lines.get(i) {
        let restored = text.replace("[BR]", "\n").replace(" [BR] ", "\n").trim().to_string();
        let wrapped = subtitle_generator::wrap_arabic_text(&restored, 45);
        translated_cues.push(subtitle_generator::SubtitleCue {
          index: cue.index,
          start: cue.start.clone(),
          end: cue.end.clone(),
          text: wrapped,
        });
    }
  }

  subtitle_generator::write_srt_file(&translated_cues, &output_path)
}

fn translate_batch_with_argos(text: &str) -> Result<String, String> {
    // Create a temporary file for the input with UTF-8 encoding
    let temp_input = std::env::temp_dir().join("pitflix_translate_in.txt");
    std::fs::write(&temp_input, text).map_err(|e| e.to_string())?;

    // Use a more robust Python script that explicitly handles UTF-8 for both input and output
    let output = Command::new("python")
        .args(&[
            "-c",
            "import argostranslate.translate, sys, io; \
             sys.stdin = io.TextIOWrapper(sys.stdin.buffer, encoding='utf-8'); \
             sys.stdout = io.TextIOWrapper(sys.stdout.buffer, encoding='utf-8'); \
             print(argostranslate.translate.translate(sys.stdin.read(), 'en', 'ar'))"
        ])
        .stdin(std::fs::File::open(&temp_input).map_err(|e| e.to_string())?)
        .output()
        .map_err(|e| format!("Argos batch translate error: {}", e))?;

    let _ = std::fs::remove_file(&temp_input);

    if !output.status.success() {
        return Err(format!("Translation failed: {}", String::from_utf8_lossy(&output.stderr)));
    }

    Ok(String::from_utf8_lossy(&output.stdout).to_string())
}

#[tauri::command]
pub async fn generate_arabic_subtitle(
  app: tauri::AppHandle,
  video_path: String,
) -> Result<String, String> {
  eprintln!("[generate-arabic-subtitle] Starting with video_path: {}", video_path);
  
  if subtitle_generator::is_subtitle_cached(&video_path) {
    let cached = subtitle_generator::get_subtitle_output_path(&video_path)
      .to_string_lossy()
      .to_string();
    eprintln!("[generate-arabic-subtitle] Returning cached: {}", cached);
    return Ok(cached);
  }

  // Run the heavy work in a separate thread to avoid blocking the main Tauri event loop
  let video_path_clone = video_path.clone();
  std::thread::spawn(move || {
    eprintln!("[generate-arabic-subtitle] Getting subtitle tracks...");
    let tracks = subtitle_generator::get_subtitle_tracks(&video_path_clone)
      .map_err(|e| {
        eprintln!("[generate-arabic-subtitle] Error getting tracks: {}", e);
        format!("Failed to detect subtitles: {}", e)
      })?;
    
    eprintln!("[generate-arabic-subtitle] Found {} tracks", tracks.len());
    let english_track = subtitle_generator::find_english_subtitle_track(&tracks)
      .ok_or_else(|| {
        eprintln!("[generate-arabic-subtitle] No English track found");
        "No English subtitle track found".to_string()
      })?;

    eprintln!("[generate-arabic-subtitle] Extracting English track {}...", english_track.index);
    let temp_srt = subtitle_generator::get_subtitle_output_path(&video_path_clone)
      .with_extension("temp.srt")
      .to_string_lossy()
      .to_string();

    subtitle_generator::extract_subtitle_to_srt(&video_path_clone, english_track.index, &temp_srt)
      .map_err(|e| {
        eprintln!("[generate-arabic-subtitle] Extraction failed: {}", e);
        format!("Failed to extract subtitle: {}", e)
      })?;

    eprintln!("[generate-arabic-subtitle] Translating to Arabic...");
    let output_srt = subtitle_generator::get_subtitle_output_path(&video_path_clone)
      .to_string_lossy()
      .to_string();

    // Heavy translation work happens here
    let cues = subtitle_generator::parse_srt_file(&temp_srt)?;
    
    // Merge fragmented cues with gaps ≤ 500 ms to reduce noise and improve translation context
    let cues = subtitle_generator::merge_short_gap_cues(cues, 500);
    eprintln!("[generate-arabic-subtitle] After merge: {} cues", cues.len());
    eprintln!("[generate-arabic-subtitle] Sending {} cues to Python for translation (single call)...", cues.len());

    const SEP: &str = "\n<<<PITFLIX_SEP>>>\n";
    let total_count = cues.len();

    // Emit a "started" progress signal immediately so the UI transitions out of "Generating…"
    let _ = app.emit("arabic-subtitle-progress", serde_json::json!({
        "current": 0,
        "total": total_count
    }));

    // Build ONE batch with ALL cues — one Python spawn instead of N, eliminating the
    // per-chunk interpreter startup cost (~2-4 s each) that made the process so slow.
    let mut batch_text = String::new();
    for cue in &cues {
        batch_text.push_str(&cue.text.replace('\n', " [BR] "));
        batch_text.push_str(SEP);
    }

    let translated_batch = translate_batch_with_argos(&batch_text)?;

    let translated_lines: Vec<String> = translated_batch
        .split("<<<PITFLIX_SEP>>>")
        .map(|s| s.trim().to_string())
        .filter(|s| !s.is_empty())
        .collect();

    let mut translated_cues = Vec::new();
    for (i, cue) in cues.iter().enumerate() {
        if let Some(text) = translated_lines.get(i) {
            let restored = text.replace("[BR]", "\n").replace(" [BR] ", "\n").trim().to_string();
            let wrapped = subtitle_generator::wrap_arabic_text(&restored, 45);
            translated_cues.push(subtitle_generator::SubtitleCue {
                index: cue.index,
                start: cue.start.clone(),
                end: cue.end.clone(),
                text: wrapped,
            });
        }
        // Emit progress every 10 cues so the frontend bar moves smoothly
        if i % 10 == 0 || i == total_count - 1 {
            let _ = app.emit("arabic-subtitle-progress", serde_json::json!({
                "current": i + 1,
                "total": total_count
            }));
        }
    }

    eprintln!("[generate-arabic-subtitle] Translated {}/{} cues.", translated_cues.len(), total_count);

    if translated_cues.is_empty() {
        return Err("Translation resulted in empty cues".to_string());
    }

    subtitle_generator::write_srt_file(&translated_cues, &output_srt)?;

    let _ = std::fs::remove_file(&temp_srt);
    eprintln!("[generate-arabic-subtitle] Success! Output: {}", output_srt);

    Ok(output_srt)
  }).join().map_err(|_| "Thread panicked".to_string())?
}

// ── player3_open: launch WPF companion PitflixPlayer.exe ─────────────────────
//
// Does NOT touch player2_open, player2_close, or any existing command.
//
// Optionally starts a backend session first (when file_path is provided), then:
//   • minimises the Tauri window
//   • launches PitflixPlayer.exe from the same directory as this executable
//   • when the WPF process exits, restores (unminimises + focuses) the Tauri window

#[derive(Debug, serde::Deserialize, Default)]
#[serde(rename_all = "camelCase")]
pub struct Player3OpenRequest {
  #[serde(default)]
  pub file_path: Option<String>,
  #[serde(default)]
  pub media_id: Option<i32>,
  #[serde(default)]
  pub episode_id: Option<i32>,
  #[serde(default)]
  pub start_position: Option<f64>,
  #[serde(default)]
  pub subtitle_track: Option<String>,
}

#[tauri::command]
pub fn player3_open(
  app: tauri::AppHandle,
  #[allow(unused_variables)]
  req: Player3OpenRequest,
) -> Result<(), String> {
  // 1. If a file path was supplied, start a backend session first via
  //    POST http://localhost:5280/api/player/play
  if let Some(ref file_path) = req.file_path {
    let body = serde_json::json!({
      "filePath":      file_path,
      "mediaId":       req.media_id.unwrap_or(0),
      "episodeId":     req.episode_id,
      "startPosition": req.start_position.unwrap_or(0.0),
      "subtitleTrack": req.subtitle_track,
    });
    player3_http_post("127.0.0.1:5280", "/api/player/play", &body.to_string())
      .map_err(|e| format!("Failed to start backend session: {e}"))?;

    // Give the backend 500 ms to finish setting up the mpv pipe before
    // PitflixPlayer.exe starts and calls GET /api/player/session.
    std::thread::sleep(std::time::Duration::from_millis(500));
  }

  // 2. Minimise the Tauri window
  if let Some(window) = app.get_webview_window("main") {
    let _ = window.minimize();
  }

  // 3. Locate PitflixPlayer.exe.
  //
  //    Search order (first path that exists wins):
  //      [1] Production: same directory as this Tauri exe
  //      [2] Dev Debug:  ../../../../PitflixPlayer/bin/Debug/net8.0-windows/
  //      [3] Dev Release: ../../../../PitflixPlayer/bin/Release/net8.0-windows/
  //
  //    In dev mode the Tauri exe lives at:
  //      …/Pitflix.UI/src-tauri/target/debug/Pitflix.exe
  //    so four ".." levels reach the repo root, then into the WPF project's
  //    build output.

  let exe_dir = std::env::current_exe()
    .ok()
    .and_then(|p| p.parent().map(|d| d.to_path_buf()))
    .unwrap_or_default();

  let candidates = [
    exe_dir.join("PitflixPlayer.exe"),                                                   // [1] production
    exe_dir.join("..").join("..").join("..").join("..")
           .join("PitflixPlayer").join("bin").join("Debug")
           .join("net8.0-windows").join("PitflixPlayer.exe"),                            // [2] dev Debug
    exe_dir.join("..").join("..").join("..").join("..")
           .join("PitflixPlayer").join("bin").join("Release")
           .join("net8.0-windows").join("PitflixPlayer.exe"),                            // [3] dev Release
  ];

  let player_exe = candidates.iter().find(|p| p.exists()).cloned().unwrap_or_else(|| {
    // None found — emit a Tauri event so the frontend can show a friendly error,
    // then return the first candidate path so the spawn error message is useful.
    let msg = format!(
      "PitflixPlayer.exe not found. Searched:\n{}",
      candidates.iter().map(|p| format!("  {}", p.display())).collect::<Vec<_>>().join("\n")
    );
    eprintln!("[player3_open] {msg}");
    let _ = app.emit("player3_error", &msg);
    candidates[0].clone()
  });

  eprintln!("[player3_open] launching: {}", player_exe.display());

  // 4. Launch PitflixPlayer.exe
  let mut child = std::process::Command::new(&player_exe)
    .spawn()
    .map_err(|e| {
      let msg = format!("Failed to launch PitflixPlayer.exe at {}: {e}", player_exe.display());
      let _ = app.emit("player3_error", &msg);
      msg
    })?;

  // 5. Background thread: when WPF exits → restore the Tauri window
  let app_handle = app.clone();
  std::thread::spawn(move || {
    let _ = child.wait();
    if let Some(window) = app_handle.get_webview_window("main") {
      let _ = window.unminimize();
      let _ = window.set_focus();
    }
  });

  Ok(())
}

/// Minimal synchronous HTTP/1.0 POST to localhost — no external HTTP crate needed.
fn player3_http_post(authority: &str, path: &str, json_body: &str) -> Result<(), String> {
  use std::io::{Read, Write};
  use std::net::TcpStream;
  use std::time::Duration;

  let mut stream = TcpStream::connect(authority)
    .map_err(|e| format!("connect {authority}: {e}"))?;
  stream.set_write_timeout(Some(Duration::from_secs(5))).ok();
  stream.set_read_timeout(Some(Duration::from_secs(5))).ok();

  let request = format!(
    "POST {path} HTTP/1.0\r\nHost: {authority}\r\nContent-Type: application/json\r\nContent-Length: {len}\r\nConnection: close\r\n\r\n{body}",
    len  = json_body.len(),
    body = json_body,
  );
  stream.write_all(request.as_bytes()).map_err(|e| format!("write: {e}"))?;

  let mut response = String::new();
  let _ = stream.read_to_string(&mut response);

  // Accept any 2xx status
  if response.starts_with("HTTP/") {
    let status_line = response.lines().next().unwrap_or("");
    let ok = status_line.contains(" 200 ")
      || status_line.contains(" 201 ")
      || status_line.contains(" 204 ");
    if !ok {
      return Err(format!("Server responded: {status_line}"));
    }
  }

  Ok(())
}

