import 'dart:async';
import 'dart:convert';
import 'dart:io';

import 'package:flutter/foundation.dart';
import 'package:path_provider/path_provider.dart';
import 'package:shared_preferences/shared_preferences.dart';

/// Disk-backed cache of raw TMDB responses, so a cold start paints from what the app already knew
/// instead of waiting on the network for content it showed five minutes ago.
///
/// [TtlCache] and TmdbService's various static maps only live as long as the process, and Android
/// reclaims backgrounded apps aggressively — so in practice almost every launch was a fully cold
/// Home: trending, coming soon and the rest all re-fetched from scratch before anything appeared.
///
/// Responses are stored as raw JSON rather than mapped model objects: [TitleItem] and friends are
/// built from TMDB's payload shape via `fromTmdbSummary`, so caching the payload needs no
/// serialization code of its own and can't drift from the models.
///
/// Bounded, and only used for the list endpoints that gate a screen's first paint — never for
/// per-title lookups (which would grow without limit during a library import; those go through
/// DiskTtlStore as compact extracted values instead).
///
/// Lives in its own file, not SharedPreferences: it used to, capped at 24 entries to keep prefs small,
/// but Discover alone persists 20 pages (11 genres x movie/tv) and Home another 11 — so every launch
/// evicted Home's Trending/Coming Soon pages and Home went back to the network for them.
class PersistentJsonCache {
  PersistentJsonCache._();

  /// Where this cache used to live — removed on load so the old blob stops bloating prefs.
  static const _legacyPrefsKey = 'tmdb_response_cache_v1';
  static const _fileName = 'tmdb_response_cache_v2.json';

  /// Above this many entries the oldest are dropped. Room for Home + Discover + Onboarding's lists.
  @visibleForTesting
  static const maxEntries = 64;

  @visibleForTesting
  static Future<File> Function() fileProvider = () async {
    final dir = await getApplicationSupportDirectory();
    return File('${dir.path}/$_fileName');
  };

  /// Skip persisting anything unreasonably large — a runaway response shouldn't bloat the prefs file.
  static const _maxEntryBytes = 256 * 1024;

  static const _writeDebounce = Duration(seconds: 2);

  static final Map<String, ({DateTime at, String body})> _entries = {};
  static bool _loaded = false;
  static Timer? _writeTimer;

  /// Reads the previous session's cache into memory. Safe to call more than once; failures leave the
  /// cache empty rather than throwing, since a cold fetch is always a valid fallback.
  static Future<void> load() async {
    if (_loaded) return;
    _loaded = true;
    unawaited(_removeLegacyPrefs());
    try {
      final file = await fileProvider();
      if (!await file.exists()) return;
      final raw = await file.readAsString();
      final decoded = jsonDecode(raw) as Map<String, dynamic>;
      final restored = <({String key, DateTime at, String body})>[];
      for (final entry in decoded.entries) {
        final value = entry.value as Map<String, dynamic>;
        final at = DateTime.tryParse(value['at'] as String? ?? '');
        final body = value['body'] as String?;
        if (at != null && body != null) {
          restored.add((key: entry.key, at: at, body: body));
        }
      }
      // Oldest first, so insertion order stays age order and eviction keeps working (see set()).
      restored.sort((a, b) => a.at.compareTo(b.at));
      for (final r in restored) {
        // Never clobber an entry a request already stored: load() isn't awaited at startup, so a
        // fetch can land first, and the live response must win over the restored one.
        if (_entries.containsKey(r.key)) continue;
        _entries[r.key] = (at: r.at, body: r.body);
      }
    } catch (e) {
      debugPrint('PersistentJsonCache: could not restore ($e)');
      _entries.clear();
    }
  }

  /// The cached body for [key] if it's still within [ttl], else null.
  static Map<String, dynamic>? get(String key, Duration ttl) {
    final entry = _entries[key];
    if (entry == null) return null;
    if (DateTime.now().difference(entry.at) > ttl) {
      _entries.remove(key);
      return null;
    }
    try {
      return jsonDecode(entry.body) as Map<String, dynamic>;
    } catch (_) {
      _entries.remove(key);
      return null;
    }
  }

  static void set(String key, String body) {
    if (body.length > _maxEntryBytes) return;
    // Remove first so re-setting an existing key moves it to the end: Dart maps keep insertion
    // order, which makes "first key" reliably the oldest entry. Comparing timestamps instead breaks
    // when several writes land in the same millisecond — a burst of parallel Home fetches does
    // exactly that, and ties made eviction drop the newest entry rather than the oldest.
    _entries.remove(key);
    _entries[key] = (at: DateTime.now(), body: body);
    while (_entries.length > maxEntries) {
      _entries.remove(_entries.keys.first);
    }
    _scheduleWrite();
  }

  static Future<void> clear() async {
    _entries.clear();
    _writeTimer?.cancel();
    _writeTimer = null;
    try {
      final file = await fileProvider();
      if (await file.exists()) await file.delete();
    } catch (_) {
      // Nothing to do — worst case a stale blob is overwritten on the next write.
    }
  }

  static Future<void> _removeLegacyPrefs() async {
    try {
      final prefs = await SharedPreferences.getInstance();
      await prefs.remove(_legacyPrefsKey);
    } catch (_) {}
  }

  /// Writes immediately instead of after the debounce — for tests.
  @visibleForTesting
  static Future<void> flush() async {
    _writeTimer?.cancel();
    await _write();
  }

  /// Debounced so a burst of parallel Home fetches results in one serialize + write, not one each.
  static void _scheduleWrite() {
    _writeTimer?.cancel();
    _writeTimer = Timer(_writeDebounce, _write);
  }

  static Future<void> _write() async {
    _writeTimer = null;
    try {
      final payload = {
        for (final e in _entries.entries)
          e.key: {'at': e.value.at.toIso8601String(), 'body': e.value.body},
      };
      final file = await fileProvider();
      await file.writeAsString(jsonEncode(payload), flush: true);
    } catch (e) {
      debugPrint('PersistentJsonCache: could not persist ($e)');
    }
  }
}
