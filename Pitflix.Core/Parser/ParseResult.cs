namespace Pitflix.Core.Parser;

public enum ParseConfidence
{
    Low,
    Medium,
    High
}

public sealed class ParseResult
{
    public string CleanName { get; init; } = "";
    public int? Season { get; init; }
    public int? Episode { get; init; }
    public int? Year { get; init; }
    public bool IsArabic { get; init; }
    public string MediaType { get; init; } = "";
    public ParseConfidence Confidence { get; init; }
}
