//! Premiere Cinemas. Listings come from a refresh (coming soon + now showing);
//! showtimes are fetched per movie + date, because each one means clicking
//! through the pickers (~6s per movie for all branches).
//!
//! Jobs run on a small pool of hidden windows, each its own copy of the
//! now-showing page, so up to [`POOL_SIZE`] movies load side by side without
//! the clicks of one interfering with another. Windows are kept alive between
//! jobs (so the next one doesn't pay for a page load) and closed after a few
//! idle minutes. Invariant: whenever a window exists and no job holds its
//! slot, it is on the now-showing page and has reported ready.

use std::sync::atomic::{AtomicU64, Ordering};
use std::sync::Mutex;
use std::time::Duration;

use serde_json::{json, Value};
use tauri::{AppHandle, Manager, State, Url, WebviewUrl, WebviewWindow, WebviewWindowBuilder, Wry};
use tokio::sync::{mpsc, Semaphore};

use super::{now_ms, wait_for, CinemaScrapeState};

pub(super) const LABEL_PREFIX: &str = "cinema-premiere-";
const POOL_SIZE: usize = 3;
const ORIGIN: &str = "https://www.premiere-cinemas.com";
const NOW_SHOWING: &str = "/en/now-showing";
const COMING_SOON: &str = "/en/coming-soon";
const SCRIPT: &str = include_str!("premiere_scrape.js");
const PAGE_TIMEOUT: Duration = Duration::from_secs(45);
/// A whole week at every branch is ~30s; leave room for a slow site.
const JOB_TIMEOUT: Duration = Duration::from_secs(150);
const IDLE_CLOSE: Duration = Duration::from_secs(3 * 60);

type ReceiverSlot = Option<mpsc::UnboundedReceiver<Value>>;

#[derive(Default)]
struct Slot {
    /// Set while this slot's window exists; the protocol handler sends its reports here.
    reports: Mutex<Option<mpsc::UnboundedSender<Value>>>,
    /// Holding this means owning the slot (and its window) for one job.
    rx: tokio::sync::Mutex<ReceiverSlot>,
    /// Bumped per job so the idle-close timer knows if it's stale.
    generation: AtomicU64,
}

pub struct PremierePool {
    slots: Vec<Slot>,
    /// One permit per slot: a job holding a permit is guaranteed a free slot.
    permits: Semaphore,
}

impl Default for PremierePool {
    fn default() -> Self {
        Self {
            slots: (0..POOL_SIZE).map(|_| Slot::default()).collect(),
            permits: Semaphore::new(POOL_SIZE),
        }
    }
}

impl PremierePool {
    /// The report channel for a scraper window label, if it's one of ours.
    pub(super) fn reports_for(&self, label: &str) -> Option<&Mutex<Option<mpsc::UnboundedSender<Value>>>> {
        let index: usize = label.strip_prefix(LABEL_PREFIX)?.parse().ok()?;
        self.slots.get(index).map(|s| &s.reports)
    }
}

fn label(index: usize) -> String {
    format!("{LABEL_PREFIX}{index}")
}

fn premiere_url(path: &str) -> Result<Url, String> {
    Url::parse(&format!("{ORIGIN}{path}")).map_err(|e| e.to_string())
}

fn close_window(app: &AppHandle, slot: &Slot, index: usize, rx: &mut ReceiverSlot) {
    if let Ok(mut tx) = slot.reports.lock() {
        *tx = None;
    }
    *rx = None;
    if let Some(window) = app.get_webview_window(&label(index)) {
        let _ = window.destroy();
    }
}

/// Returns the slot's live window, creating it at `start_path` if needed. The
/// bool is true when it was just created (its first page report is still coming).
fn ensure_window(
    app: &AppHandle,
    slot: &Slot,
    index: usize,
    rx: &mut ReceiverSlot,
    start_path: &str,
) -> Result<(WebviewWindow<Wry>, bool), String> {
    if rx.is_some() {
        if let Some(window) = app.get_webview_window(&label(index)) {
            return Ok((window, false));
        }
    }
    close_window(app, slot, index, rx);

    let (tx, new_rx) = mpsc::unbounded_channel();
    *slot.reports.lock().map_err(|e| e.to_string())? = Some(tx);
    *rx = Some(new_rx);

    let window = WebviewWindowBuilder::new(app, label(index), WebviewUrl::External(premiere_url(start_path)?))
        .title("Pitflix cinema refresh")
        .visible(false)
        .focused(false)
        .skip_taskbar(true)
        .on_navigation(|url| {
            url.host_str()
                .is_some_and(|h| h == "premiere-cinemas.com" || h.ends_with(".premiere-cinemas.com"))
        })
        .initialization_script(SCRIPT)
        .use_https_scheme(true)
        .build()
        .map_err(|e| format!("Failed to open the cinema webview: {e}"))?;
    Ok((window, true))
}

fn drain(rx: &mut mpsc::UnboundedReceiver<Value>) {
    while rx.try_recv().is_ok() {}
}

fn schedule_idle_close(app: &AppHandle, index: usize, generation: u64) {
    let app = app.clone();
    tauri::async_runtime::spawn(async move {
        tokio::time::sleep(IDLE_CLOSE).await;
        let state = app.state::<CinemaScrapeState>();
        let slot = &state.premiere.slots[index];
        if slot.generation.load(Ordering::SeqCst) != generation {
            return; // used again since; that job scheduled its own close
        }
        // Busy means a job just started; it schedules its own close.
        let Ok(mut rx) = slot.rx.try_lock() else {
            return;
        };
        close_window(&app, slot, index, &mut rx);
    });
}

/// Returns `{ cinema, fetchedAt, nowShowing, comingSoon }`.
#[tauri::command]
pub async fn cinemas_fetch_premiere(
    app: AppHandle,
    state: State<'_, CinemaScrapeState>,
) -> Result<Value, String> {
    let _permit = state.premiere.permits.acquire().await.map_err(|e| e.to_string())?;
    let (index, mut rx_slot) = take_free_slot(&state)?;
    let slot = &state.premiere.slots[index];
    let generation = slot.generation.fetch_add(1, Ordering::SeqCst) + 1;

    let result = async {
        let (window, created) = ensure_window(&app, slot, index, &mut rx_slot, COMING_SOON)?;
        let rx = rx_slot.as_mut().ok_or("Premiere window is not ready.")?;
        let any = |_: &Value| true;
        if !created {
            drain(rx);
            window.navigate(premiere_url(COMING_SOON)?).map_err(|e| e.to_string())?;
        }
        let coming_soon = wait_for(rx, "premiereComingSoon", PAGE_TIMEOUT, any).await?;
        // Now-showing last so the window is left where showtime jobs need it.
        window.navigate(premiere_url(NOW_SHOWING)?).map_err(|e| e.to_string())?;
        let now_showing = wait_for(rx, "premiereNowShowing", PAGE_TIMEOUT, any).await?;
        Ok::<_, String>(json!({
            "cinema": "premiere",
            "fetchedAt": now_ms(),
            "nowShowing": now_showing,
            "comingSoon": coming_soon,
        }))
    }
    .await;

    finish(&app, slot, index, &mut rx_slot, generation, &result);
    result
}

/// Showtimes for one movie on the given dates (`yyyy-mm-dd`), at every branch or
/// just `cinema`. One job walks all the dates under each branch, so a whole week
/// costs far less than a job per day. Returns
/// `{ movieId, fetchedAt, days: { "<date>": [{ name, formats: [{ name, times: [{ time }] }] }] } }`.
#[tauri::command]
pub async fn cinemas_premiere_showtimes(
    app: AppHandle,
    state: State<'_, CinemaScrapeState>,
    movie_id: String,
    dates: Vec<String>,
    cinema: Option<String>,
) -> Result<Value, String> {
    let _permit = state.premiere.permits.acquire().await.map_err(|e| e.to_string())?;
    let (index, mut rx_slot) = take_free_slot(&state)?;
    let slot = &state.premiere.slots[index];
    let generation = slot.generation.fetch_add(1, Ordering::SeqCst) + 1;

    let result = async {
        let (window, created) = ensure_window(&app, slot, index, &mut rx_slot, NOW_SHOWING)?;
        let rx = rx_slot.as_mut().ok_or("Premiere window is not ready.")?;
        if created {
            wait_for(rx, "premiereNowShowing", PAGE_TIMEOUT, |_| true).await?;
        }
        drain(rx);

        let job_id = format!("{index}-{generation}");
        let job = json!({ "jobId": job_id, "movieId": movie_id, "dates": dates, "cinema": cinema });
        window
            .eval(format!("window.__pitflixPremiere && window.__pitflixPremiere.crawl({job})"))
            .map_err(|e| e.to_string())?;
        let mut data = wait_for(rx, "premiereTimes", JOB_TIMEOUT, |d| {
            d["jobId"].as_str() == Some(job_id.as_str())
        })
        .await?;
        if let Some(error) = data["error"].as_str() {
            return Err(error.to_string());
        }
        Ok(json!({
            "movieId": movie_id,
            "fetchedAt": now_ms(),
            "days": data["days"].take(),
        }))
    }
    .await;

    finish(&app, slot, index, &mut rx_slot, generation, &result);
    result
}

/// With a permit held, at least one slot is free; take it.
fn take_free_slot(state: &CinemaScrapeState) -> Result<(usize, tokio::sync::MutexGuard<'_, ReceiverSlot>), String> {
    state
        .premiere
        .slots
        .iter()
        .enumerate()
        .find_map(|(i, s)| s.rx.try_lock().ok().map(|g| (i, g)))
        .ok_or_else(|| "No free Premiere window.".to_string())
}

/// Keeps a window that finished cleanly (closing it after a while idle);
/// closes one that failed, since its page state is unknown.
fn finish(
    app: &AppHandle,
    slot: &Slot,
    index: usize,
    rx: &mut ReceiverSlot,
    generation: u64,
    result: &Result<Value, String>,
) {
    match result {
        Ok(_) => schedule_idle_close(app, index, generation),
        Err(_) => close_window(app, slot, index, rx),
    }
}
