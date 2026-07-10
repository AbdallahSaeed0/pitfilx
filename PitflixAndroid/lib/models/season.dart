import 'episode.dart';

class Season {
  final int number;
  final String name;
  final List<Episode> episodes;

  const Season({
    required this.number,
    required this.name,
    required this.episodes,
  });

  int get watchedCount => episodes.where((e) => e.watched).length;
  bool get isComplete => watchedCount == episodes.length;
  bool get isInProgress => watchedCount > 0 && !isComplete;

  /// Returns a copy of this season with the episode matching [episodeNumber]
  /// replaced by the result of [update] — used to apply per-episode changes
  /// (watch status, rating, rewatch count) without mutating the original.
  Season replaceEpisode(int episodeNumber, Episode Function(Episode) update) {
    return Season(
      number: number,
      name: name,
      episodes: [
        for (final ep in episodes)
          if (ep.number == episodeNumber) update(ep) else ep,
      ],
    );
  }
}
