import 'dart:async';
import 'dart:convert';
import 'package:flutter/foundation.dart';
import 'package:shared_preferences/shared_preferences.dart';
import 'package:supabase_flutter/supabase_flutter.dart';
import '../models/rate_prompt_item.dart';
import '../models/supabase_rows.dart';
import '../models/title_item.dart';
import 'app_settings.dart';
import 'auth_service.dart';
import 'tmdb_service.dart';

/// Per-account library data (Watch Later/Favorites/custom lists, watched
/// status, ratings, episode progress, Stats source data) — see
/// Pitflix.API/Services/Supabase/sql/003_pitflix_user_library_schema.sql.
/// Every table is single-owner (RLS: `user_id = auth.uid()`), so unlike
/// [SocialService] there's no cross-user visibility to worry about.
abstract class UserLibraryService {
  static SupabaseClient get _client => Supabase.instance.client;
  static String get _myId => AuthService.currentUser!.id;

  /// This Supabase project enforces a hard server-side max-rows cap (observed at exactly 1000 —
  /// episode_watch_status/watch_log rows both landed on precisely that number even after
  /// requesting a much larger `.range()`), so a bigger single-request range doesn't help: the
  /// only way to get everything is paging through in chunks of this size until a page comes back
  /// short. Without this, any query on a table that's grown past 1000 rows for an account
  /// silently returns an arbitrary subset (no `.order()` on most of these queries, so it's not
  /// even "the first/last 1000") instead of erroring — Stats totals and Currently Watching's
  /// progress detection were both being corrupted by this for accounts with real watch history.
  static const int _pageSize = 1000;

  static Future<List<Map<String, dynamic>>> _fetchAllRows(
    Future<List<Map<String, dynamic>>> Function(int start, int end) fetchPage,
  ) async {
    final all = <Map<String, dynamic>>[];
    var start = 0;
    while (true) {
      final page = await fetchPage(start, start + _pageSize - 1);
      all.addAll(page);
      if (page.length < _pageSize) break;
      start += _pageSize;
    }
    return all;
  }

  /// Bumped after every write in this class — lists, watch records, episode
  /// status/rewatch counts, and the desktop-import bulk writes. Lets other
  /// already-mounted screens (Home/Stats/Profile/Lists — kept alive across
  /// tab switches by RootShell, so they don't naturally re-fetch) react by
  /// reloading; listen via `addListener` in `initState` and remove it in
  /// `dispose`.
  static final ValueNotifier<int> libraryVersion = ValueNotifier(0);

  // ── in-memory read caches ────────────────────────────────────────────────
  // The detail screens (movie/series) each fire several of the per-title reads
  // below on every open — favorites lookup, watch record, custom artwork,
  // episode statuses — none of which change unless this account writes (every
  // mutating method here bumps [libraryVersion]) or another device does. A
  // short TTL, additionally bounded by [libraryVersion] so any local write
  // invalidates immediately, makes reopening a title (or opening the same one
  // from two places) hit memory instead of paying a fresh Supabase round trip
  // each time — the same rationale as TmdbService._detailsCache. Cleared on
  // sign-out via [clearCache] so a different account never reads these.
  static const Duration _readCacheTtl = Duration(minutes: 5);
  static final Map<String, ({dynamic value, int version, DateTime at})>
  _readCache = {};

  /// `(hit, value)` — `hit` distinguishes a cached null (e.g. "this title has
  /// no custom artwork") from a plain miss, so an absent result is cached too
  /// rather than re-fetched on every open.
  static (bool, T?) _readFromCache<T>(String key) {
    final entry = _readCache[key];
    if (entry == null) return (false, null);
    if (entry.version != libraryVersion.value ||
        DateTime.now().difference(entry.at) > _readCacheTtl) {
      _readCache.remove(key);
      return (false, null);
    }
    return (true, entry.value as T?);
  }

  static void _writeToCache(String key, dynamic value) {
    _readCache[key] = (
      value: value,
      version: libraryVersion.value,
      at: DateTime.now(),
    );
  }

  /// Drops every in-memory cache. Call on sign-out so a different account
  /// signing in on the same process never reads the previous account's lists,
  /// favorites, watch records or custom artwork.
  static void clearCache() {
    _cachedLists = null;
    _cachedListsVersion = -1;
    _readCache.clear();
  }

  // ── lists ──────────────────────────────────────────────────────────────

  // The account's lists (id/name/type) change only when a list is created or
  // deleted — not when items are added/removed or episodes marked — yet
  // [fetchLists] was being re-run in full (two selects plus the auto-create
  // existence check) on every single detail open just to resolve the static
  // Favorites list id (see findFavoritesListId). Memoized against
  // [libraryVersion] so a create/delete refreshes it but a plain open doesn't.
  static List<SupabaseListRow>? _cachedLists;
  static int _cachedListsVersion = -1;

  /// Ensures a Watchlist and Favorites list exist for the current account
  /// (auto-created on first use, mirroring the old local backend's
  /// always-present built-in lists), then returns all of the user's lists.
  static Future<List<SupabaseListRow>> fetchLists({
    bool forceRefresh = false,
  }) async {
    if (!forceRefresh &&
        _cachedLists != null &&
        _cachedListsVersion == libraryVersion.value) {
      return _cachedLists!;
    }
    var rows = await _client
        .from('user_lists')
        .select()
        .eq('user_id', _myId)
        .order('created_at');
    final hasWatchlist = rows.any((r) => r['type'] == 'watchlist');
    final hasFavorites = rows.any((r) => r['type'] == 'favorites');
    if (!hasWatchlist) {
      await _client.from('user_lists').insert({
        'user_id': _myId,
        'name': 'Watch Later',
        'type': 'watchlist',
      });
    }
    if (!hasFavorites) {
      await _client.from('user_lists').insert({
        'user_id': _myId,
        'name': 'Favorites',
        'type': 'favorites',
      });
    }
    if (!hasWatchlist || !hasFavorites) {
      rows = await _client
          .from('user_lists')
          .select()
          .eq('user_id', _myId)
          .order('created_at');
    }
    final result = rows
        .map(
          // .fromJson (not a manual constructor call) so names carrying a
          // `::icon:: Title` prefix (e.g. from the desktop import) get
          // decoded into (icon, title) instead of showing the raw prefix.
          (r) => SupabaseListRow.fromJson(r),
        )
        .toList();
    _cachedLists = result;
    _cachedListsVersion = libraryVersion.value;
    return result;
  }

  /// This account's Watch Later list id — [fetchLists] auto-creates it if
  /// missing, so this always resolves. Used by the desktop-export importers
  /// (Letterboxd/TV Time) to drop watchlist-only titles somewhere sensible.
  static Future<String> watchlistListId() async {
    final lists = await fetchLists();
    return lists.firstWhere((l) => l.type == 'watchlist').id;
  }

  static Future<String> createList(String name) async {
    final row = await _client
        .from('user_lists')
        .insert({'user_id': _myId, 'name': name, 'type': 'custom'})
        .select()
        .single();
    libraryVersion.value++;
    return row['id'] as String;
  }

  /// Deletes a custom list (cascades to its items). Watchlist/Favorites are
  /// treated as permanent — callers should not offer this for those.
  static Future<void> deleteList(String listId) async {
    await _client.from('user_lists').delete().eq('id', listId);
    libraryVersion.value++;
  }

  static Future<List<TitleItem>> fetchListItems(String listId) async {
    final rows = await _client
        .from('user_list_items')
        .select()
        .eq('list_id', listId)
        .order('added_at', ascending: false);
    return applyCustomArtwork(rows.map(_titleFromListItemRow).toList());
  }

  static Future<void> addToList(
    String listId, {
    required int tmdbId,
    required String mediaType,
    String? title,
    String? posterPath,
  }) async {
    await _client.from('user_list_items').insert({
      'list_id': listId,
      'tmdb_id': tmdbId,
      'media_type': mediaType,
      'title': title,
      'poster_path': posterPath,
    });
    libraryVersion.value++;
  }

  static Future<void> removeFromList(
    String listId,
    int tmdbId,
    String mediaType,
  ) async {
    await _client
        .from('user_list_items')
        .delete()
        .eq('list_id', listId)
        .eq('tmdb_id', tmdbId)
        .eq('media_type', mediaType);
    libraryVersion.value++;
  }

  static Future<bool> isInList(
    String listId,
    int tmdbId,
    String mediaType,
  ) async {
    final key = 'isInList-$listId-$tmdbId-$mediaType';
    final (hit, cached) = _readFromCache<bool>(key);
    if (hit) return cached ?? false;
    final rows = await _client
        .from('user_list_items')
        .select('id')
        .eq('list_id', listId)
        .eq('tmdb_id', tmdbId)
        .eq('media_type', mediaType)
        .limit(1);
    final result = rows.isNotEmpty;
    _writeToCache(key, result);
    return result;
  }

  static TitleItem _titleFromListItemRow(Map<String, dynamic> r) {
    final tmdbId = (r['tmdb_id'] as num).toInt();
    final mediaType = r['media_type'] as String? ?? 'movie';
    final kind = mediaType.toLowerCase() == 'series' || mediaType.toLowerCase() == 'tv'
        ? TitleKind.show
        : TitleKind.movie;
    final title = r['title'] as String? ?? 'Untitled';
    return TitleItem(
      id: 'user-list-$tmdbId-${kind.name}',
      name: title,
      kind: kind,
      year: 0,
      network: kind == TitleKind.movie ? 'Theaters' : 'TV',
      rating: 0,
      genres: const [],
      overview: '',
      gradientSeed: tmdbId % 6,
      posterPath: r['poster_path'] as String?,
      tmdbId: tmdbId,
      isSummaryOnly: true,
    );
  }

  // ── watch records (movies + series overall status) ───────────────────────

  static Future<Map<String, dynamic>?> fetchWatchRecord(
    int tmdbId,
    String mediaType,
  ) async {
    final key = 'watchRecord-$_myId-$tmdbId-$mediaType';
    final (hit, cached) = _readFromCache<Map<String, dynamic>?>(key);
    if (hit) return cached;
    final row = await _client
        .from('watch_records')
        .select()
        .eq('user_id', _myId)
        .eq('tmdb_id', tmdbId)
        .eq('media_type', mediaType)
        .maybeSingle();
    _writeToCache(key, row);
    return row;
  }

  /// Upserts the watch record for a title and logs a `watch_log` entry
  /// (feeds the Stats 7-day chart / week-month totals).
  ///
  /// If the title was already `completed` before this call and [status] is
  /// `completed` again, `rewatch_count` auto-increments — mirrors desktop's
  /// "already completed → completing again" rule in
  /// LibraryRepository.UpdateMovieWatchStatusAsync. First-time completion
  /// never increments it.
  static Future<void> logWatched({
    required int tmdbId,
    required String mediaType,
    required String title,
    String? posterPath,
    List<String>? genres,
    int? releaseYear,
    String? network,
    int? rating,
    int estimatedMinutes = 0,
    String status = 'completed',
  }) async {
    final existing = await fetchWatchRecord(tmdbId, mediaType);
    final wasCompleted = existing?['status'] == 'completed';
    final currentRewatchCount = (existing?['rewatch_count'] as num?)?.toInt() ?? 0;
    final nextRewatchCount = wasCompleted && status == 'completed'
        ? currentRewatchCount + 1
        : currentRewatchCount;

    final row = {
      'user_id': _myId,
      'tmdb_id': tmdbId,
      'media_type': mediaType,
      'title': title,
      'poster_path': posterPath,
      'genres': genres ?? const [],
      'release_year': releaseYear,
      'network': network,
      'status': status,
      'rating': rating,
      'rewatch_count': nextRewatchCount,
      'updated_at': DateTime.now().toIso8601String(),
    };
    await _client
        .from('watch_records')
        .upsert(row, onConflict: 'user_id,tmdb_id,media_type');
    _writeToCache('watchRecord-$_myId-$tmdbId-$mediaType', row);
    if (estimatedMinutes > 0) {
      await _client.from('watch_log').insert({
        'user_id': _myId,
        'tmdb_id': tmdbId,
        'media_type': mediaType,
        'minutes': estimatedMinutes,
      });
    }
    libraryVersion.value++;
  }

  /// Manual correction for a movie/series' rewatch count (e.g. fixing a
  /// miscount) — bypasses the auto-increment rule in [logWatched] entirely,
  /// mirroring [setEpisodeRewatchCount].
  static Future<void> setTitleRewatchCount(
    int tmdbId,
    String mediaType,
    int count,
  ) async {
    final clamped = count < 0 ? 0 : count;
    await _client
        .from('watch_records')
        .update({
          'rewatch_count': clamped,
          'updated_at': DateTime.now().toIso8601String(),
        })
        .eq('user_id', _myId)
        .eq('tmdb_id', tmdbId)
        .eq('media_type', mediaType);
    libraryVersion.value++;
  }

  /// Updates just the rating on an already-completed movie/series row — used
  /// by the "you just watched this, wanna rate it?" notification flow, which
  /// only needs to set a rating on a watch that's already logged (unlike
  /// [logWatched], which re-upserts the whole record including status).
  static Future<void> setTitleRating(
    int tmdbId,
    String mediaType,
    int rating,
  ) async {
    await _client
        .from('watch_records')
        .update({
          'rating': rating,
          'updated_at': DateTime.now().toIso8601String(),
        })
        .eq('user_id', _myId)
        .eq('tmdb_id', tmdbId)
        .eq('media_type', mediaType);
    libraryVersion.value++;
  }

  /// Batched version of [logWatched] for bulk imports (Letterboxd/TV Time
  /// exports) — one upsert call for many titles instead of one round trip
  /// per title. Each row needs `tmdb_id`/`media_type` plus whichever of
  /// `title`/`poster_path`/`genres`/`release_year`/`network`/`status`/
  /// `rating`/`updated_at` apply; `user_id` is injected here. Does not write
  /// `watch_log` entries — there's no real watch date/duration to attribute
  /// for backfilled history, so importing shouldn't skew the Stats charts.
  static Future<void> bulkLogWatched(List<Map<String, dynamic>> rows) async {
    if (rows.isEmpty) return;
    final withUser = rows.map((r) => {'user_id': _myId, ...r}).toList();
    await _client
        .from('watch_records')
        .upsert(withUser, onConflict: 'user_id,tmdb_id,media_type');
    libraryVersion.value++;
  }

  static Future<List<Map<String, dynamic>>> fetchRecentlyCompleted({
    String? mediaType,
    int limit = 10,
  }) async {
    var query = _client
        .from('watch_records')
        .select()
        .eq('user_id', _myId)
        .eq('status', 'completed');
    if (mediaType != null) query = query.eq('media_type', mediaType);
    return query.order('updated_at', ascending: false).limit(limit);
  }

  /// tmdb_ids of series in the "Dropped" custom list, if the account has
  /// ever used Title Detail's "Drop" action (see title_actions_sheet.dart's
  /// `_dropTitle`, which creates this list on first use) — that's a plain
  /// `user_lists` entry, not a `watch_records.status` value, so this is the
  /// only real way to check "has this account dropped this show". Empty set
  /// (not an error) if the list doesn't exist yet.
  static Future<Set<int>> _droppedShowIds() async {
    final lists = await _client
        .from('user_lists')
        .select('id, name')
        .eq('user_id', _myId)
        .eq('type', 'custom');
    final droppedListIds = lists
        .where((l) => (l['name'] as String? ?? '').toLowerCase() == 'dropped')
        .map((l) => l['id'] as String)
        .toList();
    if (droppedListIds.isEmpty) return {};
    final items = await _client
        .from('user_list_items')
        .select('tmdb_id')
        .inFilter('list_id', droppedListIds)
        .eq('media_type', 'series');
    return items.map((r) => (r['tmdb_id'] as num).toInt()).toSet();
  }

  /// TEMPORARY diagnostic — every item actually stored in the "Dropped" list, with NO
  /// media_type filter (unlike [_droppedShowIds], which only counts `media_type == 'series'`
  /// entries — if a title got dropped with the wrong media_type, it'd silently miss that filter
  /// and never show up as "dropped" from Currently Watching's point of view). Lets us see
  /// directly whether a show that's still leaking through Currently Watching is actually stored
  /// with a mismatched media_type or tmdb_id, instead of guessing.
  static Future<List<Map<String, dynamic>>> fetchDroppedShowDetails() async {
    final lists = await _client
        .from('user_lists')
        .select('id, name')
        .eq('user_id', _myId)
        .eq('type', 'custom');
    final droppedListIds = lists
        .where((l) => (l['name'] as String? ?? '').toLowerCase() == 'dropped')
        .map((l) => l['id'] as String)
        .toList();
    if (droppedListIds.isEmpty) return [];
    return _client
        .from('user_list_items')
        .select('tmdb_id, title, media_type')
        .inFilter('list_id', droppedListIds)
        .order('title');
  }

  /// Series the account is actively behind on — mirrors the desktop app's
  /// "Currently Watching"/Up Next logic (`GetCurrentlyWatchingSeriesAsync`
  /// in Pitflix.Core's LibraryRepository) rather than a mobile-invented
  /// approximation: a show qualifies if it's been started (at least one
  /// watched episode) AND has a next episode that's (a) actually aired
  /// already and (b) not yet watched — a lowest-unwatched-aired-episode
  /// search across every season the account has any progress in, same idea
  /// as desktop's `FindNextUndownloadedAiredEpisodeAsync`. Checked in an
  /// order that keeps this cheap for the common case (sequential watching):
  /// the most-recently-watched season first, then one season further (a
  /// freshly-released next season), and only then the remaining
  /// already-watched seasons in case of an earlier gap (e.g. watched
  /// episodes 1,2,4,5 of season 1 but skipped 3 — that gap is found even
  /// though it isn't in the most-recent season). A show with no aired-but-
  /// unwatched episode anywhere in that scan is excluded — truly caught up,
  /// nothing to watch right now — even if `watch_records.status` is still
  /// `watching`/never `completed`; it naturally reappears once a new
  /// episode airs, no separate "completed but new episode" case needed.
  ///
  /// Shows the account dropped are always excluded — via the "Dropped"
  /// user_list (see title_actions_sheet.dart's `_dropTitle`), which is the
  /// actual mechanism the app's own "Drop" action uses, NOT
  /// `watch_records.status = 'dropped'` (no code path ever writes that
  /// value — checking it here was a no-op that let dropped shows keep
  /// showing up).
  /// Last successful [fetchCurrentlyWatching] result, persisted to disk —
  /// lets Home paint immediately from yesterday's snapshot on cold start
  /// instead of showing a blank skeleton for the several seconds the real
  /// fetch below unavoidably takes (Supabase paged fetch + per-show TMDB
  /// season lookups, all uncached on a fresh process — see TmdbService's
  /// season/episode-count caches, which start empty every cold start).
  /// Real data still replaces this the moment the live fetch finishes; this
  /// is only ever a "something now" stand-in for "nothing for several
  /// seconds", same idea as MyDeviceScanner's folder-list cache.
  static Future<List<Map<String, dynamic>>?> cachedCurrentlyWatching() async {
    try {
      final prefs = await SharedPreferences.getInstance();
      final raw = prefs.getString('currently_watching_cache_$_myId');
      if (raw == null) return null;
      return (jsonDecode(raw) as List).cast<Map<String, dynamic>>();
    } catch (_) {
      return null;
    }
  }

  static Future<void> _cacheCurrentlyWatching(
    List<Map<String, dynamic>> rows,
  ) async {
    try {
      final prefs = await SharedPreferences.getInstance();
      await prefs.setString(
        'currently_watching_cache_$_myId',
        jsonEncode(rows),
      );
    } catch (_) {
      // Best-effort — just means next cold start skips straight to the live
      // fetch instead of getting an instant stale paint first.
    }
  }

  static Future<List<Map<String, dynamic>>> fetchCurrentlyWatching() async {
    final results = await Future.wait<dynamic>([
      _fetchAllRows(
        (start, end) => _client
            .from('watch_records')
            .select()
            .eq('user_id', _myId)
            .eq('media_type', 'series')
            .range(start, end),
      ),
      _fetchAllRows(
        (start, end) => _client
            .from('episode_watch_status')
            .select('show_tmdb_id, season_number, episode_number, watched_at')
            .eq('user_id', _myId)
            .range(start, end),
      ),
      _droppedShowIds(),
    ]);
    final records = results[0] as List<Map<String, dynamic>>;
    final progressRows = results[1] as List<Map<String, dynamic>>;
    final droppedIds = results[2] as Set<int>;

    final byId = <int, Map<String, dynamic>>{
      for (final r in records) (r['tmdb_id'] as num).toInt(): r,
    };

    final watchedByShow = <int, Set<String>>{};
    final lastProgressAt = <int, DateTime>{};
    for (final r in progressRows) {
      final id = (r['show_tmdb_id'] as num?)?.toInt();
      if (id == null) continue;
      final season = (r['season_number'] as num?)?.toInt();
      final episode = (r['episode_number'] as num?)?.toInt();
      if (season != null && episode != null) {
        watchedByShow.putIfAbsent(id, () => {}).add('$season-$episode');
      }
      final at = DateTime.tryParse(r['watched_at'] as String? ?? '');
      if (at != null) {
        final existing = lastProgressAt[id];
        if (existing == null || at.isAfter(existing)) lastProgressAt[id] = at;
      }
    }

    // Only shows with at least one watched episode are candidates — a show
    // that's never actually been started has nothing to be "still behind
    // on" regardless of what watch_records.status says.
    final candidateIds = watchedByShow.keys
        .where((id) => !droppedIds.contains(id))
        .toList();

    final todayStr = DateTime.now().toIso8601String().substring(0, 10);

    /// First aired-but-unwatched episode number in [season], scanning in
    /// ascending order — null if that season has nothing new (fully
    /// watched, or the rest hasn't aired yet).
    Future<int?> firstUnwatchedAiredEpisode(int showId, int season) async {
      final airDates = await TmdbService.fetchSeasonAirDates(showId, season);
      final watched = watchedByShow[showId]!;
      final candidates =
          airDates.entries
              .where(
                (e) =>
                    !watched.contains('$season-${e.key}') &&
                    e.value.compareTo(todayStr) <= 0,
              )
              .toList()
            ..sort((a, b) => a.key.compareTo(b.key));
      return candidates.isEmpty ? null : candidates.first.key;
    }

    final rows = <Map<String, dynamic>>[];
    await Future.wait(
      candidateIds.map((id) async {
        // Season 0 (Specials) excluded — same as the onboarding season
        // picker's `s.number > 0` filter and desktop's local-library-driven
        // maxSeason (which never lands on 0 since specials aren't tracked
        // that way there). Without this, a show fully finished on every
        // real season keeps reappearing here forever just because an
        // unwatched TMDB special exists — desktop's Up Next never has this
        // problem since it only ever checks maxSeason/maxSeason+1, both
        // derived from real scanned seasons.
        final watchedSeasons = watchedByShow[id]!
            .map((k) => int.parse(k.split('-')[0]))
            .where((s) => s > 0)
            .toSet();
        if (watchedSeasons.isEmpty) return; // Only specials watched — nothing real to resume.
        final maxSeason = watchedSeasons.reduce((a, b) => a > b ? a : b);
        // Most-recent-season-first, then the possible next season, then any
        // earlier watched season with a gap — see the doc comment above.
        final seasonsToCheck = <int>[
          maxSeason,
          maxSeason + 1,
          for (final s in watchedSeasons)
            if (s != maxSeason) s,
        ];

        // Checked in parallel (rather than sequentially awaiting each one) —
        // seasonsToCheck is only 2-3 entries and each is an independent TMDB
        // call, so there's no reason to pay their latency one after another.
        // The *result* still respects seasonsToCheck's priority order below.
        final seasonResults = await Future.wait(
          seasonsToCheck.map(
            (season) async => MapEntry(season, await firstUnwatchedAiredEpisode(id, season)),
          ),
        );
        final resultBySeason = {for (final e in seasonResults) e.key: e.value};
        int? next;
        int? nextSeason;
        for (final season in seasonsToCheck) {
          final candidate = resultBySeason[season];
          if (candidate != null) {
            next = candidate;
            nextSeason = season;
            break;
          }
        }
        if (next == null) return; // Truly caught up everywhere checked.

        final record = byId[id];
        var title = record?['title'] as String?;
        var posterPath = record?['poster_path'] as String?;
        if (title == null) {
          final summary = await TmdbService.fetchShowSummary(id);
          title = summary?.title;
          posterPath ??= summary?.posterPath;
        }
        final updatedAt =
            DateTime.tryParse(record?['updated_at'] as String? ?? '') ??
            lastProgressAt[id];
        rows.add({
          'tmdb_id': id,
          'title': title ?? 'Untitled',
          'poster_path': posterPath,
          'updated_at': updatedAt?.toIso8601String(),
          // Excludes season 0 — TMDB's number_of_episodes (this row's
          // eventual denominator, fetched separately) never counts
          // Specials, so counting them here would let the shown fraction
          // exceed the total.
          'watched_episode_count': watchedByShow[id]!
              .where((k) => int.parse(k.split('-')[0]) > 0)
              .length,
          'next_season': nextSeason,
          'next_episode': next,
        });
      }),
    );
    rows.sort((a, b) {
      final aAt = a['updated_at'] as String?;
      final bAt = b['updated_at'] as String?;
      if (aAt == null) return bAt == null ? 0 : 1;
      if (bAt == null) return -1;
      return bAt.compareTo(aAt);
    });
    unawaited(_cacheCurrentlyWatching(rows));
    return rows;
  }

  /// Shows this account is tracking that have an upcoming episode air date —
  /// mirrors the desktop app's "Next Episodes" Home section (library shows +
  /// their TMDB next-airing date), minus its local-library-only pinning/
  /// backlog features this schema has no equivalent for. A show the account
  /// dropped intentionally shouldn't keep nagging about new episodes, so
  /// dropped shows are excluded via the real "Dropped" user_list (see
  /// [_droppedShowIds] — `watch_records.status = 'dropped'` is never
  /// actually written, so filtering on it here was a no-op).
  static Future<List<TitleItem>> fetchNextEpisodes({int limit = 20}) async {
    final results = await Future.wait<dynamic>([
      _client
          .from('watch_records')
          .select()
          .eq('user_id', _myId)
          .eq('media_type', 'series'),
      _droppedShowIds(),
    ]);
    final allRecords = results[0] as List<Map<String, dynamic>>;
    final droppedIds = results[1] as Set<int>;
    final records = allRecords
        .where((r) => !droppedIds.contains((r['tmdb_id'] as num).toInt()))
        .toList();
    if (records.isEmpty) return [];

    final today = DateTime.now();
    final todayDay = DateTime(today.year, today.month, today.day);
    final rows = await Future.wait(
      records.map((r) async {
        final tmdbId = (r['tmdb_id'] as num).toInt();
        final next = await TmdbService.fetchNextEpisode(tmdbId);
        final airDate = next?.airDate;
        if (airDate == null) return null;
        if (airDate.isBefore(todayDay)) return null;
        final label = next?.season != null && next?.episode != null
            ? 'S${next!.season} E${next.episode} · ${_shortDate(airDate)}'
            : _shortDate(airDate);
        return TitleItem(
          id: 'next-episode-$tmdbId',
          name: r['title'] as String? ?? 'Untitled',
          kind: TitleKind.show,
          year: 0,
          network: 'TV',
          rating: 0,
          genres: const [],
          overview: '',
          gradientSeed: tmdbId % 6,
          posterPath: r['poster_path'] as String?,
          tmdbId: tmdbId,
          isSummaryOnly: true,
          episodeSub: label,
          releaseDate: airDate,
        );
      }),
    );
    final items = rows.whereType<TitleItem>().toList()
      ..sort((a, b) => a.releaseDate!.compareTo(b.releaseDate!));
    return items.take(limit).toList();
  }

  static String _shortDate(DateTime d) {
    const months = [
      'Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun',
      'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec',
    ];
    return '${months[d.month - 1]} ${d.day}';
  }

  static TitleItem _titleFromWatchRecord(Map<String, dynamic> r) {
    final tmdbId = (r['tmdb_id'] as num).toInt();
    final mediaType = r['media_type'] as String? ?? 'movie';
    final kind = mediaType == 'series' ? TitleKind.show : TitleKind.movie;
    return TitleItem(
      id: 'watch-record-$tmdbId-${kind.name}',
      name: r['title'] as String? ?? 'Untitled',
      kind: kind,
      year: (r['release_year'] as num?)?.toInt() ?? 0,
      network: kind == TitleKind.movie ? 'Theaters' : 'TV',
      rating: 0,
      genres: (r['genres'] as List? ?? const []).cast<String>(),
      overview: '',
      gradientSeed: tmdbId % 6,
      posterPath: r['poster_path'] as String?,
      tmdbId: tmdbId,
      isSummaryOnly: true,
    );
  }

  /// Same shape Profile's old `fetchRecentlyWatched()` returned — recently
  /// completed movies/series plus summary totals, for the "Movies"/"Series"
  /// rows and quick stat tiles.
  static Future<
    ({
      List<TitleItem> movies,
      List<TitleItem> series,
      int totalWatchTimeMinutes,
      int totalEpisodesWatched,
      int totalMoviesWatched,
    })
  >
  fetchProfileSummary() async {
    final results = await Future.wait<dynamic>([
      fetchRecentlyCompleted(mediaType: 'movie'),
      fetchRecentlyCompleted(mediaType: 'series'),
      _fetchAllRows(
        (start, end) => _client
            .from('watch_log')
            .select('minutes')
            .eq('user_id', _myId)
            .range(start, end),
      ),
      _fetchAllRows(
        (start, end) => _client
            .from('watch_records')
            .select('id')
            .eq('user_id', _myId)
            .eq('media_type', 'movie')
            .eq('status', 'completed')
            .range(start, end),
      ),
      _fetchAllRows(
        (start, end) => _client
            .from('episode_watch_status')
            .select('id')
            .eq('user_id', _myId)
            .range(start, end),
      ),
    ]);
    final movieRows = results[0] as List<Map<String, dynamic>>;
    final seriesRows = results[1] as List<Map<String, dynamic>>;
    final logRows = results[2] as List<Map<String, dynamic>>;
    final completedMovies = results[3] as List<Map<String, dynamic>>;
    final watchedEpisodes = results[4] as List<Map<String, dynamic>>;

    final totalMinutes = logRows.fold<int>(
      0,
      (sum, r) => sum + ((r['minutes'] as num?)?.toInt() ?? 0),
    );

    final movieTitles = await applyCustomArtwork(
      movieRows.map(_titleFromWatchRecord).toList(),
    );
    final seriesTitles = await applyCustomArtwork(
      seriesRows.map(_titleFromWatchRecord).toList(),
    );

    return (
      movies: movieTitles,
      series: seriesTitles,
      totalWatchTimeMinutes: totalMinutes,
      totalEpisodesWatched: watchedEpisodes.length,
      totalMoviesWatched: completedMovies.length,
    );
  }

  /// This account's entire watch state across all movies/series, in bulk —
  /// used by the Letterboxd/TV Time importers to skip re-writing anything
  /// already recorded (either from a previous import run, from using the
  /// app normally, or from the desktop "Link Mobile Account" push) instead
  /// of blindly re-upserting every title/episode on every import attempt.
  /// One pair of queries covering the whole account, not one per title —
  /// this is what actually makes re-running an import fast.
  static Future<
    ({
      Map<int, String> movieStatusByTmdbId,
      Map<int, String> seriesStatusByTmdbId,
      Map<int, Set<String>> watchedEpisodesByShowId,
    })
  >
  fetchImportBaseline() async {
    final results = await Future.wait<dynamic>([
      _client
          .from('watch_records')
          .select('tmdb_id, media_type, status')
          .eq('user_id', _myId),
      _client
          .from('episode_watch_status')
          .select('show_tmdb_id, season_number, episode_number')
          .eq('user_id', _myId),
    ]);
    final records = results[0] as List<Map<String, dynamic>>;
    final episodeRows = results[1] as List<Map<String, dynamic>>;

    final movieStatus = <int, String>{};
    final seriesStatus = <int, String>{};
    for (final r in records) {
      final tmdbId = (r['tmdb_id'] as num).toInt();
      final status = r['status'] as String?;
      if (status == null) continue;
      if (r['media_type'] == 'movie') {
        movieStatus[tmdbId] = status;
      } else if (r['media_type'] == 'series') {
        seriesStatus[tmdbId] = status;
      }
    }

    final watchedEpisodes = <int, Set<String>>{};
    for (final r in episodeRows) {
      final showId = (r['show_tmdb_id'] as num?)?.toInt();
      final season = (r['season_number'] as num?)?.toInt();
      final episode = (r['episode_number'] as num?)?.toInt();
      if (showId == null || season == null || episode == null) continue;
      watchedEpisodes.putIfAbsent(showId, () => {}).add('$season-$episode');
    }

    return (
      movieStatusByTmdbId: movieStatus,
      seriesStatusByTmdbId: seriesStatus,
      watchedEpisodesByShowId: watchedEpisodes,
    );
  }

  // ── episode tracking ──────────────────────────────────────────────────

  /// Per-episode watch state for [showTmdbId] — key is "$season-$episode",
  /// value is that episode's rewatch count (row presence = watched; 0 means
  /// watched-but-never-rewatched).
  static Future<Map<String, int>> fetchEpisodeWatchStatuses(
    int showTmdbId,
  ) async {
    final key = 'episodeStatuses-$_myId-$showTmdbId';
    final (hit, cached) = _readFromCache<Map<String, int>>(key);
    if (hit) return cached ?? const {};
    final rows = await _client
        .from('episode_watch_status')
        .select('season_number, episode_number, rewatch_count')
        .eq('user_id', _myId)
        .eq('show_tmdb_id', showTmdbId);
    final result = {
      for (final r in rows)
        '${r['season_number']}-${r['episode_number']}':
            (r['rewatch_count'] as num?)?.toInt() ?? 0,
    };
    _writeToCache(key, result);
    return result;
  }

  static Future<void> setEpisodeWatched(
    int showTmdbId,
    int season,
    int episode, {
    required bool watched,
  }) async {
    if (watched) {
      await _client.from('episode_watch_status').upsert({
        'user_id': _myId,
        'show_tmdb_id': showTmdbId,
        'season_number': season,
        'episode_number': episode,
      }, onConflict: 'user_id,show_tmdb_id,season_number,episode_number');
    } else {
      await _client
          .from('episode_watch_status')
          .delete()
          .eq('user_id', _myId)
          .eq('show_tmdb_id', showTmdbId)
          .eq('season_number', season)
          .eq('episode_number', episode);
    }
    libraryVersion.value++;
  }

  /// Batched version of [setEpisodeWatched] for bulk imports — one upsert
  /// call per show instead of one per episode. Each entry needs
  /// `season_number`/`episode_number` and may include `watched_at` (ISO
  /// string) to preserve the source app's original watch date instead of
  /// defaulting to "now".
  static Future<void> bulkSetEpisodesWatched(
    int showTmdbId,
    List<Map<String, dynamic>> episodes,
  ) async {
    if (episodes.isEmpty) return;
    final rows = episodes
        .map(
          (e) => {
            'user_id': _myId,
            'show_tmdb_id': showTmdbId,
            'season_number': e['season_number'],
            'episode_number': e['episode_number'],
            if (e['watched_at'] != null) 'watched_at': e['watched_at'],
          },
        )
        .toList();
    await _client.from('episode_watch_status').upsert(
      rows,
      onConflict: 'user_id,show_tmdb_id,season_number,episode_number',
    );
    libraryVersion.value++;
  }

  /// Persists the episode popup's "Mark Rewatched" counter — upserts (rather
  /// than requiring the episode already be marked watched first) since
  /// rewatching implies watched, matching the sheet's own local behavior.
  static Future<void> setEpisodeRewatchCount(
    int showTmdbId,
    int season,
    int episode,
    int count,
  ) async {
    await _client.from('episode_watch_status').upsert({
      'user_id': _myId,
      'show_tmdb_id': showTmdbId,
      'season_number': season,
      'episode_number': episode,
      'rewatch_count': count,
    }, onConflict: 'user_id,show_tmdb_id,season_number,episode_number');
    libraryVersion.value++;
  }

  /// Persists a rating for a specific episode — see
  /// Pitflix.API/Services/Supabase/sql/010_pitflix_episode_rating.sql. Upserts
  /// (rather than requiring the episode already be marked watched) matching
  /// [setEpisodeRewatchCount]'s own behavior.
  static Future<void> setEpisodeRating(
    int showTmdbId,
    int season,
    int episode,
    int rating,
  ) async {
    await _client.from('episode_watch_status').upsert({
      'user_id': _myId,
      'show_tmdb_id': showTmdbId,
      'season_number': season,
      'episode_number': episode,
      'rating': rating,
    }, onConflict: 'user_id,show_tmdb_id,season_number,episode_number');
    libraryVersion.value++;
  }

  // ── title customizations (custom poster/backdrop) ────────────────────────

  /// This account's custom poster/backdrop for a title, if any — see
  /// Pitflix.API/Services/Supabase/sql/008_pitflix_title_customizations.sql.
  /// Keyed by (tmdb_id, media_type) only, so it applies to any title with a
  /// TMDB id, not just ones matched in the desktop's local library.
  static Future<Map<String, dynamic>?> fetchCustomArtwork(
    int tmdbId,
    String mediaType,
  ) async {
    final key = 'customArtwork-$_myId-$tmdbId-$mediaType';
    final (hit, cached) = _readFromCache<Map<String, dynamic>?>(key);
    if (hit) return cached;
    final row = await _client
        .from('user_title_customizations')
        .select()
        .eq('user_id', _myId)
        .eq('tmdb_id', tmdbId)
        .eq('media_type', mediaType)
        .maybeSingle();
    _writeToCache(key, row);
    return row;
  }

  static Future<void> setCustomPoster(
    int tmdbId,
    String mediaType,
    String posterPath,
  ) async {
    await _client.from('user_title_customizations').upsert({
      'user_id': _myId,
      'tmdb_id': tmdbId,
      'media_type': mediaType,
      'custom_poster_path': posterPath,
      'updated_at': DateTime.now().toIso8601String(),
    }, onConflict: 'user_id,tmdb_id,media_type');
  }

  static Future<void> setCustomBackdrop(
    int tmdbId,
    String mediaType,
    String backdropPath,
  ) async {
    await _client.from('user_title_customizations').upsert({
      'user_id': _myId,
      'tmdb_id': tmdbId,
      'media_type': mediaType,
      'custom_backdrop_path': backdropPath,
      'updated_at': DateTime.now().toIso8601String(),
    }, onConflict: 'user_id,tmdb_id,media_type');
  }

  /// Merges in any saved custom poster/backdrop for [items] — one batched
  /// query instead of one per title. Use this wherever a list of titles is
  /// built from a Supabase snapshot (`watch_records`/`user_list_items`),
  /// which otherwise has no way to know about a pick made via Title Detail's
  /// "Change Poster"/"Change Backdrop" (that only updates `_enriched` on the
  /// detail screen itself, not the underlying Supabase rows these lists read
  /// from). Titles with no `tmdbId`, or with no saved customization, pass
  /// through unchanged.
  static Future<List<TitleItem>> applyCustomArtwork(
    List<TitleItem> items,
  ) async {
    final ids = items
        .where((t) => t.tmdbId != null)
        .map((t) => t.tmdbId!)
        .toSet();
    if (ids.isEmpty) return items;
    try {
      final rows = await _client
          .from('user_title_customizations')
          .select()
          .eq('user_id', _myId)
          .inFilter('tmdb_id', ids.toList());
      if (rows.isEmpty) return items;

      final byKey = <String, Map<String, dynamic>>{
        for (final r in rows) '${r['tmdb_id']}-${r['media_type']}': r,
      };
      return items.map((t) {
        if (t.tmdbId == null) return t;
        final row = byKey['${t.tmdbId}-${t.isShow ? 'series' : 'movie'}'];
        if (row == null) return t;
        final poster = row['custom_poster_path'] as String?;
        final backdrop = row['custom_backdrop_path'] as String?;
        if (poster == null && backdrop == null) return t;
        return t.copyWith(posterPath: poster, backdropPath: backdrop);
      }).toList();
    } catch (_) {
      return items;
    }
  }

  // ── desktop sync status ───────────────────────────────────────────────

  /// When the desktop last successfully pushed to this account (see
  /// Pitflix.API/Services/Supabase/sql/009_pitflix_sync_status.sql) — null if
  /// the desktop was never linked, or has never completed a push. Not a
  /// live/LAN reachability check; the desktop only writes this every 5
  /// minutes (or immediately after linking/"Sync Now"), so a fresh phone-side
  /// "Refresh Library" won't itself change this value.
  static Future<DateTime?> fetchSyncStatus() async {
    try {
      final row = await _client
          .from('user_sync_status')
          .select('last_synced_at')
          .eq('user_id', _myId)
          .maybeSingle();
      final raw = row?['last_synced_at'] as String?;
      return raw == null ? null : DateTime.tryParse(raw);
    } catch (_) {
      return null;
    }
  }

  // ── rate prompts ("you just watched this, wanna rate it?") ─────────────

  /// How far back "recently watched" looks for rate prompts — without this,
  /// anything completed since [AppSettings.ratePromptBaselineAt] (a one-time
  /// install-day cutoff, never moves) stays a candidate forever if never
  /// rated or dismissed, so the list reads as an ever-growing backlog
  /// instead of "you just watched this". This is what actually keeps it to
  /// "just watched" going forward.
  static const ratePromptRecentWindow = Duration(days: 3);

  /// Recently-completed movies/series and recently-watched episodes with no
  /// rating yet — feeds the notification list. "Recently" is bounded by
  /// whichever is later of [AppSettings.ratePromptBaselineAt] (a one-time
  /// install-day cutoff, so shipping this feature never dumped years of
  /// pre-existing unrated history) and [ratePromptRecentWindow] (a rolling
  /// window, so the list only ever shows what was actually watched in the
  /// last few days — not everything unrated since install). Anything the
  /// user explicitly swiped away is excluded via
  /// [AppSettings.dismissedRatePrompts]. Sourced from whichever device most
  /// recently wrote the watch — including the desktop app's "Link Mobile
  /// Account" push — so this is how a desktop-side "mark watched" surfaces
  /// here too, not just ones made in this app.
  static Future<List<RatePromptItem>> fetchPendingRatePrompts() async {
    final installBaseline =
        AppSettings.ratePromptBaselineAt.value ?? DateTime.now();
    final recentCutoff = DateTime.now().subtract(ratePromptRecentWindow);
    final baseline = (installBaseline.isAfter(recentCutoff)
            ? installBaseline
            : recentCutoff)
        .toIso8601String();
    final dismissed = AppSettings.dismissedRatePrompts.value;

    final results = await Future.wait([
      _client
          .from('watch_records')
          .select()
          .eq('user_id', _myId)
          .eq('status', 'completed')
          .isFilter('rating', null)
          .gte('updated_at', baseline),
      _client
          .from('episode_watch_status')
          .select()
          .eq('user_id', _myId)
          .isFilter('rating', null)
          .gte('watched_at', baseline),
    ]);
    final watchRows = results[0];
    final episodeRows = results[1];

    final items = <RatePromptItem>[];

    for (final r in watchRows) {
      final tmdbId = (r['tmdb_id'] as num).toInt();
      final mediaType = r['media_type'] as String? ?? 'movie';
      final type = mediaType == 'series'
          ? RatePromptType.series
          : RatePromptType.movie;
      final key = '${mediaType == 'series' ? 'series' : 'movie'}-$tmdbId';
      if (dismissed.contains(key)) continue;
      items.add(
        RatePromptItem(
          key: key,
          type: type,
          tmdbId: tmdbId,
          title: r['title'] as String? ?? 'Untitled',
          posterPath: r['poster_path'] as String?,
          watchedAt:
              DateTime.tryParse(r['updated_at'] as String? ?? '') ??
              DateTime.now(),
        ),
      );
    }

    if (episodeRows.isNotEmpty) {
      final showIds = episodeRows
          .map((r) => (r['show_tmdb_id'] as num).toInt())
          .toSet();
      final showRows = await _client
          .from('watch_records')
          .select('tmdb_id, title, poster_path')
          .eq('user_id', _myId)
          .eq('media_type', 'series')
          .inFilter('tmdb_id', showIds.toList());
      final showInfo = {
        for (final s in showRows) (s['tmdb_id'] as num).toInt(): s,
      };

      for (final r in episodeRows) {
        final showTmdbId = (r['show_tmdb_id'] as num).toInt();
        final season = (r['season_number'] as num).toInt();
        final episode = (r['episode_number'] as num).toInt();
        final key = 'episode-$showTmdbId-$season-$episode';
        if (dismissed.contains(key)) continue;
        final info = showInfo[showTmdbId];
        items.add(
          RatePromptItem(
            key: key,
            type: RatePromptType.episode,
            tmdbId: showTmdbId,
            title: info?['title'] as String? ?? 'Untitled',
            posterPath: info?['poster_path'] as String?,
            season: season,
            episodeNumber: episode,
            watchedAt:
                DateTime.tryParse(r['watched_at'] as String? ?? '') ??
                DateTime.now(),
          ),
        );
      }
    }

    items.sort((a, b) => b.watchedAt.compareTo(a.watchedAt));
    return items;
  }

  // ── stats ──────────────────────────────────────────────────────────────

  /// Raw rows for client-side aggregation by `_StatsData.fromUserLibrary` —
  /// kept as maps (not parsed into a bundle here) since the aggregation
  /// shape is presentation-specific and lives with the Stats screen.
  static Future<
    ({
      List<Map<String, dynamic>> watchRecords,
      List<Map<String, dynamic>> watchLog,
      List<Map<String, dynamic>> episodeRewatches,
    })
  >
  fetchStatsSource() async {
    final results = await Future.wait([
      _fetchAllRows(
        (start, end) =>
            _client.from('watch_records').select().eq('user_id', _myId).range(start, end),
      ),
      // Was `.order(...).limit(500)` — fine for the "Last 7 Days" chart alone, but the all-time
      // "Time Watched" hero value and week/month totals sum every row here, so capping at the
      // most recent 500 silently undercounted anyone with more log entries than that (which is
      // now the common case since the export fix above started pushing full watch history).
      _fetchAllRows(
        (start, end) => _client.from('watch_log').select().eq('user_id', _myId).range(start, end),
      ),
      _fetchAllRows(
        (start, end) => _client
            .from('episode_watch_status')
            .select('rewatch_count')
            .eq('user_id', _myId)
            .gt('rewatch_count', 0)
            .range(start, end),
      ),
    ]);
    return (
      watchRecords: results[0],
      watchLog: results[1],
      episodeRewatches: results[2],
    );
  }

  /// TEMPORARY diagnostic (Settings > "Sync Diagnostics") — raw row counts straight from this
  /// account's Supabase tables, bypassing any client-side caching/derived logic, so they can be
  /// compared directly against the desktop's own Stats numbers (moviesCompleted/seriesCompleted/
  /// episodes from StatsEndpoints) to find exactly where the two diverge. Fetches only an id
  /// column per table and counts client-side rather than a server-side COUNT, since that's
  /// simple and these tables are never large enough for it to matter.
  static Future<
    ({
      int movieRows,
      int seriesRows,
      int episodeRows,
      int watchLogRows,
      int droppedShowCount,
      String? linkedEmail,
    })
  >
  fetchDiagnosticCounts() async {
    final results = await Future.wait<dynamic>([
      _fetchAllRows(
        (start, end) => _client
            .from('watch_records')
            .select('tmdb_id')
            .eq('user_id', _myId)
            .eq('media_type', 'movie')
            .range(start, end),
      ),
      _fetchAllRows(
        (start, end) => _client
            .from('watch_records')
            .select('tmdb_id')
            .eq('user_id', _myId)
            .eq('media_type', 'series')
            .range(start, end),
      ),
      _fetchAllRows(
        (start, end) => _client
            .from('episode_watch_status')
            .select('show_tmdb_id')
            .eq('user_id', _myId)
            .range(start, end),
      ),
      _fetchAllRows(
        (start, end) =>
            _client.from('watch_log').select('tmdb_id').eq('user_id', _myId).range(start, end),
      ),
      _droppedShowIds(),
    ]);
    return (
      movieRows: (results[0] as List).length,
      seriesRows: (results[1] as List).length,
      episodeRows: (results[2] as List).length,
      watchLogRows: (results[3] as List).length,
      droppedShowCount: (results[4] as Set<int>).length,
      linkedEmail: AuthService.currentUser?.email,
    );
  }

  /// TEMPORARY debug action (Settings > Library > "Wipe Watch Data") — deletes this account's
  /// `watch_records`/`episode_watch_status`/`watch_log` rows entirely (movies, series, and every
  /// episode's watched status), so a subsequent desktop "Sync Now" rebuilds them from scratch
  /// instead of merging with whatever was here before. Added while diagnosing mobile/desktop
  /// data parity — remove once that's confirmed stable. Does NOT touch `user_lists`/
  /// `user_list_items` (Watch Later/Favorites/custom lists like "Dropped" stay intact).
  static Future<void> wipeWatchData() async {
    await Future.wait([
      _client.from('watch_records').delete().eq('user_id', _myId),
      _client.from('episode_watch_status').delete().eq('user_id', _myId),
      _client.from('watch_log').delete().eq('user_id', _myId),
    ]);
    libraryVersion.value++;
  }
}
