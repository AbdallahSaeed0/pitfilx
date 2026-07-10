import 'package:flutter/material.dart';
import '../theme/app_theme.dart';

/// Shared "nothing here yet" placeholder — replaces the muted-text blocks
/// every screen used to hand-roll individually.
class EmptyState extends StatelessWidget {
  final String message;
  final IconData? icon;
  final EdgeInsetsGeometry padding;

  const EmptyState({
    super.key,
    required this.message,
    this.icon,
    this.padding = const EdgeInsets.symmetric(horizontal: 32),
  });

  @override
  Widget build(BuildContext context) {
    return Center(
      child: Padding(
        padding: padding,
        child: Column(
          mainAxisSize: MainAxisSize.min,
          children: [
            if (icon != null) ...[
              Icon(icon, size: 28, color: AppColors.textFaint),
              const SizedBox(height: 10),
            ],
            Text(
              message,
              textAlign: TextAlign.center,
              style: AppTextStyles.dmSans(
                fontSize: 13,
                color: AppColors.textMuted,
              ),
            ),
          ],
        ),
      ),
    );
  }
}

/// Shared "couldn't load, tap to retry" placeholder — replaces the
/// muted-text-plus-Retry-link blocks every screen used to hand-roll
/// individually.
class ErrorRetry extends StatelessWidget {
  final String message;
  final VoidCallback? onRetry;
  final EdgeInsetsGeometry padding;

  const ErrorRetry({
    super.key,
    required this.message,
    this.onRetry,
    this.padding = const EdgeInsets.symmetric(horizontal: 32),
  });

  @override
  Widget build(BuildContext context) {
    return Center(
      child: Padding(
        padding: padding,
        child: Column(
          mainAxisSize: MainAxisSize.min,
          children: [
            Text(
              message,
              textAlign: TextAlign.center,
              style: AppTextStyles.dmSans(
                fontSize: 13,
                color: AppColors.textMuted,
              ),
            ),
            if (onRetry != null) ...[
              const SizedBox(height: 12),
              GestureDetector(
                onTap: onRetry,
                child: Text(
                  'Retry',
                  style: AppTextStyles.dmSans(
                    fontSize: 13,
                    fontWeight: FontWeight.w600,
                    color: AppColors.accent,
                  ),
                ),
              ),
            ],
          ],
        ),
      ),
    );
  }
}

/// Compact inline variant for horizontal poster rows — text + "Retry" on one
/// line instead of centered/stacked, matching what Home/Profile poster rows
/// already hand-rolled.
class InlineErrorRetry extends StatelessWidget {
  final String message;
  final VoidCallback? onRetry;
  final EdgeInsetsGeometry padding;

  const InlineErrorRetry({
    super.key,
    required this.message,
    this.onRetry,
    this.padding = const EdgeInsets.symmetric(
      horizontal: AppSpacing.screenPadding,
    ),
  });

  @override
  Widget build(BuildContext context) {
    return Padding(
      padding: padding,
      child: Row(
        children: [
          Expanded(
            child: Text(
              message,
              maxLines: 2,
              overflow: TextOverflow.ellipsis,
              style: AppTextStyles.dmSans(
                fontSize: 12,
                color: AppColors.textMuted,
              ),
            ),
          ),
          if (onRetry != null)
            GestureDetector(
              onTap: onRetry,
              child: Text(
                'Retry',
                style: AppTextStyles.dmSans(
                  fontSize: 12,
                  fontWeight: FontWeight.w600,
                  color: AppColors.accent,
                ),
              ),
            ),
        ],
      ),
    );
  }
}
