using Pitflix.Core;
using Xunit;

namespace Pitflix.Tests;

public class ArabicTextTests
{
    [Theory]
    [InlineData("إسماعيلية", "اسماعيليه")]   // hamza-alef → alef, ta-marbuta → ha
    [InlineData("صعيدى", "صعيدي")]           // alef-maqsura → ya
    [InlineData("الأمريكية", "الامريكيه")]   // أ → ا, ة → ه
    public void Normalize_UnifiesArabicVariants(string input, string expected)
    {
        Assert.Equal(expected, ArabicText.Normalize(input));
    }

    [Fact]
    public void Normalize_LeavesLatinTextUnchanged()
    {
        Assert.Equal("The Incredible Hulk", ArabicText.Normalize("The Incredible Hulk"));
    }

    [Theory]
    [InlineData("Khayal Ma2ata", "Khayal Maata")]  // 2 (glottal) dropped
    [InlineData("Sa7b Sa7bo", "Sahb Sahbo")]       // 7 → h
    [InlineData("Al7akika", "Alhakika")]           // 7 → h mid-word
    public void RomanizeChatSpeak_MapsArabiziDigits(string input, string expected)
    {
        Assert.Equal(expected, ArabicText.RomanizeChatSpeak(input));
    }

    [Theory]
    [InlineData("Ocean's 11")]      // standalone number
    [InlineData("Police Academy 5")]
    [InlineData("2 Fast 2 Furious")]
    public void RomanizeChatSpeak_LeavesRealNumbersAlone(string input)
    {
        Assert.Equal(input, ArabicText.RomanizeChatSpeak(input));
    }

    [Fact]
    public void ContainsArabic_DetectsScript()
    {
        Assert.True(ArabicText.ContainsArabic("فيلم"));
        Assert.False(ArabicText.ContainsArabic("movie"));
    }
}
