using System.Net.Http;
using System.Text.Json;
using System.Text.RegularExpressions;
using Microsoft.Data.Sqlite;
using Microsoft.EntityFrameworkCore;
using Pitflix.Core.Database;
using Pitflix.Core.Models;

namespace Pitflix.API.Services;

public class IptvService
{
    private readonly IHttpClientFactory _httpClientFactory;
    private readonly ILogger<IptvService> _logger;

    public IptvService(IHttpClientFactory httpClientFactory, ILogger<IptvService> logger)
    {
        _httpClientFactory = httpClientFactory;
        _logger = logger;
    }

    // ── Provider CRUD ────────────────────────────────────────────────────────

    public async Task<List<IptvProvider>> GetProvidersAsync(CancellationToken ct = default)
    {
        using var db = LibraryContext.Create();
        var rows = new List<IptvProvider>();
        await using var conn = new SqliteConnection(LibraryPaths.DatabaseConnectionString);
        await conn.OpenAsync(ct).ConfigureAwait(false);
        await using var cmd = conn.CreateCommand();
        cmd.CommandText = "SELECT Id,DisplayName,Type,M3uUrl,ServerUrl,Username,Password,EpgUrl,CreatedAt,LastRefreshedAt,ChannelCount FROM IptvProviders ORDER BY Id";
        await using var reader = await cmd.ExecuteReaderAsync(ct).ConfigureAwait(false);
        while (await reader.ReadAsync(ct).ConfigureAwait(false))
        {
            rows.Add(MapProviderRow(reader));
        }
        return rows;
    }

    public async Task<IptvProvider?> GetProviderByIdAsync(int id, CancellationToken ct = default)
    {
        await using var conn = new SqliteConnection(LibraryPaths.DatabaseConnectionString);
        await conn.OpenAsync(ct).ConfigureAwait(false);
        await using var cmd = conn.CreateCommand();
        cmd.CommandText = "SELECT Id,DisplayName,Type,M3uUrl,ServerUrl,Username,Password,EpgUrl,CreatedAt,LastRefreshedAt,ChannelCount FROM IptvProviders WHERE Id=@id";
        cmd.Parameters.AddWithValue("@id", id);
        await using var reader = await cmd.ExecuteReaderAsync(ct).ConfigureAwait(false);
        if (await reader.ReadAsync(ct).ConfigureAwait(false))
            return MapProviderRow(reader);
        return null;
    }

    public async Task<int> CreateProviderAsync(IptvProvider p, CancellationToken ct = default)
    {
        await using var conn = new SqliteConnection(LibraryPaths.DatabaseConnectionString);
        await conn.OpenAsync(ct).ConfigureAwait(false);
        await using var cmd = conn.CreateCommand();
        cmd.CommandText = """
            INSERT INTO IptvProviders (DisplayName,Type,M3uUrl,ServerUrl,Username,Password,EpgUrl,CreatedAt,ChannelCount)
            VALUES (@dn,@type,@m3u,@server,@user,@pass,@epg,@now,0);
            SELECT last_insert_rowid();
            """;
        cmd.Parameters.AddWithValue("@dn", p.DisplayName ?? "");
        cmd.Parameters.AddWithValue("@type", (int)p.Type);
        cmd.Parameters.AddWithValue("@m3u", (object?)p.M3uUrl ?? DBNull.Value);
        cmd.Parameters.AddWithValue("@server", (object?)p.ServerUrl ?? DBNull.Value);
        cmd.Parameters.AddWithValue("@user", (object?)p.Username ?? DBNull.Value);
        cmd.Parameters.AddWithValue("@pass", (object?)p.Password ?? DBNull.Value);
        cmd.Parameters.AddWithValue("@epg", (object?)p.EpgUrl ?? DBNull.Value);
        cmd.Parameters.AddWithValue("@now", DateTime.UtcNow.ToString("o"));
        var scalar = await cmd.ExecuteScalarAsync(ct).ConfigureAwait(false);
        return Convert.ToInt32(scalar);
    }

    public async Task UpdateProviderAsync(IptvProvider p, CancellationToken ct = default)
    {
        await using var conn = new SqliteConnection(LibraryPaths.DatabaseConnectionString);
        await conn.OpenAsync(ct).ConfigureAwait(false);
        await using var cmd = conn.CreateCommand();
        cmd.CommandText = """
            UPDATE IptvProviders SET DisplayName=@dn,Type=@type,M3uUrl=@m3u,ServerUrl=@server,Username=@user,Password=@pass,EpgUrl=@epg
            WHERE Id=@id
            """;
        cmd.Parameters.AddWithValue("@id", p.Id);
        cmd.Parameters.AddWithValue("@dn", p.DisplayName ?? "");
        cmd.Parameters.AddWithValue("@type", (int)p.Type);
        cmd.Parameters.AddWithValue("@m3u", (object?)p.M3uUrl ?? DBNull.Value);
        cmd.Parameters.AddWithValue("@server", (object?)p.ServerUrl ?? DBNull.Value);
        cmd.Parameters.AddWithValue("@user", (object?)p.Username ?? DBNull.Value);
        cmd.Parameters.AddWithValue("@pass", (object?)p.Password ?? DBNull.Value);
        cmd.Parameters.AddWithValue("@epg", (object?)p.EpgUrl ?? DBNull.Value);
        await cmd.ExecuteNonQueryAsync(ct).ConfigureAwait(false);
    }

    public async Task DeleteProviderAsync(int id, CancellationToken ct = default)
    {
        await using var conn = new SqliteConnection(LibraryPaths.DatabaseConnectionString);
        await conn.OpenAsync(ct).ConfigureAwait(false);
        await using var cmd = conn.CreateCommand();
        cmd.CommandText = "DELETE FROM IptvProviders WHERE Id=@id; DELETE FROM IptvChannels WHERE ProviderId=@id";
        cmd.Parameters.AddWithValue("@id", id);
        await cmd.ExecuteNonQueryAsync(ct).ConfigureAwait(false);
    }

    // ── Channels ─────────────────────────────────────────────────────────────

    public async Task<List<IptvChannel>> GetChannelsAsync(int providerId, string? group = null, string? search = null, CancellationToken ct = default)
    {
        await using var conn = new SqliteConnection(LibraryPaths.DatabaseConnectionString);
        await conn.OpenAsync(ct).ConfigureAwait(false);
        await using var cmd = conn.CreateCommand();
        var sql = """SELECT Id,ProviderId,Name,StreamUrl,LogoUrl,"Group",TvgId,TvgName,StreamId,SortOrder FROM IptvChannels WHERE ProviderId=@pid""";
        cmd.Parameters.AddWithValue("@pid", providerId);
        if (!string.IsNullOrWhiteSpace(group))
        {
            sql += " AND \"Group\"=@group";
            cmd.Parameters.AddWithValue("@group", group);
        }
        if (!string.IsNullOrWhiteSpace(search))
        {
            sql += " AND Name LIKE @search";
            cmd.Parameters.AddWithValue("@search", $"%{search}%");
        }
        sql += " ORDER BY SortOrder, Name LIMIT 500";
        cmd.CommandText = sql;
        var rows = new List<IptvChannel>();
        await using var reader = await cmd.ExecuteReaderAsync(ct).ConfigureAwait(false);
        while (await reader.ReadAsync(ct).ConfigureAwait(false))
            rows.Add(MapChannelRow(reader));
        return rows;
    }

    public async Task<List<string>> GetGroupsAsync(int providerId, CancellationToken ct = default)
    {
        await using var conn = new SqliteConnection(LibraryPaths.DatabaseConnectionString);
        await conn.OpenAsync(ct).ConfigureAwait(false);
        await using var cmd = conn.CreateCommand();
        cmd.CommandText = """SELECT DISTINCT "Group" FROM IptvChannels WHERE ProviderId=@pid AND "Group" IS NOT NULL ORDER BY "Group" """;
        cmd.Parameters.AddWithValue("@pid", providerId);
        var groups = new List<string>();
        await using var reader = await cmd.ExecuteReaderAsync(ct).ConfigureAwait(false);
        while (await reader.ReadAsync(ct).ConfigureAwait(false))
            groups.Add(reader.GetString(0));
        return groups;
    }

    // ── Refresh (fetch channels from provider) ────────────────────────────────

    public async Task<int> RefreshProviderAsync(int providerId, CancellationToken ct = default)
    {
        var provider = await GetProviderByIdAsync(providerId, ct).ConfigureAwait(false);
        if (provider == null) throw new InvalidOperationException($"Provider {providerId} not found.");

        List<IptvChannel> channels = provider.Type switch
        {
            IptvProviderType.XtreamCodes => await FetchXtreamChannelsAsync(provider, ct).ConfigureAwait(false),
            IptvProviderType.M3uUrl => await FetchM3uUrlChannelsAsync(provider.M3uUrl!, ct).ConfigureAwait(false),
            _ => new List<IptvChannel>()
        };

        await SaveChannelsAsync(providerId, channels, ct).ConfigureAwait(false);
        return channels.Count;
    }

    public async Task<int> ImportM3uContentAsync(int providerId, string content, CancellationToken ct = default)
    {
        var channels = ParseM3u(content, providerId);
        await SaveChannelsAsync(providerId, channels, ct).ConfigureAwait(false);
        return channels.Count;
    }

    // ── Xtream Codes ─────────────────────────────────────────────────────────

    private async Task<List<IptvChannel>> FetchXtreamChannelsAsync(IptvProvider provider, CancellationToken ct)
    {
        var server = provider.ServerUrl!.TrimEnd('/');
        var url = $"{server}/player_api.php?username={Uri.EscapeDataString(provider.Username ?? "")}&password={Uri.EscapeDataString(provider.Password ?? "")}&action=get_live_streams";
        var http = _httpClientFactory.CreateClient();
        http.Timeout = TimeSpan.FromSeconds(60);
        var json = await http.GetStringAsync(url, ct).ConfigureAwait(false);

        using var doc = JsonDocument.Parse(json);
        var channels = new List<IptvChannel>();
        int order = 0;
        foreach (var el in doc.RootElement.EnumerateArray())
        {
            var streamId = el.TryGetProperty("stream_id", out var sid) ? sid.ToString() : null;
            var name = el.TryGetProperty("name", out var n) ? n.GetString() ?? "" : "";
            var logo = el.TryGetProperty("stream_icon", out var li) ? li.GetString() : null;
            var group = el.TryGetProperty("category_name", out var gn) ? gn.GetString() : null;
            var tvgName = el.TryGetProperty("epg_channel_id", out var eid) ? eid.GetString() : null;

            var streamUrl = $"{server}/{Uri.EscapeDataString(provider.Username ?? "")}/{Uri.EscapeDataString(provider.Password ?? "")}/{streamId}";

            channels.Add(new IptvChannel
            {
                ProviderId = provider.Id,
                Name = name,
                StreamUrl = streamUrl,
                LogoUrl = logo,
                Group = group,
                TvgName = tvgName,
                StreamId = streamId,
                SortOrder = order++,
            });
        }
        return channels;
    }

    public async Task<bool> TestXtreamConnectionAsync(string serverUrl, string username, string password, CancellationToken ct)
    {
        try
        {
            var server = serverUrl.TrimEnd('/');
            var url = $"{server}/player_api.php?username={Uri.EscapeDataString(username)}&password={Uri.EscapeDataString(password)}";
            var http = _httpClientFactory.CreateClient();
            http.Timeout = TimeSpan.FromSeconds(15);
            var resp = await http.GetAsync(url, ct).ConfigureAwait(false);
            if (!resp.IsSuccessStatusCode) return false;
            var json = await resp.Content.ReadAsStringAsync(ct).ConfigureAwait(false);
            using var doc = JsonDocument.Parse(json);
            return doc.RootElement.TryGetProperty("user_info", out _) || doc.RootElement.TryGetProperty("server_info", out _);
        }
        catch
        {
            return false;
        }
    }

    // ── M3U URL ───────────────────────────────────────────────────────────────

    private async Task<List<IptvChannel>> FetchM3uUrlChannelsAsync(string m3uUrl, CancellationToken ct)
    {
        var http = _httpClientFactory.CreateClient();
        http.Timeout = TimeSpan.FromSeconds(90);
        var content = await http.GetStringAsync(m3uUrl, ct).ConfigureAwait(false);
        return ParseM3u(content, 0);
    }

    // ── M3U Parser ────────────────────────────────────────────────────────────

    public static List<IptvChannel> ParseM3u(string content, int providerId)
    {
        var channels = new List<IptvChannel>();
        var lines = content.Split('\n');
        IptvChannel? current = null;
        int order = 0;

        foreach (var rawLine in lines)
        {
            var line = rawLine.Trim();
            if (string.IsNullOrEmpty(line)) continue;

            if (line.StartsWith("#EXTINF:", StringComparison.OrdinalIgnoreCase))
            {
                current = new IptvChannel { ProviderId = providerId, SortOrder = order++ };
                current.TvgId = ExtractAttr(line, "tvg-id");
                current.TvgName = ExtractAttr(line, "tvg-name");
                current.LogoUrl = ExtractAttr(line, "tvg-logo");
                current.Group = ExtractAttr(line, "group-title");

                // Display name is after the last comma
                var commaIdx = line.LastIndexOf(',');
                current.Name = commaIdx >= 0 ? line[(commaIdx + 1)..].Trim() : "";
                if (string.IsNullOrEmpty(current.Name))
                    current.Name = current.TvgName ?? "Channel";
            }
            else if (!line.StartsWith("#") && current != null)
            {
                current.StreamUrl = line;
                channels.Add(current);
                current = null;
            }
        }

        return channels;
    }

    private static string? ExtractAttr(string line, string attr)
    {
        var pattern = $@"{Regex.Escape(attr)}=""([^""]*)""";
        var m = Regex.Match(line, pattern);
        return m.Success ? m.Groups[1].Value : null;
    }

    // ── Persist channels ──────────────────────────────────────────────────────

    private async Task SaveChannelsAsync(int providerId, List<IptvChannel> channels, CancellationToken ct)
    {
        await using var conn = new SqliteConnection(LibraryPaths.DatabaseConnectionString);
        await conn.OpenAsync(ct).ConfigureAwait(false);
        await using var tx = await conn.BeginTransactionAsync(ct).ConfigureAwait(false);

        await using (var del = conn.CreateCommand())
        {
            del.Transaction = (SqliteTransaction)tx;
            del.CommandText = "DELETE FROM IptvChannels WHERE ProviderId=@pid";
            del.Parameters.AddWithValue("@pid", providerId);
            await del.ExecuteNonQueryAsync(ct).ConfigureAwait(false);
        }

        foreach (var ch in channels)
        {
            await using var ins = conn.CreateCommand();
            ins.Transaction = (SqliteTransaction)tx;
            ins.CommandText = """
                INSERT INTO IptvChannels (ProviderId,Name,StreamUrl,LogoUrl,"Group",TvgId,TvgName,StreamId,SortOrder)
                VALUES (@pid,@name,@url,@logo,@grp,@tvgid,@tvgname,@sid,@sort)
                """;
            ins.Parameters.AddWithValue("@pid", providerId);
            ins.Parameters.AddWithValue("@name", ch.Name);
            ins.Parameters.AddWithValue("@url", ch.StreamUrl);
            ins.Parameters.AddWithValue("@logo", (object?)ch.LogoUrl ?? DBNull.Value);
            ins.Parameters.AddWithValue("@grp", (object?)ch.Group ?? DBNull.Value);
            ins.Parameters.AddWithValue("@tvgid", (object?)ch.TvgId ?? DBNull.Value);
            ins.Parameters.AddWithValue("@tvgname", (object?)ch.TvgName ?? DBNull.Value);
            ins.Parameters.AddWithValue("@sid", (object?)ch.StreamId ?? DBNull.Value);
            ins.Parameters.AddWithValue("@sort", ch.SortOrder);
            await ins.ExecuteNonQueryAsync(ct).ConfigureAwait(false);
        }

        // Update provider channel count and last refreshed
        await using var upd = conn.CreateCommand();
        upd.Transaction = (SqliteTransaction)tx;
        upd.CommandText = "UPDATE IptvProviders SET ChannelCount=@count, LastRefreshedAt=@now WHERE Id=@pid";
        upd.Parameters.AddWithValue("@count", channels.Count);
        upd.Parameters.AddWithValue("@now", DateTime.UtcNow.ToString("o"));
        upd.Parameters.AddWithValue("@pid", providerId);
        await upd.ExecuteNonQueryAsync(ct).ConfigureAwait(false);

        await tx.CommitAsync(ct).ConfigureAwait(false);
    }

    // ── Mappers ───────────────────────────────────────────────────────────────

    private static IptvProvider MapProviderRow(System.Data.Common.DbDataReader r) => new()
    {
        Id = r.GetInt32(0),
        DisplayName = r.IsDBNull(1) ? "" : r.GetString(1),
        Type = (IptvProviderType)r.GetInt32(2),
        M3uUrl = r.IsDBNull(3) ? null : r.GetString(3),
        ServerUrl = r.IsDBNull(4) ? null : r.GetString(4),
        Username = r.IsDBNull(5) ? null : r.GetString(5),
        Password = r.IsDBNull(6) ? null : r.GetString(6),
        EpgUrl = r.IsDBNull(7) ? null : r.GetString(7),
        CreatedAt = DateTime.Parse(r.GetString(8)),
        LastRefreshedAt = r.IsDBNull(9) ? null : DateTime.Parse(r.GetString(9)),
        ChannelCount = r.GetInt32(10),
    };

    private static IptvChannel MapChannelRow(System.Data.Common.DbDataReader r) => new()
    {
        Id = r.GetInt32(0),
        ProviderId = r.GetInt32(1),
        Name = r.IsDBNull(2) ? "" : r.GetString(2),
        StreamUrl = r.IsDBNull(3) ? "" : r.GetString(3),
        LogoUrl = r.IsDBNull(4) ? null : r.GetString(4),
        Group = r.IsDBNull(5) ? null : r.GetString(5),
        TvgId = r.IsDBNull(6) ? null : r.GetString(6),
        TvgName = r.IsDBNull(7) ? null : r.GetString(7),
        StreamId = r.IsDBNull(8) ? null : r.GetString(8),
        SortOrder = r.GetInt32(9),
    };
}
