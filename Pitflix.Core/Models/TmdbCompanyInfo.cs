namespace Pitflix.Core.Models;

/// <summary>A production company or TV network from TMDB (Netflix, Apple TV+, HBO, Warner Bros., etc.).</summary>
public class TmdbCompanyInfo
{
    public int Id { get; set; }
    public string Name { get; set; } = "";
    public string? LogoPath { get; set; }
    /// <summary>"network" (TMDB TV networks — where streaming originals live) or "company" (production studio).</summary>
    public string Kind { get; set; } = "company";
}

/// <summary>Combined result of <see cref="Pitflix.Core.Api.TmdbClient.TryGetCompaniesAndCollectionAsync"/> —
/// companies/networks plus (movies only) the collection a title belongs to, from a single TMDB call.</summary>
public sealed record TmdbCompaniesAndCollection(
    IReadOnlyList<TmdbCompanyInfo> Companies,
    int? CollectionId,
    string? CollectionName);
