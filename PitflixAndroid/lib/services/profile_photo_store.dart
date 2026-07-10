import 'package:flutter/foundation.dart';

/// Session-only holder for the picked profile photo — no upload endpoint
/// exists yet, so this just keeps Edit Profile's pick visible on the
/// Profile screen too (until the app restarts) rather than losing it the
/// moment you navigate back.
abstract class ProfilePhotoStore {
  static final ValueNotifier<Uint8List?> photoBytes = ValueNotifier(null);
}
