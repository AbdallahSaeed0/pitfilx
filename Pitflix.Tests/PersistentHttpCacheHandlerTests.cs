using System.Diagnostics;
using System.Net;
using Pitflix.Core.Net;
using Xunit;

namespace Pitflix.Tests;

public class PersistentHttpCacheHandlerTests
{
    /// <summary>Slow fake TMDB: answers "v1", "v2", ... after a delay, counting calls.</summary>
    private sealed class SlowCountingHandler(TimeSpan delay) : HttpMessageHandler
    {
        private int _calls;
        public int Calls => Volatile.Read(ref _calls);

        protected override async Task<HttpResponseMessage> SendAsync(HttpRequestMessage request, CancellationToken ct)
        {
            var n = Interlocked.Increment(ref _calls);
            await Task.Delay(delay, ct);
            return new HttpResponseMessage(HttpStatusCode.OK) { Content = new StringContent($"v{n}") };
        }
    }

    [Fact]
    public async Task Stale_saved_answer_is_served_immediately_and_refreshed_in_the_background()
    {
        var dbPath = Path.Combine(Path.GetTempPath(), $"pf-cache-test-{Guid.NewGuid():N}.db");
        var slow = new SlowCountingHandler(TimeSpan.FromMilliseconds(800));
        var cache = new PersistentHttpCacheHandler(slow, dbPath, "api.themoviedb.org",
            freshFor: TimeSpan.FromMilliseconds(50), networkTimeout: TimeSpan.FromSeconds(10));
        using var http = new HttpClient(cache);
        const string url = "https://api.themoviedb.org/3/movie/19913?api_key=x";
        NetworkStatus.SetForcedOffline(false);
        NetworkStatus.ReportSuccess();

        // Nothing saved yet: this one has to wait for the network.
        Assert.Equal("v1", await http.GetStringAsync(url));
        await Task.Delay(150); // now older than freshFor

        // Stale: answered from disk without waiting for the 800 ms network call...
        var sw = Stopwatch.StartNew();
        Assert.Equal("v1", await http.GetStringAsync(url));
        Assert.True(sw.ElapsedMilliseconds < 400, $"stale read took {sw.ElapsedMilliseconds} ms");

        // ...while a background refresh fetches and saves the newer answer for next time.
        var deadline = DateTime.UtcNow.AddSeconds(5);
        string latest;
        do
        {
            await Task.Delay(100);
            latest = await http.GetStringAsync(url);
        } while (latest == "v1" && DateTime.UtcNow < deadline);
        Assert.StartsWith("v", latest);
        Assert.NotEqual("v1", latest);
    }
}
