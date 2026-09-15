using Pitflix.Core;
using Xunit;

namespace Pitflix.Tests;

public class StringDistanceTests
{
    [Theory]
    [InlineData("", "", 0)]
    [InlineData("abc", "", 3)]
    [InlineData("", "abc", 3)]
    [InlineData("abc", "abc", 0)]
    [InlineData("kitten", "sitting", 3)]   // classic Levenshtein example
    [InlineData("flaw", "lawn", 2)]
    [InlineData("interstellar", "interstelar", 1)] // one deletion
    public void Levenshtein_ComputesExpectedDistance(string a, string b, int expected)
    {
        Assert.Equal(expected, StringDistance.Levenshtein(a, b));
    }

    [Fact]
    public void Levenshtein_IsSymmetric()
    {
        Assert.Equal(
            StringDistance.Levenshtein("breaking bad", "braking bad"),
            StringDistance.Levenshtein("braking bad", "breaking bad"));
    }

    [Fact]
    public void Levenshtein_TreatsNullAsEmpty()
    {
        Assert.Equal(0, StringDistance.Levenshtein(null, null));
        Assert.Equal(3, StringDistance.Levenshtein(null, "abc"));
        Assert.Equal(3, StringDistance.Levenshtein("abc", null));
    }

    [Fact]
    public void Levenshtein_IsCaseSensitive()
    {
        // Documents current behavior: comparison is ordinal/case-sensitive.
        // Callers normalize to lower-case before calling (see NormalizeTitleForMatch).
        Assert.Equal(1, StringDistance.Levenshtein("Batman", "batman"));
    }
}
