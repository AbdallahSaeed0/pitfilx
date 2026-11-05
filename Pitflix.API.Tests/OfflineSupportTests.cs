using System.IO.Compression;
using System.Net;
using System.Text;
using Microsoft.Extensions.Logging.Abstractions;
using Pitflix.API.Services;
using Pitflix.Core.Net;
using Xunit;

namespace Pitflix.API.Tests;

/// <summary>NetworkStatus is process-wide, so everything touching it runs serially in this collection.</summary>
[CollectionDefinition("NetworkStatus", DisableParallelization = true)]
public sealed class NetworkStatusCollection { }

[Collection("NetworkStatus")]
public sealed class PersistentHttpCacheHandlerTests : IDisposable
{
    private readonly string _dir = Path.Combine(Path.GetTempPath(), "pitflix-test-" + Guid.NewGuid().ToString("N"));

    public PersistentHttpCacheHandlerTests()
    {
        Directory.CreateDirectory(_dir);
        NetworkStatus.SetForcedOffline(false);
        NetworkStatus.ReportSuccess();
    }

    public void Dispose()
    {
        NetworkStatus.SetForcedOffline(false);
        NetworkStatus.ReportSuccess();
        Microsoft.Data.Sqlite.SqliteConnection.ClearAllPools();
        try { Directory.Delete(_dir, true); } catch { }
    }

    private sealed class FakeInner : HttpMessageHandler
    {
        public int Calls;
        public Func<HttpRequestMessage, HttpResponseMessage> Respond = _ =>
            new HttpResponseMessage(HttpStatusCode.OK) { Content = new StringContent("{\"v\":1}", Encoding.UTF8, "application/json") };

        protected override Task<HttpResponseMessage> SendAsync(HttpRequestMessage request, CancellationToken ct)
        {
            Calls++;
            return Task.FromResult(Respond(request));
        }
    }

    private (HttpClient Client, FakeInner Inner) Make(TimeSpan freshFor)
    {
        var inner = new FakeInner();
        var handler = new PersistentHttpCacheHandler(inner, Path.Combine(_dir, "cache.db"), "api.themoviedb.org",
            freshFor, TimeSpan.FromSeconds(5));
        return (new HttpClient(handler), inner);
    }

    [Fact]
    public void KeyFor_strips_api_key_anywhere_in_query()
    {
        Assert.Equal("https://api.themoviedb.org/3/tv/1?language=en-US",
            PersistentHttpCacheHandler.KeyFor(new Uri("https://api.themoviedb.org/3/tv/1?api_key=SECRET&language=en-US")));
        Assert.Equal("https://api.themoviedb.org/3/tv/1?language=en-US",
            PersistentHttpCacheHandler.KeyFor(new Uri("https://api.themoviedb.org/3/tv/1?language=en-US&api_key=SECRET")));
        Assert.Equal("https://api.themoviedb.org/3/tv/1",
            PersistentHttpCacheHandler.KeyFor(new Uri("https://api.themoviedb.org/3/tv/1?api_key=SECRET")));
    }

    [Fact]
    public async Task Fresh_response_is_served_from_disk_without_network()
    {
        var (client, inner) = Make(TimeSpan.FromHours(1));
        Assert.Equal("{\"v\":1}", await client.GetStringAsync("https://api.themoviedb.org/3/tv/1?api_key=a"));
        Assert.Equal("{\"v\":1}", await client.GetStringAsync("https://api.themoviedb.org/3/tv/1?api_key=b"));
        Assert.Equal(1, inner.Calls);
    }

    [Fact]
    public async Task Offline_serves_saved_response_and_fails_fast_when_none()
    {
        var (client, inner) = Make(TimeSpan.Zero); // never "fresh": would always go to network when online
        await client.GetStringAsync("https://api.themoviedb.org/3/tv/2?api_key=a");

        NetworkStatus.SetForcedOffline(true);
        Assert.Equal("{\"v\":1}", await client.GetStringAsync("https://api.themoviedb.org/3/tv/2?api_key=a"));
        await Assert.ThrowsAsync<HttpRequestException>(() => client.GetStringAsync("https://api.themoviedb.org/3/tv/3?api_key=a"));
        Assert.Equal(1, inner.Calls);
    }

    [Fact]
    public async Task Network_failure_falls_back_to_saved_response_and_marks_offline()
    {
        var (client, inner) = Make(TimeSpan.Zero);
        await client.GetStringAsync("https://api.themoviedb.org/3/tv/4?api_key=a");

        inner.Respond = _ => throw new HttpRequestException("no route");
        Assert.Equal("{\"v\":1}", await client.GetStringAsync("https://api.themoviedb.org/3/tv/4?api_key=a"));
        Assert.True(NetworkStatus.DetectedOffline);
    }

    [Fact]
    public async Task NotFound_is_saved_too_so_offline_answers_the_same()
    {
        var (client, inner) = Make(TimeSpan.Zero);
        inner.Respond = _ => new HttpResponseMessage(HttpStatusCode.NotFound) { Content = new StringContent("{}") };
        var first = await client.GetAsync("https://api.themoviedb.org/3/tv/5?api_key=a");
        NetworkStatus.SetForcedOffline(true);
        var second = await client.GetAsync("https://api.themoviedb.org/3/tv/5?api_key=a");
        Assert.Equal(HttpStatusCode.NotFound, first.StatusCode);
        Assert.Equal(HttpStatusCode.NotFound, second.StatusCode);
    }

    [Fact]
    public async Task Other_hosts_pass_straight_through()
    {
        var (client, inner) = Make(TimeSpan.FromHours(1));
        await client.GetStringAsync("https://example.org/a");
        await client.GetStringAsync("https://example.org/a");
        Assert.Equal(2, inner.Calls);
    }
}

[Collection("NetworkStatus")]
public sealed class OfflineGateHandlerTests : IDisposable
{
    public OfflineGateHandlerTests() => NetworkStatus.SetForcedOffline(false);
    public void Dispose() => NetworkStatus.SetForcedOffline(false);

    private sealed class OkInner : HttpMessageHandler
    {
        public int Calls;
        protected override Task<HttpResponseMessage> SendAsync(HttpRequestMessage r, CancellationToken ct)
        {
            Calls++;
            return Task.FromResult(new HttpResponseMessage(HttpStatusCode.OK));
        }
    }

    [Fact]
    public async Task Forced_offline_blocks_internet_but_not_loopback()
    {
        var inner = new OkInner();
        var client = new HttpClient(new OfflineGateHandler(inner));
        NetworkStatus.SetForcedOffline(true);

        await Assert.ThrowsAsync<HttpRequestException>(() => client.GetAsync("https://www.omdbapi.com/?i=tt1"));
        Assert.Equal(HttpStatusCode.OK, (await client.GetAsync("http://127.0.0.1:5280/api/movies")).StatusCode);
        Assert.Equal(HttpStatusCode.OK, (await client.GetAsync("http://localhost:5280/api/movies")).StatusCode);
        Assert.Equal(2, inner.Calls);
    }
}

public sealed class ImdbDatasetServiceTests : IDisposable
{
    private readonly string _dir = Path.Combine(Path.GetTempPath(), "pitflix-imdb-" + Guid.NewGuid().ToString("N"));

    public ImdbDatasetServiceTests() => Directory.CreateDirectory(_dir);

    public void Dispose()
    {
        Microsoft.Data.Sqlite.SqliteConnection.ClearAllPools();
        try { Directory.Delete(_dir, true); } catch { }
    }

    private string Gz(string name, string content)
    {
        var path = Path.Combine(_dir, name);
        using var fs = File.Create(path);
        using var gz = new GZipStream(fs, CompressionLevel.Fastest);
        gz.Write(Encoding.UTF8.GetBytes(content));
        return path;
    }

    [Fact]
    public void Build_joins_episodes_with_ratings_and_answers_lookups()
    {
        var ratings = Gz("r.tsv.gz",
            "tconst\taverageRating\tnumVotes\n" +
            "tt0000101\t8.4\t1200\n" +   // S1E1
            "tt0000102\t7.2\t555\n" +    // S1E2
            "tt0000999\t9.0\t10\n");     // the show itself — not an episode
        var episodes = Gz("e.tsv.gz",
            "tconst\tparentTconst\tseasonNumber\tepisodeNumber\n" +
            "tt0000101\ttt0000999\t1\t1\n" +
            "tt0000102\ttt0000999\t1\t2\n" +
            "tt0000103\ttt0000999\t1\t3\n" +  // no rating yet → absent
            "tt0000104\ttt0000999\t\\N\t\\N\n");

        var svc = new ImdbDatasetService(null!, NullLogger<ImdbDatasetService>.Instance, _dir);
        svc.Build(ratings, episodes, CancellationToken.None);

        Assert.True(svc.IsAvailable);
        Assert.Equal(8.4, svc.GetEpisodeRating("tt0000999", 1, 1));
        Assert.Equal(7.2, svc.GetEpisodeRating("tt0000999", 1, 2));
        Assert.Null(svc.GetEpisodeRating("tt0000999", 1, 3));
        Assert.Null(svc.GetEpisodeRating("tt0000999", 2, 1));
        Assert.Equal(2, svc.GetSeasonRatings("tt0000999", 1).Count);
        Assert.Equal(7.8, svc.GetSeasonAverage("tt0000999", 1));
    }

    [Theory]
    [InlineData("tt0944947", 944947)]
    [InlineData("tt33502693", 33502693)]
    [InlineData("nm0000001", 0)]
    [InlineData("", 0)]
    [InlineData(null, 0)]
    public void ParseTconst(string? input, int expected) =>
        Assert.Equal(expected, ImdbDatasetService.ParseTconst(input));
}
