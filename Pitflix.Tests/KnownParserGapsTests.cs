using Pitflix.Core.Parser;
using Xunit;

namespace Pitflix.Tests;

/// <summary>
/// Regression tests for three matching bugs that caused failed/incorrect library-scan matches.
/// All three are now fixed in <see cref="NameParser"/>; these guard against reintroduction.
/// </summary>
public class KnownParserGapsTests
{
    private static string P(params string[] segments) => string.Join(Path.DirectorySeparatorChar, segments);

    // FIXED: The "NxNN" episode format (e.g. 1x05) is now parsed and the token no longer pollutes the
    // title. Previously Episode was null and "1x05" was left in the search title ("Show Name 1x05").
    [Fact]
    public void Series_NxNnFormat_ParsesSeasonAndEpisode()
    {
        var r = NameParser.Parse(P("X:", "Series", "Show", "Season 1", "Show.Name.1x05.mkv"));
        Assert.Equal(1, r.Season);
        Assert.Equal(5, r.Episode);
        Assert.Equal("Show Name", r.CleanName);
    }

    // A 2-digit episode is required for the NxNN form so titles/resolutions like "4x4" are not
    // misread as season/episode markers.
    [Fact]
    public void Movie_FourByFourTitle_IsNotTreatedAsEpisode()
    {
        var r = NameParser.Parse(P("X:", "Movies", "4x4 (2019).mkv"));
        Assert.Null(r.Episode);
        Assert.Equal(2019, r.Year);
    }

    // FIXED: SxxExx wrapped in hyphen separators ("Show - S01E05 - Title") no longer leaves dangling
    // "- -" in the title; the title is truncated at the marker so the episode title is dropped too.
    [Fact]
    public void Series_HyphenSeparatedSxxExx_ProducesCleanTitle()
    {
        var r = NameParser.Parse(P("X:", "Series", "Show", "Season 1", "Show - S01E05 - Title.mkv"));
        Assert.Equal(1, r.Season);
        Assert.Equal(5, r.Episode);
        Assert.DoesNotContain("- -", r.CleanName);
        Assert.Equal("Show", r.CleanName);
    }

    // FIXED: "01 - Pilot.mkv" (leading index + episode title) now uses the folder title as the show
    // name instead of the leftover episode title "Pilot".
    [Fact]
    public void Series_LeadingIndexEpisode_PrefersFolderTitle()
    {
        var r = NameParser.Parse(P("X:", "Series", "The Office", "Season 1", "01 - Pilot.mkv"));
        Assert.Equal(1, r.Season);
        Assert.Equal(1, r.Episode);
        Assert.Equal("The Office", r.CleanName);
    }

    // FIXED: An explicit "E04" / "Episode 2" marker in the filename with no Season N *folder* (e.g. all
    // episodes dumped flat in the show folder) used to leave MediaType empty, which blocked the
    // season-defaults-to-1 fallback — Season stayed null even though Episode was found, so manually
    // matching the file to the right TMDB show saved the Show but silently never created the Episode row.
    [Fact]
    public void Series_EpisodeMarkerWithoutSeasonFolder_ParsesAsSeries()
    {
        var r = NameParser.Parse(P("X:", "task", "Beng Kolli Season 1 Episode 2.mp4"));
        Assert.Equal("Series", r.MediaType);
        Assert.Equal(1, r.Season);
        Assert.Equal(2, r.Episode);
    }

    [Fact]
    public void Series_BareEMarkerWithoutSeasonFolder_ParsesAsSeries()
    {
        var r = NameParser.Parse(P("X:", "task", "Beng.Kolli.E04.mp4"));
        Assert.Equal("Series", r.MediaType);
        Assert.Equal(1, r.Season);
        Assert.Equal(4, r.Episode);
    }

    // FIXED: A bare trailing number with no E/Episode marker at all ("ShowName.01.mkv") under a real
    // Season N folder used to leave Episode null (only a lone-number filename or an E-prefixed marker
    // was recognized), which — same as above — blocked MediaType classification and dropped the episode.
    [Fact]
    public void Series_BareTrailingNumberUnderSeasonFolder_ParsesAsSeries()
    {
        var r = NameParser.Parse(P("X:", "task", "Underage", "Season 01", "Underage.02.mp4"));
        Assert.Equal("Series", r.MediaType);
        Assert.Equal(1, r.Season);
        Assert.Equal(2, r.Episode);
    }

    // A bare trailing number outside a Season folder stays unrecognized as an episode marker — too
    // ambiguous with movie titles like "Rocky 4" to trust without the folder signal.
    [Fact]
    public void Movie_TrailingNumberWithoutSeasonFolder_IsNotTreatedAsEpisode()
    {
        var r = NameParser.Parse(P("X:", "Movies", "Rocky 4.mkv"));
        Assert.Equal("Movie", r.MediaType);
        Assert.Null(r.Episode);
    }

    // 3-digit trailing numbers are excluded from the bare-trailing-number fallback so resolution tags
    // like "720"/"480" left without their "p" suffix are never misread as an episode number.
    [Fact]
    public void Series_ThreeDigitTrailingNumber_IsNotTreatedAsEpisode()
    {
        var r = NameParser.Parse(P("X:", "Series", "Show", "Season 1", "Show.720.mkv"));
        Assert.Null(r.Episode);
    }
}
