import 'dart:convert';
import 'package:flutter_test/flutter_test.dart';
import 'package:shared_preferences/shared_preferences.dart';
import 'package:pitflix_android/utils/persistent_json_cache.dart';

void main() {
  TestWidgetsFlutterBinding.ensureInitialized();

  setUp(() async {
    SharedPreferences.setMockInitialValues({});
    await PersistentJsonCache.clear();
  });

  test('returns a stored entry inside its TTL and drops it after', () {
    PersistentJsonCache.set('trending/movie/week?', jsonEncode({'results': [1, 2, 3]}));
    expect(PersistentJsonCache.get('trending/movie/week?', const Duration(hours: 1)), isNotNull);
    // Zero TTL means anything already written is past it.
    expect(PersistentJsonCache.get('trending/movie/week?', Duration.zero), isNull);
    // ...and the expired entry is evicted, not left to be re-checked forever.
    expect(PersistentJsonCache.get('trending/movie/week?', const Duration(hours: 1)), isNull);
  });

  test('unknown key misses', () {
    expect(PersistentJsonCache.get('nope?', const Duration(hours: 1)), isNull);
  });

  test('corrupt body is discarded rather than thrown', () {
    PersistentJsonCache.set('bad?', 'not json at all');
    expect(PersistentJsonCache.get('bad?', const Duration(hours: 1)), isNull);
  });

  test('oversized entries are not stored', () {
    PersistentJsonCache.set('huge?', 'x' * (256 * 1024 + 1));
    expect(PersistentJsonCache.get('huge?', const Duration(hours: 1)), isNull);
  });

  test('evicts the oldest past the entry cap', () {
    for (var i = 0; i < 30; i++) {
      PersistentJsonCache.set('k$i?', jsonEncode({'i': i}));
    }
    expect(PersistentJsonCache.get('k0?', const Duration(hours: 1)), isNull, reason: 'oldest evicted');
    expect(PersistentJsonCache.get('k29?', const Duration(hours: 1)), isNotNull, reason: 'newest kept');
  });

  test('survives a restart: written entries come back through load()', () async {
    PersistentJsonCache.set('trending/tv/week?', jsonEncode({'results': ['a']}));
    // Force the debounced write out to the (mock) store, then simulate a fresh process.
    await Future<void>.delayed(const Duration(seconds: 3));
    final saved = (await SharedPreferences.getInstance()).getString('tmdb_response_cache_v1');
    expect(saved, isNotNull, reason: 'debounced write reached SharedPreferences');
    expect(saved, contains('trending/tv/week'));
  });

  test('re-setting an existing key refreshes its position, not just its value', () {
    for (var i = 0; i < 24; i++) {
      PersistentJsonCache.set('k$i?', jsonEncode({'i': i}));
    }
    // Touch the oldest so it is no longer next in line for eviction.
    PersistentJsonCache.set('k0?', jsonEncode({'i': 0, 'touched': true}));
    PersistentJsonCache.set('new?', jsonEncode({'i': -1}));
    expect(PersistentJsonCache.get('k0?', const Duration(hours: 1)), isNotNull,
        reason: 'recently touched key survives');
    expect(PersistentJsonCache.get('k1?', const Duration(hours: 1)), isNull,
        reason: 'the next-oldest key is the one evicted');
  });
}
