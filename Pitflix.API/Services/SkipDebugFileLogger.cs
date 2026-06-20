using Microsoft.Extensions.Logging;

namespace Pitflix.API.Services;

/// <summary>
/// Writes a dedicated, low-noise log file for just the intro/outro skip-detection
/// services (AudioFingerprintService, SkipFingerprintHostedService,
/// SkipSegmentDetectionService) — the main console is drowned in EF Core SQL command
/// logging, making it hard to find anything skip-related. The Tauri side tails this
/// file into the dev terminal alongside PitflixPlayer.log (see lib.rs).
/// </summary>
public sealed class SkipDebugFileLoggerProvider : ILoggerProvider
{
    public static readonly string LogPath = Path.Combine(AppContext.BaseDirectory, "skip-debug.log");

    private readonly object _writeLock = new();

    public ILogger CreateLogger(string categoryName) => new SkipDebugFileLogger(categoryName, this);

    internal void Write(string line)
    {
        lock (_writeLock)
        {
            try { File.AppendAllText(LogPath, line + Environment.NewLine); }
            catch { /* never crash the app trying to log */ }
        }
    }

    public void Dispose() { }

    private sealed class SkipDebugFileLogger : ILogger
    {
        private readonly string _category;
        private readonly SkipDebugFileLoggerProvider _provider;

        public SkipDebugFileLogger(string category, SkipDebugFileLoggerProvider provider)
        {
            _category = category;
            _provider = provider;
        }

        public IDisposable? BeginScope<TState>(TState state) where TState : notnull => null;

        private static readonly string[] SkipCategories =
        {
            "Pitflix.API.Services.AudioFingerprintService",
            "Pitflix.API.Services.SkipFingerprintHostedService",
            "Pitflix.API.Services.SkipSegmentDetectionService",
        };

        public bool IsEnabled(LogLevel logLevel) =>
            logLevel >= LogLevel.Information && Array.IndexOf(SkipCategories, _category) >= 0;

        public void Log<TState>(LogLevel logLevel, EventId eventId, TState state, Exception? exception,
            Func<TState, Exception?, string> formatter)
        {
            if (!IsEnabled(logLevel)) return;
            var shortCategory = _category[(_category.LastIndexOf('.') + 1)..];
            var line = $"[{DateTime.Now:HH:mm:ss.fff}] [{logLevel}] [{shortCategory}] {formatter(state, exception)}";
            if (exception != null) line += Environment.NewLine + exception;
            _provider.Write(line);
        }
    }
}
