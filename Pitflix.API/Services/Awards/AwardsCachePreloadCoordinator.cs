using Microsoft.Extensions.DependencyInjection;
using Pitflix.Core.Database;

namespace Pitflix.API.Services.Awards;

/// <summary>Background awards cache build (TMDB + library flags) with polling status.</summary>
public sealed class AwardsCachePreloadCoordinator
{
    private readonly IServiceScopeFactory _scopes;
    private readonly IAwardsDataProvider _provider;
    private readonly AwardsService _awards;

    private readonly object _gate = new();
    private Task? _running;
    private CancellationTokenSource? _runCts;
    private AwardsPreloadStatusDto _status = new();
    private string? _lastCompletedAt;

    public AwardsCachePreloadCoordinator(IServiceScopeFactory scopes, IAwardsDataProvider provider, AwardsService awards)
    {
        _scopes = scopes;
        _provider = provider;
        _awards = awards;
    }

    public AwardsPreloadStatusDto GetStatus()
    {
        lock (_gate)
        {
            return new AwardsPreloadStatusDto
            {
                Running = _status.Running,
                Phase = _status.Phase,
                AwardId = _status.AwardId,
                Year = _status.Year,
                CategoryId = _status.CategoryId,
                ProcessedNominees = _status.ProcessedNominees,
                TotalNominees = _status.TotalNominees,
                SuccessCount = _status.SuccessCount,
                FailedCount = _status.FailedCount,
                SkippedNominees = _status.SkippedNominees,
                CachedRowCount = _status.CachedRowCount,
                LastError = _status.LastError,
                LastCompletedAt = _lastCompletedAt
            };
        }
    }

    /// <summary>Starts a background job. Returns false if a run is already active.</summary>
    public bool TryStart(bool clearFirst)
    {
        lock (_gate)
        {
            if (_running is { IsCompleted: false })
                return false;

            _runCts = new CancellationTokenSource();
            var token = _runCts.Token;
            _running = RunAsync(clearFirst, token);
            return true;
        }
    }

    /// <summary>Signals the current run to stop (best-effort; may finish the current edition).</summary>
    public void RequestCancel()
    {
        CancellationTokenSource? cts;
        lock (_gate)
            cts = _runCts;

        try
        {
            cts?.Cancel();
        }
        catch (ObjectDisposedException)
        {
            /* ignored */
        }
    }

    private async Task RunAsync(bool clearFirst, CancellationToken ct)
    {
        try
        {
            lock (_gate)
            {
                _status = new AwardsPreloadStatusDto
                {
                    Running = true,
                    Phase = clearFirst ? "clear" : "scan",
                    ProcessedNominees = 0,
                    TotalNominees = 0,
                    SuccessCount = 0,
                    FailedCount = 0,
                    LastError = null
                };
            }

            await using (var scope0 = _scopes.CreateAsyncScope())
            {
                var cacheRepo0 = scope0.ServiceProvider.GetRequiredService<AwardNomineeCacheRepository>();
                if (clearFirst)
                    await cacheRepo0.DeleteAllAsync(ct).ConfigureAwait(false);
                var n0 = await cacheRepo0.CountRowsAsync(ct).ConfigureAwait(false);
                lock (_gate)
                {
                    _status.CachedRowCount = n0;
                }
            }

            var catalog = await _awards.GetCatalogAsync(ct).ConfigureAwait(false);
            var totalNominees = 0;
            foreach (var a in catalog)
            {
                var years = await _provider.ListYearsAsync(a.Id, ct).ConfigureAwait(false);
                foreach (var y in years)
                {
                    var edition = await _provider.TryLoadEditionAsync(a.Id, y, ct).ConfigureAwait(false);
                    if (edition == null)
                        continue;
                    foreach (var c in edition.Categories)
                        totalNominees += c.Nominees.Count;
                }
            }

            lock (_gate)
            {
                _status.TotalNominees = totalNominees;
                _status.Phase = "enrich";
            }

            var processed = 0;
            var successRows = 0;
            var failedNominees = 0;
            var skippedNominees = 0;
            string? lastErr = null;

            foreach (var a in catalog)
            {
                var years = await _provider.ListYearsAsync(a.Id, ct).ConfigureAwait(false);
                foreach (var y in years)
                {
                    ct.ThrowIfCancellationRequested();

                    await using var scope = _scopes.CreateAsyncScope();
                    var cacheRepo = scope.ServiceProvider.GetRequiredService<AwardNomineeCacheRepository>();
                    var lib = scope.ServiceProvider.GetRequiredService<LibraryRepository>();

                    var edition = await _provider.TryLoadEditionAsync(a.Id, y, ct).ConfigureAwait(false);
                    if (edition == null)
                        continue;

                    var editionNomineeCount = 0;
                    foreach (var c in edition.Categories)
                        editionNomineeCount += c.Nominees.Count;

                    // Incremental mode: skip editions that are already cached.
                    // This way "Update cache" only fetches editions that have never been downloaded.
                    if (!clearFirst)
                    {
                        var existingCount = await cacheRepo.CountEditionRowsAsync(a.Id, y, ct).ConfigureAwait(false);
                        if (existingCount > 0)
                        {
                            processed += editionNomineeCount;
                            skippedNominees += editionNomineeCount;
                            lock (_gate)
                            {
                                _status.ProcessedNominees = processed;
                                _status.SkippedNominees = skippedNominees;
                            }
                            continue;
                        }
                    }

                    lock (_gate)
                    {
                        _status.AwardId = a.Id;
                        _status.Year = y;
                        _status.CategoryId = null;
                    }

                    try
                    {
                        var rows =
                            await _awards.BuildCacheRowsForEditionAsync(a.Id, y, edition, lib, ct).ConfigureAwait(false);
                        await cacheRepo.UpsertEditionRowsAsync(a.Id, y, rows, ct).ConfigureAwait(false);
                        successRows += rows.Count;
                        processed += editionNomineeCount;
                        lock (_gate)
                        {
                            _status.ProcessedNominees = processed;
                            _status.SuccessCount = successRows;
                        }
                    }
                    catch (OperationCanceledException)
                    {
                        throw;
                    }
                    catch (Exception ex)
                    {
                        lastErr = ex.Message;
                        failedNominees += editionNomineeCount;
                        processed += editionNomineeCount;
                        lock (_gate)
                        {
                            _status.ProcessedNominees = processed;
                            _status.FailedCount = failedNominees;
                            _status.LastError = lastErr;
                        }
                    }

                    var cnt = await cacheRepo.CountRowsAsync(ct).ConfigureAwait(false);
                    lock (_gate)
                    {
                        _status.CachedRowCount = cnt;
                    }
                }
            }

            lock (_gate)
            {
                _status.Running = false;
                _status.Phase = "done";
                _status.ProcessedNominees = totalNominees;
                _status.SuccessCount = successRows;
                _status.FailedCount = failedNominees;
                _status.LastError = lastErr;
                _lastCompletedAt = DateTime.UtcNow.ToString("o", System.Globalization.CultureInfo.InvariantCulture);
            }
        }
        catch (OperationCanceledException)
        {
            lock (_gate)
            {
                _status.Running = false;
                _status.Phase = "cancelled";
                _status.LastError = null;
                _lastCompletedAt = DateTime.UtcNow.ToString("o", System.Globalization.CultureInfo.InvariantCulture);
            }
        }
        catch (Exception ex)
        {
            lock (_gate)
            {
                _status.Running = false;
                _status.Phase = "error";
                _status.LastError = ex.Message;
                _lastCompletedAt = DateTime.UtcNow.ToString("o", System.Globalization.CultureInfo.InvariantCulture);
            }
        }
        finally
        {
            lock (_gate)
            {
                _runCts?.Dispose();
                _runCts = null;
            }
        }
    }
}
