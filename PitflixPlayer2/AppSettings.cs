using System;
using System.IO;
using System.Text.Json;

namespace PitflixPlayer;

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
