mod stream_route;

use std::collections::{HashMap, HashSet};
use std::net::SocketAddr;
use std::sync::atomic::{AtomicBool, Ordering};
use std::sync::{Arc, OnceLock};
use std::time::{Duration, Instant};

use librqbit::api::TorrentIdOrHash;
use librqbit::{
    AddTorrent, AddTorrentOptions, PeerConnectionOptions, Session, SessionOptions,
    SessionPersistenceConfig,
};
use serde::Serialize;
use tauri::{AppHandle, Manager};
use tokio::io::AsyncReadExt;
use tokio::net::TcpListener;
use tokio::sync::Mutex;
use tokio::time::timeout;

struct EngineState {
    session: Option<Arc<Session>>,
    port: Option<u16>,
    server: Option<tokio::task::JoinHandle<()>>,
    cancellations: HashMap<String, Arc<AtomicBool>>,
}

fn engine() -> &'static Mutex<EngineState> {
    static ENGINE: OnceLock<Mutex<EngineState>> = OnceLock::new();
    ENGINE.get_or_init(|| {
        Mutex::new(EngineState {
            session: None,
            port: None,
            server: None,
            cancellations: HashMap::new(),
        })
    })
}

#[derive(Serialize)]
#[serde(rename_all = "camelCase")]
pub struct TorrentStreamResult {
    url: String,
    info_hash: String,
    file_index: usize,
    filename: String,
    size: u64,
}

#[derive(Serialize)]
#[serde(rename_all = "camelCase")]
pub struct TorrentStreamStatus {
    active: bool,
    state: String,
    progress_bytes: u64,
    total_bytes: u64,
    progress_percent: f64,
    download_speed_mibps: f64,
    upload_speed_mibps: f64,
    peers_live: usize,
    peers_seen: usize,
    finished: bool,
    error: Option<String>,
}

impl TorrentStreamStatus {
    fn inactive(state: &str) -> Self {
        Self {
            active: false,
            state: state.to_string(),
            progress_bytes: 0,
            total_bytes: 0,
            progress_percent: 0.0,
            download_speed_mibps: 0.0,
            upload_speed_mibps: 0.0,
            peers_live: 0,
            peers_seen: 0,
            finished: false,
            error: None,
        }
    }
}

async fn ensure_session(app: &AppHandle) -> Result<(Arc<Session>, u16), String> {
    let mut state = engine().lock().await;
    if let (Some(session), Some(port)) = (&state.session, state.port) {
        return Ok((session.clone(), port));
    }

    let cache_dir = app
        .path()
        .app_cache_dir()
        .map_err(|e| e.to_string())?
        .join("torrent-streams");
    std::fs::create_dir_all(&cache_dir).map_err(|e| e.to_string())?;

    let session = Session::new_with_opts(
        cache_dir.clone(),
        SessionOptions {
            fastresume: true,
            persistence: Some(SessionPersistenceConfig::Json {
                folder: Some(cache_dir.clone()),
            }),
            listen_port_range: Some(16881..16931),
            enable_upnp_port_forwarding: true,
            ..Default::default()
        },
    )
    .await
    .map_err(|e| format!("Could not initialize torrent engine: {e:#}"))?;

    let listener = TcpListener::bind(SocketAddr::from(([127, 0, 0, 1], 0)))
        .await
        .map_err(|e| format!("Could not start local stream server: {e}"))?;
    let port = listener.local_addr().map_err(|e| e.to_string())?.port();
    let router = stream_route::router(session.clone());
    let server = tokio::spawn(async move {
        if let Err(error) = axum::serve(listener, router).await {
            eprintln!("[torrent-stream] local server failed: {error}");
        }
    });

    eprintln!("[torrent-stream] ready at http://127.0.0.1:{port}");
    state.session = Some(session.clone());
    state.port = Some(port);
    state.server = Some(server);
    Ok((session, port))
}

fn normalize_hash(raw: &str) -> Result<String, String> {
    let hash = raw.trim().to_ascii_lowercase();
    if hash.len() != 40 || !hash.bytes().all(|b| b.is_ascii_hexdigit()) {
        return Err("Torrent stream requires a 40-character hexadecimal info hash.".to_string());
    }
    Ok(hash)
}

#[tauri::command]
pub async fn torrent_stream_start(
    app: AppHandle,
    info_hash: String,
    file_index: Option<usize>,
    trackers: Vec<String>,
) -> Result<TorrentStreamResult, String> {
    let hash = normalize_hash(&info_hash)?;
    let (session, port) = ensure_session(&app).await?;
    let id = TorrentIdOrHash::parse(&hash).map_err(|e| e.to_string())?;
    let cancelled = Arc::new(AtomicBool::new(false));
    {
        let mut state = engine().lock().await;
        if let Some(previous) = state.cancellations.insert(hash.clone(), cancelled.clone()) {
            previous.store(true, Ordering::Relaxed);
        }
    }

    let result: Result<TorrentStreamResult, String> = async {
        let handle = match session.get(id) {
            Some(existing) => existing,
            None => {
                let magnet = format!("magnet:?xt=urn:btih:{hash}");
                let opts = AddTorrentOptions {
                    overwrite: true,
                    paused: true,
                    only_files: file_index.map(|idx| vec![idx]),
                    trackers: (!trackers.is_empty()).then_some(trackers),
                    peer_opts: Some(PeerConnectionOptions {
                        connect_timeout: Some(Duration::from_secs(8)),
                        read_write_timeout: Some(Duration::from_secs(15)),
                        keep_alive_interval: None,
                    }),
                    ..Default::default()
                };
                let added = timeout(
                    Duration::from_secs(75),
                    session.add_torrent(AddTorrent::from_url(&magnet), Some(opts)),
                )
                .await
                .map_err(|_| {
                    "Torrent metadata timed out. Try a result with more seeders.".to_string()
                })?
                .map_err(|e| format!("Could not add torrent: {e:#}"))?;
                added
                    .into_handle()
                    .ok_or_else(|| "Torrent engine returned no playable handle.".to_string())?
            }
        };
        ensure_not_cancelled(&cancelled)?;

        timeout(Duration::from_secs(45), handle.wait_until_initialized())
            .await
            .map_err(|_| "Torrent initialization timed out.".to_string())?
            .map_err(|e| format!("Torrent initialization failed: {e:#}"))?;
        ensure_not_cancelled(&cancelled)?;

        let files = handle
            .with_metadata(|metadata| {
                metadata
                    .file_infos
                    .iter()
                    .enumerate()
                    .map(|(index, file)| {
                        (
                            index,
                            file.relative_filename.to_string_lossy().to_string(),
                            file.len,
                        )
                    })
                    .collect::<Vec<_>>()
            })
            .map_err(|e| format!("Could not read torrent files: {e:#}"))?;
        if files.is_empty() {
            return Err("Torrent contains no files.".to_string());
        }

        let selected = file_index
            .and_then(|index| files.iter().find(|file| file.0 == index))
            .or_else(|| files.iter().max_by_key(|file| file.2))
            .ok_or_else(|| "Could not select a playable torrent file.".to_string())?;
        let selected_index = selected.0;
        let filename = selected.1.clone();
        let size = selected.2;

        let only = HashSet::from([selected_index]);
        session
            .update_only_files(&handle, &only)
            .await
            .map_err(|e| format!("Could not select torrent file: {e:#}"))?;
        session
            .unpause(&handle)
            .await
            .map_err(|e| format!("Could not start torrent: {e:#}"))?;

        prebuffer_and_check(&handle, selected_index, size, &cancelled).await?;

        Ok(TorrentStreamResult {
            url: format!("http://127.0.0.1:{port}/stream/{hash}/{selected_index}"),
            info_hash: hash.clone(),
            file_index: selected_index,
            filename,
            size,
        })
    }
    .await;

    {
        let mut state = engine().lock().await;
        if state
            .cancellations
            .get(&hash)
            .is_some_and(|current| Arc::ptr_eq(current, &cancelled))
        {
            state.cancellations.remove(&hash);
        }
    }
    if result.is_err() {
        let _ = session.delete(id, true).await;
    }
    result
}

fn ensure_not_cancelled(cancelled: &AtomicBool) -> Result<(), String> {
    if cancelled.load(Ordering::Relaxed) {
        Err("Stream preparation cancelled.".to_string())
    } else {
        Ok(())
    }
}

async fn prebuffer_and_check(
    handle: &Arc<librqbit::ManagedTorrent>,
    file_index: usize,
    file_size: u64,
    cancelled: &AtomicBool,
) -> Result<(), String> {
    const PREBUFFER_BYTES: u64 = 16 * 1024 * 1024;
    const PREBUFFER_TIMEOUT: Duration = Duration::from_secs(35);

    let target = file_size.min(PREBUFFER_BYTES);
    let mut reader = handle
        .clone()
        .stream(file_index)
        .map_err(|e| format!("Could not prepare torrent stream: {e:#}"))?;
    let started = Instant::now();
    let mut buffered = 0_u64;
    let mut chunk = vec![0_u8; 256 * 1024];

    while buffered < target {
        ensure_not_cancelled(cancelled)?;
        if started.elapsed() >= PREBUFFER_TIMEOUT {
            return Err(
                "This torrent is too slow to stream. Try another result with more seeders."
                    .to_string(),
            );
        }

        let wanted = ((target - buffered) as usize).min(chunk.len());
        let read = match timeout(Duration::from_secs(1), reader.read(&mut chunk[..wanted])).await {
            Ok(Ok(read)) => read,
            Ok(Err(error)) => return Err(format!("Torrent prebuffer failed: {error}")),
            Err(_) => continue,
        };
        if read == 0 {
            return Err("Torrent ended before a playable buffer was ready.".to_string());
        }
        buffered += read as u64;
    }

    let elapsed = started.elapsed().as_secs_f64().max(0.001);
    let measured_mibps = buffered as f64 / (1024.0 * 1024.0) / elapsed;
    let required_mibps = if file_size >= 20 * 1024 * 1024 * 1024 {
        4.0
    } else if file_size >= 8 * 1024 * 1024 * 1024 {
        2.0
    } else {
        0.75
    };
    if measured_mibps < required_mibps {
        return Err(format!(
            "This torrent is too slow to stream ({measured_mibps:.2} MiB/s; at least {required_mibps:.2} MiB/s recommended). Try another result."
        ));
    }
    Ok(())
}

#[tauri::command]
pub async fn torrent_stream_stop(info_hash: String, delete_files: bool) -> Result<(), String> {
    let hash = normalize_hash(&info_hash)?;
    let (session, cancellation) = {
        let mut state = engine().lock().await;
        (state.session.clone(), state.cancellations.remove(&hash))
    };
    if let Some(cancellation) = cancellation {
        cancellation.store(true, Ordering::Relaxed);
    }
    let Some(session) = session else {
        return Ok(());
    };
    let id = TorrentIdOrHash::parse(&hash).map_err(|e| e.to_string())?;
    if session.get(id).is_some() {
        session
            .delete(id, delete_files)
            .await
            .map_err(|e| format!("Could not remove torrent: {e:#}"))?;
    }
    Ok(())
}

#[tauri::command]
pub async fn torrent_stream_status(info_hash: String) -> Result<TorrentStreamStatus, String> {
    let hash = normalize_hash(&info_hash)?;
    let session = {
        let state = engine().lock().await;
        state.session.clone()
    };
    let Some(session) = session else {
        return Ok(TorrentStreamStatus::inactive("starting"));
    };
    let id = TorrentIdOrHash::parse(&hash).map_err(|e| e.to_string())?;
    let Some(handle) = session.get(id) else {
        return Ok(TorrentStreamStatus::inactive("finding_metadata"));
    };

    let stats = handle.stats();
    let (download_speed_mibps, upload_speed_mibps, peers_live, peers_seen) =
        stats.live.as_ref().map_or((0.0, 0.0, 0, 0), |live| {
            (
                live.download_speed.mbps,
                live.upload_speed.mbps,
                live.snapshot.peer_stats.live,
                live.snapshot.peer_stats.seen,
            )
        });
    let progress_percent = if stats.total_bytes > 0 {
        (stats.progress_bytes as f64 / stats.total_bytes as f64 * 100.0).clamp(0.0, 100.0)
    } else {
        0.0
    };

    Ok(TorrentStreamStatus {
        active: true,
        state: stats.state.to_string(),
        progress_bytes: stats.progress_bytes,
        total_bytes: stats.total_bytes,
        progress_percent,
        download_speed_mibps,
        upload_speed_mibps,
        peers_live,
        peers_seen,
        finished: stats.finished,
        error: stats.error,
    })
}

pub fn stop() {
    if let Ok(mut state) = engine().try_lock() {
        if let Some(server) = state.server.take() {
            server.abort();
        }
        state.session = None;
        state.port = None;
        for cancellation in state.cancellations.drain().map(|(_, value)| value) {
            cancellation.store(true, Ordering::Relaxed);
        }
    }
}

#[cfg(test)]
mod tests {
    use super::normalize_hash;

    #[test]
    fn validates_and_normalizes_info_hashes() {
        let upper = "0123456789ABCDEF0123456789ABCDEF01234567";
        assert_eq!(
            normalize_hash(upper).unwrap(),
            "0123456789abcdef0123456789abcdef01234567"
        );
        assert!(normalize_hash("not-a-hash").is_err());
    }
}
