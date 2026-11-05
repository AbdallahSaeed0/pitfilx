using System.Globalization;

namespace Pitflix.Core.Services;

/// <summary>
/// "Has this episode aired yet?" from a TMDB air date (yyyy-MM-dd, no time of day).
///
/// An episode counts as aired from the day AFTER its air date, in the machine's local time zone.
/// TMDB gives no release hour, and streaming drops land anywhere from midnight to evening on the
/// listed day — counting the air date itself put tonight's episode into Up Next in the morning
/// (e.g. Ted Lasso S4E10, listed for the same day, showing at 8 AM before release). Comparing
/// against UTC was also wrong the other way: on an evening in the Americas UTC is already
/// tomorrow, which surfaced the next day's episode early.
/// </summary>
public static class AirDates
{
    /// <summary>Local calendar date as yyyy-MM-dd (comparable with TMDB's air_date strings).</summary>
    public static string LocalToday() => DateTime.Now.ToString("yyyy-MM-dd", CultureInfo.InvariantCulture);

    public static bool HasAired(string? airDate, string? localToday = null)
    {
        if (string.IsNullOrWhiteSpace(airDate)) return false;
        return string.CompareOrdinal(airDate.Trim(), localToday ?? LocalToday()) < 0;
    }
}
