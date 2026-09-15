using System.Net;
using System.Text;
using Pitflix.API.Services;
using Xunit;

namespace Pitflix.API.Tests;

public sealed class StremioAddonServiceTests
{
    [Theory]
    [InlineData("http://example.com/manifest.json")]
    [InlineData("https://localhost/manifest.json")]
    [InlineData("https://127.0.0.1/manifest.json")]
    [InlineData("https://192.168.1.20/manifest.json")]
    [InlineData("https://example.com/configure")]
    [InlineData("https://user:secret@example.com/manifest.json")]
    public void TryValidatePublicHttpsUrl_RejectsUnsafeOrInvalidUrls(string input)
    {
        Assert.False(StremioAddonService.TryValidatePublicHttpsUrl(input, out _, out var error));
        Assert.False(string.IsNullOrWhiteSpace(error));
    }

    [Fact]
    public void TryValidatePublicHttpsUrl_AcceptsConfiguredManifestPath()
    {
        const string input = "https://torrentio.strem.fun/config-token/manifest.json";

        Assert.True(StremioAddonService.TryValidatePublicHttpsUrl(input, out var uri, out var error));
        Assert.Equal(input, uri!.AbsoluteUri);
        Assert.Null(error);
    }

    [Fact]
    public void DefaultCometManifestUrl_IsAValidPublicManifestUrl()
    {
        Assert.True(
            StremioAddonService.TryValidatePublicHttpsUrl(
                StremioAddonService.DefaultCometManifestUrl,
                out var uri,
                out var error));
        Assert.Equal("comet.stremio.ru", uri!.Host);
        Assert.Null(error);
    }

    [Fact]
    public async Task GetStreamsAsync_MapsTorrentIdentityTrackersAndMetadata()
    {
        const string payload =
            """
            {
              "streams": [{
                "name": "Torrentio 4K",
                "title": "Movie.2024.2160p.WEB-DL.HEVC.HDR10+",
                "infoHash": "0123456789abcdef0123456789abcdef01234567",
                "fileIdx": 3,
                "sources": ["tracker:udp://tracker.example:80/announce", "dht:ignored"],
                "behaviorHints": { "videoSize": 5368709120 }
              }]
            }
            """;
        var service = new StremioAddonService(
            new FakeHttpClientFactory(new JsonHandler(payload)),
            (_, _) => Task.FromResult(new[] { IPAddress.Parse("93.184.216.34") }));

        var result = await service.GetStreamsAsync(
            "https://example.com/config/manifest.json",
            "movie",
            "tt1234567",
            CancellationToken.None);

        var stream = Assert.Single(result);
        Assert.Equal("4K", stream.Quality);
        Assert.Equal("5 GB", stream.Size);
        Assert.Equal(3, stream.FileIndex);
        Assert.Equal("0123456789abcdef0123456789abcdef01234567", stream.InfoHash);
        Assert.Contains("xt=urn:btih:0123456789abcdef0123456789abcdef01234567", stream.MagnetLink);
        Assert.Contains("tracker.example", Uri.UnescapeDataString(stream.MagnetLink));
        Assert.Contains("HEVC", stream.Badges);
        Assert.Contains("HDR10+", stream.Badges);
    }

    [Fact]
    public async Task GetStreamsAsync_RejectsHostnamesThatResolveToPrivateAddresses()
    {
        var service = new StremioAddonService(
            new FakeHttpClientFactory(new JsonHandler("""{"streams":[]}""")),
            (_, _) => Task.FromResult(new[] { IPAddress.Parse("10.0.0.25") }));

        var result = await service.GetStreamsAsync(
            "https://example.com/manifest.json",
            "movie",
            "tt1234567",
            CancellationToken.None);

        Assert.Empty(result);
    }

    [Fact]
    public async Task GetStreamsAsync_MapsCometDescriptionAndTorrentMetadata()
    {
        const string payload =
            """
            {
              "streams": [{
                "name": "Comet",
                "description": "Movie.2024.1080p.BluRay.x265.10bit",
                "infoHash": "abcdef0123456789abcdef0123456789abcdef01",
                "fileIdx": 1,
                "behaviorHints": { "videoSize": 2147483648 }
              }]
            }
            """;
        var service = new StremioAddonService(
            new FakeHttpClientFactory(new JsonHandler(payload)),
            (_, _) => Task.FromResult(new[] { IPAddress.Parse("93.184.216.34") }));

        var result = await service.GetStreamsAsync(
            "https://example.com/config/manifest.json",
            "movie",
            "tt1234567",
            CancellationToken.None);

        var stream = Assert.Single(result);
        Assert.Equal("Movie.2024.1080p.BluRay.x265.10bit", stream.Title);
        Assert.Equal("1080p", stream.Quality);
        Assert.Equal("2 GB", stream.Size);
        Assert.Equal(1, stream.FileIndex);
        Assert.Equal("abcdef0123456789abcdef0123456789abcdef01", stream.InfoHash);
        Assert.Contains("HEVC", stream.Badges);
        Assert.Contains("10bit", stream.Badges);
        Assert.Contains("Bluray", stream.Badges);
    }

    [Fact]
    public async Task GetStreamsAsync_IgnoresCometTorrentDisabledPlaceholder()
    {
        const string payload =
            """
            {
              "streams": [{
                "name": "[INFO] Comet",
                "description": "Non-debrid searches disabled on this server",
                "url": "https://example.com/not-a-video"
              }]
            }
            """;
        var service = new StremioAddonService(
            new FakeHttpClientFactory(new JsonHandler(payload)),
            (_, _) => Task.FromResult(new[] { IPAddress.Parse("93.184.216.34") }));

        var result = await service.GetStreamsAsync(
            "https://example.com/config/manifest.json",
            "movie",
            "tt1234567",
            CancellationToken.None);

        Assert.Empty(result);
    }

    private sealed class FakeHttpClientFactory : IHttpClientFactory
    {
        private readonly HttpMessageHandler _handler;

        public FakeHttpClientFactory(HttpMessageHandler handler)
        {
            _handler = handler;
        }

        public HttpClient CreateClient(string name) => new(_handler, disposeHandler: false);
    }

    private sealed class JsonHandler : HttpMessageHandler
    {
        private readonly string _payload;

        public JsonHandler(string payload)
        {
            _payload = payload;
        }

        protected override Task<HttpResponseMessage> SendAsync(
            HttpRequestMessage request,
            CancellationToken cancellationToken)
        {
            Assert.Equal(
                "https://example.com/config/stream/movie/tt1234567.json",
                request.RequestUri!.AbsoluteUri);
            return Task.FromResult(new HttpResponseMessage(HttpStatusCode.OK)
            {
                Content = new StringContent(_payload, Encoding.UTF8, "application/json"),
            });
        }
    }
}
