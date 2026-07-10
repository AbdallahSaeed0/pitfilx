using System.Text.Json.Serialization;

namespace Pitflix.API.Services.Trakt;

/// <summary>Redirect URI only — never a secret, so it's fine to fix at startup from appsettings.json.
/// Client id/secret live in <see cref="Pitflix.Core.Config.AppSettings"/> (DB-backed, see
/// <c>ResolveTraktCredentialsFromSources</c>) so anyone running their own Pitflix install can paste
/// their own Trakt app credentials into Settings without editing config files.</summary>
public sealed record TraktRedirectOptions(string RedirectUri);

public sealed record TraktTokenResponse(
    [property: JsonPropertyName("access_token")] string AccessToken,
    [property: JsonPropertyName("refresh_token")] string RefreshToken,
    [property: JsonPropertyName("expires_in")] int ExpiresIn);

public sealed record TraktIds(
    [property: JsonPropertyName("trakt")] int Trakt,
    [property: JsonPropertyName("tmdb")] int? Tmdb,
    [property: JsonPropertyName("imdb")] string? Imdb);

public sealed record TraktMovieRef(
    [property: JsonPropertyName("ids")] TraktIds Ids,
    string? Title,
    int? Year,
    double? Rating = null);

public sealed record TraktShowRef(
    [property: JsonPropertyName("ids")] TraktIds Ids,
    string? Title,
    int? Year,
    double? Rating = null);

public sealed record TraktEpisodeRef(
    [property: JsonPropertyName("season")] int? Season,
    [property: JsonPropertyName("number")] int? Number,
    string? Title);

public sealed record TraktSearchResult(
    string Type,
    TraktMovieRef? Movie,
    TraktShowRef? Show);

public sealed record TraktHistoryItem(
    long Id,
    [property: JsonPropertyName("watched_at")] DateTime WatchedAt,
    string Type,
    TraktMovieRef? Movie,
    TraktShowRef? Show,
    TraktEpisodeRef? Episode);

public sealed record TraktUserProfile(string Username);

public sealed record TraktPlaybackItem(
    long Id,
    double Progress,
    [property: JsonPropertyName("paused_at")] DateTime PausedAt,
    string? Type,
    TraktMovieRef? Movie,
    TraktShowRef? Show,
    TraktEpisodeRef? Episode);

public sealed record TraktRecommendationItem(
    int? Score,
    TraktMovieRef? Movie,
    TraktShowRef? Show);
