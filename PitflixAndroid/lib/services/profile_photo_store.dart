import 'package:flutter/foundation.dart';

/// Session-only holder for the picked profile photo — keeps Edit Profile's
/// pick visible on the Profile screen too (until the app restarts) rather
/// than losing it the moment you navigate back.
abstract class ProfilePhotoStore {
  static final ValueNotifier<Uint8List?> photoBytes = ValueNotifier(null);

  /// This account's persisted `profiles.avatar_url` — the single source of
  /// truth every screen showing the avatar (Home's top-right icon, Profile)
  /// listens to, so a save in Edit Profile is reflected everywhere without
  /// each screen re-fetching. Set on profile load (whichever screen loads
  /// first) and immediately after a successful upload.
  static final ValueNotifier<String?> avatarUrl = ValueNotifier(null);
}
