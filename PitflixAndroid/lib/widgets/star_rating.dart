import 'package:flutter/material.dart';
import '../theme/app_theme.dart';

/// Star rating selector — [max] is normally 5 or 10, driven by
/// AppSettings.ratingScaleMax so it matches the user's chosen rating scale
/// everywhere. Icon size shrinks automatically for the 10-point scale so a
/// full row still fits comfortably.
class StarRating extends StatelessWidget {
  final int rating;
  final int max;
  final ValueChanged<int>? onChanged;
  final double? size;

  const StarRating({
    super.key,
    required this.rating,
    this.max = 5,
    this.onChanged,
    this.size,
  });

  @override
  Widget build(BuildContext context) {
    final effectiveSize = size ?? (max > 5 ? 15 : 17);
    return Row(
      mainAxisSize: MainAxisSize.min,
      children: [
        for (var i = 1; i <= max; i++)
          GestureDetector(
            onTap: onChanged == null ? null : () => onChanged!(i),
            child: Padding(
              padding: const EdgeInsets.symmetric(horizontal: 1),
              child: Icon(
                Icons.star_rounded,
                size: effectiveSize,
                color: i <= rating ? AppColors.star : AppColors.borderInput,
              ),
            ),
          ),
      ],
    );
  }
}
