import 'package:supabase_flutter/supabase_flutter.dart';
import 'ratings_service.dart';
import 'tmdb_service.dart';
import 'user_library_service.dart';

/// Thin wrapper around Supabase Auth (GoTrue) — matches this codebase's
/// static-class service pattern (see LocalBackendService/TmdbService).
abstract class AuthService {
  static GoTrueClient get _auth => Supabase.instance.client.auth;

  /// Wipes every in-memory data cache — must run on any account change so a
  /// newly signed-in account never reads the previous one's cached lists,
  /// favorites, watch records, custom artwork or ratings.
  static void _clearCaches() {
    UserLibraryService.clearCache();
    TmdbService.clearCache();
    RatingsService.clearCache();
  }

  static User? get currentUser => _auth.currentUser;
  static Session? get currentSession => _auth.currentSession;
  static bool get isSignedIn => currentSession != null;

  static Future<AuthResponse> signIn(String email, String password) =>
      _auth.signInWithPassword(email: email, password: password);

  static Future<AuthResponse> signUp(String email, String password) =>
      _auth.signUp(email: email, password: password);

  static Future<void> signOut() async {
    _clearCaches();
    await _auth.signOut();
  }

  /// Changes the signed-in account's password. Re-authenticates with
  /// [currentPassword] first (Supabase's `updateUser` doesn't itself verify
  /// the caller knows the old password — only that the session is valid —
  /// so this adds that check explicitly before writing the new one).
  static Future<void> changePassword({
    required String currentPassword,
    required String newPassword,
  }) async {
    final email = currentUser?.email;
    if (email == null) throw StateError('Not signed in');
    await _auth.signInWithPassword(email: email, password: currentPassword);
    await _auth.updateUser(UserAttributes(password: newPassword));
  }

  /// Resolves a `profiles.username` to its account email via the
  /// `email_for_username` RPC — Supabase Auth only signs in by email, so
  /// Login calls this first when the entered value isn't one. Returns null
  /// if no account has that username.
  static Future<String?> emailForUsername(String username) async {
    final result = await Supabase.instance.client.rpc(
      'email_for_username',
      params: {'p_username': username},
    );
    return result as String?;
  }

  /// Permanently deletes the signed-in account and everything tied to it
  /// (profile, friendships, activity, lists, watch records, episode
  /// progress — see `014_pitflix_delete_own_account.sql`'s notes on what
  /// cascades and what doesn't). Irreversible. Signs the local session out
  /// immediately after, since the account no longer exists to hold one.
  static Future<void> deleteAccount() async {
    await Supabase.instance.client.rpc('delete_own_account');
    _clearCaches();
    await _auth.signOut();
  }
}
