import 'package:flutter/material.dart';
import '../models/title_item.dart';
import '../services/tmdb_service.dart';
import '../theme/app_theme.dart';

/// Netflix-style login backdrop: a tiled wall of real TMDB posters (trending
/// movies + shows, the same pool Home already uses) behind a dark scrim, with
/// [child] centered on top. Shuffled on every mount, so it looks different
/// each time the screen (Splash/Login/Sign Up) is shown. Falls back to a
/// plain dark background if the fetch fails — this is purely decorative.
class PosterWallBackground extends StatefulWidget {
  final Widget child;

  const PosterWallBackground({super.key, required this.child});

  @override
  State<PosterWallBackground> createState() => _PosterWallBackgroundState();
}

class _PosterWallBackgroundState extends State<PosterWallBackground> {
  List<String>? _posterUrls;

  @override
  void initState() {
    super.initState();
    _load();
  }

  Future<void> _load() async {
    try {
      final results = await Future.wait([
        TmdbService.fetchTrending(TitleKind.movie),
        TmdbService.fetchTrending(TitleKind.show),
      ]);
      final urls =
          [...results[0], ...results[1]]
              .map((t) => TmdbService.posterUrl(t.posterPath))
              .whereType<String>()
              .toList()
            ..shuffle();
      if (mounted && urls.isNotEmpty) setState(() => _posterUrls = urls);
    } catch (_) {
      // Decorative only — keep the plain dark background on failure.
    }
  }

  @override
  Widget build(BuildContext context) {
    final urls = _posterUrls;
    return Stack(
      fit: StackFit.expand,
      children: [
        const ColoredBox(color: AppColors.bgBase),
        if (urls != null)
          GridView.builder(
            physics: const NeverScrollableScrollPhysics(),
            gridDelegate: const SliverGridDelegateWithFixedCrossAxisCount(
              crossAxisCount: 4,
              childAspectRatio: 2 / 3,
              crossAxisSpacing: 2,
              mainAxisSpacing: 2,
            ),
            itemCount: 32,
            itemBuilder: (context, i) => Opacity(
              opacity: 0.5,
              child: Image.network(
                urls[i % urls.length],
                fit: BoxFit.cover,
                errorBuilder: (context, error, stackTrace) =>
                    const SizedBox.shrink(),
              ),
            ),
          ),
        DecoratedBox(
          decoration: BoxDecoration(
            gradient: LinearGradient(
              begin: Alignment.topCenter,
              end: Alignment.bottomCenter,
              colors: [
                AppColors.bgBase.withValues(alpha: 0.55),
                AppColors.bgBase.withValues(alpha: 0.85),
                AppColors.bgBase,
              ],
              stops: const [0, 0.5, 1],
            ),
          ),
        ),
        widget.child,
      ],
    );
  }
}
