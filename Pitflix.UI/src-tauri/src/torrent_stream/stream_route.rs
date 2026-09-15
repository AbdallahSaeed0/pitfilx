use std::io::SeekFrom;
use std::path::Path as FsPath;
use std::sync::Arc;

use axum::body::Body;
use axum::extract::{Path, State};
use axum::http::{header, HeaderMap, HeaderValue, StatusCode};
use axum::response::{IntoResponse, Response};
use axum::routing::get;
use axum::Router;
use librqbit::api::TorrentIdOrHash;
use librqbit::Session;
use tokio::io::{AsyncReadExt, AsyncSeekExt};

pub fn router(session: Arc<Session>) -> Router {
    Router::new()
        .route("/health", get(|| async { "ok" }))
        .route("/stream/{hash}/{file_id}", get(stream).head(stream))
        .with_state(session)
}

async fn stream(
    State(session): State<Arc<Session>>,
    Path((hash, file_id)): Path<(String, usize)>,
    headers: HeaderMap,
) -> Response {
    let Ok(id) = TorrentIdOrHash::parse(&hash) else {
        return (StatusCode::BAD_REQUEST, "Invalid torrent hash.").into_response();
    };
    let Some(handle) = session.get(id) else {
        return (StatusCode::NOT_FOUND, "Torrent is not active.").into_response();
    };

    let content_type = handle
        .with_metadata(|metadata| {
            metadata
                .file_infos
                .get(file_id)
                .map(|file| content_type_for(&file.relative_filename))
        })
        .ok()
        .flatten()
        .unwrap_or("application/octet-stream");
    let mut reader = match handle.stream(file_id) {
        Ok(reader) => reader,
        Err(error) => return (StatusCode::NOT_FOUND, format!("{error:#}")).into_response(),
    };
    let length = reader.len();

    let requested = headers
        .get(header::RANGE)
        .and_then(|value| value.to_str().ok())
        .and_then(parse_range);
    let (status, start, end_exclusive) = match requested {
        Some((start, end)) => {
            let Some(end_exclusive) = end
                .map(|value| value.checked_add(1))
                .unwrap_or(Some(length))
            else {
                return (StatusCode::RANGE_NOT_SATISFIABLE, "Invalid byte range.").into_response();
            };
            if start >= length || end_exclusive > length || end_exclusive <= start {
                return (StatusCode::RANGE_NOT_SATISFIABLE, "Invalid byte range.").into_response();
            }
            (StatusCode::PARTIAL_CONTENT, start, end_exclusive)
        }
        None => (StatusCode::OK, 0, length),
    };

    if start > 0 && reader.seek(SeekFrom::Start(start)).await.is_err() {
        return (StatusCode::INTERNAL_SERVER_ERROR, "Torrent seek failed.").into_response();
    }

    let response_length = end_exclusive - start;
    let mut response_headers = HeaderMap::new();
    response_headers.insert(header::ACCEPT_RANGES, HeaderValue::from_static("bytes"));
    response_headers.insert(header::CONTENT_TYPE, HeaderValue::from_static(content_type));
    response_headers.insert(
        header::CONTENT_LENGTH,
        HeaderValue::from_str(&response_length.to_string()).unwrap(),
    );
    if status == StatusCode::PARTIAL_CONTENT {
        response_headers.insert(
            header::CONTENT_RANGE,
            HeaderValue::from_str(&format!("bytes {}-{}/{}", start, end_exclusive - 1, length))
                .unwrap(),
        );
    }

    let body = Body::from_stream(tokio_util::io::ReaderStream::with_capacity(
        reader.take(response_length),
        64 * 1024,
    ));
    (status, response_headers, body).into_response()
}

fn parse_range(raw: &str) -> Option<(u64, Option<u64>)> {
    let range = raw.trim().strip_prefix("bytes=")?;
    let (start, end) = range.split_once('-')?;
    let start = start.trim().parse().ok()?;
    let end = if end.trim().is_empty() {
        None
    } else {
        Some(end.trim().parse().ok()?)
    };
    Some((start, end))
}

fn content_type_for(path: &FsPath) -> &'static str {
    match path
        .extension()
        .and_then(|extension| extension.to_str())
        .unwrap_or("")
        .to_ascii_lowercase()
        .as_str()
    {
        "mp4" | "m4v" => "video/mp4",
        "mkv" => "video/x-matroska",
        "webm" => "video/webm",
        "avi" => "video/x-msvideo",
        "mov" => "video/quicktime",
        "ts" | "m2ts" | "mts" => "video/mp2t",
        _ => "application/octet-stream",
    }
}

#[cfg(test)]
mod tests {
    use super::{content_type_for, parse_range};
    use std::path::Path;

    #[test]
    fn parses_bounded_and_open_byte_ranges() {
        assert_eq!(parse_range("bytes=0-499"), Some((0, Some(499))));
        assert_eq!(parse_range("bytes=500-"), Some((500, None)));
        assert_eq!(parse_range("items=0-10"), None);
    }

    #[test]
    fn maps_common_video_content_types() {
        assert_eq!(content_type_for(Path::new("movie.mkv")), "video/x-matroska");
        assert_eq!(content_type_for(Path::new("movie.MP4")), "video/mp4");
        assert_eq!(
            content_type_for(Path::new("unknown.bin")),
            "application/octet-stream"
        );
    }
}
