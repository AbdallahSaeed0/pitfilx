import 'cast_member.dart';
import 'season.dart';

enum TitleKind { show, movie }

/// Unified model for both TV shows and movies — used by poster cards,
/// Home/Discover/Search grids, Stats, and Title Detail screens.
class TitleItem {
  final String id;
  final String name;
  final TitleKind kind;
  final int year;
  final String network; // e.g. "Apple TV+" or "Theaters"
  final double rating; // 0-10, external critic rating
  final List<String> genres;
  final String overview;
  final List<String> castActorIds;
  final int gradientSeed;

  // Show-only
  final List<Season> seasons;
  final String? continueEpisodeLabel; // "S2 E9 · The Goodbye Party"
  final String? continueEpisodeSub; // "42 min"

  // Movie-only
  final String? runtimeLabel; // "2h 46m"
  final bool watched;
  final int userRating; // 0-5 stars
  final bool watchLater;

  // Poster card extras
  final String? episodeSub; // "S2 · E3" shown under title on Watch Next cards
  final double? progress; // 0-1 watched progress for Watch Next cards

  // Real-data extras (TMDB) — relative paths (e.g. "/abc123.jpg"), null for
  // mock titles. Resolve to a full URL via TmdbService.posterUrl/backdropUrl.
  final String? posterPath;
  final String? backdropPath;

  /// Raw TMDB numeric id — set for any real (non-mock) title, null for mock
  /// data. Used to re-fetch full details (genres, runtime, cast) when a
  /// title arrived via a "summary" endpoint (trending/search) that doesn't
  /// carry them.
  final int? tmdbId;

  /// True only for [fromTmdbSummary] titles — trending/search results carry
  /// no genres/runtime, unlike [fromTmdbDetails] or [fromLocalMediaCard].
  final bool isSummaryOnly;

  /// Real cast (TMDB credits), populated separately from [castActorIds]
  /// (which only resolves against mock data). Empty until fetched.
  final List<CastMember> cast;

  /// Local Pitflix.API library row id (Movie.Id / Show.Id) — set only for
  /// titles that came from [fromLocalMediaCard] or Home's Currently Watching
  /// section. Required by the poster/backdrop-change endpoint, which only
  /// works for titles already matched in the local library; null for
  /// TMDB-only titles (Trending/Search/Coming Soon) that aren't in it yet.
  final int? libraryId;

  const TitleItem({
    required this.id,
    required this.name,
    required this.kind,
    required this.year,
    required this.network,
    required this.rating,
    required this.genres,
    required this.overview,
    this.castActorIds = const [],
    this.gradientSeed = 0,
    this.seasons = const [],
    this.continueEpisodeLabel,
    this.continueEpisodeSub,
    this.runtimeLabel,
    this.watched = false,
    this.userRating = 0,
    this.watchLater = false,
    this.episodeSub,
    this.progress,
    this.posterPath,
    this.backdropPath,
    this.tmdbId,
    this.isSummaryOnly = false,
    this.cast = const [],
    this.libraryId,
  });

  /// True when this title is worth enriching with a full detail lookup
  /// before showing Title Detail (genres/runtime/cast are still missing).
  bool get needsDetailEnrichment => isSummaryOnly && tmdbId != null;

  TitleItem copyWith({
    List<Season>? seasons,
    List<CastMember>? cast,
    String? posterPath,
    String? backdropPath,
  }) => TitleItem(
    id: id,
    name: name,
    kind: kind,
    year: year,
    network: network,
    rating: rating,
    genres: genres,
    overview: overview,
    castActorIds: castActorIds,
    gradientSeed: gradientSeed,
    seasons: seasons ?? this.seasons,
    continueEpisodeLabel: continueEpisodeLabel,
    continueEpisodeSub: continueEpisodeSub,
    runtimeLabel: runtimeLabel,
    watched: watched,
    userRating: userRating,
    watchLater: watchLater,
    episodeSub: episodeSub,
    progress: progress,
    posterPath: posterPath ?? this.posterPath,
    backdropPath: backdropPath ?? this.backdropPath,
    tmdbId: tmdbId,
    isSummaryOnly: isSummaryOnly,
    cast: cast ?? this.cast,
    libraryId: libraryId,
  );

  bool get isShow => kind == TitleKind.show;

  int get totalEpisodes => seasons.fold(0, (sum, s) => sum + s.episodes.length);
  int get watchedEpisodes => seasons.fold(0, (sum, s) => sum + s.watchedCount);

  /// Trending list entry — TMDB's `/trending/movie|tv/week` result shape.
  factory TitleItem.fromTmdbSummary(Map<String, dynamic> json, TitleKind kind) {
    final id = (json['id'] as num?)?.toInt();
    final name =
        (kind == TitleKind.movie ? json['title'] : json['name']) as String? ??
        'Untitled';
    final dateStr =
        (kind == TitleKind.movie
                ? json['release_date']
                : json['first_air_date'])
            as String?;
    return TitleItem(
      id: 'tmdb-$id',
      name: name,
      kind: kind,
      year: _yearFromDate(dateStr),
      network: kind == TitleKind.movie ? 'Theaters' : 'TV',
      rating: ((json['vote_average'] as num?) ?? 0).toDouble(),
      genres: const [],
      overview: json['overview'] as String? ?? '',
      gradientSeed: (id ?? 0) % 6,
      posterPath: json['poster_path'] as String?,
      backdropPath: json['backdrop_path'] as String?,
      tmdbId: id,
      isSummaryOnly: true,
    );
  }

  /// Full detail lookup — TMDB's `/movie/{id}` or `/tv/{id}` response shape.
  /// Used to resolve Supabase list_items/watch_events (which only carry a
  /// tmdb_id + media_type) into a displayable title.
  factory TitleItem.fromTmdbDetails(Map<String, dynamic> json, TitleKind kind) {
    final id = (json['id'] as num?)?.toInt();
    final name =
        (kind == TitleKind.movie ? json['title'] : json['name']) as String? ??
        'Untitled';
    final dateStr =
        (kind == TitleKind.movie
                ? json['release_date']
                : json['first_air_date'])
            as String?;
    final genreNames = ((json['genres'] as List?) ?? [])
        .cast<Map<String, dynamic>>()
        .map((g) => g['name'] as String? ?? '')
        .where((g) => g.isNotEmpty)
        .toList();
    String? runtimeLabel;
    if (kind == TitleKind.movie) {
      final minutes = (json['runtime'] as num?)?.toInt();
      if (minutes != null && minutes > 0) {
        runtimeLabel = '${minutes ~/ 60}h ${minutes % 60}m';
      }
    }
    return TitleItem(
      id: 'tmdb-$id',
      name: name,
      kind: kind,
      year: _yearFromDate(dateStr),
      network: kind == TitleKind.movie ? 'Theaters' : 'TV',
      rating: ((json['vote_average'] as num?) ?? 0).toDouble(),
      genres: genreNames,
      overview: json['overview'] as String? ?? '',
      gradientSeed: (id ?? 0) % 6,
      runtimeLabel: runtimeLabel,
      posterPath: json['poster_path'] as String?,
      backdropPath: json['backdrop_path'] as String?,
      tmdbId: id,
    );
  }

  /// Pitflix.API's `MediaCardDto` shape (from `/api/lists/{id}/items` or
  /// stats' `recentlyCompletedMovies`/`recentlyCompletedSeries`) — already
  /// fully resolved server-side (poster URLs, genres, overview), so unlike
  /// the TMDB factories above this needs no follow-up network call.
  factory TitleItem.fromLocalMediaCard(
    Map<String, dynamic> json,
    TitleKind kind,
  ) {
    final tmdbId = (json['tmdbId'] as num?)?.toInt() ?? 0;
    final poster =
        json['selectedPosterPath'] as String? ??
        json['posterLocalPath'] as String? ??
        json['posterRemoteUrl'] as String?;
    final backdrop =
        json['selectedBackdropPath'] as String? ??
        json['backdropLocalPath'] as String?;
    final genres = (json['genresCsv'] as String? ?? '')
        .split(',')
        .map((g) => g.trim())
        .where((g) => g.isNotEmpty)
        .toList();
    return TitleItem(
      id: 'local-$tmdbId-${kind.name}',
      name: json['title'] as String? ?? 'Untitled',
      kind: kind,
      year: (json['year'] as num?)?.toInt() ?? 0,
      network: kind == TitleKind.movie ? 'Theaters' : 'TV',
      rating: (json['voteAverage'] as num?)?.toDouble() ?? 0,
      genres: genres,
      overview: json['overview'] as String? ?? '',
      gradientSeed: tmdbId % 6,
      posterPath: poster,
      backdropPath: backdrop,
      tmdbId: tmdbId,
      libraryId: (json['id'] as num?)?.toInt(),
    );
  }

  static int _yearFromDate(String? dateStr) {
    if (dateStr == null || dateStr.length < 4) return 0;
    return int.tryParse(dateStr.substring(0, 4)) ?? 0;
  }
}
