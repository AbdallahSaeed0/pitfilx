using System.Text;
using System.Text.RegularExpressions;

namespace Pitflix.Core;

/// <summary>
/// Arabic text helpers for library matching: script normalization (so spelling/diacritic variants of
/// the same title compare equal) and "Arabizi" chat-speak romanization (so <c>Ma2ata</c> can be tried
/// as <c>Maata</c> against TMDB).
/// </summary>
public static partial class ArabicText
{
    [GeneratedRegex(@"[ؐ-ًؚ-ٰٟۖ-ۭـ]", RegexOptions.CultureInvariant)]
    private static partial Regex ArabicDiacriticsAndTatweel();

    [GeneratedRegex(@"\p{IsArabic}", RegexOptions.CultureInvariant)]
    private static partial Regex ArabicChar();

    public static bool ContainsArabic(string? s) => !string.IsNullOrEmpty(s) && ArabicChar().IsMatch(s);

    /// <summary>
    /// Canonical Arabic form for matching: drop harakat/tatweel, unify alef (أ إ آ ٱ → ا),
    /// ة → ه, ى → ي, ؤ/ئ → و/ي. Non-Arabic text is returned unchanged (only these code points move).
    /// </summary>
    public static string Normalize(string? s)
    {
        if (string.IsNullOrEmpty(s))
            return "";

        var stripped = ArabicDiacriticsAndTatweel().Replace(s, "");
        var sb = new StringBuilder(stripped.Length);
        foreach (var c in stripped)
        {
            switch (c)
            {
                case 'أ':
                case 'إ':
                case 'آ':
                case 'ٱ':
                    sb.Append('ا');
                    break;
                case 'ة':
                    sb.Append('ه');
                    break;
                case 'ى':
                    sb.Append('ي');
                    break;
                case 'ئ':
                    sb.Append('ي');
                    break;
                case 'ؤ':
                    sb.Append('و');
                    break;
                default:
                    sb.Append(c);
                    break;
            }
        }

        return sb.ToString();
    }

    /// <summary>
    /// Maps "Arabizi" digits used inside Latin words to letters (7→h, 5→kh, 8→gh, 9→q, 6→t) and drops
    /// the glottal-stop stand-ins (2, 3, 4). Only rewrites a digit when it sits between Latin letters,
    /// so real numbers ("Ocean's 11", "1988") are left alone. Returns the input unchanged when nothing
    /// looked like chat-speak.
    /// </summary>
    public static string RomanizeChatSpeak(string? s)
    {
        if (string.IsNullOrEmpty(s))
            return s ?? "";

        var changed = false;
        var result = Regex.Replace(s, @"(?<=[A-Za-z])([23456789])(?=[A-Za-z])", m =>
        {
            changed = true;
            return m.Value switch
            {
                "5" => "kh",
                "6" => "t",
                "7" => "h",
                "8" => "gh",
                "9" => "q",
                _ => "", // 2, 3, 4 → glottal / dropped
            };
        }, RegexOptions.CultureInvariant);

        return changed ? result : s;
    }
}
