import 'package:flutter/material.dart';

/// List "icon" support. The backend has no dedicated icon column — the
/// desktop app encodes the chosen icon directly into the list's name as a
/// `::iconId:: Display Title` prefix (see Pitflix.UI's listMarks.tsx) so it
/// round-trips through the same `name` field mobile reads. This file mirrors
/// that scheme so icons picked on either platform render correctly on both.
abstract class ListMarks {
  static const Map<String, IconData> icons = {
    'gem': Icons.diamond_outlined,
    'sparkles': Icons.auto_awesome,
    'film': Icons.movie_outlined,
    'clapperboard': Icons.theaters_outlined,
    'tv': Icons.tv,
    'heart': Icons.favorite_outline,
    'moon': Icons.dark_mode_outlined,
    'crown': Icons.workspace_premium_outlined,
    'flame': Icons.local_fire_department_outlined,
    'trophy': Icons.emoji_events_outlined,
    'palette': Icons.palette_outlined,
    'zap': Icons.bolt,
  };

  static final _prefix = RegExp(r'^::([a-z]+)::\s*');

  /// Splits a raw stored list name into its icon id (if any) and the
  /// display title, e.g. `"::heart:: Favorites"` -> `("heart", "Favorites")`.
  static (String? iconId, String title) decode(String rawName) {
    final match = _prefix.firstMatch(rawName);
    if (match == null) return (null, rawName);
    final id = match.group(1)!;
    if (!icons.containsKey(id)) return (null, rawName);
    return (id, rawName.substring(match.end));
  }

  /// Inverse of [decode] — used when persisting a name that should carry an
  /// icon selection.
  static String encode(String? iconId, String title) =>
      iconId == null ? title : '::$iconId:: $title';
}
