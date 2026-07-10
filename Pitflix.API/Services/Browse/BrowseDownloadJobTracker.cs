using System.Collections.Concurrent;

namespace Pitflix.API.Services.Browse;

public enum BrowseDownloadJobState { Running, Succeeded, Failed, Cancelled }

/// <summary>
/// In-memory status board + cancellation registry for background Browse downloads (images,
/// direct video files, and HLS remuxes — see <see cref="BrowseDownloadService"/>). Every
/// download runs as a background job so the frontend can show progress and offer cancel,
/// regardless of type — the initial POST always returns immediately with a jobId.
///
/// There's no live Tauri connection available here to push events through (Pitflix.API is a
/// separate process from the Rust/Tauri shell with no handle back into it), so the frontend
/// polls <c>GET /api/browse/download/{jobId}/status</c> instead, and cancels via
/// <c>POST /api/browse/download/{jobId}/cancel</c>. Deliberately isolated (own dictionaries, no
/// shared state) and deliberately not persisted — a job list that resets on API restart is an
/// acceptable simplification for a single-user desktop app's one-off downloads.
/// </summary>
public sealed class BrowseDownloadJobTracker
{
    public sealed record JobStatus(
        BrowseDownloadJobState State,
        string? SavedPath,
        string? Error,
        DateTime CreatedAtUtc,
        double? ProgressPercent,
        long? BytesDone,
        long? BytesTotal);

    private readonly ConcurrentDictionary<string, JobStatus> _jobs = new();
    private readonly ConcurrentDictionary<string, CancellationTokenSource> _cancellation = new();
    private static readonly TimeSpan JobRetention = TimeSpan.FromHours(1);

    /// <summary>Registers a new job and returns its id plus a token that's cancelled when
    /// <see cref="RequestCancel"/> is called for that id — link this into whatever
    /// HttpClient/Process wait the download actually does.</summary>
    public (string JobId, CancellationToken Token) CreateJob()
    {
        PruneOldJobs();
        var id = Guid.NewGuid().ToString("N");
        _jobs[id] = new JobStatus(BrowseDownloadJobState.Running, null, null, DateTime.UtcNow, null, null, null);
        var cts = new CancellationTokenSource();
        _cancellation[id] = cts;
        return (id, cts.Token);
    }

    public void ReportProgress(string jobId, double? percent, long? bytesDone, long? bytesTotal) =>
        _jobs.AddOrUpdate(jobId,
            _ => new JobStatus(BrowseDownloadJobState.Running, null, null, DateTime.UtcNow, percent, bytesDone, bytesTotal),
            (_, existing) => existing with { ProgressPercent = percent, BytesDone = bytesDone, BytesTotal = bytesTotal });

    public void Complete(string jobId, string savedPath)
    {
        _jobs.AddOrUpdate(jobId,
            _ => new JobStatus(BrowseDownloadJobState.Succeeded, savedPath, null, DateTime.UtcNow, 100, null, null),
            (_, existing) => existing with { State = BrowseDownloadJobState.Succeeded, SavedPath = savedPath, ProgressPercent = 100 });
        _cancellation.TryRemove(jobId, out _);
    }

    public void Fail(string jobId, string? error)
    {
        _jobs.AddOrUpdate(jobId,
            _ => new JobStatus(BrowseDownloadJobState.Failed, null, error, DateTime.UtcNow, null, null, null),
            (_, existing) => existing with { State = BrowseDownloadJobState.Failed, Error = error });
        _cancellation.TryRemove(jobId, out _);
    }

    public void MarkCancelled(string jobId)
    {
        _jobs.AddOrUpdate(jobId,
            _ => new JobStatus(BrowseDownloadJobState.Cancelled, null, "Cancelled", DateTime.UtcNow, null, null, null),
            (_, existing) => existing with { State = BrowseDownloadJobState.Cancelled, Error = "Cancelled" });
        _cancellation.TryRemove(jobId, out _);
    }

    public JobStatus? Get(string jobId) => _jobs.TryGetValue(jobId, out var status) ? status : null;

    /// <summary>Signals cancellation for a still-running job. Returns false if the job doesn't
    /// exist or has already finished (nothing left to cancel).</summary>
    public bool RequestCancel(string jobId)
    {
        if (_cancellation.TryGetValue(jobId, out var cts))
        {
            cts.Cancel();
            return true;
        }
        return false;
    }

    private void PruneOldJobs()
    {
        var cutoff = DateTime.UtcNow - JobRetention;
        foreach (var kvp in _jobs)
        {
            if (kvp.Value.CreatedAtUtc < cutoff)
            {
                _jobs.TryRemove(kvp.Key, out _);
                _cancellation.TryRemove(kvp.Key, out _);
            }
        }
    }
}
