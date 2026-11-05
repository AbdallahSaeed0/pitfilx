//! Native child-webview for the "online stream" embed player.
//!
//! `StreamPlayerPage` plays free third-party embed sources (StreamIMDB,
//! CorsFlix, ...) that monetize with popup/redirect ads fired from
//! inside the player on click — a plain `<iframe>` has no way to stop a
//! cross-origin page from calling `window.open()` or navigating the top
//! frame. This mirrors the `browse` module's native-child-webview approach
//! (see its doc comment) but stripped to just what playback needs: no
//! download-button injection, no custom URI scheme. The two guards below are
//! what actually stop the hijack, enforced at the WebView2 layer where the
//! embedded page's own script can't see or work around them:
//!
//!   1. `on_new_window` unconditionally denies every popup — streaming
//!      embeds never legitimately need a real new window/tab.
//!   2. `on_navigation` only allows top-frame navigation to stay on the same
//!      registrable domain the player was opened with, so a `top.location =
//!      ...` redirect to an ad page can't hijack the whole player either.
//!
//! Only ONE stream-player webview exists at a time, same as `browse`.

use std::sync::{Arc, Mutex};

use tauri::{
    AppHandle, LogicalPosition, LogicalSize, Manager, Position, Rect, Size, State, Url, Webview,
    Wry,
};
#[cfg(windows)]
use webview2_com::Microsoft::Web::WebView2::Win32::COREWEBVIEW2_PERMISSION_STATE_DENY;
#[cfg(windows)]
use webview2_com::{PermissionRequestedEventHandler, ScriptDialogOpeningEventHandler};

const STREAM_PLAYER_LABEL: &str = "stream-player-webview";

/// Shared handle to the (at most one) open stream-player webview, plus the
/// registrable domain it's currently allowed to navigate within — read by
/// the `on_navigation` closure on every top-frame navigation attempt.
#[derive(Clone, Default)]
pub struct StreamPlayerWebviewState {
    webview: Arc<Mutex<Option<Webview<Wry>>>>,
    allowed_host: Arc<Mutex<Option<String>>>,
}

fn parse_and_check(url: &str) -> Result<Url, String> {
    let parsed = Url::parse(url.trim()).map_err(|e| format!("Invalid URL: {e}"))?;
    if parsed.scheme() != "https" {
        return Err("Only https URLs are supported.".into());
    }
    if parsed.host_str().is_none() {
        return Err("URL has no host.".into());
    }
    Ok(parsed)
}

/// Last two dot-separated labels, e.g. `player.cdn.corsflix.net` -> `corsflix.net`.
/// Good enough for the handful of simple TLDs these embed sources use — this
/// only ever widens navigation within the SAME provider's own domain, it
/// never needs to be exact for third-party ad domains (those just fail the
/// comparison and get denied, which is the safe default either way).
fn registrable_domain(host: &str) -> String {
    let labels: Vec<&str> = host.split('.').collect();
    if labels.len() >= 2 {
        format!("{}.{}", labels[labels.len() - 2], labels[labels.len() - 1])
    } else {
        host.to_string()
    }
}

fn same_site(a: &str, b: &str) -> bool {
    registrable_domain(&a.to_lowercase()) == registrable_domain(&b.to_lowercase())
}

/// Silently suppresses JS `alert`/`confirm`/`prompt` dialogs and permission
/// prompts (notifications, geolocation, camera, ...) on the stream player
/// webview. These free ad-supported embeds use both as nuisance/bait popups
/// — a spammed `alert()` or a "allow notifications?" prompt stealing focus
/// is what actually produces "small popups" and having to click several
/// times to reach the real button, not `window.open()` (already denied by
/// `on_new_window`). WebView2 shows its own native dialog/prompt UI only
/// when nothing handles the event; handling it here and never calling
/// `Accept()` / granting the permission dismisses it immediately with no UI
/// ever shown — the page's `alert()` call just returns right away.
#[cfg(windows)]
fn install_dialog_guards(webview: &Webview<Wry>) {
    let result = webview.with_webview(|platform_webview| unsafe {
        let controller = platform_webview.controller();
        let core = match controller.CoreWebView2() {
            Ok(c) => c,
            Err(e) => {
                eprintln!("[stream-player] CoreWebView2() failed: {e:?}");
                return;
            }
        };

        let dialog_handler =
            ScriptDialogOpeningEventHandler::create(Box::new(|_sender, _args| Ok(())));
        let mut dialog_token: i64 = 0;
        if let Err(e) = core.add_ScriptDialogOpening(&dialog_handler, &mut dialog_token) {
            eprintln!("[stream-player] add_ScriptDialogOpening failed: {e:?}");
        }

        let permission_handler = PermissionRequestedEventHandler::create(Box::new(
            |_sender, args| {
                if let Some(args) = args {
                    let _ = args.SetState(COREWEBVIEW2_PERMISSION_STATE_DENY);
                }
                Ok(())
            },
        ));
        let mut permission_token: i64 = 0;
        if let Err(e) = core.add_PermissionRequested(&permission_handler, &mut permission_token) {
            eprintln!("[stream-player] add_PermissionRequested failed: {e:?}");
        }
    });

    if let Err(e) = result {
        eprintln!("[stream-player] install_dialog_guards() dispatch failed: {e}");
    }
}

#[cfg(not(windows))]
fn install_dialog_guards(_webview: &Webview<Wry>) {}

/// Opens (or, if already open, navigates + repositions) the stream-player
/// child webview so it overlays the container div at the given logical (CSS)
/// px bounds. Must be `async` — Tauri's webview builder can deadlock if
/// invoked synchronously from a command.
#[tauri::command]
pub async fn stream_player_open(
    app: AppHandle,
    state: State<'_, StreamPlayerWebviewState>,
    url: String,
    x: f64,
    y: f64,
    width: f64,
    height: f64,
) -> Result<String, String> {
    let parsed = parse_and_check(&url)?;
    let host = parsed.host_str().unwrap().to_lowercase();

    *state.allowed_host.lock().map_err(|e| e.to_string())? = Some(host);

    // Tauri's own webview registry (keyed by label) is the source of truth
    // for "does this already exist" — not just our Mutex, which can race
    // when this command fires twice for the same mount (e.g. React
    // StrictMode double-invokes effects in dev). Reusing whatever's already
    // registered under this label makes repeat/overlapping opens idempotent
    // instead of the second call erroring out on a duplicate-label create
    // (which previously got misread as "embed failed" and fell back to
    // opening the stream in the system browser).
    if let Some(existing) = app.get_webview(STREAM_PLAYER_LABEL) {
        existing.navigate(parsed).map_err(|e| e.to_string())?;
        existing
            .set_bounds(Rect {
                position: Position::Logical(LogicalPosition::new(x, y)),
                size: Size::Logical(LogicalSize::new(width.max(1.0), height.max(1.0))),
            })
            .map_err(|e| e.to_string())?;
        *state.webview.lock().map_err(|e| e.to_string())? = Some(existing);
        return Ok(STREAM_PLAYER_LABEL.to_string());
    }

    let main = app
        .get_window("main")
        .ok_or_else(|| "main window not found".to_string())?;

    let allowed_host_for_nav = state.allowed_host.clone();

    let builder = tauri::webview::WebviewBuilder::new(
        STREAM_PLAYER_LABEL,
        tauri::WebviewUrl::External(parsed),
    )
    .on_navigation(move |nav_url| {
        let allowed = allowed_host_for_nav.lock().ok().and_then(|g| g.clone());
        match (allowed, nav_url.host_str()) {
            (Some(a), Some(h)) => same_site(&a, h),
            _ => false,
        }
    })
    .on_new_window(|_popup_url, _features| {
        // Never let a popup become a real OS window. Streaming embeds have no
        // legitimate reason to open one — this is how the ad-supported
        // "free embed" providers try to pop an ad on every play click.
        tauri::webview::NewWindowResponse::Deny
    });

    let webview = match main.add_child(
        builder,
        LogicalPosition::new(x, y),
        LogicalSize::new(width.max(1.0), height.max(1.0)),
    ) {
        Ok(wv) => wv,
        Err(e) => {
            // Lost a creation race against an overlapping open() call — the
            // winner's webview should now be registered under this label;
            // use it instead of failing the whole play attempt.
            match app.get_webview(STREAM_PLAYER_LABEL) {
                Some(existing) => existing,
                None => return Err(format!("Failed to create stream player webview: {e}")),
            }
        }
    };

    install_dialog_guards(&webview);

    *state.webview.lock().map_err(|e| e.to_string())? = Some(webview);

    Ok(STREAM_PLAYER_LABEL.to_string())
}

#[tauri::command]
pub fn stream_player_navigate(
    state: State<'_, StreamPlayerWebviewState>,
    url: String,
) -> Result<(), String> {
    let parsed = parse_and_check(&url)?;
    let host = parsed.host_str().unwrap().to_lowercase();
    *state.allowed_host.lock().map_err(|e| e.to_string())? = Some(host);

    let guard = state.webview.lock().map_err(|e| e.to_string())?;
    let wv = guard
        .as_ref()
        .ok_or_else(|| "Stream player webview is not open.".to_string())?;
    wv.navigate(parsed).map_err(|e| e.to_string())
}

#[tauri::command]
pub fn stream_player_resize(
    state: State<'_, StreamPlayerWebviewState>,
    x: f64,
    y: f64,
    width: f64,
    height: f64,
) -> Result<(), String> {
    let guard = state.webview.lock().map_err(|e| e.to_string())?;
    let wv = guard
        .as_ref()
        .ok_or_else(|| "Stream player webview is not open.".to_string())?;
    wv.set_bounds(Rect {
        position: Position::Logical(LogicalPosition::new(x, y)),
        size: Size::Logical(LogicalSize::new(width.max(1.0), height.max(1.0))),
    })
    .map_err(|e| e.to_string())
}

#[tauri::command]
pub fn stream_player_close(state: State<'_, StreamPlayerWebviewState>) -> Result<(), String> {
    let mut guard = state.webview.lock().map_err(|e| e.to_string())?;
    if let Some(wv) = guard.take() {
        wv.close().map_err(|e| e.to_string())?;
    }
    *state.allowed_host.lock().map_err(|e| e.to_string())? = None;
    Ok(())
}
