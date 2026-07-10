using System.Text.Json;
using Pitflix.API.Services;

namespace Pitflix.API.Services.Awards;

/// <summary>Loads curated JSON under <c>Data/Awards</c>; optional remote providers can implement the same interface.</summary>
public sealed class FileAwardsDataProvider : IAwardsDataProvider
{
    private readonly string _dataRoot;

    public FileAwardsDataProvider(IWebHostEnvironment env)
    {
        _dataRoot = ResolveDataRoot(env);
    }

    /// <summary>Resolves the <c>Data/Awards</c> directory across dev, single-file, and installed builds.</summary>
    private static string ResolveDataRoot(IWebHostEnvironment env) => DataRootResolver.Resolve(env, "Awards");

    public Task<IReadOnlyList<int>> ListYearsAsync(string awardId, CancellationToken ct)
    {
        var editionsDir = Path.Combine(_dataRoot, "editions", awardId);
        if (!Directory.Exists(editionsDir))
            return Task.FromResult<IReadOnlyList<int>>(Array.Empty<int>());

        var years = new List<int>();
        foreach (var file in Directory.EnumerateFiles(editionsDir, "*.json"))
        {
            if (int.TryParse(Path.GetFileNameWithoutExtension(file), out var y))
                years.Add(y);
        }

        years.Sort();
        years.Reverse();
        return Task.FromResult<IReadOnlyList<int>>(years);
    }

    public async Task<AwardEditionFileDto?> TryLoadEditionAsync(string awardId, int year, CancellationToken ct)
    {
        var path = Path.Combine(_dataRoot, "editions", awardId, $"{year}.json");
        if (!File.Exists(path))
            return null;

        await using var fs = File.OpenRead(path);
        return await JsonSerializer.DeserializeAsync<AwardEditionFileDto>(fs,
            new JsonSerializerOptions { PropertyNameCaseInsensitive = true }, ct).ConfigureAwait(false);
    }

    public async Task<AwardEditionBannerDto?> TryLoadEditionBannerAsync(string awardId, int year, CancellationToken ct)
    {
        var path = Path.Combine(_dataRoot, "editions", awardId, $"{year}.json");
        if (!File.Exists(path))
            return null;

        await using var fs = File.OpenRead(path);
        using var doc = await JsonDocument.ParseAsync(fs, cancellationToken: ct).ConfigureAwait(false);
        var root = doc.RootElement;
        string? label = null;
        string? posterPath = null;
        if (root.TryGetProperty("label", out var le))
            label = le.GetString();
        if (root.TryGetProperty("posterPath", out var pe))
            posterPath = pe.GetString();

        return new AwardEditionBannerDto { Label = label, PosterPath = posterPath };
    }
}
