import 'package:flutter/material.dart';
import '../theme/app_theme.dart';
import 'circle_icon_button.dart';
import 'poster_gradients.dart';

/// Backdrop hero used by Title Detail (series & movie): dark gradient
/// placeholder, back/more circular buttons, title, and meta line + rating.
class TitleHeroHeader extends StatelessWidget {
  final String title;
  final String metaLine;
  final double rating;
  final int gradientSeed;
  final String?
  imageUrl; // real TMDB backdrop; falls back to the gradient on null/error
  final double height;
  final VoidCallback? onMorePressed;

  /// Null hides the favorite button entirely (still loading which list it
  /// belongs to); non-null shows a filled/outline heart reflecting state.
  final bool? isFavorite;
  final VoidCallback? onFavoriteToggled;

  /// 0.0-1.0 overall watch progress (e.g. episodes watched / total for a
  /// series); null hides the bar entirely (movies, or series with no
  /// episode data yet).
  final double? progress;

  const TitleHeroHeader({
    super.key,
    required this.title,
    required this.metaLine,
    required this.rating,
    required this.gradientSeed,
    this.imageUrl,
    this.height = 200,
    this.onMorePressed,
    this.isFavorite,
    this.onFavoriteToggled,
    this.progress,
  });

  @override
  Widget build(BuildContext context) {
    return SizedBox(
      height: height,
      width: double.infinity,
      child: Stack(
        fit: StackFit.expand,
        children: [
          DecoratedBox(
            decoration: BoxDecoration(
              gradient: PosterGradients.of(gradientSeed),
            ),
          ),
          if (imageUrl != null)
            Image.network(
              imageUrl!,
              fit: BoxFit.cover,
              errorBuilder: (context, error, stackTrace) =>
                  const SizedBox.shrink(),
              loadingBuilder: (context, child, progress) =>
                  progress == null ? child : const SizedBox.shrink(),
            ),
          DecoratedBox(
            decoration: BoxDecoration(
              gradient: LinearGradient(
                begin: Alignment.bottomCenter,
                end: Alignment.topCenter,
                colors: [
                  AppColors.bgBase.withValues(alpha: 1),
                  AppColors.bgBase.withValues(alpha: 0),
                ],
                stops: const [0, 0.75],
              ),
            ),
          ),
          Positioned(
            top: 14,
            left: 16,
            child: CircleIconButton(
              icon: Icons.arrow_back_ios_new,
              onTap: () => Navigator.of(context).pop(),
            ),
          ),
          Positioned(
            top: 14,
            right: 16,
            child: Row(
              children: [
                if (isFavorite != null) ...[
                  CircleIconButton(
                    icon: isFavorite! ? Icons.favorite : Icons.favorite_border,
                    onTap: onFavoriteToggled,
                  ),
                  const SizedBox(width: 8),
                ],
                CircleIconButton(icon: Icons.more_horiz, onTap: onMorePressed),
              ],
            ),
          ),
          Positioned(
            left: 20,
            right: 20,
            bottom: 16,
            child: Column(
              crossAxisAlignment: CrossAxisAlignment.start,
              mainAxisSize: MainAxisSize.min,
              children: [
                Text(
                  title,
                  style: AppTextStyles.bebas(fontSize: 36, letterSpacing: 0.08),
                ),
                const SizedBox(height: 4),
                Row(
                  children: [
                    Flexible(
                      child: Text(
                        metaLine,
                        overflow: TextOverflow.ellipsis,
                        style: AppTextStyles.dmSans(
                          fontSize: 12,
                          color: Colors.white.withValues(alpha: 0.55),
                        ),
                      ),
                    ),
                    const SizedBox(width: 8),
                    Container(
                      padding: const EdgeInsets.symmetric(
                        horizontal: 6,
                        vertical: 2,
                      ),
                      decoration: BoxDecoration(
                        color: AppColors.accent,
                        borderRadius: BorderRadius.circular(4),
                      ),
                      child: Text(
                        '$rating ★',
                        style: AppTextStyles.dmSans(
                          fontSize: 11,
                          fontWeight: FontWeight.w600,
                          color: AppColors.bgBase,
                        ),
                      ),
                    ),
                  ],
                ),
                if (progress != null) ...[
                  const SizedBox(height: 8),
                  Container(
                    height: 6,
                    clipBehavior: Clip.antiAlias,
                    decoration: BoxDecoration(
                      borderRadius: BorderRadius.circular(3),
                      border: Border.all(
                        color: Colors.white.withValues(alpha: 0.3),
                        width: 1,
                      ),
                    ),
                    child: Stack(
                      fit: StackFit.expand,
                      children: [
                        const ColoredBox(color: AppColors.progressTrack),
                        Align(
                          alignment: Alignment.centerLeft,
                          child: FractionallySizedBox(
                            widthFactor: progress!.clamp(0.0, 1.0),
                            child: const ColoredBox(color: AppColors.logoAccent),
                          ),
                        ),
                      ],
                    ),
                  ),
                ],
              ],
            ),
          ),
        ],
      ),
    );
  }
}
