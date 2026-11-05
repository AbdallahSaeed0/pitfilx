using System;
using System.Collections.Generic;
using System.IO;
using System.Linq;
using System.Text.Json;

namespace PitflixPlayer;

/// <summary>Remembered tracks for one show. Null fields mean "no preference".</summary>
internal sealed class ShowTrackPref
{
    public string? AudioLang  { get; set; }
    public string? AudioTitle { get; set; }
    /// <summary>"off" or "lang"; null = no subtitle preference for this show.</summary>
    public string? SubMode    { get; set; }
    public string? SubLang    { get; set; }
    public string? SubTitle   { get; set; }
    /// <summary>Dual subtitles: "off" or "lang" for the second subtitle (mpv secondary-sid, shown at the top).</summary>
    public string? SecondaryMode  { get; set; }
    public string? SecondaryLang  { get; set; }
    public string? SecondaryTitle { get; set; }
    public long    UpdatedUtcTicks { get; set; }
}

/// <summary>
/// Lightweight per-user settings persisted to
/// <c>%LOCALAPPDATA%\PitflixPlayer\settings.json</c>.
///
/// Currently holds only the preferred-subtitle state — the user's complaint
/// was that picking a non-default subtitle on one video didn't carry to the
/// next.  We snapshot their choice every time they pick one and re-apply on
/// every file-load (within a session) and every PitflixPlayer launch (across
/// sessions).  More fields can be added here without changing the call sites.
///
/// Failure modes are deliberately silent — corrupt JSON, missing dir, no
/// write permission → we just return defaults / skip the save.  Settings are
/// a nice-to-have, never a correctness requirement.
/// </summary>
internal sealed class AppSettings
{
    private static readonly string _path = Path.Combine(
        Environment.GetFolderPath(Environment.SpecialFolder.LocalApplicationData),
        "PitflixPlayer", "settings.json");

    // ── Subtitle preference ──────────────────────────────────────────────────
    //
    // PreferredSubMode encodes the user's last explicit choice:
    //   "default" — no preference; mpv picks based on its own --slang etc.
    //   "off"     — user explicitly chose "Off" in the CC menu; sid=no on every file.
    //   "lang"    — user picked a specific track; PreferredSubLang holds the lang code.
    public string  PreferredSubMode { get; set; } = "default";
    public string? PreferredSubLang { get; set; }

    // ── Skip amount ──────────────────────────────────────────────────────────
    //
    // Seconds jumped by the Left/Right arrow keys, the mouse-wheel seek zone
    // (bottom 15% of the window), and the "Skip Amount" context-menu picker.
    public int SkipSeconds { get; set; } = 5;

    // ── Per-show track memory ────────────────────────────────────────────────
    //
    // Audio + subtitle choice per show ("show:<libraryShowId>" or "dir:<folder>"),
    // matched by language/title on each new episode since mpv track indices drift.
    // Takes precedence over the global PreferredSub* above for that show.
    public Dictionary<string, ShowTrackPref> ShowTrackPrefs { get; set; } = new();

    private const int MaxShowTrackPrefs = 300;
    private readonly object _showPrefsLock = new();

    public ShowTrackPref? GetShowTrackPref(string key)
    {
        lock (_showPrefsLock)
            return ShowTrackPrefs.TryGetValue(key, out var p) ? p : null;
    }

    public void UpdateShowTrackPref(string key, Action<ShowTrackPref> update)
    {
        lock (_showPrefsLock)
        {
            if (!ShowTrackPrefs.TryGetValue(key, out var pref))
                ShowTrackPrefs[key] = pref = new ShowTrackPref();
            update(pref);
            pref.UpdatedUtcTicks = DateTime.UtcNow.Ticks;
            if (ShowTrackPrefs.Count > MaxShowTrackPrefs)
            {
                foreach (var stale in ShowTrackPrefs.OrderBy(kv => kv.Value.UpdatedUtcTicks)
                             .Take(ShowTrackPrefs.Count - MaxShowTrackPrefs).Select(kv => kv.Key).ToList())
                    ShowTrackPrefs.Remove(stale);
            }
            Save();
        }
    }

    public static AppSettings Load()
    {
        try
        {
            if (File.Exists(_path))
            {
                var json = File.ReadAllText(_path);
                var s = JsonSerializer.Deserialize<AppSettings>(json);
                if (s is not null) return s;
            }
        }
        catch (Exception ex)
        {
            App.Log($"AppSettings.Load failed (non-fatal): {ex.Message}");
        }
        return new AppSettings();
    }

    public void Save()
    {
        try
        {
            var dir = Path.GetDirectoryName(_path);
            if (!string.IsNullOrEmpty(dir)) Directory.CreateDirectory(dir);
            File.WriteAllText(_path, JsonSerializer.Serialize(this,
                new JsonSerializerOptions { WriteIndented = true }));
        }
        catch (Exception ex)
        {
            App.Log($"AppSettings.Save failed (non-fatal): {ex.Message}");
        }
    }
}
