// Prevents additional console window on Windows in release, DO NOT REMOVE!!
#![cfg_attr(not(debug_assertions), windows_subsystem = "windows")]

/// Lets the shell associate this process with a stable identity so the taskbar shows the real
/// app icon (especially with frameless / WebView2 windows). Call before creating any window.
#[cfg(windows)]
fn set_windows_app_user_model_id() {
    use windows::core::w;
    use windows::Win32::UI::Shell::SetCurrentProcessExplicitAppUserModelID;

    unsafe {
        let _ = SetCurrentProcessExplicitAppUserModelID(w!("com.pitflix.Pitflix"));
    }
}

fn main() {
    #[cfg(windows)]
    set_windows_app_user_model_id();

    pitflixui_lib::run()
}
