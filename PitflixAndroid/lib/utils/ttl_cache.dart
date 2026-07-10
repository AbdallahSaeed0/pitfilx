/// Tiny in-memory cache with a time-to-live — used to avoid re-fetching data
/// a screen just fetched moments ago (e.g. Lists re-requesting the same
/// `/api/lists` Home already loaded for its Watch Later section), without
/// risking genuinely stale data across a longer session.
class TtlCache<T> {
  final Duration ttl;
  T? _value;
  DateTime? _storedAt;

  TtlCache({this.ttl = const Duration(seconds: 45)});

  T? get(bool forceRefresh) {
    if (forceRefresh) return null;
    final storedAt = _storedAt;
    if (_value == null || storedAt == null) return null;
    if (DateTime.now().difference(storedAt) > ttl) return null;
    return _value;
  }

  void set(T value) {
    _value = value;
    _storedAt = DateTime.now();
  }
}
