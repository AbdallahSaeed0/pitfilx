import 'package:flutter/foundation.dart';
import 'package:shared_preferences/shared_preferences.dart';

/// Small persisted user preferences — currently just the rating scale.
/// Backed by shared_preferences so it survives app restarts, unlike most
/// other session-only state in this app (there's no backend support for
/// storing this kind of preference).
abstract class AppSettings {
  static const _ratingScaleKey = 'rating_scale_max';

  /// 5 (star rating) or 10 (point rating). Defaults to 5 until [load] runs.
  static final ValueNotifier<int> ratingScaleMax = ValueNotifier(5);

  static Future<void> load() async {
    final prefs = await SharedPreferences.getInstance();
    final saved = prefs.getInt(_ratingScaleKey);
    if (saved == 5 || saved == 10) ratingScaleMax.value = saved!;
  }

  static Future<void> setRatingScaleMax(int value) async {
    ratingScaleMax.value = value;
    final prefs = await SharedPreferences.getInstance();
    await prefs.setInt(_ratingScaleKey, value);
  }
}
