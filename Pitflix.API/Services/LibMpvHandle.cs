using LibMpv.Client;

namespace Pitflix.API.Services;

/// <summary>
/// Wraps a single libmpv instance (in-process, no separate mpv.exe).
/// Property callbacks fire on libmpv's internal event thread — callers
/// must lock before touching shared session state.
/// </summary>
internal sealed class LibMpvHandle : IDisposable
{
    private readonly MpvContext _mpv;
    private volatile bool _disposed;

    // time-pos fires every video frame — throttle to 500 ms max
    private DateTime _lastTimePosAt = DateTime.MinValue;

    // Wired by PlayerService after construction
    public Action<double>? OnTimePos;
    public Action<bool>?   OnPause;
    public Action<double>? OnDuration;
    public Action<string>? OnPath;
    public Action?         OnEnded;

    public LibMpvHandle(
        string   filePath,
        double   startPosition,
        long?    hwnd,
        string[] scriptPaths,
        string?  subtitleFile)
    {
        _mpv = new MpvContext();

        // ── Pre-init options (must be set before mpv initializes) ──────────
        _mpv.SetOptionString("terminal",               "no");
        _mpv.SetOptionString("keep-open",              "always");
        _mpv.SetOptionString("osc",                    "no");
        _mpv.SetOptionString("osd-level",              "0");
        _mpv.SetOptionString("input-default-bindings", "no");
        _mpv.SetOptionString("input-cursor",           "no");
        _mpv.SetOptionString("cursor-autohide",        "no");
        _mpv.SetOptionString("user-agent",             "pitflix/1.0");

        if (hwnd.HasValue)
        {
            _mpv.SetOptionString("wid",          hwnd.Value.ToString());
            _mpv.SetOptionString("force-window", "immediate");
            _mpv.SetOptionString("pause",        "yes");   // WPF unpauses once ready
        }

        if (startPosition > 0.5)
            _mpv.SetOptionString("start",
                startPosition.ToString("F3", System.Globalization.CultureInfo.InvariantCulture));

        foreach (var script in scriptPaths)
            if (!string.IsNullOrWhiteSpace(script))
                _mpv.SetOptionString("script", script);

        // ── Events ─────────────────────────────────────────────────────────
        _mpv.Shutdown += (_, _) => { if (!_disposed) OnEnded?.Invoke(); };
        _mpv.EndFile  += (_, _) => { if (!_disposed) OnEnded?.Invoke(); };

        // ── Observed properties ────────────────────────────────────────────
        // time-pos fires every rendered frame — throttle to ~500 ms
        _mpv.ObserveProperty("time-pos", () =>
        {
            if (_disposed) return;
            var now = DateTime.UtcNow;
            if ((now - _lastTimePosAt).TotalMilliseconds < 450) return;
            _lastTimePosAt = now;
            var v = _mpv.GetPropertyDouble("time-pos");
            if (v.HasValue) OnTimePos?.Invoke(v.Value);
        });

        // pause is bool — MpvContext has a typed overload for this
        _mpv.ObserveProperty("pause", (paused) =>
        {
            if (!_disposed) OnPause?.Invoke(paused);
        });

        _mpv.ObserveProperty("duration", () =>
        {
            if (_disposed) return;
            var v = _mpv.GetPropertyDouble("duration");
            if (v.HasValue && v.Value > 0) OnDuration?.Invoke(v.Value);
        });

        _mpv.ObserveProperty("path", () =>
        {
            if (_disposed) return;
            var v = _mpv.GetPropertyString("path");
            if (!string.IsNullOrEmpty(v)) OnPath?.Invoke(v);
        });

        // ── Start playback ─────────────────────────────────────────────────
        // loadfile also triggers mpv_initialize() if not yet done
        var cmd = new List<string> { "loadfile", filePath, "replace" };
        _mpv.Command([.. cmd]);

        if (!string.IsNullOrWhiteSpace(subtitleFile))
            _mpv.Command(["sub-add", subtitleFile, "auto"]);
    }

    // ── Commands ────────────────────────────────────────────────────────────

    public void Command(params string[] args)
    {
        if (_disposed) return;
        try { _mpv.Command(args); }
        catch { }
    }

    public void SetFlag(string name, bool value)
    {
        if (_disposed) return;
        try { _mpv.SetPropertyFlag(name, value); }
        catch { }
    }

    public void SetString(string name, string value)
    {
        if (_disposed) return;
        try { _mpv.SetPropertyString(name, value); }
        catch { }
    }

    public void SetDouble(string name, double value)
    {
        if (_disposed) return;
        try { _mpv.SetPropertyDouble(name, value); }
        catch { }
    }

    public void SetLong(string name, long value)
    {
        if (_disposed) return;
        try { _mpv.SetPropertyLong(name, value); }
        catch { }
    }

    public string? GetString(string name)
    {
        if (_disposed) return null;
        try { return _mpv.GetPropertyString(name); }
        catch { return null; }
    }

    // ── Track list (subtitle / audio discovery) ─────────────────────────────
    // Uses indexed track-list/N/... properties — no unsafe node API needed.
    public List<(long Id, string Type, string Lang, string Title)> GetTrackList()
    {
        var result = new List<(long, string, string, string)>();
        if (_disposed) return result;
        try
        {
            var count = _mpv.GetPropertyLong("track-list/count") ?? 0;
            for (long i = 0; i < count; i++)
            {
                var type = _mpv.GetPropertyString($"track-list/{i}/type") ?? "";
                if (type != "sub" && type != "audio") continue;
                var id    = _mpv.GetPropertyLong  ($"track-list/{i}/id")    ?? i + 1;
                var lang  = _mpv.GetPropertyString($"track-list/{i}/lang")  ?? "";
                var title = _mpv.GetPropertyString($"track-list/{i}/title") ?? "";
                result.Add((id, type, lang, title));
            }
        }
        catch { }
        return result;
    }

    // ── Dispose ─────────────────────────────────────────────────────────────

    public void Dispose()
    {
        if (_disposed) return;
        _disposed = true;
        try { _mpv.Command(["quit"]); } catch { }
        try { _mpv.Dispose(); } catch { }
    }
}
