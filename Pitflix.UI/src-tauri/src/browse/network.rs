//! Network-level request interception for the Browse child webview (Phase 2).
//!
//! Phase 1 (`blocklist.rs`) only ever sees top-level navigation/popup URLs.
//! This module hooks WebView2's `ICoreWebView2::WebResourceRequested` event
//! (via `AddWebResourceRequestedFilter`) to observe every sub-resource
//! request the embedded page makes, which enables two things additive to
//! Phase 1:
//!
//!   1. Passive HLS/DASH manifest detection — used as a last-resort fallback
//!      by the download button when script-scraping (`inject.js`) finds
//!      nothing (e.g. the page's own player builds the manifest URL in a way
//!      that isn't visible in any inline script).
//!   2. True sub-resource ad/tracker blocking — cancelling the request
//!      itself, rather than Phase 1's cosmetic `display:none` hiding or its
//!      navigation-level guard (which can't see e.g. an ad iframe's own
//!      sub-requests).
//!
//! ## Step 0 API survey (see the Phase 2 task write-up)
//!
//! `wry` 0.55 doesn't expose `WebResourceRequested` through its safe public
//! API. Tauri's `Webview::with_webview` hands back a `PlatformWebview` whose
//! Windows-only `.controller()` returns the raw `ICoreWebView2Controller`
//! (from `webview2-com`, already resolved transitively through wry at
//! 0.38.2 — pinned here as a direct dependency for the same version so the
//! event-handler macros are usable without duplicating COM bindings).
//! `.CoreWebView2()` on that controller yields the `ICoreWebView2` needed for
//! `AddWebResourceRequestedFilter` / `add_WebResourceRequested`, and
//! `PlatformWebview::environment()` yields the `ICoreWebView2Environment`
//! needed for `CreateWebResourceResponse` (the blocking response). No
//! approximation was needed; this is the same pattern `wry` itself uses
//! internally for its custom-protocol handler (see
//! `wry::webview2::attach_custom_protocol_handler`).

use std::collections::VecDeque;
use std::sync::atomic::{AtomicBool, AtomicU64, Ordering};
use std::sync::{Arc, Mutex};
use std::time::{SystemTime, UNIX_EPOCH};

use serde::Serialize;
#[cfg(windows)]
use tauri::{Url, Webview, Wry};
#[cfg(not(windows))]
use tauri::{Webview, Wry};
#[cfg(windows)]
use webview2_com::Microsoft::Web::WebView2::Win32::{
    ICoreWebView2, ICoreWebView2Environment, ICoreWebView2WebResourceRequestedEventArgs,
    COREWEBVIEW2_WEB_RESOURCE_CONTEXT_ALL, COREWEBVIEW2_WEB_RESOURCE_CONTEXT_DOCUMENT,
};
#[cfg(windows)]
use webview2_com::{take_pwstr, WebResourceRequestedEventHandler};
#[cfg(windows)]
use windows::core::{HSTRING, PWSTR};
#[cfg(windows)]
use windows::Win32::System::Com::IStream;

#[cfg(windows)]
use super::blocklist;

/// Max manifests retained per tab; oldest evicted first once the current tab
/// navigates or this cap is hit. Only one tab exists today (see the
/// `browse` module docs) but the cache is still cleared per-navigation so it
/// never carries stale entries from a previous page into a new one.
const MAX_DETECTED: usize = 5;

#[derive(Clone, Serialize)]
pub struct DetectedMedia {
    pub url: String,
    #[serde(rename = "type")]
    pub media_type: &'static str, // "hls" | "dash"
    #[serde(rename = "detectedAt")]
    pub detected_at_ms: u64,
    #[serde(rename = "pageUrl")]
    pub page_url: String,
}

struct Inner {
    detected: Mutex<VecDeque<DetectedMedia>>,
    blocked_count: AtomicU64,
    ad_block_enabled: AtomicBool,
}

impl Default for Inner {
    fn default() -> Self {
        Self {
            detected: Mutex::new(VecDeque::new()),
            blocked_count: AtomicU64::new(0),
            // Network-level ad blocking defaults to on; the frontend toggle can
            // flip this off per-session if a specific site breaks under it.
            ad_block_enabled: AtomicBool::new(true),
        }
    }
}

#[derive(Clone, Default)]
pub struct NetworkState(Arc<Inner>);

impl NetworkState {
    fn now_ms() -> u64 {
        SystemTime::now()
            .duration_since(UNIX_EPOCH)
            .map(|d| d.as_millis() as u64)
            .unwrap_or(0)
    }

    /// Clears the detected-manifest cache. Call this on every top-level
    /// navigation so manifests from the previous page never leak into the
    /// next one's fallback resolution.
    pub fn clear(&self) {
        self.0.detected.lock().unwrap().clear();
    }

    fn record_manifest(&self, url: String, media_type: &'static str, page_url: String) {
        let mut guard = self.0.detected.lock().unwrap();
        if guard.iter().any(|m| m.url == url) {
            return;
        }
        guard.push_front(DetectedMedia {
            url,
            media_type,
            detected_at_ms: Self::now_ms(),
            page_url,
        });
        while guard.len() > MAX_DETECTED {
            guard.pop_back();
        }
    }

    pub fn snapshot(&self) -> Vec<DetectedMedia> {
        self.0.detected.lock().unwrap().iter().cloned().collect()
    }

    pub fn blocked_count(&self) -> u64 {
        self.0.blocked_count.load(Ordering::Relaxed)
    }

    fn record_blocked(&self) {
        self.0.blocked_count.fetch_add(1, Ordering::Relaxed);
    }

    pub fn is_ad_block_enabled(&self) -> bool {
        self.0.ad_block_enabled.load(Ordering::Relaxed)
    }

    pub fn set_ad_block_enabled(&self, enabled: bool) {
        self.0.ad_block_enabled.store(enabled, Ordering::Relaxed);
    }
}

/// Classifies a request URI as an HLS or DASH manifest by extension,
/// ignoring any fragment. Query strings are fine to include (many CDNs sign
/// manifest URLs with a token in the query).
fn classify_manifest(uri: &str) -> Option<&'static str> {
    let lower = uri.split('#').next().unwrap_or(uri).to_lowercase();
    if lower.contains(".m3u8") {
        Some("hls")
    } else if lower.contains(".mpd") {
        Some("dash")
    } else {
        None
    }
}

#[cfg(windows)]
unsafe fn read_pwstr_prop(
    f: impl FnOnce(*mut PWSTR) -> windows::core::Result<()>,
) -> Option<String> {
    let mut ptr = PWSTR::null();
    f(&mut ptr).ok()?;
    Some(take_pwstr(ptr))
}

#[cfg(windows)]
unsafe fn block_response(
    environment: &ICoreWebView2Environment,
    args: &ICoreWebView2WebResourceRequestedEventArgs,
) -> windows::core::Result<()> {
    let response = environment.CreateWebResourceResponse(
        None::<&IStream>,
        403,
        &HSTRING::from("Blocked"),
        &HSTRING::from(""),
    )?;
    args.SetResponse(&response)
}

#[cfg(windows)]
unsafe fn handle_request(
    args: &ICoreWebView2WebResourceRequestedEventArgs,
    core: &ICoreWebView2,
    environment: &ICoreWebView2Environment,
    state: &NetworkState,
) {
    let Ok(request) = args.Request() else { return };
    let Some(uri) = read_pwstr_prop(|p| request.Uri(p)) else {
        return;
    };
    if uri.is_empty() {
        return;
    }

    if state.is_ad_block_enabled() {
        let host = Url::parse(&uri)
            .ok()
            .and_then(|u| u.host_str().map(str::to_lowercase));
        if let Some(host) = host {
            if blocklist::is_blocked(&host) {
                let mut context = COREWEBVIEW2_WEB_RESOURCE_CONTEXT_ALL;
                // Sub-resources only — top-level navigation to a blocked domain is
                // already denied by the Phase 1 `on_navigation` guard, and blocking
                // it again here would just produce a confusing blank error page
                // instead of the navigation simply never happening.
                let is_document = args.ResourceContext(&mut context).is_ok()
                    && context == COREWEBVIEW2_WEB_RESOURCE_CONTEXT_DOCUMENT;
                if !is_document && block_response(environment, args).is_ok() {
                    state.record_blocked();
                    return;
                }
            }
        }
    }

    if let Some(media_type) = classify_manifest(&uri) {
        let page_url = read_pwstr_prop(|p| core.Source(p)).unwrap_or_default();
        state.record_manifest(uri, media_type, page_url);
    }
}

/// Registers the `WebResourceRequested` observer on `webview`'s underlying
/// `ICoreWebView2`. Must be called once, right after the webview is created
/// (see `browse_open`). Errors are logged and otherwise swallowed — a failed
/// install just means Phase 2 features silently don't activate, Phase 1's
/// cosmetic hiding and nav guard still apply.
///
/// Windows-only: this is a WebView2 COM API. On other platforms (Android)
/// this is a no-op — Phase 2 detection/blocking simply isn't available
/// there yet, matching the module's existing Windows-first scope.
#[cfg(not(windows))]
pub fn install(_webview: &Webview<Wry>, _state: NetworkState) {}

#[cfg(windows)]
pub fn install(webview: &Webview<Wry>, state: NetworkState) {
    let result = webview.with_webview(move |platform_webview| unsafe {
        let controller = platform_webview.controller();
        let environment = platform_webview.environment();
        let core = match controller.CoreWebView2() {
            Ok(c) => c,
            Err(e) => {
                eprintln!("[browse-net] CoreWebView2() failed: {e:?}");
                return;
            }
        };

        if let Err(e) = core.AddWebResourceRequestedFilter(
            &HSTRING::from("*"),
            COREWEBVIEW2_WEB_RESOURCE_CONTEXT_ALL,
        ) {
            eprintln!("[browse-net] AddWebResourceRequestedFilter failed: {e:?}");
            return;
        }

        let core_for_handler = core.clone();
        let state_for_handler = state.clone();
        let handler = WebResourceRequestedEventHandler::create(Box::new(move |_sender, args| {
            if let Some(args) = args {
                handle_request(&args, &core_for_handler, &environment, &state_for_handler);
            }
            Ok(())
        }));

        let mut token: i64 = 0;
        if let Err(e) = core.add_WebResourceRequested(&handler, &mut token) {
            eprintln!("[browse-net] add_WebResourceRequested failed: {e:?}");
        }
    });

    if let Err(e) = result {
        eprintln!("[browse-net] install() dispatch failed: {e}");
    }
}
