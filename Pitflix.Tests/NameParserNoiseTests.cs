using Pitflix.Core.Parser;
using Xunit;

namespace Pitflix.Tests;

/// <summary>
/// Regression tests for noise tokens that were slipping into the TMDB search title and causing
/// zero-result lookups during scans (audio layouts like 5.1, plus IMAX/XviD/HD/site tails/dubbed tags).
/// </summary>
public class NameParserNoiseTests
{
    private static string P(params string[] segments) => string.Join(Path.DirectorySeparatorChar, segments);

    [Theory]
    // 5.1 audio previously survived as "5 1" and killed the whole Matrix trilogy.
    [InlineData("The Matrix (1999) 720p 5.1 BRRiP x264 AAC [Team Nanban].mp4", "The Matrix", 1999)]
    [InlineData("The Matrix Reloaded (2003) 720p 5.1 BRRiP x264 AAC [Team Nanban].mp4", "The Matrix Reloaded", 2003)]
    [InlineData("Mad Max Fury Road 2015 HD.avi", "Mad Max Fury Road", 2015)]
    [InlineData("Top_Gun_Maverick_2022_IMAX_720p_10bit_BluRay_6CH_x265_HEVC_PSA.mkv", "Top Gun Maverick", 2022)]
    [InlineData("The Lucky One 2012 BRRip XviD-aTLas.avi", "The Lucky One", 2012)]
    [InlineData("Midsommar.2019.DIRECTOR'S.CUT.1080p.10bit.BluRay.6CH.sample.mkv", "Midsommar", 2019)]
    [InlineData("Inside.Out.2015.HDRip.MaZiKa2daY.CoM.mkv", "Inside Out", 2015)]
    public void NoiseTokens_AreStrippedFromTitle(string file, string expectedTitle, int expectedYear)
    {
        var r = NameParser.Parse(P("X:", "Movies", file));
        Assert.Equal(expectedTitle, r.CleanName);
        Assert.Equal(expectedYear, r.Year);
    }

    [Fact]
    public void RealTitleWithNumber_IsNotMistakenForAudioLayout()
    {
        // Guard against the 5.1/2.0 stripping eating legitimate title tokens.
        var r = NameParser.Parse(P("X:", "Movies", "Ocean's Eleven (2001).mkv"));
        Assert.Equal("Ocean's Eleven", r.CleanName);
    }

    [Fact]
    public void TheNet_IsNotStripped_ByComTokenNeighbours()
    {
        // "net" is deliberately NOT a noise token so real titles survive.
        var r = NameParser.Parse(P("X:", "Movies", "The Net (1995).mkv"));
        Assert.Equal("The Net", r.CleanName);
    }
}
