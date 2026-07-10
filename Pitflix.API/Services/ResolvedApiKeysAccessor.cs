using Pitflix.Core.Config;

namespace Pitflix.API.Services;

/// <summary>
/// DI-facing read access to resolved API keys. Values are still populated via
/// <see cref="AppSettings.ResolveTmdbApiKeyFromSources"/> / <see cref="AppSettings.ResolveOpenSubtitlesFromSources"/>
/// at startup and on settings save; this accessor only changes how consumers read them.
/// </summary>
public interface IResolvedApiKeysAccessor
{
    string? ResolvedTmdbApiKey { get; }
    string? ResolvedOpenSubtitlesApiKey { get; }
    string? ResolvedOpenSubtitlesAppName { get; }
}

public sealed class ResolvedApiKeysAccessor : IResolvedApiKeysAccessor
{
    public string? ResolvedTmdbApiKey => AppSettings.ResolvedTmdbApiKey;
    public string? ResolvedOpenSubtitlesApiKey => AppSettings.ResolvedOpenSubtitlesApiKey;
    public string? ResolvedOpenSubtitlesAppName => AppSettings.ResolvedOpenSubtitlesAppName;
}
