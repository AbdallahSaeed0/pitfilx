using System.Text.Json;

namespace Pitflix.API.Services;

/// <summary>
/// Optional curated “must-consider” TMDB ids to ensure blockbuster titles can appear in the trailers feed
/// even when discover/trending windows shift.
/// </summary>
public sealed class TrailersCuratedPriorityProvider
{
    private readonly IWebHostEnvironment _env;

    public TrailersCuratedPriorityProvider(IWebHostEnvironment env)
    {
        _env = env;
    }

    public sealed record Entry(string MediaType, int TmdbId, string? Note = null);

    private sealed class FileDto
    {
        public List<Entry> Titles { get; set; } = new();
    }

    public async Task<IReadOnlyList<Entry>> TryLoadAsync(CancellationToken ct)
    {
        var path = Path.Combine(_env.ContentRootPath, "Data", "Trailers", "priority.json");
        if (!File.Exists(path))
            return Array.Empty<Entry>();

        await using var fs = File.OpenRead(path);
        var dto = await JsonSerializer.DeserializeAsync<FileDto>(fs,
            new JsonSerializerOptions { PropertyNameCaseInsensitive = true }, ct).ConfigureAwait(false);

        var list = dto?.Titles?
            .Where(t => !string.IsNullOrWhiteSpace(t.MediaType) && t.TmdbId > 0)
            .ToList();

        return list ?? (IReadOnlyList<Entry>)Array.Empty<Entry>();
    }
}

