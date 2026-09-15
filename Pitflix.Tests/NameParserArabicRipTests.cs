using Pitflix.Core.Parser;
using Xunit;

namespace Pitflix.Tests;

/// <summary>
/// Cleaning for Arabic "YouTube rip" filenames: structural words (film/play), trailing cast lists,
/// and bidirectional control characters that corrupt the TMDB search query.
/// </summary>
public class NameParserArabicRipTests
{
    private static string P(params string[] segments) => string.Join(Path.DirectorySeparatorChar, segments);

    [Fact]
    public void BidiControlChars_AreStrippedFromCleanName()
    {
        // U+202C (POP DIRECTIONAL FORMATTING) appears in many Arabic rip filenames.
        var r = NameParser.Parse(P("X:", "Movies", "كده اوكيه‬.mp4"));
        Assert.DoesNotContain('‬', r.CleanName);
        Assert.Equal("كده اوكيه", r.CleanName);
    }

    [Fact]
    public void ArabicCastSuffix_YieldsTitleOnlySearchCandidate()
    {
        // "مسرحية TITLE - actor - actor - YouTube" → candidates should include the bare title.
        var candidates = NameParser.BuildSearchCandidates(
            P("X:", "Movies", "مسرحية كده اوكيه - احمد السقا - منى زكى‬ - YouTube.mp4"));
        Assert.Contains("كده اوكيه", candidates);
    }

    [Fact]
    public void EnglishTitleWithDash_IsNotTruncated()
    {
        // The cast-suffix trimming is Arabic-only; English titles with a real " - " must survive.
        var candidates = NameParser.BuildSearchCandidates(
            P("X:", "Movies", "Mission Impossible - Fallout (2018).mkv"));
        Assert.Contains(candidates, c => c.Contains("Fallout", StringComparison.OrdinalIgnoreCase));
    }
}
