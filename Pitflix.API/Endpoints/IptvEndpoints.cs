using System.Text.Json;
using Pitflix.API.Services;
using Pitflix.Core.Models;

namespace Pitflix.API.Endpoints;

public static class IptvEndpoints
{
    public static void MapIptvEndpoints(this WebApplication app, JsonSerializerOptions jsonOpts)
    {
        // ── Providers ──────────────────────────────────────────────────────────

        app.MapGet("/api/iptv/providers", async (IptvService svc, CancellationToken ct) =>
        {
            var providers = await svc.GetProvidersAsync(ct).ConfigureAwait(false);
            return Results.Json(providers.Select(p => new
            {
                p.Id,
                p.DisplayName,
                type = p.Type.ToString(),
                p.M3uUrl,
                p.ServerUrl,
                p.Username,
                p.EpgUrl,
                p.ChannelCount,
                p.CreatedAt,
                p.LastRefreshedAt,
            }), jsonOpts);
        });

        app.MapGet("/api/iptv/providers/{id:int}", async (int id, IptvService svc, CancellationToken ct) =>
        {
            var p = await svc.GetProviderByIdAsync(id, ct).ConfigureAwait(false);
            if (p == null) return Results.NotFound();
            return Results.Json(new
            {
                p.Id,
                p.DisplayName,
                type = p.Type.ToString(),
                p.M3uUrl,
                p.ServerUrl,
                p.Username,
                p.EpgUrl,
                p.ChannelCount,
                p.CreatedAt,
                p.LastRefreshedAt,
            }, jsonOpts);
        });

        app.MapPost("/api/iptv/providers", async (CreateIptvProviderBody body, IptvService svc, CancellationToken ct) =>
        {
            try
            {
                var p = new IptvProvider
                {
                    DisplayName = body.DisplayName ?? "",
                    Type = ParseProviderType(body.Type),
                    M3uUrl = body.M3uUrl,
                    ServerUrl = body.ServerUrl,
                    Username = body.Username,
                    Password = body.Password,
                    EpgUrl = body.EpgUrl,
                };
                var id = await svc.CreateProviderAsync(p, ct).ConfigureAwait(false);
                return Results.Json(new { id });
            }
            catch (Exception ex)
            {
                return Results.BadRequest(new { error = ex.Message });
            }
        });

        app.MapPut("/api/iptv/providers/{id:int}", async (int id, CreateIptvProviderBody body, IptvService svc, CancellationToken ct) =>
        {
            var existing = await svc.GetProviderByIdAsync(id, ct).ConfigureAwait(false);
            if (existing == null) return Results.NotFound();

            existing.DisplayName = body.DisplayName ?? existing.DisplayName;
            existing.Type = ParseProviderType(body.Type);
            existing.M3uUrl = body.M3uUrl;
            existing.ServerUrl = body.ServerUrl;
            existing.Username = body.Username;
            existing.Password = body.Password;
            existing.EpgUrl = body.EpgUrl;

            await svc.UpdateProviderAsync(existing, ct).ConfigureAwait(false);
            return Results.Json(new { success = true }, jsonOpts);
        });

        app.MapDelete("/api/iptv/providers/{id:int}", async (int id, IptvService svc, CancellationToken ct) =>
        {
            await svc.DeleteProviderAsync(id, ct).ConfigureAwait(false);
            return Results.Json(new { success = true }, jsonOpts);
        });

        // ── Refresh (fetch channels from remote) ────────────────────────────

        app.MapPost("/api/iptv/providers/{id:int}/refresh", async (int id, IptvService svc, CancellationToken ct) =>
        {
            try
            {
                var count = await svc.RefreshProviderAsync(id, ct).ConfigureAwait(false);
                return Results.Json(new { channelCount = count }, jsonOpts);
            }
            catch (Exception ex)
            {
                return Results.BadRequest(new { error = ex.Message });
            }
        });

        // ── M3U file import (content sent as plain text body) ───────────────

        app.MapPost("/api/iptv/providers/{id:int}/import-m3u", async (int id, HttpRequest req, IptvService svc, CancellationToken ct) =>
        {
            try
            {
                using var sr = new StreamReader(req.Body);
                var content = await sr.ReadToEndAsync(ct).ConfigureAwait(false);
                if (string.IsNullOrWhiteSpace(content))
                    return Results.BadRequest(new { error = "Empty M3U content." });

                var count = await svc.ImportM3uContentAsync(id, content, ct).ConfigureAwait(false);
                return Results.Json(new { channelCount = count }, jsonOpts);
            }
            catch (Exception ex)
            {
                return Results.BadRequest(new { error = ex.Message });
            }
        });

        // ── Test Xtream connection ───────────────────────────────────────────

        app.MapPost("/api/iptv/test-xtream", async (TestXtreamBody body, IptvService svc, CancellationToken ct) =>
        {
            var ok = await svc.TestXtreamConnectionAsync(
                body.ServerUrl ?? "", body.Username ?? "", body.Password ?? "", ct).ConfigureAwait(false);
            return Results.Json(new { success = ok }, jsonOpts);
        });

        // ── Channels ────────────────────────────────────────────────────────

        app.MapGet("/api/iptv/providers/{id:int}/channels", async (int id, string? group, string? search, IptvService svc, CancellationToken ct) =>
        {
            var channels = await svc.GetChannelsAsync(id, group, search, ct).ConfigureAwait(false);
            return Results.Json(channels.Select(c => new
            {
                c.Id,
                c.ProviderId,
                c.Name,
                c.StreamUrl,
                c.LogoUrl,
                c.Group,
                c.TvgId,
                c.TvgName,
                c.StreamId,
                c.SortOrder,
            }), jsonOpts);
        });

        app.MapGet("/api/iptv/providers/{id:int}/groups", async (int id, IptvService svc, CancellationToken ct) =>
        {
            var groups = await svc.GetGroupsAsync(id, ct).ConfigureAwait(false);
            return Results.Json(groups, jsonOpts);
        });
    }

    private static IptvProviderType ParseProviderType(string? type) => type switch
    {
        "XtreamCodes" => IptvProviderType.XtreamCodes,
        "EpgOnly" => IptvProviderType.EpgOnly,
        _ => IptvProviderType.M3uUrl,
    };
}

internal sealed record CreateIptvProviderBody(
    string? DisplayName,
    string? Type,
    string? M3uUrl,
    string? ServerUrl,
    string? Username,
    string? Password,
    string? EpgUrl);

internal sealed record TestXtreamBody(string? ServerUrl, string? Username, string? Password);
