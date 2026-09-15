using Pitflix.Core.Models;
using Pitflix.Core.Parser;
using Pitflix.Core.Scanner;
using Xunit;

namespace Pitflix.Tests;

/// <summary>
/// Tests for the fuzzy matcher that decides which TMDB search result a scanned file maps to
/// (<see cref="ScanPipeline.ScoreSearchResultAgainstParsed"/> and its normalization helpers).
/// These are the scores that determine correct-vs-wrong matches during a library scan.
/// </summary>
public class TitleMatchScoringTests
{
    private static ParseResult Parsed(string title, int? year = null, bool arabic = false, string media = "Movie") =>
        new() { CleanName = title, Year = year, MediaType = media, IsArabic = arabic };

    private static TmdbSearchResult Movie(string title, string? releaseDate = null, string? lang = "en") =>
        new() { TitleMovie = title, ReleaseDateMovie = releaseDate, OriginalLanguage = lang };

    // ---------------------------------------------------------------- Normalization

    [Theory]
    [InlineData("The Dark Knight!", "the dark knight")]
    [InlineData("Spider-Man: No Way Home", "spider man no way home")]
    [InlineData("  Multiple   Spaces  ", "multiple spaces")]
    [InlineData("WALL·E", "wall e")]
    public void NormalizeTitleForMatch_LowercasesAndStripsPunctuation(string input, string expected)
    {
        Assert.Equal(expected, ScanPipeline.NormalizeTitleForMatch(input));
    }

    // ---------------------------------------------------------------- Scoring

    [Fact]
    public void ExactTitleAndYear_ScoresPerfect()
    {
        var score = ScanPipeline.ScoreSearchResultAgainstParsed(
            Parsed("Inception", 2010), Movie("Inception", "2010-07-16"), "Movie");
        Assert.True(score >= 0.99, $"expected near-perfect, got {score}");
    }

    [Fact]
    public void WrongTitle_ScoresLow()
    {
        var score = ScanPipeline.ScoreSearchResultAgainstParsed(
            Parsed("Inception", 2010), Movie("Titanic", "1997-12-19"), "Movie");
        Assert.True(score < 0.5, $"expected low score for unrelated title, got {score}");
    }

    [Fact]
    public void MatchingYear_ScoresHigherThanMismatchingYear()
    {
        var right = ScanPipeline.ScoreSearchResultAgainstParsed(
            Parsed("The Thing", 2011), Movie("The Thing", "2011-10-14"), "Movie");
        var wrong = ScanPipeline.ScoreSearchResultAgainstParsed(
            Parsed("The Thing", 2011), Movie("The Thing", "1982-06-25"), "Movie");
        Assert.True(right > wrong, $"year match ({right}) should beat year mismatch ({wrong})");
    }

    [Fact]
    public void StopWordsIgnored_PartialTitleStillMatches()
    {
        // "Dark Knight" (missing leading "The") should still strongly match "The Dark Knight".
        var score = ScanPipeline.ScoreSearchResultAgainstParsed(
            Parsed("Dark Knight", 2008), Movie("The Dark Knight", "2008-07-18"), "Movie");
        Assert.True(score >= 0.9, $"expected strong token match, got {score}");
    }

    [Fact]
    public void MatchesAgainstOriginalTitle_NotJustDisplayTitle()
    {
        var r = new TmdbSearchResult
        {
            TitleMovie = "Parasite",
            OriginalTitleMovie = "기생충",
            ReleaseDateMovie = "2019-05-30"
        };
        var score = ScanPipeline.ScoreSearchResultAgainstParsed(Parsed("Parasite", 2019), r, "Movie");
        Assert.True(score >= 0.99, $"expected match on display title, got {score}");
    }

    [Fact]
    public void EmptyQuery_ScoresZero()
    {
        var score = ScanPipeline.ScoreSearchResultAgainstParsed(
            Parsed(""), Movie("Inception", "2010-07-16"), "Movie");
        Assert.Equal(0, score);
    }
}
