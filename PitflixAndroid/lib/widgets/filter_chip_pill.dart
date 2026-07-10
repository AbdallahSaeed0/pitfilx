import 'package:flutter/material.dart';
import '../theme/app_theme.dart';

/// Filter chip used on Discover/Search ("All | Movies | Shows").
class FilterChipPill extends StatelessWidget {
  final String label;
  final bool active;
  final VoidCallback onTap;

  const FilterChipPill({
    super.key,
    required this.label,
    required this.active,
    required this.onTap,
  });

  @override
  Widget build(BuildContext context) {
    return GestureDetector(
      onTap: onTap,
      child: Container(
        padding: const EdgeInsets.symmetric(horizontal: 16, vertical: 8),
        decoration: BoxDecoration(
          color: active ? AppColors.accent : AppColors.border,
          borderRadius: BorderRadius.circular(20),
        ),
        child: Text(
          label,
          style: AppTextStyles.dmSans(
            fontSize: 12,
            fontWeight: active ? FontWeight.w600 : FontWeight.w400,
            // Active chip bg is white — needs dark text to stay legible.
            color: active
                ? AppColors.bgBase
                : Colors.white.withValues(alpha: 0.45),
          ),
        ),
      ),
    );
  }
}

/// Static pill chip used for genre tags on Title Detail / Actor screens.
class GenreChip extends StatelessWidget {
  final String label;

  const GenreChip({super.key, required this.label});

  @override
  Widget build(BuildContext context) {
    return Container(
      padding: const EdgeInsets.symmetric(horizontal: 12, vertical: 5),
      decoration: BoxDecoration(
        color: AppColors.border,
        borderRadius: BorderRadius.circular(20),
      ),
      child: Text(
        label,
        style: AppTextStyles.dmSans(
          fontSize: 12,
          color: Colors.white.withValues(alpha: 0.65),
        ),
      ),
    );
  }
}
