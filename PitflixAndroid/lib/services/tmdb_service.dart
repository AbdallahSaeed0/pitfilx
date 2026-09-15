import 'dart:convert';
import 'http_client.dart';
import '../config/app_config.dart';
import '../models/cast_member.dart';
import '../models/coming_soon_item.dart';
import '../models/episode.dart';
import '../models/person_credit.dart';
import '../models/person_profile.dart';
import '../models/season.dart';
import '../models/title_item.dart';
import '../utils/persistent_json_cache.dart';
import '../utils/ttl_cache.dart';

/// Direct calls to TMDB's public API — trending lists for Home, and per-title
/// detail lookups used to resolve Supabase list_items/watch_events (which
/// only store a tmdb_id + media_type) into displayable titles.
class TmdbService {
  TmdbService._();

  static const String _base = 'https://api.themoviedb.org/3';
  static const String imageBase = 'https://image.tmdb.org/t/p/w342';
  static const String backdropImageBase = 'https://image.tmdb.org/t/p/w780';
  static const String profileImageBase = 'https://image.tmdb.org/t/p/w185';
  static const String stillImageBase = 'https://image.tmdb.org/t/p/w300';

  static final _trendingCache = {
    TitleKind.movie: TtlCache<List<TitleItem>>(),
    TitleKind.show: TtlCache<List<TitleItem>>(),
  };

  // Per-show cache for fetchEpisodeCount — a show's total episode count
  // barely ever changes mid-season, but this was being re-fetched from TMDB
  // (one call per currently-watching show, every single Home load/refresh)
  // with no caching at all, which is most of why that section was slow.
  static final Map<int, int?> _episodeCountCache = {};
  static final Map<int, DateTime> _episodeCountCachedAt = {};
  static const _episodeCountTtl = Duration(hours: 6);

  // Per-(show, season) cache for fetchSeasonAirDates — UserLibraryService
  // .fetchCurrentlyWatching calls this up to 3x per candidate show on every
  // Home load to find the next unwatched aired episode, and a season's air
  // dates don't change once the season has finished airing. Uncached, this
  // was the dominant cost of a cold-start Currently Watching load (N shows x
  // up to 3 sequential TMDB round trips each, every single time).
  static final Map<String, Map<int, String>> _seasonAirDatesCache = {};
  static final Map<String, DateTime> _seasonAirDatesCachedAt = {};
  static const _seasonAirDatesTtl = Duration(hours: 6);

  // Per-title cache for fetchDetails — Title Detail's own full lookup (main
  // detail call + credits + every season's episode list for shows). That's
  // the single most expensive thing this app fetches from TMDB, and it was
  // being re-paid in full on every single open — including reopening a title
  // you just backed out of, or opening the same Currently Watching show
  // twice in a row. A title's own detail data barely changes minute to
  // minute, so a short TTL cache makes every open after the first one
  // (within the window) instant.
  static final Map<String, ({TitleItem item, DateTime at})> _detailsCache = {};
  static const _detailsTtl = Duration(minutes: 15);

  static void clearCache() {
    for (final cache in _trendingCache.values) {
      cache.clear();
    }
    _episodeCountCache.clear();
    _episodeCountCachedAt.clear();
    _seasonAirDatesCache.clear();
    _seasonAirDatesCachedAt.clear();
    _detailsCache.clear();
    // Otherwise "clear cache" would leave the on-disk copies behind and the next launch would
    // restore exactly what the user just cleared.
    PersistentJsonCache.clear();
  }

  static Future<List<TitleItem>> fetchTrending(
    TitleKind kind, {
    bool forceRefresh = false,
  }) async {
    final cache = _trendingCache[kind]!;
    final cached = cache.get(forceRefresh);
    if (cached != null) return cached;

    final path = kind == TitleKind.movie
        ? 'trending/movie/week'
        : 'trending/tv/week';
    // Survives a restart: this is Home's main content, so a cold launch used to sit on skeletons
    // waiting for it. A week-long trending list is fine to show for an hour while it revalidates.
    final json = await _get(path, persistFor: const Duration(hours: 1));
    final results = (json['results'] as List? ?? [])
        .cast<Map<String, dynamic>>();
    final mapped = results
        .map((r) => TitleItem.fromTmdbSummary(r, kind))
        .toList();
    cache.set(mapped);
    return mapped;
  }

  /// TMDB's curated `top_rated` list — critically-acclaimed, broadly liked
  /// titles, as opposed to [fetchTrending]'s "popular this week" (which
  /// skews toward whatever just released, not necessarily good). Used by
  /// Onboarding's "favorite titles" step so the picks shown are actually
  /// worth having as favorites, not just whatever's currently buzzy.
  static Future<List<TitleItem>> fetchTopRated(TitleKind kind) async {
    final path = kind == TitleKind.movie ? 'movie/top_rated' : 'tv/top_rated';
    final json = await _get(path, persistFor: const Duration(hours: 12));
    final results = (json['results'] as List? ?? [])
        .cast<Map<String, dynamic>>();
    return results.map((r) => TitleItem.fromTmdbSummary(r, kind)).toList();
  }

  /// Movies + shows in [movieGenreId]/[tvGenreId] combined, sorted by
  /// popularity — the "category row" content for Discover. [tvGenreId] is
  /// optional since TMDB's TV genre taxonomy doesn't line up 1:1 with movies
  /// (e.g. no standalone "Horror" on the TV side).
  static Future<List<TitleItem>> discoverByGenre({
    required int movieGenreId,
    int? tvGenreId,
  }) async {
    final results = await Future.wait([
      _discoverByGenre('discover/movie', movieGenreId, TitleKind.movie),
      if (tvGenreId != null)
        _discoverByGenre('discover/tv', tvGenreId, TitleKind.show),
    ]);
    return [for (final r in results) ...r];
  }

  static Future<List<TitleItem>> _discoverByGenre(
    String path,
    int genreId,
    TitleKind kind,
  ) async {
    final json = await _get(
      path,
      params: {'with_genres': '$genreId', 'sort_by': 'popularity.desc'},
      persistFor: const Duration(hours: 6),
    );
    final results = (json['results'] as List? ?? [])
        .cast<Map<String, dynamic>>();
    return results.map((r) => TitleItem.fromTmdbSummary(r, kind)).toList();
  }

  /// Resolves a bare (tmdbId, mediaType) pair — as stored in Supabase
  /// list_items/watch_events — into a full title. Returns null on failure so
  /// callers can skip a single bad id without failing the whole list. For
  /// shows, also fetches each season's episode list (capped at 20 seasons)
  /// and cast, in parallel.
  static Future<TitleItem?> fetchDetails(
    int tmdbId,
    TitleKind kind, {
    bool forceRefresh = false,
  }) async {
    final key = '${kind.name}-$tmdbId';
    if (!forceRefresh) {
      final cached = _detailsCache[key];
      if (cached != null &&
          DateTime.now().difference(cached.at) < _detailsTtl) {
        return cached.item;
      }
    }
    final path = kind == TitleKind.movie ? 'movie/$tmdbId' : 'tv/$tmdbId';
    try {
      final json = await _get(path);
      var title = TitleItem.fromTmdbDetails(json, kind);

      // One request covers both halves of the credits, so the crew row costs no extra round trip.
      final credits = fetchFullCredits(tmdbId, kind);
      if (kind == TitleKind.show) {
        final numberOfSeasons =
            (json['number_of_seasons'] as num?)?.toInt() ?? 0;
        final seasons = await fetchTvSeasons(tmdbId, numberOfSeasons);
        final resolved = await credits;
        title = title.copyWith(
          seasons: seasons,
          cast: resolved.cast,
          crew: resolved.crew,
        );
      } else {
        final resolved = await credits;
        title = title.copyWith(cast: resolved.cast, crew: resolved.crew);
      }
      _detailsCache[key] = (item: title, at: DateTime.now());
      return title;
    } catch (_) {
      return null;
    }
  }

  /// Fetches episode lists for seasons 1..[numberOfSeasons] (specials/season
  /// 0 skipped), in parallel. A single season failing just drops it rather
  /// than failing the whole show.
  static Future<List<Season>> fetchTvSeasons(
    int tvId,
    int numberOfSeasons,
  ) async {
    final capped = numberOfSeasons.clamp(0, 20);
    final results = await Future.wait(
      List.generate(capped, (i) => i + 1).map((n) => _fetchTvSeason(tvId, n)),
    );
    return results.whereType<Season>().toList();
  }

  static Future<Season?> _fetchTvSeason(int tvId, int seasonNumber) async {
    try {
      final json = await _get('tv/$tvId/season/$seasonNumber');
      final episodesJson = (json['episodes'] as List? ?? [])
          .cast<Map<String, dynamic>>();
      final episodes = episodesJson
          .map(
            (e) => Episode(
              number: (e['episode_number'] as num?)?.toInt() ?? 0,
              title: e['name'] as String? ?? 'Episode',
              durationMinutes: (e['runtime'] as num?)?.toInt() ?? 0,
              watched: false,
              stillPath: e['still_path'] as String?,
              airDate: e['air_date'] as String?,
            ),
          )
          .toList();
      return Season(
        number: seasonNumber,
        name: json['name'] as String? ?? 'Season $seasonNumber',
        episodes: episodes,
      );
    } catch (_) {
      return null;
    }
  }

  /// Candidate posters/backdrops for the artwork picker, straight from
  /// TMDB's `/movie|tv/{id}/images` — works for any tmdbId regardless of
  /// whether it's matched in the local desktop library (the old picker went
  /// through the desktop backend, which only had this for library titles).
  /// Returns maps shaped like `{filePath, voteAverage, width, height,
  /// language}`, matching the field names `ImagePickerScreen` already reads.
  static Future<List<Map<String, dynamic>>> fetchImages(
    int tmdbId,
    TitleKind kind, {
    required bool backdrops,
  }) async {
    final path = kind == TitleKind.movie
        ? 'movie/$tmdbId/images'
        : 'tv/$tmdbId/images';
    try {
      final json = await _get(
        path,
        params: {'include_image_language': 'en,null'},
      );
      final list = (json[backdrops ? 'backdrops' : 'posters'] as List? ?? [])
          .cast<Map<String, dynamic>>();
      return list
          .map(
            (i) => {
              'filePath': i['file_path'] as String? ?? '',
              'voteAverage': (i['vote_average'] as num?)?.toDouble() ?? 0,
              'width': (i['width'] as num?)?.toInt() ?? 0,
              'height': (i['height'] as num?)?.toInt() ?? 0,
              'language': i['iso_639_1'] as String?,
            },
          )
          .where((i) => (i['filePath'] as String).isNotEmpty)
          .toList();
    } catch (_) {
      return const [];
    }
  }

  /// Just this title's current poster path, via a plain TMDB detail lookup —
  /// used to self-heal poster thumbnails on summary-only `TitleItem`s whose
  /// stored `posterPath` is null or points at a URL that no longer resolves
  /// (see `PosterCard`'s `tmdbId`/`kind` fallback params). Cheaper than
  /// [fetchDetails], which also pulls credits/seasons this doesn't need.
  static Future<String?> fetchPosterPath(int tmdbId, TitleKind kind) async {
    final path = kind == TitleKind.movie ? 'movie/$tmdbId' : 'tv/$tmdbId';
    try {
      final json = await _get(path);
      return json['poster_path'] as String?;
    } catch (_) {
      return null;
    }
  }

  /// Total episode count for a show — used to turn Home's "N episodes
  /// watched" Currently Watching text into a watched/total progress bar.
  /// Null on failure (progress bar just doesn't show for that card).
  static Future<int?> fetchEpisodeCount(int tmdbId) async {
    final cachedAt = _episodeCountCachedAt[tmdbId];
    if (cachedAt != null &&
        DateTime.now().difference(cachedAt) < _episodeCountTtl) {
      return _episodeCountCache[tmdbId];
    }
    try {
      final json = await _get('tv/$tmdbId');
      final count = (json['number_of_episodes'] as num?)?.toInt();
      _episodeCountCache[tmdbId] = count;
      _episodeCountCachedAt[tmdbId] = DateTime.now();
      return count;
    } catch (_) {
      return null;
    }
  }

  /// This show's next scheduled episode straight from TMDB's
  /// `next_episode_to_air` — used to build the mobile "Next Episodes" section
  /// (mirrors the desktop app's, see `/api/home/next-episodes`). Null when
  /// TMDB has nothing scheduled, or on failure.
  static Future<
    ({String? episodeName, int? season, int? episode, DateTime? airDate})?
  >
  fetchNextEpisode(int tmdbId) async {
    try {
      final json = await _get('tv/$tmdbId');
      final next = json['next_episode_to_air'] as Map<String, dynamic>?;
      if (next == null) return null;
      return (
        episodeName: next['name'] as String?,
        season: (next['season_number'] as num?)?.toInt(),
        episode: (next['episode_number'] as num?)?.toInt(),
        airDate: DateTime.tryParse(next['air_date'] as String? ?? ''),
      );
    } catch (_) {
      return null;
    }
  }

  /// This show's most recently aired episode straight from TMDB's
  /// `last_episode_to_air` — used to detect "a new episode just dropped" for
  /// a show the account already finished (see
  /// UserLibraryService.fetchCurrentlyWatching), so it resurfaces there
  /// instead of staying hidden as "completed" forever. Null when TMDB has
  /// nothing, or on failure.
  static Future<
    ({String? episodeName, int? season, int? episode, DateTime? airDate})?
  >
  fetchLastEpisode(int tmdbId) async {
    try {
      final json = await _get('tv/$tmdbId');
      final last = json['last_episode_to_air'] as Map<String, dynamic>?;
      if (last == null) return null;
      return (
        episodeName: last['name'] as String?,
        season: (last['season_number'] as num?)?.toInt(),
        episode: (last['episode_number'] as num?)?.toInt(),
        airDate: DateTime.tryParse(last['air_date'] as String? ?? ''),
      );
    } catch (_) {
      return null;
    }
  }

  /// Episode number → air date for one season — a leaner cousin of
  /// [_fetchTvSeason] (which also pulls title/runtime/still for the full
  /// detail-screen use case) used by
  /// UserLibraryService.fetchCurrentlyWatching to find the first aired-but-
  /// unwatched episode, mirroring the desktop app's
  /// `FindNextUndownloadedAiredEpisodeAsync`. Null episodes with no air date
  /// are simply omitted (can't tell if they've aired). Empty map on failure.
  static Future<Map<int, String>> fetchSeasonAirDates(
    int tvId,
    int seasonNumber,
  ) async {
    final key = '$tvId-$seasonNumber';
    final cachedAt = _seasonAirDatesCachedAt[key];
    if (cachedAt != null &&
        DateTime.now().difference(cachedAt) < _seasonAirDatesTtl) {
      return _seasonAirDatesCache[key]!;
    }
    try {
      final json = await _get('tv/$tvId/season/$seasonNumber');
      final episodesJson = (json['episodes'] as List? ?? [])
          .cast<Map<String, dynamic>>();
      final result = <int, String>{};
      for (final e in episodesJson) {
        final number = (e['episode_number'] as num?)?.toInt();
        final airDate = e['air_date'] as String?;
        if (number != null && airDate != null && airDate.isNotEmpty) {
          result[number] = airDate;
        }
      }
      _seasonAirDatesCache[key] = result;
      _seasonAirDatesCachedAt[key] = DateTime.now();
      return result;
    } catch (_) {
      return const {};
    }
  }

  /// Bare name/poster for a show — used to backfill Currently Watching rows
  /// that have episode progress (`episode_watch_status`) but no
  /// `watch_records` row yet to source a title/poster from (see
  /// UserLibraryService.fetchCurrentlyWatching). Null on failure.
  static Future<({String title, String? posterPath})?> fetchShowSummary(
    int tmdbId,
  ) async {
    try {
      final json = await _get('tv/$tmdbId');
      return (
        title: json['name'] as String? ?? 'Untitled',
        posterPath: json['poster_path'] as String?,
      );
    } catch (_) {
      return null;
    }
  }

  /// Cast for a movie or show, via TMDB's own `/credits` endpoint — works
  /// for any tmdbId regardless of whether it's matched in the local
  /// library (unlike the desktop app's library-only cast data).
  /// Departments users actually look for, in the order a crew row should lead with. Anything not
  /// listed keeps TMDB's own ordering behind these — a title's crew can run to 200+ entries where
  /// most are "Thanks" or third-assistant-somethings, and TMDB returns them in no useful order.
  static const _crewDepartmentPriority = [
    'Directing',
    'Writing',
    'Production',
    'Camera',
    'Sound',
    'Editing',
    'Art',
    'Visual Effects',
  ];

  /// Jobs promoted above their own department's other roles.
  static const _crewJobPriority = [
    'Director',
    'Screenplay',
    'Writer',
    'Story',
    'Producer',
    'Executive Producer',
    'Director of Photography',
    'Original Music Composer',
    'Editor',
  ];

  /// Both halves of TMDB's `/credits` response. It's a single request, so fetching crew costs
  /// nothing extra over the cast lookup that was already happening.
  static Future<({List<CastMember> cast, List<CastMember> crew})> fetchFullCredits(
    int tmdbId,
    TitleKind kind,
  ) async {
    final path = kind == TitleKind.movie
        ? 'movie/$tmdbId/credits'
        : 'tv/$tmdbId/credits';
    try {
      final json = await _get(path);
      final cast = (json['cast'] as List? ?? [])
          .cast<Map<String, dynamic>>()
          .map(CastMember.fromTmdbCredit)
          .toList();
      final crew = CastMember.mergeCrewByPerson(
        (json['crew'] as List? ?? [])
            .cast<Map<String, dynamic>>()
            .map(CastMember.fromTmdbCrewCredit)
            .toList(),
      );
      crew.sort(_compareCrew);
      return (cast: cast, crew: crew);
    } catch (_) {
      return (cast: const <CastMember>[], crew: const <CastMember>[]);
    }
  }

  static int _compareCrew(CastMember a, CastMember b) {
    int rank(List<String> priority, String? value) {
      if (value == null) return priority.length;
      // A merged entry's job reads "Writer, Producer" — rank it by its strongest role.
      var best = priority.length;
      for (final part in value.split(',')) {
        final i = priority.indexOf(part.trim());
        if (i >= 0 && i < best) best = i;
      }
      return best;
    }

    final jobCmp = rank(_crewJobPriority, a.job).compareTo(rank(_crewJobPriority, b.job));
    if (jobCmp != 0) return jobCmp;
    return rank(_crewDepartmentPriority, a.department)
        .compareTo(rank(_crewDepartmentPriority, b.department));
  }

  static Future<List<CastMember>> fetchCredits(
    int tmdbId,
    TitleKind kind,
  ) async => (await fetchFullCredits(tmdbId, kind)).cast;

  /// How far ahead "Coming Soon" looks. Was 30 days; widened since a month
  /// out was too narrow to reliably have anything to show.
  static const int comingSoonWindowDays = 90;

  static final _comingSoonCache = TtlCache<List<ComingSoonItem>>(
    ttl: const Duration(minutes: 10),
  );

  /// Upcoming movies + new/returning TV within [comingSoonWindowDays],
  /// straight from TMDB — no local backend involved. Mirrors the desktop
  /// app's `/api/home/coming-soon` distinction between brand-new series
  /// (`first_air_date` inside the window) and season 2+ premieres of shows
  /// already airing (only entries whose `next_episode_to_air` is episode 1
  /// of season 2+, landing inside the window, qualify) — an earlier version
  /// used `air_date.gte/lte` on `/discover/tv`, which matches ANY show with
  /// an episode airing soon (i.e. most ongoing weekly shows), so it showed
  /// titles that were already airing, not actually "coming soon". Doesn't
  /// include the desktop's local-library stub shows (Android has no local
  /// library to check), so a season 2+ premiere only surfaces here if the
  /// show is popular/trending/on-the-air enough to be in the TMDB candidate
  /// pools below.
  static Future<List<ComingSoonItem>> fetchComingSoon({
    bool forceRefresh = false,
  }) async {
    final cached = _comingSoonCache.get(forceRefresh);
    if (cached != null) return cached;

    final now = DateTime.now();
    final today = DateTime(now.year, now.month, now.day);
    final cutoff = today.add(Duration(days: comingSoonWindowDays));
    String fmt(DateTime d) =>
        '${d.year.toString().padLeft(4, '0')}-${d.month.toString().padLeft(2, '0')}-${d.day.toString().padLeft(2, '0')}';
    final todayStr = fmt(today);
    final cutoffStr = fmt(cutoff);
    bool inWindow(DateTime d) {
      final day = DateTime(d.year, d.month, d.day);
      return !day.isBefore(today) && !day.isAfter(cutoff);
    }

    Future<List<Map<String, dynamic>>> pages(
      String path,
      Map<String, String> params, {
      int pageCount = 2,
    }) async {
      final fetched = await Future.wait([
        for (var p = 1; p <= pageCount; p++)
          _get(
            path,
            params: {...params, 'page': '$p'},
            persistFor: const Duration(hours: 6),
          ),
      ]);
      return [
        for (final json in fetched)
          ...(json['results'] as List? ?? []).cast<Map<String, dynamic>>(),
      ];
    }

    final results = await Future.wait([
      pages('discover/movie', {
        'region': 'US',
        'primary_release_date.gte': todayStr,
        'primary_release_date.lte': cutoffStr,
        'sort_by': 'primary_release_date.asc',
        'with_release_type': '2|3',
        // Excludes short films — under-40-minutes is the standard short
        // film threshold (Academy/BAFTA), and TMDB's theatrical release
        // type alone doesn't filter these out (film-festival shorts still
        // get tagged as a theatrical release).
        'with_runtime.gte': '40',
      }),
      pages('discover/tv', {
        'first_air_date.gte': todayStr,
        'first_air_date.lte': cutoffStr,
        'sort_by': 'first_air_date.asc',
      }),
      pages('trending/tv/week', const {}, pageCount: 1),
      pages('tv/on_the_air', const {}),
      pages('discover/tv', const {'sort_by': 'popularity.desc'}),
    ]);
    final movieRows = results[0];
    final newSeriesRows = results[1];
    final candidatePoolRows = [...results[2], ...results[3], ...results[4]];

    final seenMovies = <int>{};
    final movies = <ComingSoonItem>[];
    for (final r in movieRows) {
      final id = (r['id'] as num?)?.toInt();
      final date = DateTime.tryParse(r['release_date'] as String? ?? '');
      if (id == null || date == null || !inWindow(date)) continue;
      if (!seenMovies.add(id)) continue;
      movies.add(
        ComingSoonItem(
          tmdbId: id,
          mediaType: 'movie',
          title: r['title'] as String? ?? 'Untitled',
          posterUrl: posterUrl(r['poster_path'] as String?),
          releaseDate: date,
          overview: r['overview'] as String?,
          voteAverage: (r['vote_average'] as num?)?.toDouble(),
        ),
      );
    }
    movies.sort((a, b) => a.releaseDate!.compareTo(b.releaseDate!));

    final newSeriesIds = <int>{};
    final newSeries = <ComingSoonItem>[];
    for (final r in newSeriesRows) {
      final id = (r['id'] as num?)?.toInt();
      final date = DateTime.tryParse(r['first_air_date'] as String? ?? '');
      if (id == null || date == null || !inWindow(date)) continue;
      if (!newSeriesIds.add(id)) continue;
      newSeries.add(
        ComingSoonItem(
          tmdbId: id,
          mediaType: 'tv',
          title: r['name'] as String? ?? 'Untitled',
          posterUrl: posterUrl(r['poster_path'] as String?),
          releaseDate: date,
          overview: r['overview'] as String?,
          voteAverage: (r['vote_average'] as num?)?.toDouble(),
        ),
      );
    }

    // Season 2+ premiere candidates: trending/on-the-air/popular shows,
    // excluding brand-new series already captured above, deduplicated.
    final candidates = <int, Map<String, dynamic>>{};
    for (final r in candidatePoolRows) {
      final id = (r['id'] as num?)?.toInt();
      if (id == null || newSeriesIds.contains(id)) continue;
      candidates.putIfAbsent(id, () => r);
    }
    // Only newSeries + returning together need to reach 40 (see `tv` below),
    // so once newSeries alone covers that there's nothing for this loop to
    // contribute — skip it entirely rather than paying for up to 80 TMDB
    // detail calls (previously always run in full) just to throw the results
    // away. This was the dominant cost in a cold-start Coming Soon load.
    final neededReturning = (40 - newSeries.length).clamp(0, 80);
    final candidateList = candidates.values.take(80).toList();

    final returning = <ComingSoonItem>[];
    const concurrency = 12;
    for (
      var i = 0;
      i < candidateList.length && returning.length < neededReturning;
      i += concurrency
    ) {
      final batch = candidateList.skip(i).take(concurrency);
      final batchResults = await Future.wait(
        batch.map((show) async {
          final id = (show['id'] as num).toInt();
          try {
            final json = await _get('tv/$id');
            final next = json['next_episode_to_air'] as Map<String, dynamic>?;
            if (next == null) return null;
            final seasonNum = (next['season_number'] as num?)?.toInt();
            final episodeNum = (next['episode_number'] as num?)?.toInt();
            if (seasonNum == null || seasonNum < 2 || episodeNum != 1) {
              return null;
            }
            final airDate = DateTime.tryParse(
              next['air_date'] as String? ?? '',
            );
            if (airDate == null || !inWindow(airDate)) return null;
            return ComingSoonItem(
              tmdbId: id,
              mediaType: 'tv',
              title: show['name'] as String? ?? 'Untitled',
              posterUrl: posterUrl(show['poster_path'] as String?),
              releaseDate: airDate,
              overview: show['overview'] as String?,
              voteAverage: (show['vote_average'] as num?)?.toDouble(),
              seasonNumber: seasonNum,
            );
          } catch (_) {
            return null;
          }
        }),
      );
      returning.addAll(batchResults.whereType<ComingSoonItem>());
    }
    returning.sort((a, b) => a.releaseDate!.compareTo(b.releaseDate!));

    final tv = [...newSeries, ...returning].take(40).toList();
    final combined = [...movies.take(30), ...tv];
    _comingSoonCache.set(combined);
    return combined;
  }

  /// Actor bio + "known for" filmography, straight from TMDB (`/person/{id}`
  /// + combined_credits) — same shape the local backend's `/api/people/{id}`
  /// used to return, so ActorScreen doesn't need to change. Null on failure.
  /// Everything the person page needs, from one `/person/{id}` call with combined_credits appended.
  ///
  /// Returns acting and crew filmographies separately: someone can be both (an actor who directs),
  /// and the two want different subtitles under the poster — the character played versus the job
  /// done. Both are collapsed one-entry-per-title and sorted newest first.
  static Future<PersonProfile?> fetchPersonProfile(int personId) async {
    try {
      final json = await _get(
        'person/$personId',
        params: {'append_to_response': 'combined_credits'},
      );
      final combined = json['combined_credits'] as Map<String, dynamic>?;

      List<PersonCredit> parse(String key, {required bool isCrew}) {
        final raw = (combined?[key] as List? ?? []).cast<Map<String, dynamic>>();
        final parsed = <PersonCredit>[];
        for (final entry in raw) {
          final credit = PersonCredit.fromCombinedCredit(entry, isCrew: isCrew);
          if (credit != null) parsed.add(credit);
        }
        return PersonCredit.collapseAndSort(parsed);
      }

      return PersonProfile(
        tmdbId: personId,
        name: json['name'] as String? ?? '',
        biography: json['biography'] as String?,
        birthday: json['birthday'] as String?,
        placeOfBirth: json['place_of_birth'] as String?,
        profilePath: json['profile_path'] as String?,
        knownForDepartment: json['known_for_department'] as String?,
        actingCredits: parse('cast', isCrew: false),
        crewCredits: parse('crew', isCrew: true),
      );
    } catch (_) {
      return null;
    }
  }

  /// Text search — used by the Search screen. [kindFilter] narrows to
  /// `/search/movie` or `/search/tv`; null searches both via `/search/multi`
  /// (people results are dropped, since this app has no actor-search UI).
  static Future<List<TitleItem>> search(
    String query, {
    TitleKind? kindFilter,
  }) async {
    final trimmed = query.trim();
    if (trimmed.isEmpty) return const [];

    if (kindFilter != null) {
      final path = kindFilter == TitleKind.movie ? 'search/movie' : 'search/tv';
      final json = await _get(path, params: {'query': trimmed});
      final results = (json['results'] as List? ?? [])
          .cast<Map<String, dynamic>>();
      return results
          .map((r) => TitleItem.fromTmdbSummary(r, kindFilter))
          .toList();
    }

    final json = await _get('search/multi', params: {'query': trimmed});
    final results = (json['results'] as List? ?? [])
        .cast<Map<String, dynamic>>();
    return results
        .where((r) => r['media_type'] == 'movie' || r['media_type'] == 'tv')
        .map(
          (r) => TitleItem.fromTmdbSummary(
            r,
            r['media_type'] == 'tv' ? TitleKind.show : TitleKind.movie,
          ),
        )
        .toList();
  }

  /// When non-null, every [_get] call waits until this time before firing —
  /// set the moment ANY call gets a 429, so a bulk import's other
  /// concurrently-in-flight requests (and their own independent per-title
  /// retries) all back off together instead of continuing to hammer TMDB
  /// at the same rate while one of them individually retries. Without this
  /// shared coordination, a rate-limited burst just kept the whole batch
  /// bouncing off 429s in lockstep — which is why the unmatched count
  /// stayed high (180ish) across repeated import attempts instead of
  /// actually dropping: it was never "TMDB doesn't have this title", it was
  /// the whole run staying rate-limited.
  static DateTime? _rateLimitedUntil;

  static Future<Map<String, dynamic>> _get(
    String path, {
    Map<String, String>? params,
    /// When set, the raw response survives an app restart for this long (see
    /// [PersistentJsonCache]). Only pass it for the list endpoints that gate a screen's first
    /// paint — per-title lookups would grow the store without bound.
    Duration? persistFor,
  }) async {
    if (!AppConfig.isTmdbConfigured) {
      throw const TmdbNotConfiguredException();
    }

    final ttl = persistFor;
    final cacheKey = ttl == null ? null : _cacheKey(path, params);
    if (cacheKey != null && ttl != null) {
      final cached = PersistentJsonCache.get(cacheKey, ttl);
      if (cached != null) return cached;
    }

    final cooldown = _rateLimitedUntil;
    if (cooldown != null) {
      final wait = cooldown.difference(DateTime.now());
      if (wait > Duration.zero) await Future<void>.delayed(wait);
    }

    final useBearer = AppConfig.tmdbReadAccessToken.isNotEmpty;
    final queryParams = {
      if (!useBearer) 'api_key': AppConfig.effectiveTmdbApiKey,
      ...?params,
    };
    final url = Uri.parse('$_base/$path').replace(queryParameters: queryParams);
    final res = await PitflixHttp.client.get(
      url,
      headers: useBearer
          ? {
              'Authorization': 'Bearer ${AppConfig.tmdbReadAccessToken}',
              'Accept': 'application/json',
            }
          : {'Accept': 'application/json'},
    );

    if (res.statusCode == 429) {
      // Respect TMDB's own Retry-After if it sent one; otherwise a
      // conservative flat default — better to wait a bit too long once than
      // to keep tripping the limit and dragging out the whole import.
      final retryAfterHeader = res.headers['retry-after'];
      final retryAfterSeconds = int.tryParse(retryAfterHeader ?? '') ?? 5;
      final until = DateTime.now().add(Duration(seconds: retryAfterSeconds));
      if (_rateLimitedUntil == null || until.isAfter(_rateLimitedUntil!)) {
        _rateLimitedUntil = until;
      }
    } else if (res.statusCode == 200 &&
        _rateLimitedUntil != null &&
        !DateTime.now().isBefore(_rateLimitedUntil!)) {
      // Cooldown has elapsed and requests are succeeding again — clear it
      // so later calls don't keep paying a wait that's no longer needed.
      _rateLimitedUntil = null;
    }

    if (res.statusCode != 200) {
      throw TmdbHttpException(res.statusCode, path);
    }

    if (cacheKey != null) PersistentJsonCache.set(cacheKey, res.body);
    return jsonDecode(res.body) as Map<String, dynamic>;
  }

  /// Stable key for a request: sorted params so the same call can't miss because a map happened to
  /// iterate in a different order. The API key is excluded — it isn't part of what identifies the
  /// resource, and keeping it out means the cache survives a key change and never lands on disk.
  static String _cacheKey(String path, Map<String, String>? params) {
    final pairs = (params?.entries ?? const <MapEntry<String, String>>[])
        .map((e) => '${e.key}=${e.value}')
        .toList()
      ..sort();
    return '$path?${pairs.join('&')}';
  }

  /// [posterPath] is either a TMDB-relative path ("/abc.jpg") or, when the
  /// title came from the local Pitflix.API backend, an already-absolute URL
  /// — passed through [_resolveLocalUrl] in that case.
  static String? posterUrl(String? posterPath) {
    if (posterPath == null || posterPath.isEmpty) return null;
    return posterPath.startsWith('http')
        ? _resolveLocalUrl(posterPath)
        : '$imageBase$posterPath';
  }

  static String? backdropUrl(String? backdropPath) {
    if (backdropPath == null || backdropPath.isEmpty) return null;
    return backdropPath.startsWith('http')
        ? _resolveLocalUrl(backdropPath)
        : '$backdropImageBase$backdropPath';
  }

  static String? profileUrl(String? profilePath) {
    if (profilePath == null || profilePath.isEmpty) return null;
    return profilePath.startsWith('http')
        ? _resolveLocalUrl(profilePath)
        : '$profileImageBase$profilePath';
  }

  static String? stillUrl(String? stillPath) {
    if (stillPath == null || stillPath.isEmpty) return null;
    return stillPath.startsWith('http')
        ? _resolveLocalUrl(stillPath)
        : '$stillImageBase$stillPath';
  }

  /// The backend always bakes `http://localhost:{port}` into URLs for images
  /// it serves from its own file cache (posters/backdrops/stills/cast photos
  /// not sourced straight from TMDB) — correct for the desktop app itself,
  /// but "localhost" from the phone/emulator means the phone, not the PC
  /// running the backend. Rewrite the host/port to match
  /// [AppConfig.localBackendBaseUrl], which the app already successfully
  /// uses for every other API call, keeping the path unchanged.
  static String _resolveLocalUrl(String absoluteUrl) {
    final uri = Uri.tryParse(absoluteUrl);
    if (uri == null) return absoluteUrl;
    if (uri.host != 'localhost' && uri.host != '127.0.0.1') return absoluteUrl;

    final backendUri = Uri.tryParse(AppConfig.localBackendBaseUrl);
    if (backendUri == null) return absoluteUrl;

    return uri
        .replace(
          scheme: backendUri.scheme,
          host: backendUri.host,
          port: backendUri.hasPort ? backendUri.port : uri.port,
        )
        .toString();
  }

  /// Maps the mobile app's own convention ("movie"/"tv") — used for TMDB
  /// calls — from whichever media_type string a Supabase row carries
  /// (desktop writes "Movie"/"Series").
  static TitleKind kindFromMediaType(String mediaType) {
    final m = mediaType.toLowerCase();
    return (m == 'tv' || m == 'series') ? TitleKind.show : TitleKind.movie;
  }
}

class TmdbNotConfiguredException implements Exception {
  const TmdbNotConfiguredException();

  @override
  String toString() =>
      'TMDB API key not configured — set it in lib/config/app_config.dart';
}

/// A non-200 TMDB response, carrying the actual status code so callers can
/// tell a transient failure (429 rate-limited, 5xx) — worth retrying, and
/// NOT the same thing as "this title doesn't exist on TMDB" — apart from a
/// genuine 404/empty-results case. Bulk imports (TmdbMatchService) rely on
/// this distinction: without it, a rate-limit blip under import concurrency
/// gets silently recorded as "not found on TMDB" and cached that way
/// forever, which is exactly what was happening before this existed.
class TmdbHttpException implements Exception {
  final int statusCode;
  final String path;

  const TmdbHttpException(this.statusCode, this.path);

  bool get isTransient => statusCode == 429 || statusCode >= 500;

  @override
  String toString() => 'TMDB GET $path failed: $statusCode';
}
