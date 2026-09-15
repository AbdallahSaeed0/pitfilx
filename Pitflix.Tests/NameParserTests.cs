using Pitflix.Core.Parser;
using Xunit;

namespace Pitflix.Tests;

/// <summary>
/// Tests for <see cref="NameParser.Parse"/> — the filename/path → title+season+episode+year logic
/// that drives library scan matching. Paths are built with the OS separator so they behave the same
/// on the machine that runs the scan.
/// </summary>
public class NameParserTests
{
    private static string P(params string[] segments) => string.Join(Path.DirectorySeparatorChar, segments);

    // ---------------------------------------------------------------- Movies

    [Fact]
    public void Movie_DotSeparatedWithYearAndReleaseTags_ExtractsCleanTitleAndYear()
    {
        var r = NameParser.Parse(P("X:", "Movies", "Inception.2010.1080p.BluRay.x264.mkv"));
        Assert.Equal("Inception", r.CleanName);
        Assert.Equal(2010, r.Year);
        Assert.Equal("Movie", r.MediaType);
        Assert.Null(r.Season);
        Assert.Null(r.Episode);
    }

    [Fact]
    public void Movie_SpacedTitleWithParenYear_ExtractsTitleAndYear()
    {
        var r = NameParser.Parse(P("X:", "Movies", "The Dark Knight (2008).mkv"));
        Assert.Equal("The Dark Knight", r.CleanName);
        Assert.Equal(2008, r.Year);
        Assert.Equal("Movie", r.MediaType);
    }

    [Fact]
    public void Movie_UnderscoreSeparators_NormalizedToSpaces()
    {
        var r = NameParser.Parse(P("X:", "Movies", "The_Matrix_1999.mkv"));
        Assert.Equal("The Matrix", r.CleanName);
        Assert.Equal(1999, r.Year);
    }

    [Fact]
    public void Movie_BracketSiteAndQualityTags_AreStripped()
    {
        var r = NameParser.Parse(P("X:", "Movies", "[YTS.MX] Interstellar (2014) [1080p].mkv"));
        Assert.Equal("Interstellar", r.CleanName);
        Assert.Equal(2014, r.Year);
    }

    [Fact]
    public void Movie_SequelNumberIsPreserved()
    {
        var r = NameParser.Parse(P("X:", "Movies", "John Wick 2 (2017).mkv"));
        Assert.Equal("John Wick 2", r.CleanName);
        Assert.Equal(2017, r.Year);
    }

    // ---------------------------------------------------------------- Series (explicit SxxExx)

    [Fact]
    public void Series_SxxExx_ExtractsSeasonEpisodeAndTitle()
    {
        var r = NameParser.Parse(P("X:", "Series", "Breaking Bad", "Season 1", "Breaking.Bad.S01E05.720p.HDTV.mkv"));
        Assert.Equal("Breaking Bad", r.CleanName);
        Assert.Equal(1, r.Season);
        Assert.Equal(5, r.Episode);
        Assert.Equal("Series", r.MediaType);
        Assert.Equal(ParseConfidence.High, r.Confidence);
    }

    [Theory]
    [InlineData("Show.S02E10.mkv", 2, 10)]
    [InlineData("Show.s2e3.mkv", 2, 3)]
    [InlineData("Show S01 E07.mkv", 1, 7)]
    [InlineData("Show.S10E112.mkv", 10, 112)]
    public void Series_SeasonEpisodeVariants_Parse(string file, int season, int episode)
    {
        var r = NameParser.Parse(P("X:", "Series", "Show", file));
        Assert.Equal(season, r.Season);
        Assert.Equal(episode, r.Episode);
    }

    // ------------------------------------------------ Series (inferred from folder + filename)

    [Fact]
    public void Series_EpisodeWordUnderSeasonFolder_InfersSeasonEpisodeAndUsesFolderTitle()
    {
        var r = NameParser.Parse(P("X:", "Series", "Friends", "Season 3", "Episode 07.mkv"));
        Assert.Equal(3, r.Season);
        Assert.Equal(7, r.Episode);
        Assert.Equal("Friends", r.CleanName);
        Assert.Equal("Series", r.MediaType);
    }

    [Fact]
    public void Series_NumberOnlyFileUnderSeasonFolder_InfersEpisodeAndFolderTitle()
    {
        var r = NameParser.Parse(P("X:", "Series", "Lost", "Season 1", "03.mkv"));
        Assert.Equal(1, r.Season);
        Assert.Equal(3, r.Episode);
        Assert.Equal("Lost", r.CleanName);
    }

    [Fact]
    public void Series_ShortSeasonFolder_S01_IsRecognized()
    {
        var r = NameParser.Parse(P("X:", "Series", "The Wire", "S01", "Episode 4.mkv"));
        Assert.Equal(1, r.Season);
        Assert.Equal(4, r.Episode);
        Assert.Equal("The Wire", r.CleanName);
    }

    // ---------------------------------------------------------------- Years

    [Theory]
    [InlineData("Movie 1994.mkv", 1994)]
    [InlineData("Movie 2029.mkv", 2029)]
    public void Year_WithinSupportedRange_IsExtracted(string file, int year)
    {
        var r = NameParser.Parse(P("X:", "Movies", file));
        Assert.Equal(year, r.Year);
    }

    [Fact]
    public void Year_1899_IsRejectedAsOutOfRange()
    {
        var r = NameParser.Parse(P("X:", "Movies", "Old Film 1899.mkv"));
        Assert.Null(r.Year);
    }

    // ---------------------------------------------------------------- Edge cases

    [Fact]
    public void EmptyOrExtensionOnly_ReturnsEmptyResult()
    {
        var r = NameParser.Parse("");
        Assert.Equal("", r.CleanName);
        Assert.Equal(ParseConfidence.Low, r.Confidence);
    }

    [Fact]
    public void BuildSearchCandidates_IncludesParentFolderTitles()
    {
        var candidates = NameParser.BuildSearchCandidates(
            P("X:", "Movies", "John Wick", "John Wick 2014", "file.mkv"));
        Assert.Contains(candidates, c => c.Contains("John Wick", StringComparison.OrdinalIgnoreCase));
    }
}
