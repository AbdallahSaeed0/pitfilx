namespace Pitflix.API.Services.Trailers;

/// <summary>Temporary targeted diagnostics for known-missing official trailers (remove or disable after investigation).</summary>
internal static class TrailerIngestionTraceDiagnostics
{
    public const string LogPrefix = "Pitflix.Trailers.Trace";

    /// <summary>Stable ids for end-of-run summaries (must stay aligned with <see cref="MatchTraceId"/>).</summary>
    public static readonly string[] KnownTraceIds =
    [
        "jack_ryan_ghost_war",
        "mandalorian_grogu",
        "hunger_games_reaping"
    ];

    /// <summary>Returns a trace id when the YouTube title matches one of the known missing examples (substring heuristics).</summary>
    public static string? MatchTraceId(string? title)
    {
        if (string.IsNullOrWhiteSpace(title))
            return null;
        var n = title.ToLowerInvariant();
        if (n.Contains("jack") && n.Contains("ryan") && n.Contains("ghost"))
            return "jack_ryan_ghost_war";
        if (n.Contains("mandalorian") && n.Contains("grogu"))
            return "mandalorian_grogu";
        if (n.Contains("hunger") && n.Contains("games") && (n.Contains("reaping") || n.Contains("sunrise")))
            return "hunger_games_reaping";
        return null;
    }
}
