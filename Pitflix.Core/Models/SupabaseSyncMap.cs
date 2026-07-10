namespace Pitflix.Core.Models;

/// <summary>
/// Maps a locally-owned <see cref="UserList"/> or <see cref="ListItem"/> row to its Supabase
/// counterpart (uuid). Existence of a mapping row means "already synced" in both directions —
/// the push sweep skips local rows that already have one, and the pull sweep skips remote rows
/// whose id already appears here (they're ours, pushed earlier).
/// </summary>
public class SupabaseSyncMap
{
    public int Id { get; set; }

    /// <summary>"list" or "list_item".</summary>
    public string EntityType { get; set; } = "";

    /// <summary>Local <see cref="UserList.Id"/> or <see cref="ListItem.Id"/>.</summary>
    public int LocalId { get; set; }

    /// <summary>Supabase row id (uuid, stored as text).</summary>
    public string RemoteId { get; set; } = "";

    /// <summary>Which side created this row: "desktop" or "mobile".</summary>
    public string Origin { get; set; } = "desktop";

    public DateTime LastSyncedAtUtc { get; set; }
}

public static class SupabaseSyncEntityTypes
{
    public const string List = "list";
    public const string ListItem = "list_item";
}
