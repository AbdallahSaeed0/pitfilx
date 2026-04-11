using System.Text.Json.Serialization;

namespace Pitflix.API.Services.Awards;

public interface IAwardsDataProvider
{
    Task<IReadOnlyList<int>> ListYearsAsync(string awardId, CancellationToken ct);
    Task<AwardEditionFileDto?> TryLoadEditionAsync(string awardId, int year, CancellationToken ct);
    /// <summary>Lightweight read (label + optional ceremony poster) for year tiles — avoids deserializing full nominee payloads.</summary>
    Task<AwardEditionBannerDto?> TryLoadEditionBannerAsync(string awardId, int year, CancellationToken ct);
}

public sealed class AwardCatalogFileDto
{
    [JsonPropertyName("awards")]
    public List<AwardCatalogEntryDto> Awards { get; set; } = new();
}

public sealed class AwardCatalogEntryDto
{
    public string Id { get; set; } = "";
    public string Name { get; set; } = "";
    public string? Subtitle { get; set; }
    public string? Accent { get; set; }
    /// <summary>TMDB <c>backdrop_path</c> fragment (leading slash optional).</summary>
    public string? HeroBackdropPath { get; set; }
    /// <summary>Optional TMDB <c>backdrop_path</c> for ceremony / brand art (Oscars, BAFTA, etc.).</summary>
    public string? EventBackdropPath { get; set; }
    /// <summary>TMDB <c>poster_path</c> for card / badge art.</summary>
    public string? CardPosterPath { get; set; }
    /// <summary>Optional TMDB poster for ceremony / brand art (Oscars, BAFTA, etc.). Falls back to <see cref="CardPosterPath"/>.</summary>
    public string? EventPosterPath { get; set; }
}

/// <summary>Catalog row with resolved CDN URLs for the UI.</summary>
public sealed class AwardCatalogCardDto
{
    public string Id { get; set; } = "";
    public string Name { get; set; } = "";
    public string? Subtitle { get; set; }
    public string? Accent { get; set; }
    public string? HeroBackdropUrl { get; set; }
    /// <summary>Ceremony / brand backdrop when <c>eventBackdropPath</c> is set; else same as hero backdrop.</summary>
    public string? EventBackdropUrl { get; set; }
    /// <summary>Ceremony / brand poster when <c>eventPosterPath</c> is set; else same as card art.</summary>
    public string? EventPosterUrl { get; set; }
    public string? CardPosterUrl { get; set; }
    public string? SpotlightPosterUrl { get; set; }
}

public sealed class AwardYearTileDto
{
    public int Year { get; init; }
    public string? Label { get; init; }
    public string? PosterUrl { get; init; }
}

public sealed class AwardEditionBannerDto
{
    public string? Label { get; set; }
    public string? PosterPath { get; set; }
}

public sealed class AwardEditionFileDto
{
    public string AwardId { get; set; } = "";
    public int Year { get; set; }
    public string? Label { get; set; }
    /// <summary>
    /// Optional TMDB <c>poster_path</c> fragment for the ceremony/event artwork for this edition/year.
    /// This is used for year tiles first (to avoid random nominee/movie posters).
    /// </summary>
    public string? PosterPath { get; set; }
    /// <summary>
    /// Optional TMDB <c>backdrop_path</c> fragment for ceremony hero use (not intended as a tile primary image).
    /// </summary>
    public string? BackdropPath { get; set; }
    public List<AwardCategoryFileDto> Categories { get; set; } = new();
    public string? DataSource { get; set; }
    public string? Notes { get; set; }
    /// <summary>Optional QA metadata from <c>scripts/audit-awards-data.mjs --apply-qa</c>.</summary>
    public AwardEditionQaDto? Qa { get; set; }
}

/// <summary>Structured edition-level QA flags from the awards audit pipeline.</summary>
public sealed class AwardEditionQaDto
{
    public int Version { get; set; }
    public string? LastAuditAt { get; set; }
    public bool IsSeedEdition { get; set; }
    public bool NeedsNomineeBackfill { get; set; }
    public bool NeedsTmdbEnrichment { get; set; }
    public List<string> Warnings { get; set; } = new();
    public AwardEditionQaStatsDto? Stats { get; set; }
}

public sealed class AwardEditionQaStatsDto
{
    public int CategoryCount { get; set; }
    public int NomineeCount { get; set; }
    public int WinnerCount { get; set; }
    public int TmdbNull { get; set; }
    public int TmdbSet { get; set; }
}

public sealed class AwardCategoryFileDto
{
    public string Id { get; set; } = "";
    public string Name { get; set; } = "";
    public List<AwardNomineeFileDto> Nominees { get; set; } = new();
}

public sealed class AwardNomineeFileDto
{
    public string Title { get; set; } = "";
    public string MediaType { get; set; } = "movie";
    /// <summary>Primary theatrical / season year from curated data — strengthens search when present.</summary>
    [JsonPropertyName("releaseYear")]
    public int? ReleaseYear { get; set; }
    public int? TmdbId { get; set; }
    public bool Winner { get; set; }
}

/// <summary>API shape sent to the client (posters enriched).</summary>
public sealed class AwardEditionResponseDto
{
    public string AwardId { get; set; } = "";
    public int Year { get; set; }
    public string? Label { get; set; }
    public string? DataSource { get; set; }
    public string? Notes { get; set; }
    public AwardEditionQaDto? Qa { get; set; }
    public string? HeroBackdropUrl { get; set; }
    public string? HeroPosterUrl { get; set; }
    /// <summary>Catalog ceremony / brand poster for this award (enlarged next to edition title).</summary>
    public string? EventPosterUrl { get; set; }
    public List<AwardCategoryResponseDto> Categories { get; set; } = new();
}

public sealed class AwardCategoryResponseDto
{
    public string Id { get; set; } = "";
    public string Name { get; set; } = "";
    public List<AwardNomineeResponseDto> Nominees { get; set; } = new();
}

public sealed class AwardNomineeResponseDto
{
    public string Title { get; set; } = "";
    public string MediaType { get; set; } = "";
    public int? TmdbId { get; set; }
    public bool Winner { get; set; }
    public string? PosterUrl { get; set; }
    public string? BackdropUrl { get; set; }
}
