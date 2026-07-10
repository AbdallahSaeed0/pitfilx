namespace Pitflix.API.Services.Browse;

/// <summary>Body of <c>POST /api/browse/download</c> — a single media URL surfaced by the
/// Browse tab's content-script download overlay (see Pitflix.UI's <c>inject.js</c>).
/// <c>Type</c> is <c>"image"</c>, <c>"video"</c> (direct file), or <c>"hls"</c> (an .m3u8
/// manifest that needs remuxing — see <see cref="BrowseDownloadJobTracker"/>).</summary>
public sealed record BrowseDownloadRequest(string? Url, string? Type, string? PageUrl);

/// <summary>Every download (image, direct video, or HLS remux) now runs as a background job —
/// this always returns immediately with <c>Pending=true</c> and a <c>JobId</c> to poll via
/// <c>GET /api/browse/download/{jobId}/status</c>, or cancel via
/// <c>POST /api/browse/download/{jobId}/cancel</c>. <c>Success=false</c> with no <c>JobId</c>
/// means the request was rejected before a job could even start (bad URL, ffmpeg missing, etc).</summary>
public sealed record BrowseDownloadResult(bool Success, string? SavedPath = null, bool Pending = false,
    string? JobId = null);

public sealed record BrowseDownloadJobStatusResult(
    string Status,
    string? SavedPath,
    string? Error,
    double? ProgressPercent,
    long? BytesDone,
    long? BytesTotal);
