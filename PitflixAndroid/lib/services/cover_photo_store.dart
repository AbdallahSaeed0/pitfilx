import 'package:flutter/foundation.dart';

/// Session-only holder for the user's picked profile cover image — same
/// pattern as [ProfilePhotoStore]. No upload endpoint exists yet, so this
/// just keeps the picked image visible across the app until restart.
abstract class CoverPhotoStore {
  static final ValueNotifier<Uint8List?> photoBytes = ValueNotifier(null);
}
