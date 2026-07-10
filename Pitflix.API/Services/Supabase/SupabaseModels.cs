using System.Text.Json.Serialization;

namespace Pitflix.API.Services.Supabase;

public static class SupabaseSourceValues
{
    public const string Desktop = "desktop";
    public const string Mobile = "mobile";
}

public static class SupabaseListTypes
{
    public const string Watchlist = "watchlist";
    public const string Favorites = "favorites";
    public const string Custom = "custom";
}

/// <summary>Row shape for the Supabase <c>lists</c> table.</summary>
public sealed record SupabaseListDto(
    string? Id,
    string Name,
    string Type,
    string Source,
    [property: JsonPropertyName("created_at")] DateTime CreatedAt);

/// <summary>Row shape for the Supabase <c>list_items</c> table.</summary>
public sealed record SupabaseListItemDto(
    string? Id,
    [property: JsonPropertyName("list_id")] string ListId,
    [property: JsonPropertyName("tmdb_id")] int TmdbId,
    [property: JsonPropertyName("media_type")] string MediaType,
    [property: JsonPropertyName("added_at")] DateTime AddedAt);

/// <summary>Row shape for the Supabase <c>watch_events</c> table.</summary>
public sealed record SupabaseWatchEventDto(
    string? Id,
    [property: JsonPropertyName("tmdb_id")] int TmdbId,
    [property: JsonPropertyName("media_type")] string MediaType,
    string? Title,
    [property: JsonPropertyName("poster_path")] string? PosterPath,
    [property: JsonPropertyName("watched_at")] DateTime WatchedAt,
    short? Rating,
    string Source,
    [property: JsonPropertyName("synced_at")] DateTime SyncedAt);
