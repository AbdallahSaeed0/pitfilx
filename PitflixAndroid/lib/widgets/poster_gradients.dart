import 'package:flutter/material.dart';

/// Standing in for TMDB poster/backdrop imagery — a small palette of dark
/// gradients cycled by [TitleItem.gradientSeed], matching the placeholder
/// look of the design prototype.
abstract class PosterGradients {
  static const List<List<Color>> palette = [
    [Color(0xFF0D1A2E), Color(0xFF1C2F4E)], // blue
    [Color(0xFF2E0D14), Color(0xFF4E1C24)], // red
    [Color(0xFF0D2E1A), Color(0xFF1C4E2F)], // green
    [Color(0xFF2E220D), Color(0xFF4E3C1C)], // amber
    [Color(0xFF1A0D2E), Color(0xFF2F1C4E)], // violet
    [Color(0xFF0D2A2E), Color(0xFF1C464E)], // teal
  ];

  static LinearGradient of(int seed) {
    final colors = palette[seed % palette.length];
    return LinearGradient(
      begin: Alignment.topLeft,
      end: Alignment.bottomRight,
      colors: colors,
    );
  }
}
