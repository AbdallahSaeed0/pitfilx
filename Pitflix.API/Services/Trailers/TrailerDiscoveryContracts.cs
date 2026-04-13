namespace Pitflix.API.Services.Trailers;

/// <summary>
/// Raw row from a future scraper/RSS feed. Must be normalized and matched to TMDB before use on Home — never trust <see cref="RawTitle"/> as catalog metadata.
/// </summary>
public sealed record RawTrailerCandidate(
    string RawTitle,
    string SourceUrl,
    string? ThumbnailUrl,
    DateTime? PublishedAtUtc,
    string? SourceName,
    string? InferredTrailerType);

/// <summary>Snapshot of one external discovery pass (Invidious / YouTube API / RSS + TMDB resolve) for logging and <c>/api/home/trailers/rss-status</c>.</summary>
public sealed record TrailerRssDiscoveryDiagnostics(
    bool Enabled,
    int ChannelsConfigured,
    int RawEntriesFetched,
    int ResolvedToTmdb,
    IReadOnlyList<string> ChannelErrors,
    string? BuildError,
    int YoutubeSearchRawEntries = 0,
    string? YoutubeSearchError = null,
    int InvidiousRawEntries = 0,
    string? InvidiousError = null);
