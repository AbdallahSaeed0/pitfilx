using System.Diagnostics;
using Microsoft.Extensions.Configuration;
using Microsoft.Extensions.Logging;

namespace Pitflix.API.Services;

/// <summary>
/// Resolves the PHP CLI for <see cref="PhpImdbGrabberClient"/>: config, env, common Windows paths, then <c>where php</c>.
/// Result is cached for the process lifetime.
/// </summary>
public static class PhpExecutableResolver
{
    private static readonly object Gate = new();
    private static string? _cached;

    /// <summary>Clears cache (e.g. for tests).</summary>
    public static void ClearCache() => _cached = null;

    public static string? Resolve(IConfiguration configuration, ILogger? log = null)
    {
        lock (Gate)
        {
            if (_cached != null)
                return _cached;

            static bool LooksLikeFile(string p) =>
                p.EndsWith(".exe", StringComparison.OrdinalIgnoreCase) ||
                p.Contains(Path.DirectorySeparatorChar) ||
                p.Contains('/', StringComparison.Ordinal);

            string? tryPath(string? raw)
            {
                if (string.IsNullOrWhiteSpace(raw))
                    return null;
                var p = raw.Trim();
                if (LooksLikeFile(p) && File.Exists(p))
                    return p;
                if (p.Equals("php", StringComparison.OrdinalIgnoreCase))
                {
                    var w = TryWherePhpOnWindows(log);
                    if (!string.IsNullOrEmpty(w))
                        return w;
                    foreach (var c in CommonWindowsPhpPaths())
                    {
                        if (File.Exists(c))
                            return c;
                    }

                    return "php";
                }

                return null;
            }

            var fromCfg = configuration["PhpExecutable"];
            var a = tryPath(fromCfg);
            if (a != null)
            {
                _cached = a;
                log?.LogDebug("PhpExecutable: using config/env path {Path}", a);
                return _cached;
            }

            var fromEnv = Environment.GetEnvironmentVariable("PHP_EXECUTABLE");
            var b = tryPath(fromEnv);
            if (b != null)
            {
                _cached = b;
                log?.LogDebug("PhpExecutable: using PHP_EXECUTABLE {Path}", b);
                return _cached;
            }

            foreach (var c in CommonWindowsPhpPaths())
            {
                if (!File.Exists(c))
                    continue;
                _cached = c;
                log?.LogDebug("PhpExecutable: using common path {Path}", c);
                return _cached;
            }

            var where = TryWherePhpOnWindows(log);
            if (!string.IsNullOrEmpty(where))
            {
                _cached = where;
                log?.LogInformation("PhpExecutable: resolved via where.exe: {Path}", where);
                return _cached;
            }

            _cached = "php";
            log?.LogDebug("PhpExecutable: falling back to \"php\" on PATH");
            return _cached;
        }
    }

    private static IEnumerable<string> CommonWindowsPhpPaths()
    {
        if (!OperatingSystem.IsWindows())
            yield break;

        var pf = Environment.GetFolderPath(Environment.SpecialFolder.ProgramFiles);
        var pf86 = Environment.GetFolderPath(Environment.SpecialFolder.ProgramFilesX86);
        foreach (var baseDir in new[] { pf, pf86, @"C:\php", @"C:\tools\php", Path.Combine(Environment.GetFolderPath(Environment.SpecialFolder.LocalApplicationData), "Programs") })
        {
            if (string.IsNullOrEmpty(baseDir))
                continue;
            yield return Path.Combine(baseDir, "php", "php.exe");
            yield return Path.Combine(baseDir, "PHP", "php.exe");
        }

        yield return Path.Combine(Environment.GetFolderPath(Environment.SpecialFolder.UserProfile), "scoop", "apps", "php", "current", "php.exe");
        yield return Path.Combine(Environment.GetFolderPath(Environment.SpecialFolder.UserProfile), "scoop", "shims", "php.exe");
    }

    private static string? TryWherePhpOnWindows(ILogger? log)
    {
        if (!OperatingSystem.IsWindows())
            return null;

        try
        {
            using var proc = new Process
            {
                StartInfo = new ProcessStartInfo
                {
                    FileName = Path.Combine(Environment.SystemDirectory, "where.exe"),
                    ArgumentList = { "php" },
                    RedirectStandardOutput = true,
                    RedirectStandardError = true,
                    UseShellExecute = false,
                    CreateNoWindow = true,
                },
            };
            proc.Start();
            var stdout = proc.StandardOutput.ReadToEnd();
            proc.WaitForExit(8000);
            if (proc.ExitCode != 0)
                return null;
            var line = stdout.Split(new[] { '\r', '\n' }, StringSplitOptions.RemoveEmptyEntries).FirstOrDefault()?.Trim();
            if (string.IsNullOrEmpty(line) || !File.Exists(line))
                return null;
            return line;
        }
        catch (Exception ex)
        {
            log?.LogTrace(ex, "PhpExecutable: where.exe php failed");
            return null;
        }
    }
}
