using System.Net;

namespace Pitflix.Core.Net;

/// <summary>
/// Fails outbound requests immediately while <see cref="NetworkStatus.IsOffline"/> (instead of each one
/// waiting out its timeout), and feeds network-level failures back into <see cref="NetworkStatus"/>.
/// Loopback requests (Pitflix's own API, local torrent engine, …) always pass.
/// </summary>
public sealed class OfflineGateHandler : DelegatingHandler
{
    public OfflineGateHandler() { }
    public OfflineGateHandler(HttpMessageHandler inner) : base(inner) { }

    protected override async Task<HttpResponseMessage> SendAsync(HttpRequestMessage request, CancellationToken ct)
    {
        var uri = request.RequestUri;
        if (uri is null || IsLocal(uri))
            return await base.SendAsync(request, ct).ConfigureAwait(false);

        if (NetworkStatus.IsOffline && await NetworkStatus.RefreshIfDueAsync(ct).ConfigureAwait(false))
            throw new HttpRequestException($"Offline — skipped {uri.Host}");

        try
        {
            var resp = await base.SendAsync(request, ct).ConfigureAwait(false);
            NetworkStatus.ReportSuccess();
            return resp;
        }
        catch (HttpRequestException ex) when (ex.InnerException is System.Net.Sockets.SocketException)
        {
            // DNS / connect failure — the machine can't reach the internet.
            NetworkStatus.ReportFailure();
            throw;
        }
    }

    private static bool IsLocal(Uri uri) =>
        uri.IsLoopback || (IPAddress.TryParse(uri.Host.Trim('[', ']'), out var ip) && IPAddress.IsLoopback(ip));
}
