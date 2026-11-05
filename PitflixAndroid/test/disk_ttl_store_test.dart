import 'dart:io';
import 'package:flutter_test/flutter_test.dart';
import 'package:pitflix_android/utils/disk_ttl_store.dart';

void main() {
  late Directory dir;
  late File file;

  DiskTtlStore store({int maxEntries = 10}) =>
      DiskTtlStore('t.json', maxEntries: maxEntries, fileProvider: () async => file);

  setUp(() async {
    dir = await Directory.systemTemp.createTemp('disk_ttl_store_test');
    file = File('${dir.path}/t.json');
  });

  tearDown(() => dir.delete(recursive: true));

  test('miss, then hit with a fresh age', () async {
    final s = store();
    expect(await s.read('a'), isNull);
    s.set('a', {'n': 1});
    final hit = await s.read('a');
    expect(hit!.value, {'n': 1});
    expect(hit.age, lessThan(const Duration(seconds: 5)));
  });

  test('an empty value is a hit, so negative answers cache', () async {
    final s = store();
    s.set('missing-season', <String, String>{});
    expect((await s.read('missing-season'))?.value, isEmpty);
  });

  test('survives a restart via the file', () async {
    final s = store();
    s.set('show-1', {'number_of_episodes': 10});
    await s.flush();

    final restarted = store();
    expect((await restarted.read('show-1'))?.value, {'number_of_episodes': 10});
  });

  test('evicts the oldest past the cap, even when writes share a millisecond', () async {
    final s = store(maxEntries: 3);
    for (var i = 0; i < 5; i++) {
      s.set('k$i', i);
    }
    expect(await s.read('k0'), isNull);
    expect(await s.read('k1'), isNull);
    expect((await s.read('k4'))?.value, 4);
  });

  test('clear removes the file', () async {
    final s = store();
    s.set('a', 1);
    await s.flush();
    expect(await file.exists(), isTrue);
    await s.clear();
    expect(await file.exists(), isFalse);
    expect(await s.read('a'), isNull);
  });

  test('a corrupt file is ignored rather than thrown', () async {
    await file.writeAsString('not json');
    expect(await store().read('a'), isNull);
  });
}
