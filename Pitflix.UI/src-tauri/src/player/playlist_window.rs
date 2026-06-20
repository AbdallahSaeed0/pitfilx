//! Docked side-panel window for the folder playlist (libmpv embedded mode).
//!
//! Creates a frameless, always-on-top secondary `WebviewWindow` flush with the
//! main window's right edge. Re-positioned whenever the main window moves or
//! resizes so it stays visually attached.

use std::sync::Mutex;

use tauri::{
  AppHandle, LogicalPosition, LogicalSize, Manager, PhysicalPosition, PhysicalSize, State,
  WebviewUrl, WebviewWindowBuilder, WindowEvent,
};

pub struct PlaylistWindowState {
  /// Cleared on window close. The label used for the window's identifier.
  pub label: Mutex<Option<String>>,
}

impl Default for PlaylistWindowState {
  fn default() -> Self {
    Self {
      label: Mutex::new(None),
    }
  }
}

const PLAYLIST_WINDOW_LABEL: &str = "pitflix-playlist";
/// Logical (CSS) px width of the docked side panel.
const PLAYLIST_WIDTH_LOGICAL: f64 = 320.0;

/// Set the playlist window's position+size so it sits flush with the main
/// window's right edge, matching its vertical extent.
fn reposition_to_main(app: &AppHandle) -> Result<(), String> {
  let main = app
    .get_webview_window("main")
    .ok_or_else(|| "main window not found".to_string())?;
  let playlist = match app.get_webview_window(PLAYLIST_WINDOW_LABEL) {
    Some(w) => w,
    None => return Ok(()),
  };
  let main_pos: PhysicalPosition<i32> = main.outer_position().map_err(|e| e.to_string())?;
  let main_size: PhysicalSize<u32> = main.outer_size().map_err(|e| e.to_string())?;
  let scale = main.scale_factor().map_err(|e| e.to_string())?;
  let playlist_width_phys = (PLAYLIST_WIDTH_LOGICAL * scale).round() as i32;

  // Right edge of main → left edge of playlist. Height matches main.
  playlist
    .set_position(PhysicalPosition::new(
      main_pos.x + main_size.width as i32,
      main_pos.y,
    ))
    .map_err(|e| e.to_string())?;
  playlist
    .set_size(PhysicalSize::new(
      playlist_width_phys.max(1) as u32,
      main_size.height.max(1),
    ))
    .map_err(|e| e.to_string())?;
  Ok(())
}

/// Open the docked playlist window. Idempotent: if it already exists, brings it
/// to the front and re-positions it.
#[tauri::command]
pub fn playlist_window_open(
  app: AppHandle,
  state: State<'_, PlaylistWindowState>,
  folder: String,
  current_file: String,
) -> Result<(), String> {
  // If already open, just re-position and notify.
  if app.get_webview_window(PLAYLIST_WINDOW_LABEL).is_some() {
    reposition_to_main(&app)?;
    use tauri::Emitter;
    let _ = app.emit_to(
      PLAYLIST_WINDOW_LABEL,
      "playlist:set-context",
      serde_json::json!({ "folder": folder, "currentFile": current_file }),
    );
    return Ok(());
  }

  // Encode params via URL fragment so the popout route can read them on load.
  // Using fragment keeps Tauri router happy and survives the Vite dev server.
  let mut url = String::from("/playlist-popout");
  url.push_str("?folder=");
  url.push_str(&urlencoding::encode(&folder));
  url.push_str("&current=");
  url.push_str(&urlencoding::encode(&current_file));

  let main = app
    .get_webview_window("main")
    .ok_or_else(|| "main window not found".to_string())?;
  let main_pos: PhysicalPosition<i32> = main.outer_position().map_err(|e| e.to_string())?;
  let main_size: PhysicalSize<u32> = main.outer_size().map_err(|e| e.to_string())?;
  let scale = main.scale_factor().map_err(|e| e.to_string())?;

  // WebviewWindowBuilder::position/inner_size are LOGICAL (CSS) px, but
  // outer_position/outer_size return physical px. Convert.
  let logical_x = (main_pos.x as f64 + main_size.width as f64) / scale;
  let logical_y = main_pos.y as f64 / scale;
  let logical_h = main_size.height as f64 / scale;

  let builder = WebviewWindowBuilder::new(
    &app,
    PLAYLIST_WINDOW_LABEL,
    WebviewUrl::App(url.into()),
  )
  .title("Playlist")
  .decorations(false)
  .resizable(false)
  .minimizable(false)
  .maximizable(false)
  .skip_taskbar(true)
  .always_on_top(false)
  .position(logical_x, logical_y)
  .inner_size(PLAYLIST_WIDTH_LOGICAL, logical_h)
  .transparent(false);

  let win = builder.build().map_err(|e| format!("create playlist window: {e}"))?;

  // Clear our stored label when the window is closed.
  let app_for_close = app.clone();
  win.on_window_event(move |ev| {
    if matches!(ev, WindowEvent::Destroyed | WindowEvent::CloseRequested { .. }) {
      if let Some(s) = app_for_close.try_state::<PlaylistWindowState>() {
        if let Ok(mut g) = s.label.lock() {
          *g = None;
        }
      }
    }
  });

  if let Ok(mut g) = state.label.lock() {
    *g = Some(PLAYLIST_WINDOW_LABEL.to_string());
  }
  Ok(())
}

#[tauri::command]
pub fn playlist_window_close(app: AppHandle) -> Result<(), String> {
  if let Some(w) = app.get_webview_window(PLAYLIST_WINDOW_LABEL) {
    let _ = w.close();
  }
  Ok(())
}

#[tauri::command]
pub fn playlist_window_resync(app: AppHandle) -> Result<(), String> {
  reposition_to_main(&app)
}

/// Wired into `lib.rs` setup. Watches main-window move/resize and re-positions
/// the playlist window if it's currently open.
pub fn install_main_window_follower(app: &AppHandle) {
  let app_clone = app.clone();
  if let Some(main) = app.get_webview_window("main") {
    main.on_window_event(move |ev| {
      if matches!(
        ev,
        WindowEvent::Moved(_) | WindowEvent::Resized(_) | WindowEvent::ScaleFactorChanged { .. }
      ) {
        let _ = reposition_to_main(&app_clone);
      }
    });
  }
}

// Re-export logical types so callers don't need to import them everywhere.
#[allow(dead_code)]
pub fn _types_for_link() -> (LogicalPosition<f64>, LogicalSize<f64>) {
  (LogicalPosition::new(0.0, 0.0), LogicalSize::new(0.0, 0.0))
}
