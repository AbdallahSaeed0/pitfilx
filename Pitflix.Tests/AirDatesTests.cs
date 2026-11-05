using Pitflix.Core.Services;
using Xunit;

namespace Pitflix.Tests;

public class AirDatesTests
{
    [Theory]
    [InlineData("2026-10-05", true)]   // yesterday — out
    [InlineData("2026-10-06", false)]  // today — release time unknown, not yet (Ted Lasso S4E10 case)
    [InlineData("2026-10-07", false)]  // tomorrow
    [InlineData(" 2026-10-05 ", true)] // TMDB strings are trimmed
    [InlineData("", false)]
    [InlineData(null, false)]
    public void HasAired_counts_from_the_day_after_the_air_date(string? airDate, bool expected) =>
        Assert.Equal(expected, AirDates.HasAired(airDate, "2026-10-06"));
}
