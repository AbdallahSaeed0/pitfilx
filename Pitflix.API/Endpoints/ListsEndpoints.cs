using System.Text.Json;
using Pitflix.API;
using Pitflix.API.Services;
using Pitflix.Core.Database;
using Pitflix.Core.Models;

namespace Pitflix.API.Endpoints;

public static class ListsEndpoints
{
    public static void MapListsEndpoints(this WebApplication app, JsonSerializerOptions jsonSerializerOptions)
    {
        app.MapGet("/api/lists", async (LibraryRepository repo, CancellationToken ct) =>
        {
            var rows = await repo.GetUserListSummaryRowsAsync(ct).ConfigureAwait(false);
            return Results.Json(rows);
        });

        app.MapGet("/api/lists/{id:int}", async (int id, LibraryRepository repo, CancellationToken ct) =>
        {
            var list = await repo.GetUserListByIdAsync(id, ct).ConfigureAwait(false);
            if (list == null)
                return Results.NotFound();
            return Results.Json(new
            {
                id = list.Id,
                name = list.Name,
                isDefault = list.IsDefault
            }, jsonSerializerOptions);
        });

        app.MapPost("/api/lists", async (CreateListBody body, LibraryRepository repo, CancellationToken ct) =>
        {
            try
            {
                var list = await repo.CreateUserListAsync(body.Name ?? "", ct).ConfigureAwait(false);
                return Results.Json(list);
            }
            catch (Exception ex)
            {
                app.Logger.LogWarning(ex, "Create user list failed");
                return Results.BadRequest(new { error = ex.Message });
            }
        });

        app.MapPut("/api/lists/{id:int}", async (int id, RenameListBody body, LibraryRepository repo, CancellationToken ct) =>
        {
            var ok = await repo.RenameUserListAsync(id, body.Name ?? "", ct).ConfigureAwait(false);
            return ok
                ? Results.Json(new { success = true }, jsonSerializerOptions)
                : Results.BadRequest(new { error = "Could not rename list (duplicate name or built-in list)." });
        });

        app.MapDelete("/api/lists/{id:int}", async (int id, LibraryRepository repo, CancellationToken ct) =>
        {
            var ok = await repo.DeleteUserListAsync(id, ct).ConfigureAwait(false);
            return Results.Json(new { success = ok });
        });

        app.MapGet("/api/lists/{id:int}/items", async (int id, LibraryRepository repo, ITmdbClientFactory tmdbClientFactory, CancellationToken ct) =>
        {
            var rows = await repo.GetListItemRowsAsync(id, ct).ConfigureAwait(false);

            var showIds = rows
                .Where(r => string.Equals(r.MediaType, "Series", StringComparison.OrdinalIgnoreCase) && r.LibraryDatabaseId is not null)
                .Select(r => r.LibraryDatabaseId!.Value)
                .ToList();
            var movieIds = rows
                .Where(r => !string.Equals(r.MediaType, "Series", StringComparison.OrdinalIgnoreCase) && r.LibraryDatabaseId is not null)
                .Select(r => r.LibraryDatabaseId!.Value)
                .ToList();

            var showsById = await repo.GetShowsByIdsAsync(showIds, ct).ConfigureAwait(false);
            var moviesById = await repo.GetMoviesByIdsAsync(movieIds, ct).ConfigureAwait(false);

            var cards = new List<MediaCardDto>();
            foreach (var row in rows)
            {
                if (string.Equals(row.MediaType, "Series", StringComparison.OrdinalIgnoreCase) &&
                    row.LibraryDatabaseId is { } sid)
                {
                    if (showsById.TryGetValue(sid, out var s))
                    {
                        cards.Add(MediaCardMappers.ToCardFromShow(s));
                        continue;
                    }
                }
                else if (row.LibraryDatabaseId is { } mid)
                {
                    if (moviesById.TryGetValue(mid, out var m))
                    {
                        cards.Add(MediaCardMappers.ToCardFromMovie(m));
                        continue;
                    }
                }

                cards.Add(new MediaCardDto
                {
                    Id = row.LibraryDatabaseId ?? 0,
                    TmdbId = row.TmdbId,
                    Title = row.Title,
                    Year = row.Year,
                    PosterLocalPath = row.PosterLocalPath,
                    PosterRemoteUrl = row.PosterRemoteUrl,
                    ImdbId = row.ImdbId,
                    IsArabic = false,
                    TmdbMediaType = string.Equals(row.MediaType, "Series", StringComparison.OrdinalIgnoreCase)
                        ? "Series"
                        : "Movie"
                });
            }

            var mapped = cards.Select(ImageUrls.MapMediaCard).ToList();
            var tmdbList = tmdbClientFactory.Create();
            await MediaCardPosterEnricher.EnrichMissingRemotePostersAsync(mapped, tmdbList, ct).ConfigureAwait(false);
            return Results.Json(mapped);
        });

        app.MapPost("/api/lists/{id:int}/items", async (int id, AddListItemBody body, LibraryRepository repo, CancellationToken ct) =>
        {
            await repo.AddListItemAsync(id, body.TmdbId, body.MediaType ?? "Movie",
                body.Title, body.PosterRemoteUrl, body.ImdbId, ct).ConfigureAwait(false);
            return Results.Json(new { success = true });
        });

        app.MapGet("/api/lists/{id:int}/contains", async (int id, int tmdbId, string? mediaType, LibraryRepository repo, CancellationToken ct) =>
        {
            var mt = string.IsNullOrWhiteSpace(mediaType) ? "Movie" : mediaType!;
            var inList = await repo.IsInListAsync(id, tmdbId, mt, ct).ConfigureAwait(false);
            return Results.Json(new { inList }, jsonSerializerOptions);
        });

        app.MapGet("/api/lists/{id:int}/tmdb-ids", async (int id, string? mediaType, LibraryRepository repo, CancellationToken ct) =>
        {
            var mt = string.IsNullOrWhiteSpace(mediaType) ? "Movie" : mediaType!;
            var set = await repo.GetListTmdbKeySetForMediaTypeAsync(id, mt, ct).ConfigureAwait(false);
            return Results.Json(set.Order().ToArray(), jsonSerializerOptions);
        });

        app.MapDelete("/api/lists/{listId:int}/items/{tmdbId:int}", async (int listId, int tmdbId, string? mediaType, LibraryRepository repo, CancellationToken ct) =>
        {
            var mt = string.IsNullOrWhiteSpace(mediaType) ? "Movie" : mediaType!;
            await repo.RemoveListItemAsync(listId, tmdbId, mt, ct).ConfigureAwait(false);
            return Results.Json(new { success = true });
        });
    }
}
