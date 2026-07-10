import 'package:supabase_flutter/supabase_flutter.dart';

/// Thin wrapper around Supabase Auth (GoTrue) — matches this codebase's
/// static-class service pattern (see LocalBackendService/TmdbService).
abstract class AuthService {
  static GoTrueClient get _auth => Supabase.instance.client.auth;

  static User? get currentUser => _auth.currentUser;
  static Session? get currentSession => _auth.currentSession;
  static bool get isSignedIn => currentSession != null;

  static Future<AuthResponse> signIn(String email, String password) =>
      _auth.signInWithPassword(email: email, password: password);

  static Future<AuthResponse> signUp(String email, String password) =>
      _auth.signUp(email: email, password: password);

  static Future<void> signOut() => _auth.signOut();

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
}
