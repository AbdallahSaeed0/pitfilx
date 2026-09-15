using Pitflix.Core.Models;
using Pitflix.Core.Parser;
using Pitflix.Core.Scanner;
using Xunit;

namespace Pitflix.Tests;

/// <summary>
/// Guards the anti-wrong-match rule: when a filename's year disagrees with a candidate, the weak
/// "trust popularity" acceptances must not fire. Reproduces the real mismatch where
/// "Police Academy 5 … 1988" was auto-matched to the more popular original "Police Academy (1984)".
/// </summary>
public class AutoMatchYearGuardTests
{
    private static ParseResult Parsed(string title, int? year) =>
        new() { CleanName = title, Year = year, MediaType = "Movie" };

    private static TmdbSearchResult Movie(string title, int year, double popularity) => new()
    {
        Id = title.GetHashCode() & 0x7fffffff,
        TitleMovie = title,
        ReleaseDateMovie = $"{year}-01-01",
        Popularity = popularity,
    };

    // The franchise as TMDB returns it: many same-name entries, the 1984 original by far the most popular.
    private static List<TmdbSearchResult> PoliceAcademyResults() => new()
    {
        Movie("Police Academy", 1984, 30),
        Movie("Police Academy 2: Their First Assignment", 1985, 12),
        Movie("Police Academy 3: Back in Training", 1986, 10),
    };

    [Fact]
    public void YearConflict_DoesNotAcceptMorePopularSameNameFilm()
    {
        // Filename says 1988 (Police Academy 5) but the parser couldn't decode the subtitle.
        var parsed = Parsed("Police Academy 5 A M B com", 1988);
        var matched = ScanPipeline.TryPickAutoMatch(parsed, PoliceAcademyResults(), "Movie", out _);
        Assert.False(matched);
    }

    [Fact]
    public void YearAgrees_StillAcceptsPopularMatch()
    {
        // Control: when the year lines up, the popular original is a legitimate accept.
        var parsed = Parsed("Police Academy", 1984);
        var matched = ScanPipeline.TryPickAutoMatch(parsed, PoliceAcademyResults(), "Movie", out var chosen);
        Assert.True(matched);
        Assert.Equal("Police Academy", chosen.Title);
    }

    [Fact]
    public void NoYearInFilename_PopularityFallbackStillWorks()
    {
        // No year to conflict with → the popularity fallback is unaffected.
        var parsed = Parsed("Police Academy", null);
        var matched = ScanPipeline.TryPickAutoMatch(parsed, PoliceAcademyResults(), "Movie", out var chosen);
        Assert.True(matched);
        Assert.Equal("Police Academy", chosen.Title);
    }

    [Fact]
    public void ExactTitleAndYear_AlwaysAccepts()
    {
        var parsed = Parsed("The Incredible Hulk", 2008);
        var results = new List<TmdbSearchResult>
        {
            Movie("The Incredible Hulk", 2008, 40),
            Movie("The Incredible Hulk", 1977, 3),
        };
        var matched = ScanPipeline.TryPickAutoMatch(parsed, results, "Movie", out var chosen);
        Assert.True(matched);
        Assert.Equal(2008, int.Parse(chosen.ReleaseDate[..4]));
    }
}
