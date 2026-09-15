import 'package:cached_network_image/cached_network_image.dart';
import 'package:flutter/material.dart';
import '../models/title_item.dart';
import '../services/tmdb_service.dart';
import '../theme/app_theme.dart';
import 'poster_gradients.dart';

/// A poster card used across Home, Discover, Search, Profile, and Actor
/// screens. Either give it a fixed [width]/[height] (horizontal scroll rows)
/// or leave them null to fill the parent (grid layouts with AspectRatio).
class PosterCard extends StatefulWidget {
  final String title;
  final int gradientSeed;
  final String?
  imageUrl; // real TMDB poster; falls back to the gradient on null/error
  final String? subtitle; // episode sub or year, shown below title
  final double? progress; // 0-1, shows a thin progress strip if non-null
  final String? cornerBadge; // e.g. "S05E05", shown as a top-right chip
  final double? width;
  final double? height;
  final VoidCallback? onTap;
  final VoidCallback? onLongPress;

  /// Optional self-heal fallback: when [imageUrl] is null or fails to load,
  /// and both of these are set, fetches this title's current poster straight
  /// from TMDB once and swaps it in. Titles built from a stored Supabase
  /// `poster_path` (Profile's Movies/Series, Home's Continue Watching,
  /// Playlists) can carry a null or stale/unreachable path — a snapshot from
  /// whenever the row was written — unlike Title Detail, which always
  /// re-resolves fresh from TMDB. Leave both null for titles that already
  /// come from a fresh TMDB fetch (Trending/Search/Discover), where this
  /// would never trigger anyway.
  final int? tmdbId;
  final TitleKind? kind;

  const PosterCard({
    super.key,
    required this.title,
    required this.gradientSeed,
    this.imageUrl,
    this.subtitle,
    this.progress,
    this.cornerBadge,
    this.width,
    this.height,
    this.onTap,
    this.onLongPress,
    this.tmdbId,
    this.kind,
  });

  @override
  State<PosterCard> createState() => _PosterCardState();
}

class _PosterCardState extends State<PosterCard> {
  String? _healedUrl;
  bool _healAttempted = false;

  // Once healing succeeds, the healed URL wins even if `widget.imageUrl` was
  // non-null (it was just broken) — that's the whole point of healing.
  String? get _effectiveUrl => _healedUrl ?? widget.imageUrl;

  void _tryHeal() {
    if (_healAttempted || widget.tmdbId == null || widget.kind == null) {
      return;
    }
    _healAttempted = true;
    TmdbService.fetchPosterPath(widget.tmdbId!, widget.kind!).then((path) {
      if (!mounted || path == null) return;
      final resolved = TmdbService.posterUrl(path);
      if (resolved != null) setState(() => _healedUrl = resolved);
    });
  }

  @override
  void initState() {
    super.initState();
    if (widget.imageUrl == null) _tryHeal();
  }

  @override
  Widget build(BuildContext context) {
    final imageUrl = _effectiveUrl;
    return GestureDetector(
      onTap: widget.onTap,
      onLongPress: widget.onLongPress,
      child: SizedBox(
        width: widget.width,
        height: widget.height,
        child: ClipRRect(
          borderRadius: BorderRadius.circular(AppSpacing.posterRadius),
          child: Stack(
            fit: StackFit.expand,
            children: [
              DecoratedBox(
                decoration: BoxDecoration(
                  gradient: PosterGradients.of(widget.gradientSeed),
                ),
              ),
              if (imageUrl != null)
                CachedNetworkImage(
                  imageUrl: imageUrl,
                  fit: BoxFit.cover,
                  fadeInDuration: const Duration(milliseconds: 150),
                  errorWidget: (context, url, error) {
                    WidgetsBinding.instance.addPostFrameCallback(
                      (_) => _tryHeal(),
                    );
                    return const SizedBox.shrink();
                  },
                  placeholder: (context, url) => const SizedBox.shrink(),
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
                bottom: widget.progress != null ? 11 : 8,
                child: Column(
                  crossAxisAlignment: CrossAxisAlignment.start,
                  mainAxisSize: MainAxisSize.min,
                  children: [
                    Text(
                      widget.title,
                      maxLines: 2,
                      overflow: TextOverflow.ellipsis,
                      style: AppTextStyles.dmSans(
                        fontSize: 10,
                        fontWeight: FontWeight.w600,
                        color: const Color(0xFFEDE9FF),
                      ),
                    ),
                    if (widget.subtitle != null)
                      Padding(
                        padding: const EdgeInsets.only(top: 2),
                        child: Text(
                          widget.subtitle!,
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
              if (widget.cornerBadge != null)
                Positioned(
                  top: 6,
                  right: 6,
                  child: Container(
                    padding: const EdgeInsets.symmetric(horizontal: 6, vertical: 3),
                    decoration: BoxDecoration(
                      color: const Color(0xCC000000),
                      borderRadius: BorderRadius.circular(4),
                    ),
                    child: Text(
                      widget.cornerBadge!,
                      style: AppTextStyles.dmSans(
                        fontSize: 9,
                        fontWeight: FontWeight.w700,
                        color: AppColors.textPrimary,
                      ),
                    ),
                  ),
                ),
              if (widget.progress != null)
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
                          widthFactor: widget.progress!.clamp(0.0, 1.0),
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
