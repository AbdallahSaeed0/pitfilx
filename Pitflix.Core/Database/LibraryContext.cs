using Microsoft.EntityFrameworkCore;
using Pitflix.Core.Models;

namespace Pitflix.Core.Database;

public class LibraryContext : DbContext
{
    public LibraryContext(DbContextOptions<LibraryContext> options)
        : base(options)
    {
    }

    public DbSet<Show> Shows => Set<Show>();
    public DbSet<Movie> Movies => Set<Movie>();
    public DbSet<Episode> Episodes => Set<Episode>();
    public DbSet<CastMember> CastMembers => Set<CastMember>();
    public DbSet<ScanLog> ScanLogs => Set<ScanLog>();
    public DbSet<Setting> Settings => Set<Setting>();
    public DbSet<WatchHistory> WatchHistories => Set<WatchHistory>();
    public DbSet<TrailerItem> TrailerItems => Set<TrailerItem>();
    public DbSet<TrailerChannelSyncState> TrailerChannelSyncStates => Set<TrailerChannelSyncState>();
    public DbSet<UserList> UserLists => Set<UserList>();
    public DbSet<ListItem> ListItems => Set<ListItem>();
    public DbSet<LibraryFolder> LibraryFolders => Set<LibraryFolder>();
    public DbSet<RatingsSnapshot> RatingsSnapshots => Set<RatingsSnapshot>();
    public DbSet<PinnedComingSoon> PinnedComingSoon => Set<PinnedComingSoon>();
    public DbSet<SeasonSkipSegment> SeasonSkipSegments => Set<SeasonSkipSegment>();
    public DbSet<EpisodeSkipOverride> EpisodeSkipOverrides => Set<EpisodeSkipOverride>();

    protected override void OnModelCreating(ModelBuilder modelBuilder)
    {
        modelBuilder.Entity<Show>(e =>
        {
            e.HasIndex(x => x.TmdbId);
            e.HasIndex(x => x.FolderPath);
            e.HasIndex(x => x.IsArabic);
            e.HasIndex(x => x.IsMatched);
        });

        modelBuilder.Entity<Movie>(e =>
        {
            e.HasIndex(x => x.TmdbId);
            e.HasIndex(x => x.FilePath);
            e.HasIndex(x => x.IsArabic);
            e.HasIndex(x => x.IsMatched);
        });

        modelBuilder.Entity<Episode>(e =>
        {
            e.HasIndex(x => new { x.ShowId, x.Season, x.EpisodeNumber }).IsUnique();
            e.HasIndex(x => x.ShowId);
            e.HasOne(x => x.Show)
                .WithMany(s => s.Episodes)
                .HasForeignKey(x => x.ShowId)
                .OnDelete(DeleteBehavior.Cascade);
        });

        modelBuilder.Entity<CastMember>(e =>
        {
            e.HasIndex(x => new { x.MediaId, x.MediaType });
        });

        modelBuilder.Entity<ScanLog>(e =>
        {
            e.HasIndex(x => x.FilePath).IsUnique();
            e.HasIndex(x => x.Status);
        });

        modelBuilder.Entity<Setting>(e => { e.HasKey(x => x.Key); });

        modelBuilder.Entity<WatchHistory>(e =>
        {
            e.HasIndex(x => x.OpenedAt);
            e.HasIndex(x => new { x.FilePath, x.OpenedAt });
            e.HasIndex(x => new { x.IsStopFinalized, x.LastHeartbeatAtUtc });
        });

        modelBuilder.Entity<TrailerItem>(e =>
        {
            e.HasIndex(x => x.VideoId).IsUnique();
            e.HasIndex(x => x.PublishedAtUtc);
            e.HasIndex(x => new { x.TmdbId, x.MediaType, x.PublishedAtUtc });
            e.HasIndex(x => new { x.IsActive, x.PublishedAtUtc });
            e.HasIndex(x => x.MediaType);
        });

        modelBuilder.Entity<TrailerChannelSyncState>(e => { e.HasKey(x => x.ChannelId); });

        modelBuilder.Entity<UserList>(e =>
        {
            e.HasIndex(x => x.Name);
        });

        modelBuilder.Entity<ListItem>(e =>
        {
            e.HasIndex(x => x.ListId);
            e.HasIndex(x => new { x.ListId, x.TmdbId, x.MediaType }).IsUnique();
            e.HasOne(x => x.List)
                .WithMany(l => l.Items)
                .HasForeignKey(x => x.ListId)
                .OnDelete(DeleteBehavior.Cascade);
        });

        modelBuilder.Entity<LibraryFolder>(e =>
        {
            e.HasIndex(x => x.Path).IsUnique();
        });

        modelBuilder.Entity<RatingsSnapshot>(e =>
        {
            e.HasIndex(x => new { x.TmdbId, x.MediaType }).IsUnique();
            e.HasIndex(x => x.NextRefreshAtUtc);
            e.HasIndex(x => x.RatingsLastUpdatedAtUtc);
        });

        modelBuilder.Entity<PinnedComingSoon>(e =>
        {
            e.HasIndex(x => new { x.TmdbId, x.MediaType }).IsUnique();
            e.HasIndex(x => x.PinnedAt);
        });

        modelBuilder.Entity<SeasonSkipSegment>(e =>
        {
            e.HasIndex(x => new { x.ShowId, x.SeasonNumber }).IsUnique();
            e.HasOne<Show>()
                .WithMany()
                .HasForeignKey(x => x.ShowId)
                .OnDelete(DeleteBehavior.Cascade);
        });

        modelBuilder.Entity<EpisodeSkipOverride>(e =>
        {
            e.HasIndex(x => x.EpisodeId).IsUnique();
            e.HasOne<Episode>()
                .WithMany()
                .HasForeignKey(x => x.EpisodeId)
                .OnDelete(DeleteBehavior.Cascade);
        });
    }

    public static LibraryContext Create()
    {
        var dir = Path.GetDirectoryName(LibraryPaths.DatabaseFilePath);
        if (!string.IsNullOrEmpty(dir))
            Directory.CreateDirectory(dir);

        var options = new DbContextOptionsBuilder<LibraryContext>()
            .UseSqlite(LibraryPaths.DatabaseConnectionString)
            .Options;

        return new LibraryContext(options);
    }
}
