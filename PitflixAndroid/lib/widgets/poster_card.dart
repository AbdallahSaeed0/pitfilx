import 'package:flutter/material.dart';
import '../theme/app_theme.dart';
import 'poster_gradients.dart';

/// A poster card used across Home, Discover, Search, Profile, and Actor
/// screens. Either give it a fixed [width]/[height] (horizontal scroll rows)
/// or leave them null to fill the parent (grid layouts with AspectRatio).
class PosterCard extends StatelessWidget {
  final String title;
  final int gradientSeed;
  final String?
  imageUrl; // real TMDB poster; falls back to the gradient on null/error
  final String? subtitle; // episode sub or year, shown below title
  final double? progress; // 0-1, shows a thin progress strip if non-null
  final double? width;
  final double? height;
  final VoidCallback? onTap;

  const PosterCard({
    super.key,
    required this.title,
    required this.gradientSeed,
    this.imageUrl,
    this.subtitle,
    this.progress,
    this.width,
    this.height,
    this.onTap,
  });

  @override
  Widget build(BuildContext context) {
    return GestureDetector(
      onTap: onTap,
      child: SizedBox(
        width: width,
        height: height,
        child: ClipRRect(
          borderRadius: BorderRadius.circular(AppSpacing.posterRadius),
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
                      AppColors.bgBase.withValues(alpha: 0.95),
                      AppColors.bgBase.withValues(alpha: 0),
                    ],
                    stops: const [0, 0.55],
                  ),
                ),
              ),
              Positioned(
                left: 8,
                right: 8,
                bottom: progress != null ? 11 : 8,
                child: Column(
                  crossAxisAlignment: CrossAxisAlignment.start,
                  mainAxisSize: MainAxisSize.min,
                  children: [
                    Text(
                      title,
                      maxLines: 2,
                      overflow: TextOverflow.ellipsis,
                      style: AppTextStyles.dmSans(
                        fontSize: 10,
                        fontWeight: FontWeight.w600,
                        color: const Color(0xFFEDE9FF),
                      ),
                    ),
                    if (subtitle != null)
                      Padding(
                        padding: const EdgeInsets.only(top: 2),
                        child: Text(
                          subtitle!,
                          maxLines: 1,
                          overflow: TextOverflow.ellipsis,
                          style: AppTextStyles.dmSans(
                            fontSize: 9,
                            color: Colors.white.withValues(alpha: 0.7),
                          ),
                        ),
                      ),
                  ],
                ),
              ),
              if (progress != null)
                Positioned(
                  left: 0,
                  right: 0,
                  bottom: 0,
                  child: Container(
                    height: 5,
                    decoration: BoxDecoration(
                      border: Border(
                        top: BorderSide(
                          color: Colors.white.withValues(alpha: 0.25),
                          width: 1,
                        ),
                      ),
                    ),
                    child: Stack(
                      fit: StackFit.expand,
                      children: [
                        const ColoredBox(color: AppColors.progressTrack),
                        FractionallySizedBox(
                          alignment: Alignment.centerLeft,
                          widthFactor: progress!.clamp(0.0, 1.0),
                          child: const ColoredBox(color: AppColors.logoAccent),
                        ),
                      ],
                    ),
                  ),
                ),
            ],
          ),
        ),
      ),
    );
  }
}
