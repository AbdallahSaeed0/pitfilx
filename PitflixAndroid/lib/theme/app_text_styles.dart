import 'package:flutter/material.dart';
import 'package:google_fonts/google_fonts.dart';
import 'app_colors.dart';

/// Design tokens — typography. Bebas Neue for display/headings, DM Sans for
/// everything else. See design_handoff_pitflix_android/README.md.
abstract class AppTextStyles {
  static TextStyle bebas({
    required double fontSize,
    Color color = AppColors.textPrimary,
    double letterSpacing = 0.08,
    FontWeight fontWeight = FontWeight.w400,
  }) {
    return GoogleFonts.bebasNeue(
      fontSize: fontSize,
      color: color,
      letterSpacing: fontSize * letterSpacing,
      fontWeight: fontWeight,
      height: 1.0,
    );
  }

  static TextStyle dmSans({
    required double fontSize,
    Color color = AppColors.textPrimary,
    FontWeight fontWeight = FontWeight.w400,
    double? letterSpacing,
    double? height,
  }) {
    return GoogleFonts.dmSans(
      fontSize: fontSize,
      color: color,
      fontWeight: fontWeight,
      letterSpacing: letterSpacing,
      height: height,
    );
  }

  /// Uppercase section labels — "WATCH NEXT", "SETTINGS", etc.
  static TextStyle sectionLabel({Color color = AppColors.textMuted}) {
    return dmSans(
      fontSize: 11,
      fontWeight: FontWeight.w600,
      color: color,
      letterSpacing: 11 * 0.11,
    );
  }

  static TextStyle navLabel({required bool active}) {
    return dmSans(
      fontSize: 9,
      fontWeight: active ? FontWeight.w600 : FontWeight.w400,
      color: active ? AppColors.logoAccent : AppColors.textInactiveNav,
      letterSpacing: 9 * 0.04,
    );
  }
}
