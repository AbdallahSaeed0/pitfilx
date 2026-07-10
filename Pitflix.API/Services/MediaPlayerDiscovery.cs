namespace Pitflix.API.Services;

public static class MediaPlayerDiscovery
{
    public static List<object> DiscoverCandidates()
    {
        var list = new List<object>();
        var seenPaths = new HashSet<string>(StringComparer.OrdinalIgnoreCase);

        void TryAdd(string label, string path)
        {
            try
            {
                if (File.Exists(path) && !seenPaths.Contains(path))
                {
                    list.Add(new { label, path });
                    seenPaths.Add(path);
                }
            }
            catch
            {
                /* ignore */
            }
        }

        var pf = Environment.GetFolderPath(Environment.SpecialFolder.ProgramFiles);
        var pf86 = Environment.GetFolderPath(Environment.SpecialFolder.ProgramFilesX86);

        TryAdd("VLC", Path.Combine(pf, "VideoLAN", "VLC", "vlc.exe"));
        TryAdd("VLC (32-bit)", Path.Combine(pf86, "VideoLAN", "VLC", "vlc.exe"));
        TryAdd("mpv", Path.Combine(pf, "mpv", "mpv.exe"));
        TryAdd("MPC-HC 64-bit", Path.Combine(pf86, "MPC-HC", "mpc-hc64.exe"));
        TryAdd("MPC-HC 64-bit", Path.Combine(pf, "MPC-HC", "mpc-hc64.exe"));
        TryAdd("MPC-HC", Path.Combine(pf86, "MPC-HC", "mpc-hc.exe"));
        TryAdd("MPC-HC", Path.Combine(pf, "MPC-HC", "mpc-hc.exe"));
        TryAdd("MPC-BE 64-bit", Path.Combine(pf, "MPC-BE x64", "mpc-be64.exe"));
        TryAdd("MPC-BE", Path.Combine(pf86, "MPC-BE", "mpc-be.exe"));
        TryAdd("PotPlayer", Path.Combine(pf, "DAUM", "PotPlayer", "PotPlayerMini64.exe"));
        TryAdd("PotPlayer (x86)", Path.Combine(pf86, "DAUM", "PotPlayer", "PotPlayerMini64.exe"));
        TryAdd("PotPlayer", Path.Combine(pf, "DAUM", "PotPlayer", "PotPlayerMini.exe"));
        TryAdd("KMPlayer", Path.Combine(pf86, "KMPlayer", "kmplayer.exe"));
        TryAdd("KMPlayer", Path.Combine(pf, "KMPlayer", "kmplayer.exe"));
        TryAdd("Windows Media Player", Path.Combine(pf, "Windows Media Player", "wmplayer.exe"));

        var playerNames = new[]
        {
            "vlc.exe", "mpv.exe", "mpc-hc64.exe", "mpc-hc.exe", "mpc-be64.exe", "mpc-be.exe",
            "PotPlayerMini64.exe", "PotPlayerMini.exe", "kmplayer.exe", "smplayer.exe",
            "bsplayer.exe", "gomplayer.exe", "zoom player.exe"
        };

        try
        {
            if (Directory.Exists(pf))
            {
                foreach (var dir in Directory.GetDirectories(pf))
                {
                    foreach (var playerName in playerNames)
                    {
                        var exePath = Path.Combine(dir, playerName);
                        if (File.Exists(exePath) && !seenPaths.Contains(exePath))
                        {
                            var dirName = Path.GetFileName(dir);
                            TryAdd($"{dirName} ({playerName})", exePath);
                        }

                        try
                        {
                            foreach (var subDir in Directory.GetDirectories(dir))
                            {
                                var subExePath = Path.Combine(subDir, playerName);
                                if (File.Exists(subExePath) && !seenPaths.Contains(subExePath))
                                {
                                    var subDirName = Path.GetFileName(subDir);
                                    TryAdd($"{subDirName} ({playerName})", subExePath);
                                }
                            }
                        }
                        catch { /* ignore subdirectory scan errors */ }
                    }
                }
            }

            if (Directory.Exists(pf86) && !string.Equals(pf, pf86, StringComparison.OrdinalIgnoreCase))
            {
                foreach (var dir in Directory.GetDirectories(pf86))
                {
                    foreach (var playerName in playerNames)
                    {
                        var exePath = Path.Combine(dir, playerName);
                        if (File.Exists(exePath) && !seenPaths.Contains(exePath))
                        {
                            var dirName = Path.GetFileName(dir);
                            TryAdd($"{dirName} ({playerName})", exePath);
                        }

                        try
                        {
                            foreach (var subDir in Directory.GetDirectories(dir))
                            {
                                var subExePath = Path.Combine(subDir, playerName);
                                if (File.Exists(subExePath) && !seenPaths.Contains(subExePath))
                                {
                                    var subDirName = Path.GetFileName(subDir);
                                    TryAdd($"{subDirName} ({playerName})", subExePath);
                                }
                            }
                        }
                        catch { /* ignore subdirectory scan errors */ }
                    }
                }
            }
        }
        catch
        {
            /* ignore scan errors */
        }

        return list;
    }
}
