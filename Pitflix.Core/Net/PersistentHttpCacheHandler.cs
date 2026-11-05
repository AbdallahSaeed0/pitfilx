using System.Collections.Concurrent;
using System.IO.Compression;
using System.Net;
using System.Text.RegularExpressions;
using Microsoft.Data.Sqlite;

namespace Pitflix.Core.Net;

/// <summary>
/// Disk-backed cache for GET responses from one API host (TMDB). Every successful answer (and 404,
/// which TMDB uses for "no such item") is saved, so:
/// <list type="bullet">
/// <item>offline — or when the network call fails — the saved answer is served instead of an error;</item>
/// <item>answers younger than <c>freshFor</c> are served straight from disk, so pages are fast after an
/// API restart (TmdbClient's own memo caches are process-lifetime only);</item>
/// <item>older answers are ALSO served straight from disk (stale-while-revalidate) and refreshed in the
/// background for next time. Waiting on the network for them made every page whose saved data was
/// past <c>freshFor</c> — most of the cache, once it's a few days old — take seconds online while
/// the very same page opened instantly in offline mode.</item>
/// </list>
/// Only a request with nothing saved at all waits for the network.
/// The API key query parameter is stripped from cache keys, so changing the key keeps the cache.
/// </summary>
public sealed class PersistentHttpCacheHandler : DelegatingHandler
{
    private static readonly Regex ApiKeyParam = new(@"([?&])api_key=[^&]*&?", RegexOptions.Compiled | RegexOptions.IgnoreCase);

    private readonly string _host;
    private readonly string _connectionString;
    private readonly TimeSpan _freshFor;
    private readonly TimeSpan _networkTimeout;
    private readonly Lazy<bool> _ready;
    /// <summary>Keys with a background refresh in flight (one refresh per key at a time).</summary>
    private readonly ConcurrentDictionary<string, byte> _refreshing = new();
    /// <summary>Caps concurrent background refreshes: one page can turn up dozens of stale answers,
    /// and firing them all at once would trip TMDB's rate limit.</summary>
    private static readonly SemaphoreSlim RefreshGate = new(4);
    /// <summary>How soon a request with no saved answer re-probes connectivity after a detected outage.</summary>
    private static readonly TimeSpan UncachedReprobeInterval = TimeSpan.FromSeconds(3);

    public PersistentHttpCacheHandler(HttpMessageHandler inner, string dbPath, string host, TimeSpan freshFor,
        TimeSpan networkTimeout) : base(inner)
    {
        _host = host;
        _connectionString = new SqliteConnectionStringBuilder { DataSource = dbPath, DefaultTimeout = 15 }.ToString();
        _freshFor = freshFor;
        _networkTimeout = networkTimeout;
        _ready = new Lazy<bool>(() => Initialize(dbPath));
    }

    /// <summary>For IHttpClientFactory pipelines (<c>AddHttpMessageHandler</c>), which set the inner
    /// handler themselves and need a fresh instance per pipeline.</summary>
    public PersistentHttpCacheHandler(string dbPath, string host, TimeSpan freshFor, TimeSpan networkTimeout)
    {
        _host = host;
        _connectionString = new SqliteConnectionStringBuilder { DataSource = dbPath, DefaultTimeout = 15 }.ToString();
        _freshFor = freshFor;
        _networkTimeout = networkTimeout;
        _ready = new Lazy<bool>(() => Initialize(dbPath));
    }

    /// <summary>Cache key: the URL without its api_key parameter.</summary>
    public static string KeyFor(Uri uri)
    {
        var s = ApiKeyParam.Replace(uri.GetLeftPart(UriPartial.Path) + uri.Query, "$1");
        return s.TrimEnd('&', '?');
    }

    protected override async Task<HttpResponseMessage> SendAsync(HttpRequestMessage request, CancellationToken ct)
    {
        if (request.Method != HttpMethod.Get || request.RequestUri is null ||
            !string.Equals(request.RequestUri.Host, _host, StringComparison.OrdinalIgnoreCase) || !_ready.Value)
            return await base.SendAsync(request, ct).ConfigureAwait(false);

        var key = KeyFor(request.RequestUri);
        var cached = Read(key);
        if (cached is not null)
        {
            if (DateTime.UtcNow - cached.FetchedUtc >= _freshFor && !NetworkStatus.IsOffline)
                RefreshInBackground(request, key);
            return cached.ToResponse(request);
        }

        // Nothing saved to fall back on: a single timed-out call elsewhere (e.g. a background refresh)
        // flips "offline" for 20 s, which used to fail first-time pages like a person's filmography
        // outright while the internet was fine. Re-probe after just a few seconds instead.
        if (NetworkStatus.IsOffline &&
            await NetworkStatus.RefreshIfDueAsync(ct, UncachedReprobeInterval).ConfigureAwait(false))
            throw new HttpRequestException("Offline and no saved response for " + key);

        using var timeout = CancellationTokenSource.CreateLinkedTokenSource(ct);
        timeout.CancelAfter(_networkTimeout);
        HttpResponseMessage resp;
        try
        {
            resp = await base.SendAsync(request, timeout.Token).ConfigureAwait(false);
        }
        catch (Exception ex) when (ex is HttpRequestException || (ex is OperationCanceledException && !ct.IsCancellationRequested))
        {
            NetworkStatus.ReportFailure();
            return cached?.ToResponse(request) ?? throw new HttpRequestException("Network unavailable: " + ex.Message, ex);
        }

        NetworkStatus.ReportSuccess();
        if (resp.IsSuccessStatusCode || resp.StatusCode == HttpStatusCode.NotFound)
        {
            var body = await resp.Content.ReadAsByteArrayAsync(ct).ConfigureAwait(false);
            var entry = new Entry((int)resp.StatusCode, resp.Content.Headers.ContentType?.ToString(), body, DateTime.UtcNow);
            Write(key, entry);
            resp.Dispose();
            return entry.ToResponse(request);
        }

        // Rate limit / server error: a saved answer beats an error page.
        if (cached is not null)
        {
            resp.Dispose();
            return cached.ToResponse(request);
        }
        return resp;
    }

    /// <summary>
    /// Re-fetches a stale saved answer without anyone waiting on it. The caller's request is answered
    /// from disk and may be disposed meanwhile, so a fresh request is built from its URL and headers.
    /// </summary>
    private void RefreshInBackground(HttpRequestMessage original, string key)
    {
        if (!_refreshing.TryAdd(key, 0))
            return;
        var uri = original.RequestUri!;
        var headers = original.Headers.Select(h => (h.Key, Values: h.Value.ToArray())).ToList();
        _ = Task.Run(async () =>
        {
            await RefreshGate.WaitAsync().ConfigureAwait(false);
            try
            {
                using var req = new HttpRequestMessage(HttpMethod.Get, uri);
                foreach (var (name, values) in headers)
                    req.Headers.TryAddWithoutValidation(name, values);
                using var timeout = new CancellationTokenSource(_networkTimeout);
                using var resp = await base.SendAsync(req, timeout.Token).ConfigureAwait(false);
                NetworkStatus.ReportSuccess();
                if (resp.IsSuccessStatusCode || resp.StatusCode == HttpStatusCode.NotFound)
                {
                    var body = await resp.Content.ReadAsByteArrayAsync().ConfigureAwait(false);
                    Write(key, new Entry((int)resp.StatusCode, resp.Content.Headers.ContentType?.ToString(), body,
                        DateTime.UtcNow));
                }
            }
            catch (Exception ex) when (ex is HttpRequestException or OperationCanceledException)
            {
                NetworkStatus.ReportFailure(); // the saved copy stays; it was already served
            }
            catch
            {
                /* best-effort */
            }
            finally
            {
                RefreshGate.Release();
                _refreshing.TryRemove(key, out _);
            }
        });
    }

    /// <summary>Number of saved responses (for diagnostics).</summary>
    public long Count()
    {
        if (!_ready.Value) return 0;
        try
        {
            using var conn = Open();
            using var cmd = conn.CreateCommand();
            cmd.CommandText = "SELECT COUNT(*) FROM Responses";
            return (long)(cmd.ExecuteScalar() ?? 0L);
        }
        catch { return 0; }
    }

    private sealed record Entry(int Status, string? ContentType, byte[] Body, DateTime FetchedUtc)
    {
        public HttpResponseMessage ToResponse(HttpRequestMessage request)
        {
            var content = new ByteArrayContent(Body);
            if (!string.IsNullOrEmpty(ContentType))
                content.Headers.TryAddWithoutValidation("Content-Type", ContentType);
            return new HttpResponseMessage((HttpStatusCode)Status) { Content = content, RequestMessage = request };
        }
    }

    private SqliteConnection Open()
    {
        var conn = new SqliteConnection(_connectionString);
        conn.Open();
        return conn;
    }

    private bool Initialize(string dbPath)
    {
        try
        {
            Directory.CreateDirectory(Path.GetDirectoryName(dbPath)!);
            using var conn = Open();
            using var cmd = conn.CreateCommand();
            cmd.CommandText = """
                PRAGMA journal_mode=WAL;
                CREATE TABLE IF NOT EXISTS Responses (
                    Key          TEXT PRIMARY KEY,
                    Status       INTEGER NOT NULL,
                    ContentType  TEXT NULL,
                    Body         BLOB NOT NULL,
                    FetchedTicks INTEGER NOT NULL
                );
                DELETE FROM Responses WHERE FetchedTicks < $cutoff;
                """;
            cmd.Parameters.AddWithValue("$cutoff", DateTime.UtcNow.AddDays(-180).Ticks);
            cmd.ExecuteNonQuery();
            return true;
        }
        catch
        {
            return false; // cache unavailable — requests pass straight through
        }
    }

    private Entry? Read(string key)
    {
        try
        {
            using var conn = Open();
            using var cmd = conn.CreateCommand();
            cmd.CommandText = "SELECT Status, ContentType, Body, FetchedTicks FROM Responses WHERE Key = $k";
            cmd.Parameters.AddWithValue("$k", key);
            using var r = cmd.ExecuteReader();
            if (!r.Read()) return null;
            return new Entry(r.GetInt32(0), r.IsDBNull(1) ? null : r.GetString(1), Gunzip((byte[])r[2]),
                new DateTime(r.GetInt64(3), DateTimeKind.Utc));
        }
        catch { return null; }
    }

    private void Write(string key, Entry e)
    {
        try
        {
            using var conn = Open();
            using var cmd = conn.CreateCommand();
            cmd.CommandText = """
                INSERT INTO Responses (Key, Status, ContentType, Body, FetchedTicks) VALUES ($k, $s, $ct, $b, $t)
                ON CONFLICT(Key) DO UPDATE SET Status = excluded.Status, ContentType = excluded.ContentType,
                    Body = excluded.Body, FetchedTicks = excluded.FetchedTicks
                """;
            cmd.Parameters.AddWithValue("$k", key);
            cmd.Parameters.AddWithValue("$s", e.Status);
            cmd.Parameters.AddWithValue("$ct", (object?)e.ContentType ?? DBNull.Value);
            cmd.Parameters.AddWithValue("$b", Gzip(e.Body));
            cmd.Parameters.AddWithValue("$t", e.FetchedUtc.Ticks);
            cmd.ExecuteNonQuery();
        }
        catch { /* best-effort */ }
    }

    private static byte[] Gzip(byte[] data)
    {
        using var ms = new MemoryStream();
        using (var gz = new GZipStream(ms, CompressionLevel.Fastest, leaveOpen: true))
            gz.Write(data);
        return ms.ToArray();
    }

    private static byte[] Gunzip(byte[] data)
    {
        using var gz = new GZipStream(new MemoryStream(data), CompressionMode.Decompress);
        using var ms = new MemoryStream();
        gz.CopyTo(ms);
        return ms.ToArray();
    }
}
