import 'dart:async';
import 'dart:convert';
import 'dart:io';

import 'package:flutter/foundation.dart';
import 'package:path_provider/path_provider.dart';

/// Disk-backed key → JSON-value map with a per-entry write time, for per-title TMDB facts that
/// Home needs for every show in the library (episode counts, next/last episode, season air dates).
///
/// [PersistentJsonCache] deliberately refuses per-title data (it lives in SharedPreferences, which
/// rewrites its whole store on every write and keeps it all in memory), so these lookups used to be
/// memory-only — and Android kills backgrounded apps constantly, so nearly every launch re-asked
/// TMDB about every show the account has ever started. This stores compact extracted values (not
/// raw responses) in its own file, so it can hold a whole library without touching prefs.
///
/// Callers decide freshness per read via the `ttl` passed to [get], so one store can keep a
/// finished season for weeks and an airing one for hours.
class DiskTtlStore {
  DiskTtlStore(this.fileName, {required this.maxEntries, Future<File> Function()? fileProvider})
    : _fileProvider = fileProvider ?? (() => _defaultFile(fileName));

  final String fileName;
  final int maxEntries;
  final Future<File> Function() _fileProvider;

  static const _writeDebounce = Duration(seconds: 2);

  final Map<String, ({DateTime at, Object? value})> _entries = {};
  Future<void>? _loading;
  Timer? _writeTimer;

  static Future<File> _defaultFile(String name) async {
    final dir = await getApplicationSupportDirectory();
    return File('${dir.path}/$name');
  }

  Future<void> _ensureLoaded() => _loading ??= _load();

  Future<void> _load() async {
    try {
      final file = await _fileProvider();
      if (!await file.exists()) return;
      final decoded = jsonDecode(await file.readAsString()) as Map<String, dynamic>;
      final restored = <({String key, DateTime at, Object? value})>[];
      for (final e in decoded.entries) {
        final v = e.value as Map<String, dynamic>;
        final at = DateTime.tryParse(v['at'] as String? ?? '');
        if (at != null) restored.add((key: e.key, at: at, value: v['v']));
      }
      // Oldest first, so map insertion order stays age order for eviction (see set()).
      restored.sort((a, b) => a.at.compareTo(b.at));
      for (final r in restored) {
        // A fetch that finished before the load did is newer — never overwrite it.
        if (_entries.containsKey(r.key)) continue;
        _entries[r.key] = (at: r.at, value: r.value);
      }
    } catch (e) {
      debugPrint('DiskTtlStore($fileName): could not restore ($e)');
    }
  }

  /// The stored value and how long ago it was written, or null on a miss. Freshness is the
  /// caller's call — it often depends on the value itself (an ended show vs an airing one).
  /// A stored empty value ("this season doesn't exist") is a hit, so negative answers cache too.
  Future<({Duration age, Object? value})?> read(String key) async {
    await _ensureLoaded();
    final entry = _entries[key];
    if (entry == null) return null;
    return (age: DateTime.now().difference(entry.at), value: entry.value);
  }

  void set(String key, Object? value) {
    // Remove first so a re-set moves the key to the end — Dart maps keep insertion order, which
    // makes the first key reliably the oldest (timestamps tie inside a burst of parallel fetches).
    _entries.remove(key);
    _entries[key] = (at: DateTime.now(), value: value);
    while (_entries.length > maxEntries) {
      _entries.remove(_entries.keys.first);
    }
    _writeTimer?.cancel();
    _writeTimer = Timer(_writeDebounce, _write);
  }

  Future<void> clear() async {
    _entries.clear();
    _writeTimer?.cancel();
    _writeTimer = null;
    try {
      final file = await _fileProvider();
      if (await file.exists()) await file.delete();
    } catch (_) {
      // Worst case a stale file is overwritten on the next write.
    }
  }

  /// Writes immediately instead of after the debounce — for tests.
  @visibleForTesting
  Future<void> flush() async {
    _writeTimer?.cancel();
    await _write();
  }

  Future<void> _write() async {
    _writeTimer = null;
    try {
      final payload = {
        for (final e in _entries.entries)
          e.key: {'at': e.value.at.toIso8601String(), 'v': e.value.value},
      };
      final file = await _fileProvider();
      await file.writeAsString(jsonEncode(payload), flush: true);
    } catch (e) {
      debugPrint('DiskTtlStore($fileName): could not persist ($e)');
    }
  }
}
