using System.Text.Json;

namespace Pitflix.API.Services.Awards;

/// <summary>Loads curated JSON under <c>Data/Awards</c>; optional remote providers can implement the same interface.</summary>
public sealed class FileAwardsDataProvider : IAwardsDataProvider
{
    private readonly string _dataRoot;

    public FileAwardsDataProvider(IWebHostEnvironment env)
    {
        _dataRoot = ResolveDataRoot(env);
    }

    /// <summary>
    /// Resolves the <c>Data/Awards</c> directory.
    /// In dev the content root is the project directory and works directly.
    /// In a single-file production build the JSON content files are extracted by the
    /// runtime to <see cref="AppContext.BaseDirectory"/>, which differs from
    /// <c>env.ContentRootPath</c> (the process working-directory set by Tauri).
    /// We try both so the provider works in every launch mode.
    /// </summary>
    private static string ResolveDataRoot(IWebHostEnvironment env)
    {
        var fromContentRoot = Path.Combine(env.ContentRootPath, "Data", "Awards");
        if (Directory.Exists(fromContentRoot))
            return fromContentRoot;

        var fromBaseDir = Path.Combine(AppContext.BaseDirectory, "Data", "Awards");
        if (Directory.Exists(fromBaseDir))
            return fromBaseDir;

        // Tauri NSIS installer places resources under binaries\ relative to the install dir
        var fromBaseDirBinaries = Path.Combine(AppContext.BaseDirectory, "binaries", "Data", "Awards");
        if (Directory.Exists(fromBaseDirBinaries))
            return fromBaseDirBinaries;

        // Try next to the running exe (handles non-single-file sidecar layouts)
        var exeDir = Path.GetDirectoryName(Environment.ProcessPath ?? "");
        if (!string.IsNullOrEmpty(exeDir))
        {
            var fromExeDir = Path.Combine(exeDir, "Data", "Awards");
            if (Directory.Exists(fromExeDir))
                return fromExeDir;

            var fromExeDirBinaries = Path.Combine(exeDir, "binaries", "Data", "Awards");
            if (Directory.Exists(fromExeDirBinaries))
                return fromExeDirBinaries;
        }

        // Fall back to ContentRootPath even if absent — callers handle missing files gracefully.
        return fromContentRoot;
    }

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
