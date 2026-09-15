//! Native child-webview management for the "Browse" tab.
//!
//! A single external URL is displayed as a real OS-level child `Webview`
//! (via Tauri's `unstable` multiwebview API — see `Cargo.toml`) overlaid on
//! top of the container `<div>` the React `BrowsePage` measures. It has to be
//! a genuine child webview rather than an `<iframe>` because cross-origin
//! pages can't be scripted/embedded from the app's own HTML for security
//! reasons enforced by the target site itself (frame-busting, X-Frame-Options,
//! CSP `frame-ancestors`, etc.) — a native overlay sidesteps all of that.
//!
//! Only ONE browse webview exists at a time (multi-tab is out of scope for
//! this phase) under the fixed label [`BROWSE_LABEL`].

pub mod blocklist;
pub mod network;

use std::sync::{Arc, Mutex};

use serde::Deserialize;
use tauri::{
    AppHandle, Emitter, LogicalPosition, LogicalSize, Manager, Position, Rect, Size, State, Url,
    Webview, Wry,
};

pub use network::{DetectedMedia, NetworkState};

const BROWSE_LABEL: &str = "browse-webview";

/// Content script injected after every navigation-complete event. Handles
/// popup suppression, cosmetic ad hiding, and the hover download-button
/// overlay (see `inject.js` for details). Bundled at compile time.
const INJECT_JS: &str = include_str!("inject.js");

/// Shared handle to the (at most one) open browse webview. `Arc`-wrapped so
/// the `on_new_window` closure registered at build time can keep a clone and
/// navigate the webview once it exists (the closure is set on the builder
/// *before* the webview is built, but only ever invoked afterwards, once a
/// page inside it tries to open a popup).
#[derive(Clone, Default)]
pub struct BrowseWebviewState(pub Arc<Mutex<Option<Webview<Wry>>>>);

fn parse_and_check(url: &str) -> Result<Url, String> {
    let parsed = Url::parse(url.trim()).map_err(|e| format!("Invalid URL: {e}"))?;
    if !matches!(parsed.scheme(), "http" | "https") {
        return Err("Only http/https URLs are supported.".into());
    }
    if blocklist::is_blocked(parsed.host_str().unwrap_or("")) {
        return Err("This domain is blocked.".into());
    }
    Ok(parsed)
}

/// Opens (or, if already open, navigates + repositions) the browse child
/// webview so it overlays the container div at the given logical (CSS) px
/// bounds. Must be `async` — Tauri's webview builder can deadlock if invoked
/// synchronously from a command (see `WebviewBuilder::new` docs).
#[tauri::command]
pub async fn browse_open(
    app: AppHandle,
    state: State<'_, BrowseWebviewState>,
    net_state: State<'_, NetworkState>,
    url: String,
    x: f64,
    y: f64,
    width: f64,
    height: f64,
) -> Result<String, String> {
    let parsed = parse_and_check(&url)?;

    // Already open: just reposition + navigate instead of rebuilding.
    {
        let guard = state.0.lock().map_err(|e| e.to_string())?;
        if let Some(existing) = guard.as_ref() {
            // No need to clear the manifest cache here — the `on_page_load`
            // handler registered at webview-creation time stays attached across
            // every subsequent `navigate()` call and clears it on `Started`.
            existing.navigate(parsed).map_err(|e| e.to_string())?;
            existing
                .set_bounds(Rect {
                    position: Position::Logical(LogicalPosition::new(x, y)),
                    size: Size::Logical(LogicalSize::new(width.max(1.0), height.max(1.0))),
                })
                .map_err(|e| e.to_string())?;
            return Ok(BROWSE_LABEL.to_string());
        }
    }

    let main = app
        .get_window("main")
        .ok_or_else(|| "main window not found".to_string())?;

    let shared_for_new_window = state.0.clone();
    let net_state_for_page_load = net_state.inner().clone();

    let builder =
        tauri::webview::WebviewBuilder::new(BROWSE_LABEL, tauri::WebviewUrl::External(parsed))
            .on_navigation(|nav_url| !blocklist::is_blocked(nav_url.host_str().unwrap_or("")))
            .on_new_window(move |popup_url, _features| {
                // Never let a popup become a real OS window — either drop it (blocked
                // domain) or redirect the SAME browse webview to it, keeping
                // everything inside the tab and preventing popup spam.
                if blocklist::is_blocked(popup_url.host_str().unwrap_or("")) {
                    return tauri::webview::NewWindowResponse::Deny;
                }
                if let Ok(guard) = shared_for_new_window.lock() {
                    if let Some(wv) = guard.as_ref() {
                        let _ = wv.navigate(popup_url);
                    }
                }
                tauri::webview::NewWindowResponse::Deny
            })
            .on_page_load(move |_webview, payload| {
                // A new top-level navigation is starting — the manifests seen so far
                // belong to the page being left, so drop them before the new page's
                // own requests start arriving. (INJECT_JS itself is no longer eval'd
                // here — see `initialization_script_for_all_frames` below.)
                if matches!(payload.event(), tauri::webview::PageLoadEvent::Started) {
                    net_state_for_page_load.clear();
                }
            })
            // Registered once, applies to every navigation AND every frame —
            // including cross-origin `<iframe>`s, which is how most video-embed
            // sites (Streamtape/Doodstream/mixdrop-style players, etc.) actually
            // host their `<video>` element. `webview.eval()` on page-load-finished
            // (the previous approach) only ever runs in the top-level frame, so any
            // site whose player lives in an iframe never got a download button at
            // all — this is the fix for that. Runs at document-created time (before
            // the page's own scripts), so `inject.js`'s reliance on `document`
            // always existing (even pre-body) is required and already the case: it
            // falls back to `document.documentElement` for the MutationObserver and
            // an empty initial `scan()` is harmless since the observer catches
            // everything added afterwards.
            .initialization_script_for_all_frames(INJECT_JS)
            // The download-overlay content script hands media URLs back to Rust by
            // `fetch()`-ing the `pitflix-browse` custom scheme (see `inject.js` +
            // `handle_download_protocol`). On Windows/Android that scheme is served
            // as `http(s)://pitflix-browse.localhost/...`; `https` avoids mixed-
            // content blocking when the embedded page itself is https.
            .use_https_scheme(true);

    let webview = main
        .add_child(
            builder,
            LogicalPosition::new(x, y),
            LogicalSize::new(width.max(1.0), height.max(1.0)),
        )
        .map_err(|e| format!("Failed to create browse webview: {e}"))?;

    network::install(&webview, net_state.inner().clone());

    *state.0.lock().map_err(|e| e.to_string())? = Some(webview);

    Ok(BROWSE_LABEL.to_string())
}

#[tauri::command]
pub fn browse_navigate(state: State<'_, BrowseWebviewState>, url: String) -> Result<(), String> {
    let parsed = parse_and_check(&url)?;
    let guard = state.0.lock().map_err(|e| e.to_string())?;
    let wv = guard
        .as_ref()
        .ok_or_else(|| "Browse webview is not open.".to_string())?;
    wv.navigate(parsed).map_err(|e| e.to_string())
}

#[tauri::command]
pub fn browse_resize(
    state: State<'_, BrowseWebviewState>,
    x: f64,
    y: f64,
    width: f64,
    height: f64,
) -> Result<(), String> {
    let guard = state.0.lock().map_err(|e| e.to_string())?;
    let wv = guard
        .as_ref()
        .ok_or_else(|| "Browse webview is not open.".to_string())?;
    wv.set_bounds(Rect {
        position: Position::Logical(LogicalPosition::new(x, y)),
        size: Size::Logical(LogicalSize::new(width.max(1.0), height.max(1.0))),
    })
    .map_err(|e| e.to_string())
}

/// Returns the current tab's network-detected HLS/DASH manifests, most
/// recent first (see `network::install`). Used by the frontend as a
/// fallback source for the per-video download button when the video
/// element's own `src`/script-scraping resolution comes up empty.
#[tauri::command]
pub fn browse_get_detected_media(
    net_state: State<'_, NetworkState>,
) -> Result<Vec<DetectedMedia>, String> {
    Ok(net_state.snapshot())
}

/// Enables/disables network-level (sub-resource) ad blocking independently
/// of the always-on Phase 1 cosmetic hiding and navigation guard, in case a
/// specific site breaks under it.
#[tauri::command]
pub fn browse_set_ad_block_enabled(
    net_state: State<'_, NetworkState>,
    enabled: bool,
) -> Result<(), String> {
    net_state.set_ad_block_enabled(enabled);
    Ok(())
}

#[derive(serde::Serialize)]
pub struct AdBlockStats {
    enabled: bool,
    #[serde(rename = "blockedCount")]
    blocked_count: u64,
}

#[tauri::command]
pub fn browse_get_ad_block_stats(
    net_state: State<'_, NetworkState>,
) -> Result<AdBlockStats, String> {
    Ok(AdBlockStats {
        enabled: net_state.is_ad_block_enabled(),
        blocked_count: net_state.blocked_count(),
    })
}

#[tauri::command]
pub fn browse_close(state: State<'_, BrowseWebviewState>) -> Result<(), String> {
    let mut guard = state.0.lock().map_err(|e| e.to_string())?;
    if let Some(wv) = guard.take() {
        wv.close().map_err(|e| e.to_string())?;
    }
    Ok(())
}

#[derive(Debug, Deserialize)]
struct DownloadRequestPayload {
    url: String,
    #[serde(rename = "type")]
    media_type: String,
    #[serde(rename = "pageUrl")]
    page_url: String,
}

/// Handler for the `pitflix-browse` custom URI scheme, registered on the
/// `tauri::Builder` (not on any one webview's ACL/capability set — see the
/// module docs on why). This is the ONLY channel the embedded, untrusted
/// external page has back into the app: it deliberately does NOT go through
/// Tauri's `invoke()`/command-permission system, because that system's
/// remote-origin allowlisting (`capabilities[].remote.urls`) would have to
/// match every domain the user might browse to, which would hand arbitrary
/// websites the ability to invoke real Tauri commands. A custom protocol
/// intercepted at the WebView2 level has no such reach — it can only ever
/// resolve to this one hardcoded handler, which does nothing but re-emit a
/// scoped event.
///
/// `inject.js`'s download button `fetch()`es
/// `https://pitflix-browse.localhost/download` with a JSON body; this parses
/// it and re-emits `browse-download-request` to the main window for
/// `BrowsePage` to pick up and forward to the Pitflix.API download endpoint.
///
/// `inject.js` also `fetch()`es `https://pitflix-browse.localhost/detected-media`
/// (GET) as the last-resort fallback in its video-source resolution chain —
/// this is the only way the untrusted embedded page can read the Phase 2
/// network-detected manifest cache (`network::NetworkState`), since it has
/// no access to `invoke()`/Tauri commands (see the doc above on why).
pub fn handle_download_protocol(
    ctx: tauri::UriSchemeContext<'_, Wry>,
    request: tauri::http::Request<Vec<u8>>,
) -> tauri::http::Response<Vec<u8>> {
    let respond = |status: u16| {
        tauri::http::Response::builder()
            .status(status)
            .header("Access-Control-Allow-Origin", "*")
            .body(Vec::new())
            .unwrap_or_else(|_| tauri::http::Response::new(Vec::new()))
    };

    match request.uri().path().trim_start_matches('/') {
        "detected-media" => {
            let snapshot = ctx.app_handle().state::<NetworkState>().snapshot();
            let body = serde_json::to_vec(&snapshot).unwrap_or_default();
            tauri::http::Response::builder()
                .status(200)
                .header("Access-Control-Allow-Origin", "*")
                .header("Content-Type", "application/json")
                .body(body)
                .unwrap_or_else(|_| tauri::http::Response::new(Vec::new()))
        }
        "download" => {
            let Ok(payload) = serde_json::from_slice::<DownloadRequestPayload>(request.body())
            else {
                return respond(400);
            };
            if payload.url.trim().is_empty() {
                return respond(400);
            }

            let _ = ctx.app_handle().emit(
                "browse-download-request",
                serde_json::json!({
                  "url": payload.url,
                  "type": payload.media_type,
                  "pageUrl": payload.page_url,
                }),
            );

            respond(204)
        }
        _ => respond(404),
    }
}
