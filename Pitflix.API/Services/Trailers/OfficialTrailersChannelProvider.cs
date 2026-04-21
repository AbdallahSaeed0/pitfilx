using System.Text.Json;

namespace Pitflix.API.Services.Trailers;

public sealed class OfficialTrailersChannelProvider
{
    private readonly IWebHostEnvironment _env;
    private readonly ILogger<OfficialTrailersChannelProvider> _log;
    private IReadOnlyList<OfficialChannelEntry>? _cached;

    public OfficialTrailersChannelProvider(IWebHostEnvironment env, ILogger<OfficialTrailersChannelProvider> log)
    {
        _env = env;
        _log = log;
    }

    public sealed record OfficialChannelEntry(
        string Name,
        string ChannelId,
        int Priority,
        int TrustTier,
        bool Enabled,
        string MediaFocus,
        int PollingPriority,
        IReadOnlyList<string> Aliases);

    private sealed class FileDto
    {
        public List<FileEntry> Channels { get; set; } = new();
    }

    private sealed class FileEntry
    {
        public string? Name { get; set; }
        public string? ChannelId { get; set; }
        public int? Priority { get; set; }
        public int? TrustTier { get; set; }
        public bool? Enabled { get; set; }
        public string? MediaFocus { get; set; }
        public int? PollingPriority { get; set; }
        public List<string>? Aliases { get; set; }
    }

    public async Task<IReadOnlyList<OfficialChannelEntry>> GetChannelsAsync(CancellationToken ct)
    {
        if (_cached != null)
            return _cached;

        var path = Path.Combine(_env.ContentRootPath, "Data", "Trailers", "official-channels.json");
        if (!File.Exists(path))
        {
            _log.LogWarning("Trailers channels config not found at {Path}", path);
            _cached = Array.Empty<OfficialChannelEntry>();
            return _cached;
        }

        await using var fs = File.OpenRead(path);
        var dto = await JsonSerializer.DeserializeAsync<FileDto>(fs,
            new JsonSerializerOptions { PropertyNameCaseInsensitive = true }, ct).ConfigureAwait(false);

        var parsed = new List<OfficialChannelEntry>();
        foreach (var x in dto?.Channels ?? new List<FileEntry>())
        {
            if (string.IsNullOrWhiteSpace(x.Name) || string.IsNullOrWhiteSpace(x.ChannelId))
                continue;
            var priority = Math.Clamp(x.Priority ?? 80, 1, 100);
            var trust = x.TrustTier is >= 1 and <= 3
                ? x.TrustTier.Value
                : priority >= 100
                    ? 1
                    : priority >= 90
                        ? 2
                        : 3;
            var focus = (x.MediaFocus ?? "both").Trim().ToLowerInvariant();
            if (focus is not ("movie" or "tv" or "both"))
                focus = "both";
            var polling = Math.Clamp(x.PollingPriority ?? priority, 1, 100);
            var aliases = (IReadOnlyList<string>)(x.Aliases?.Where(a => !string.IsNullOrWhiteSpace(a)).Select(a => a.Trim())
                .Distinct(StringComparer.OrdinalIgnoreCase).ToList() ?? new List<string>());
            parsed.Add(new OfficialChannelEntry(
                x.Name!.Trim(),
                x.ChannelId!.Trim(),
                priority,
                trust,
                x.Enabled ?? true,
                focus,
                polling,
                aliases));
        }

        parsed = parsed
            .GroupBy(x => x.ChannelId, StringComparer.Ordinal)
            .Select(g => g.OrderByDescending(x => x.PollingPriority).ThenByDescending(x => x.Priority).First())
            .OrderByDescending(x => x.PollingPriority)
            .ThenByDescending(x => x.Priority)
            .ThenBy(x => x.Name, StringComparer.OrdinalIgnoreCase)
            .ToList();

        _cached = parsed;
        _log.LogInformation("Loaded {Count} official trailers channels (monitoring fields supported)", parsed.Count);
        _log.LogInformation(
            "OfficialTrailersChannelProvider: channel list is cached for the lifetime of this process; " +
            "changes to Data/Trailers/official-channels.json require an API restart (or redeploy) to apply.");
        return _cached;
    }
}
