namespace Pitflix.Core.Models;

/// <summary>One line of JSON in <c>application/x-ndjson</c> prefetch stream.</summary>
public sealed class PrefetchMetadataProgress
{
    public string Phase { get; set; } = "";

    public int MoviesTotal { get; set; }
    public int SeriesTotal { get; set; }

    /// <summary>Titles with <c>MetadataRefreshedAt</c> already set — skipped by this run.</summary>
    public int MoviesAlreadyCached { get; set; }
    public int SeriesAlreadyCached { get; set; }

    public int Index { get; set; }
    public int ItemTotal { get; set; }

    public int? LibraryId { get; set; }
    public string? Title { get; set; }
    public bool? Ok { get; set; }
    public string? Error { get; set; }

    public int MoviesOk { get; set; }
    public int SeriesOk { get; set; }
    public List<string>? Errors { get; set; }
}
