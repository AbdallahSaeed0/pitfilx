//! Makes Windows re-apply the page's mouse cursor while the app window isn't focused.
//!
//! The player hides the pointer with CSS (`cursor: none`) when its controls fade out. Windows only
//! asks a window which cursor to show (WM_SETCURSOR) when the mouse moves or clicks over it, and
//! WebView2 only pushes a CSS cursor change straight to the screen while its window is focused. So
//! with another app focused and the mouse resting on the video, the controls faded but the arrow
//! stayed until the user clicked. Moving the pointer one pixel and straight back makes Windows send
//! that query now; the page ignores the resulting pointer events (see PlayerPage).

use tauri::{AppHandle, Manager};
use windows::Win32::Foundation::POINT;
use windows::Win32::UI::WindowsAndMessaging::{GetAncestor, GetCursorPos, SetCursorPos, WindowFromPoint, GA_ROOT};

/// Returns true when it nudged — i.e. the pointer was over this app's main window.
#[tauri::command]
pub fn player_refresh_cursor(app: AppHandle) -> bool {
    let Some(main) = app.get_webview_window("main") else { return false };
    let Ok(main_hwnd) = main.hwnd() else { return false };
    unsafe {
        let mut pt = POINT::default();
        if GetCursorPos(&mut pt).is_err() {
            return false;
        }
        // Only when the pointer is actually over our window (a child of it, e.g. the WebView).
        let under = WindowFromPoint(pt);
        if under.0.is_null() || GetAncestor(under, GA_ROOT).0 as isize != main_hwnd.0 as isize {
            return false;
        }
        let _ = SetCursorPos(pt.x + 1, pt.y);
        let _ = SetCursorPos(pt.x, pt.y);
    }
    true
}
