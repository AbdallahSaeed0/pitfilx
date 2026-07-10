namespace Pitflix.API.Services;

/// <summary>
/// Resolves a <c>Data/{subfolder}</c> directory using the same multi-candidate strategy
/// across every launch mode: dev (content root), self-contained/framework-dependent publish
/// (<see cref="AppContext.BaseDirectory"/>), and the Tauri NSIS installer (resources placed
/// under <c>binaries\</c> next to the exe, either in the base dir or next to the running process).
/// </summary>
public static class DataRootResolver
{
    /// <summary>Falls back to the content-root candidate even if absent — callers handle missing files gracefully.</summary>
    public static string Resolve(IWebHostEnvironment env, string subfolder)
    {
        var fromContentRoot = Path.Combine(env.ContentRootPath, "Data", subfolder);
        if (Directory.Exists(fromContentRoot))
            return fromContentRoot;

        var fromBaseDir = Path.Combine(AppContext.BaseDirectory, "Data", subfolder);
        if (Directory.Exists(fromBaseDir))
            return fromBaseDir;

        // Tauri NSIS installer places resources under binaries\ relative to the install dir.
        var fromBaseDirBinaries = Path.Combine(AppContext.BaseDirectory, "binaries", "Data", subfolder);
        if (Directory.Exists(fromBaseDirBinaries))
            return fromBaseDirBinaries;

        var exeDir = Path.GetDirectoryName(Environment.ProcessPath ?? "");
        if (!string.IsNullOrEmpty(exeDir))
        {
            var fromExeDir = Path.Combine(exeDir, "Data", subfolder);
            if (Directory.Exists(fromExeDir))
                return fromExeDir;

            var fromExeDirBinaries = Path.Combine(exeDir, "binaries", "Data", subfolder);
            if (Directory.Exists(fromExeDirBinaries))
                return fromExeDirBinaries;
        }

        return fromContentRoot;
    }
}
