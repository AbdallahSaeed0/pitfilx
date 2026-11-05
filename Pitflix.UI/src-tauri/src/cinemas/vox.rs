//! VOX Cinemas Egypt. The window opens on today's showtimes; `vox_scrape.js`
//! reports today, then fetches coming soon, now showing and every other date
//! from inside the page in parallel (~1–2s on top of the first page load).
//! Each report is forwarded to the frontend as it arrives
//! (`cinemas-vox-partial`) so the page fills in progressively. Anything the
//! in-page fetch couldn't get is retried by navigating to it directly.

use std::collections::BTreeMap;
use std::time::Duration;

use serde_json::{json, Value};
use tauri::{AppHandle, Emitter, Manager, State, Url, WebviewUrl, WebviewWindow, WebviewWindowBuilder, Wry};
use tokio::sync::mpsc;

use super::{now_ms, wait_for, CinemaScrapeState};

pub(super) const LABEL: &str = "cinema-scraper";
const ORIGIN: &str = "https://egy.voxcinemas.com";
const SCRIPT: &str = include_str!("vox_scrape.js");
/// First page load. Generous because the bot-protection script can add a
/// round trip before the real page is served.
const PAGE_TIMEOUT: Duration = Duration::from_secs(45);
/// The in-page parallel crawl after the first page.
const CRAWL_TIMEOUT: Duration = Duration::from_secs(60);

/// Scrapes VOX Cinemas Egypt and returns
/// `{ cinema, fetchedAt, comingSoon, nowShowing, days: [{ date, movies }], failedDates }`.
/// Emits `cinemas-vox-partial` `{ kind, data }` per page and
/// `cinemas-refresh-progress` `{ done, total }` as it goes.
#[tauri::command]
pub async fn cinemas_fetch_vox(
    app: AppHandle,
    state: State<'_, CinemaScrapeState>,
) -> Result<Value, String> {
    let _running = state
        .vox_running
        .try_lock()
        .map_err(|_| "A VOX refresh is already running.".to_string())?;

    let (tx, mut rx) = mpsc::unbounded_channel();
    *state.vox_reports.lock().map_err(|e| e.to_string())? = Some(tx);

    let result = scrape(&app, &mut rx).await;

    if let Ok(mut reports) = state.vox_reports.lock() {
        *reports = None;
    }
    if let Some(window) = app.get_webview_window(LABEL) {
        let _ = window.destroy();
    }
    result
}

fn vox_url(path_and_query: &str) -> Result<Url, String> {
    Url::parse(&format!("{ORIGIN}{path_and_query}")).map_err(|e| e.to_string())
}

fn navigate(window: &WebviewWindow<Wry>, path_and_query: &str) -> Result<(), String> {
    window.navigate(vox_url(path_and_query)?).map_err(|e| e.to_string())
}

#[derive(Default)]
struct Collected {
    coming_soon: Option<Value>,
    now_showing: Option<Value>,
    days: BTreeMap<String, Value>,
}

impl Collected {
    /// Stores a page report and forwards it to the frontend. Returns false for
    /// reports that aren't page data (`done`, `unknown`, …).
    fn absorb(&mut self, app: &AppHandle, mut report: Value) -> bool {
        let kind = report["kind"].as_str().unwrap_or_default().to_string();
        let data = report["data"].take();
        match kind.as_str() {
            "comingSoon" => self.coming_soon = Some(data.clone()),
            "nowShowing" => self.now_showing = Some(data.clone()),
            "showtimes" => {
                let Some(date) = data["date"].as_str().map(str::to_string) else {
                    return false;
                };
                self.days.insert(date, data["movies"].clone());
            }
            _ => return false,
        }
        let _ = app.emit("cinemas-vox-partial", json!({ "kind": kind, "data": data }));
        true
    }
}

async fn scrape(app: &AppHandle, rx: &mut mpsc::UnboundedReceiver<Value>) -> Result<Value, String> {
    // A window left over from a refresh that crashed mid-way.
    if let Some(window) = app.get_webview_window(LABEL) {
        let _ = window.destroy();
    }

    let window = WebviewWindowBuilder::new(app, LABEL, WebviewUrl::External(vox_url("/showtimes")?))
        .title("Pitflix cinema refresh")
        .visible(false)
        .focused(false)
        .skip_taskbar(true)
        .on_navigation(|url| {
            url.host_str()
                .is_some_and(|h| h == "voxcinemas.com" || h.ends_with(".voxcinemas.com"))
        })
        .initialization_script(SCRIPT)
        // Serves the custom scheme as `https://pitflix-cinemas.localhost` so the
        // https VOX page can fetch it without mixed-content blocking.
        .use_https_scheme(true)
        .build()
        .map_err(|e| format!("Failed to open the cinema webview: {e}"))?;

    let progress = |done: usize, total: usize| {
        let _ = app.emit("cinemas-refresh-progress", json!({ "done": done, "total": total }));
    };
    progress(0, 1);

    let mut collected = Collected::default();

    // Today's page comes first and tells us which other dates exist.
    let today = wait_for(rx, "showtimes", PAGE_TIMEOUT, |_| true).await?;
    let today_date = today["date"].as_str().unwrap_or_default().to_string();
    let other_dates: Vec<String> = today["dates"]
        .as_array()
        .map(|dates| {
            dates
                .iter()
                .filter_map(|d| d["date"].as_str())
                .filter(|d| *d != today_date)
                .map(str::to_string)
                .collect()
        })
        .unwrap_or_default();
    let total = 3 + other_dates.len();
    collected.absorb(app, json!({ "kind": "showtimes", "data": today }));
    progress(1, total);

    // Then everything else, in whatever order the parallel fetches finish.
    // The script's `done` report lists what it couldn't fetch, but the gaps are
    // recomputed from what actually arrived, which also covers a timeout.
    let deadline = tokio::time::Instant::now() + CRAWL_TIMEOUT;
    loop {
        let Ok(Some(report)) = tokio::time::timeout_at(deadline, rx.recv()).await else {
            break; // timed out: whatever's missing gets the navigation fallback below
        };
        match report["kind"].as_str() {
            Some("done") | Some("error") => break,
            _ => {
                if collected.absorb(app, report) {
                    let done = collected.days.len()
                        + usize::from(collected.coming_soon.is_some())
                        + usize::from(collected.now_showing.is_some());
                    progress(done, total);
                }
            }
        }
    }
    // Fallback: navigate to anything still missing, one page at a time.
    let any = |_: &Value| true;
    if collected.coming_soon.is_none() {
        if navigate(&window, "/movies/comingsoon").is_ok() {
            if let Ok(data) = wait_for(rx, "comingSoon", PAGE_TIMEOUT, any).await {
                collected.absorb(app, json!({ "kind": "comingSoon", "data": data }));
            }
        }
    }
    if collected.now_showing.is_none() {
        if navigate(&window, "/movies/whatson").is_ok() {
            if let Ok(data) = wait_for(rx, "nowShowing", PAGE_TIMEOUT, any).await {
                collected.absorb(app, json!({ "kind": "nowShowing", "data": data }));
            }
        }
    }
    let mut failed_dates = Vec::new();
    let missing: Vec<&String> = other_dates.iter().filter(|d| !collected.days.contains_key(*d)).collect();
    for date in missing {
        let day = match navigate(&window, &format!("/showtimes?d={}", date.replace('-', ""))) {
            Ok(()) => wait_for(rx, "showtimes", PAGE_TIMEOUT, |d| d["date"].as_str() == Some(date)).await,
            Err(e) => Err(e),
        };
        match day {
            Ok(day) => {
                collected.absorb(app, json!({ "kind": "showtimes", "data": day }));
            }
            // One slow date shouldn't throw away the rest of the schedule.
            Err(_) => failed_dates.push(date.clone()),
        }
    }
    progress(total, total);

    let any_movies = collected
        .days
        .values()
        .any(|movies| movies.as_array().is_some_and(|m| !m.is_empty()))
        || collected.now_showing.as_ref().and_then(Value::as_array).is_some_and(|m| !m.is_empty());
    if !any_movies {
        // Pages loaded but nothing parsed: don't hand back an empty schedule as if it were real.
        return Err("Site layout changed: VOX's pages loaded but no movies could be read.".into());
    }

    let days: Vec<Value> = collected
        .days
        .into_iter()
        .map(|(date, movies)| json!({ "date": date, "movies": movies }))
        .collect();

    Ok(json!({
        "cinema": "vox",
        "fetchedAt": now_ms(),
        // null = couldn't be read this time; the app keeps its previous copy.
        "comingSoon": collected.coming_soon,
        "nowShowing": collected.now_showing,
        "days": days,
        "failedDates": failed_dates,
    }))
}
