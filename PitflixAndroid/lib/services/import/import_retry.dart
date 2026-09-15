import 'dart:async';
import 'dart:math';
import 'package:supabase_flutter/supabase_flutter.dart';

/// A bulk import writes to Supabase many times in quick succession (one or
/// two calls per show, across potentially hundreds of shows) — enough load
/// that a transient PostgREST hiccup (connection reset, 503 Service
/// Unavailable, a brief timeout) becomes a real, observed failure mode
/// instead of a rare edge case, and previously took down the entire import
/// with no retry. Retries a Supabase write up to [attempts] times with a
/// short exponential backoff, but only for errors that look transient —
/// anything else (a genuine 4xx/validation error, RLS rejection, etc.)
/// fails immediately since retrying it would never succeed.
Future<T> retryTransientSupabaseError<T>(
  Future<T> Function() action, {
  int attempts = 3,
}) async {
  for (var attempt = 1; ; attempt++) {
    try {
      return await action();
    } catch (e) {
      if (attempt >= attempts || !_isTransient(e)) rethrow;
      await Future<void>.delayed(Duration(milliseconds: 300 * pow(2, attempt - 1).toInt()));
    }
  }
}

bool _isTransient(Object e) {
  if (e is PostgrestException) {
    if (e.code == '503') return true;
    final msg = e.message.toLowerCase();
    return msg.contains('timeout') ||
        msg.contains('connect error') ||
        msg.contains('disconnect') ||
        msg.contains('service unavailable') ||
        msg.contains('connection reset');
  }
  if (e is TimeoutException) return true;
  final text = e.toString().toLowerCase();
  return text.contains('socketexception') || text.contains('connection closed');
}
