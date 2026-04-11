namespace Pitflix.Core.Models;

public static class WatchStatuses
{
    public const string Unwatched = "Unwatched";
    public const string Watching = "Watching";
    public const string Completed = "Completed";

    public static bool IsValid(string? s) =>
        s is Unwatched or Watching or Completed;
}
