/// A friend — UI-only placeholder for now. Pitflix.API has no concept of
/// user accounts or a social graph yet, so this is mock data only, built to
/// prep the screens/flows ahead of real backend support.
class Friend {
  final String id;
  final String name;
  final String username;
  final int gradientSeed;
  final bool isOnline;
  final String tvTimeLabel;
  final int totalEpisodesWatched;
  final int totalMoviesWatched;
  final String? currentlyWatching;

  /// Ids into MockData.titles.
  final List<String> recentTitleIds;
  final List<String> watchLaterTitleIds;

  const Friend({
    required this.id,
    required this.name,
    required this.username,
    required this.gradientSeed,
    this.isOnline = false,
    required this.tvTimeLabel,
    required this.totalEpisodesWatched,
    this.totalMoviesWatched = 0,
    this.currentlyWatching,
    this.recentTitleIds = const [],
    this.watchLaterTitleIds = const [],
  });

  String get initials {
    final parts = name.split(' ').where((s) => s.isNotEmpty).toList();
    if (parts.isEmpty) return '?';
    return parts.take(2).map((s) => s[0]).join().toUpperCase();
  }
}
