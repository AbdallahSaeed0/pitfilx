using Pitflix.Core;
using Xunit;

namespace Pitflix.Tests;

public class MediaPathNormalizerTests
{
    [Fact]
    public void PreferredPhysicalPath_TrimsWhitespace()
    {
        Assert.Equal("", MediaPathNormalizer.PreferredPhysicalPath("   "));
        Assert.Equal("", MediaPathNormalizer.PreferredPhysicalPath(""));
    }

    [Fact]
    public void EquivalenceVariants_IncludesBothSlashDirections()
    {
        var variants = MediaPathNormalizer.EquivalenceVariants(@"C:\Media\Movies\Inception.mkv");
        Assert.Contains(variants, v => v.Contains('/'));
        Assert.Contains(variants, v => v.Contains('\\'));
    }

    [Fact]
    public void EquivalenceVariants_IncludesLowercasedForm()
    {
        var variants = MediaPathNormalizer.EquivalenceVariants(@"C:\Media\MOVIES\Inception.mkv");
        Assert.Contains(variants, v => v == v.ToLowerInvariant());
    }

    [Fact]
    public void EquivalenceVariants_EmptyPath_ReturnsEmpty()
    {
        Assert.Empty(MediaPathNormalizer.EquivalenceVariants("  "));
    }
}
