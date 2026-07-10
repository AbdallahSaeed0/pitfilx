using System.Diagnostics;
using System.Text.Json;
using Microsoft.AspNetCore.Hosting;
using Microsoft.Extensions.Logging;

namespace Pitflix.API.Services;

/// <summary>
/// Tier-1 IMDb ratings via bundled <c>php-imdb-detail/fetch_rating.php</c> (PHP CLI).
/// Fails softly when PHP or the script is unavailable — callers fall back to MDBList/TMDB.
/// </summary>
public sealed class PhpImdbGrabberClient
{
    private readonly ILogger<PhpImdbGrabberClient> _log;
    private readonly IWebHostEnvironment _env;
    private readonly IConfiguration _cfg;

    public PhpImdbGrabberClient(ILogger<PhpImdbGrabberClient> log, IWebHostEnvironment env, IConfiguration cfg)
    {
        _log = log;
        _env = env;
        _cfg = cfg;
    }

    public bool IsLikelyAvailable =>
        !string.IsNullOrWhiteSpace(ResolvePhpExecutable()) && File.Exists(ResolveScriptPath());

    /// <summary>Returns IMDb rating out of 10 as display string and raw vote count string if parsed.</summary>
    public async Task<PhpImdbRatingResult?> TryFetchAsync(string? imdbId, CancellationToken ct)
    {
        if (string.IsNullOrWhiteSpace(imdbId) || !imdbId.StartsWith("tt", StringComparison.OrdinalIgnoreCase) ||
            imdbId.Length < 3)
            return null;

        var php = ResolvePhpExecutable();
        var script = ResolveScriptPath();
        if (string.IsNullOrEmpty(php) || !File.Exists(script))
        {
            _log.LogDebug("PhpImdb: php or script missing (php={Php}, script={Script})", php, script);
            return null;
        }

        try
        {
            using var proc = new Process
            {
                StartInfo = new ProcessStartInfo
                {
                    FileName = php,
                    ArgumentList = { script, imdbId.Trim() },
                    RedirectStandardOutput = true,
                    RedirectStandardError = true,
                    UseShellExecute = false,
                    CreateNoWindow = true,
                    WorkingDirectory = Path.GetDirectoryName(script) ?? _env.ContentRootPath,
                },
            };
            proc.Start();
            var stdoutTask = proc.StandardOutput.ReadToEndAsync(ct);
            var stderrTask = proc.StandardError.ReadToEndAsync(ct);
            using var reg = ct.Register(() =>
            {
                try
                {
                    if (!proc.HasExited)
                        proc.Kill(entireProcessTree: true);
                }
                catch
                {
                    /* ignore */
                }
            });
            var completed = await Task.Run(() => proc.WaitForExit(15000), ct).ConfigureAwait(false);
            if (!completed)
            {
                _log.LogWarning("PhpImdb: timeout for {Imdb}", imdbId);
                return null;
            }

            var json = await stdoutTask.ConfigureAwait(false);
            _ = await stderrTask.ConfigureAwait(false);
            if (proc.ExitCode != 0 && string.IsNullOrWhiteSpace(json))
                return null;

            using var doc = JsonDocument.Parse(json);
            var root = doc.RootElement;
            if (root.TryGetProperty("error", out _))
                return null;
            if (!root.TryGetProperty("rating", out var rEl))
                return null;
            var rating = rEl.GetString();
            if (string.IsNullOrWhiteSpace(rating))
                return null;
            string? votes = null;
            if (root.TryGetProperty("votes", out var vEl) && vEl.ValueKind == JsonValueKind.String)
                votes = vEl.GetString();
            else if (root.TryGetProperty("votes", out vEl) && vEl.ValueKind == JsonValueKind.Number)
                votes = vEl.GetRawText();

            return new PhpImdbRatingResult(rating.Trim(), votes, "php-imdb-detail");
        }
        catch (Exception ex)
        {
            _log.LogDebug(ex, "PhpImdb: failed for {Imdb}", imdbId);
            return null;
        }
    }

    private string? ResolvePhpExecutable() => PhpExecutableResolver.Resolve(_cfg, _log);

    private string ResolveScriptPath()
    {
        var fromCfg = _cfg["PhpImdbDetailScript"]?.Trim();
        if (!string.IsNullOrEmpty(fromCfg) && File.Exists(fromCfg))
            return fromCfg;
        return Path.Combine(_env.ContentRootPath, "External", "php-imdb-detail", "fetch_rating.php");
    }
}

public sealed record PhpImdbRatingResult(string RatingDisplay, string? VoteCountDisplay, string Source);
