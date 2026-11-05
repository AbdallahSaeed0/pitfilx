//! "Cinemas Schedule" page data sources: VOX Cinemas Egypt and Premiere Cinemas.
//!
//! Both are read from their public websites through hidden WebView2 windows:
//! - VOX sits behind bot protection that stalls every non-browser HTTP client
//!   (curl, reqwest-style clients, .NET `HttpClient` all hang with zero bytes).
//! - Premiere deliberately encrypts its showtime API responses, so times are
//!   read from the page the way a visitor sees them (clicking through the
//!   cinema → date → format → experience pickers).
//!
//! An injected script per site reads the rendered DOM and hands it back
//! through the `pitflix-cinemas` custom scheme — the same no-`invoke()` channel
//! the Browse tab uses for untrusted pages (see `browse::handle_download_protocol`).

pub mod premiere;
pub mod vox;

use std::sync::Mutex;
use std::time::{Duration, SystemTime, UNIX_EPOCH};

use serde_json::Value;
use tauri::{Manager, Wry};
use tokio::sync::mpsc;

#[derive(Default)]
pub struct CinemaScrapeState {
    /// Set only while a VOX refresh runs; reports are dropped otherwise.
    vox_reports: Mutex<Option<mpsc::UnboundedSender<Value>>>,
    vox_running: tokio::sync::Mutex<()>,
    /// Hidden Premiere windows that run listing/showtime jobs side by side.
    premiere: premiere::PremierePool,
}

fn now_ms() -> u64 {
    SystemTime::now()
        .duration_since(UNIX_EPOCH)
        .map(|d| d.as_millis() as u64)
        .unwrap_or_default()
}

/// Waits for a report of `kind` whose `data` satisfies `accept`. Reports for
/// other pages — a late one from the previous page, or a bot-check
/// interstitial before the real page — are skipped.
async fn wait_for(
    rx: &mut mpsc::UnboundedReceiver<Value>,
    kind: &str,
    timeout: Duration,
    accept: impl Fn(&Value) -> bool,
) -> Result<Value, String> {
    let deadline = tokio::time::Instant::now() + timeout;
    loop {
        let mut report = tokio::time::timeout_at(deadline, rx.recv())
            .await
            .map_err(|_| format!("Cinema page timed out ({kind})."))?
            .ok_or_else(|| "Cinema refresh was cancelled.".to_string())?;
        match report["kind"].as_str() {
            Some("error") => {
                return Err(format!(
                    "Could not read the cinema page: {}",
                    report["data"].as_str().unwrap_or("unknown error")
                ))
            }
            Some(k) if k == kind && accept(&report["data"]) => return Ok(report["data"].take()),
            _ => {}
        }
    }
}

/// Handler for the `pitflix-cinemas` custom URI scheme. Only accepts reports
/// from the scraper windows, and only while they're expected.
pub fn handle_cinemas_protocol(
    ctx: tauri::UriSchemeContext<'_, Wry>,
    request: tauri::http::Request<Vec<u8>>,
) -> tauri::http::Response<Vec<u8>> {
    let state = ctx.app_handle().state::<CinemaScrapeState>();
    let label = ctx.webview_label();
    let channel = if label == vox::LABEL {
        Some(&state.vox_reports)
    } else {
        state.premiere.reports_for(label)
    };
    let status = match channel {
        _ if request.uri().path() != "/report" => 404,
        None => 403,
        Some(channel) => match serde_json::from_slice::<Value>(request.body()) {
            Ok(report) => {
                if let Ok(tx) = channel.lock() {
                    if let Some(tx) = tx.as_ref() {
                        let _ = tx.send(report);
                    }
                }
                204
            }
            Err(_) => 400,
        },
    };
    tauri::http::Response::builder()
        .status(status)
        .header("Access-Control-Allow-Origin", "*")
        .body(Vec::new())
        .unwrap_or_else(|_| tauri::http::Response::new(Vec::new()))
}
