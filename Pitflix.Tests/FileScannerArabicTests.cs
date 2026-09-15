using Pitflix.Core.Scanner;
using Xunit;

namespace Pitflix.Tests;

/// <summary>
/// Tests for <see cref="FileScanner.IsArabicForMediaPath"/>. An Arabic-language flag that is wrongly
/// set for English movies (because they sit under a foreign-films bucket named in Arabic) caused a
/// redundant second TMDB search and skewed scoring — these guard the corrected classification.
/// </summary>
public class FileScannerArabicTests
{
    private static string P(params string[] segments) => string.Join(Path.DirectorySeparatorChar, segments);

    [Fact]
    public void EnglishMovieUnderForeignBucket_IsNotFlaggedArabic()
    {
        // اجنبي = "foreign" — the bucket label is Arabic script but the content is not Arabic.
        var path = P("F:", "Movies", "اجنبي", "The Mcu", "2 -The Incredible Hulk (2008)", "2.The Incredible Hulk 2008 720p.mp4");
        Assert.False(FileScanner.IsArabicForMediaPath(path));
    }

    [Fact]
    public void ArabicTitleInFilename_IsFlaggedArabic_EvenUnderForeignBucket()
    {
        // If the actual title is Arabic, that wins regardless of how the library is organised.
        var path = P("F:", "Movies", "اجنبي", "فيلم عربي (2020).mp4");
        Assert.True(FileScanner.IsArabicForMediaPath(path));
    }

    [Fact]
    public void ArabicContentFolder_IsFlaggedArabic()
    {
        // عربي = "Arabic" — a genuine Arabic-content bucket still flags true.
        var path = P("F:", "Movies", "عربي", "Some Show", "episode.mkv");
        Assert.True(FileScanner.IsArabicForMediaPath(path));
    }

    [Fact]
    public void PlainEnglishPath_IsNotArabic()
    {
        var path = P("X:", "Movies", "Inception (2010).mkv");
        Assert.False(FileScanner.IsArabicForMediaPath(path));
    }
}
