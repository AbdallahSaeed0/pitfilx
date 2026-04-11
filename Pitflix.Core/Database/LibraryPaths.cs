namespace Pitflix.Core.Database;

public static class LibraryPaths
{
    public static string DatabaseFilePath =>
        Path.Combine(Environment.GetFolderPath(Environment.SpecialFolder.LocalApplicationData), "Pitflix", "pitflix.db");

    public static string DatabaseConnectionString => $"Data Source={DatabaseFilePath}";
}
