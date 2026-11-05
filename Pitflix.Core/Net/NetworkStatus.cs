using System.Net.NetworkInformation;

namespace Pitflix.Core.Net;

/// <summary>
/// Process-wide "can we reach the internet?" state. Offline is either forced (Settings → Offline
/// mode) or detected: a failed outbound call (<see cref="ReportFailure"/>) marks us offline until a
/// probe or a later successful call (<see cref="ReportSuccess"/>) says otherwise. While offline,
/// network-backed services serve saved data immediately instead of waiting on timeouts.
/// </summary>
public static class NetworkStatus
{
    private static readonly HttpClient ProbeHttp = new(PitflixHttp.CreateHandler()) { Timeout = TimeSpan.FromSeconds(4) };
    private static readonly SemaphoreSlim ProbeGate = new(1, 1);
    private static volatile bool _forcedOffline;
    private static volatile bool _detectedOffline;
    private static DateTime _lastProbeUtc = DateTime.MinValue;

    /// <summary>After a detected outage, re-probe at most this often (probes run on demand, not on a timer).</summary>
    private static readonly TimeSpan ReprobeInterval = TimeSpan.FromSeconds(20);

    static NetworkStatus()
    {
        try
        {
            NetworkChange.NetworkAvailabilityChanged += (_, e) =>
            {
                _detectedOffline = !e.IsAvailable;
                _lastProbeUtc = DateTime.MinValue;
                Changed?.Invoke();
            };
        }
        catch { /* not supported on this platform — rely on failures/probes */ }
    }

    /// <summary>Raised when <see cref="IsOffline"/> may have changed.</summary>
    public static event Action? Changed;

    public static bool ForcedOffline => _forcedOffline;
    public static bool DetectedOffline => _detectedOffline;
    public static bool IsOffline => _forcedOffline || _detectedOffline;

    public static void SetForcedOffline(bool value)
    {
        if (_forcedOffline == value) return;
        _forcedOffline = value;
        Changed?.Invoke();
    }

    /// <summary>An outbound call failed at the network level (DNS, connect, timeout) — not an HTTP error status.</summary>
    public static void ReportFailure()
    {
        if (_detectedOffline) return;
        _detectedOffline = true;
        _lastProbeUtc = DateTime.UtcNow;
        Changed?.Invoke();
    }

    public static void ReportSuccess()
    {
        if (!_detectedOffline) return;
        _detectedOffline = false;
        Changed?.Invoke();
    }

    /// <summary>
    /// When offline was only detected (not forced), re-checks connectivity if the last check is stale.
    /// Cheap to call on every request: it no-ops unless a re-probe is due. Pass a shorter
    /// <paramref name="minInterval"/> when the caller has nothing saved to fall back on, so one stray
    /// timeout elsewhere doesn't fail it outright for the full <see cref="ReprobeInterval"/>.
    /// </summary>
    public static async Task<bool> RefreshIfDueAsync(CancellationToken ct = default, TimeSpan? minInterval = null)
    {
        if (_forcedOffline) return true;
        if (!_detectedOffline || DateTime.UtcNow - _lastProbeUtc < (minInterval ?? ReprobeInterval)) return _detectedOffline;
        if (!await ProbeGate.WaitAsync(0, ct).ConfigureAwait(false)) return _detectedOffline;
        try
        {
            _lastProbeUtc = DateTime.UtcNow;
            if (await ProbeAsync(ct).ConfigureAwait(false)) ReportSuccess();
            return _detectedOffline;
        }
        finally
        {
            ProbeGate.Release();
        }
    }

    /// <summary>True when TMDB's API host answers at all (any HTTP status counts as reachable).</summary>
    public static async Task<bool> ProbeAsync(CancellationToken ct = default)
    {
        try
        {
            using var req = new HttpRequestMessage(HttpMethod.Head, "https://api.themoviedb.org/3/configuration");
            using var resp = await ProbeHttp.SendAsync(req, ct).ConfigureAwait(false);
            return true;
        }
        catch
        {
            return false;
        }
    }
}
