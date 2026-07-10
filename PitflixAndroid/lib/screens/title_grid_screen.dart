import 'package:flutter/material.dart';
import '../models/title_item.dart';
import '../services/tmdb_service.dart';
import '../theme/app_theme.dart';
import '../widgets/widgets.dart';
import 'title_detail_movie_screen.dart';
import 'title_detail_series_screen.dart';

/// Read-only poster grid for "See all" from a Home section (Trending,
/// Currently Watching) — takes the items already loaded by the caller
/// rather than re-fetching, since those sections are cheap in-memory lists
/// by the time the user taps through.
class TitleGridScreen extends StatelessWidget {
  final String title;
  final List<TitleItem> items;

  const TitleGridScreen({super.key, required this.title, required this.items});

  void _openTitle(BuildContext context, TitleItem t) {
    Navigator.of(context).push(
      MaterialPageRoute(
        builder: (_) => t.isShow
            ? TitleDetailSeriesScreen(title: t)
            : TitleDetailMovieScreen(title: t),
      ),
    );
  }

  @override
  Widget build(BuildContext context) {
    return Scaffold(
      backgroundColor: AppColors.bgBase,
      body: SafeArea(
        child: Column(
          children: [
            Padding(
              padding: const EdgeInsets.fromLTRB(20, 14, 20, 0),
              child: Row(
                children: [
                  CircleIconButton(
                    icon: Icons.arrow_back_ios_new,
                    background: AppColors.bgCard,
                    onTap: () => Navigator.of(context).pop(),
                  ),
                  const SizedBox(width: 14),
                  Expanded(
                    child: Text(
                      title.toUpperCase(),
                      overflow: TextOverflow.ellipsis,
                      style: AppTextStyles.bebas(
                        fontSize: 22,
                        letterSpacing: 0.1,
                        color: AppColors.logoAccent,
                      ),
                    ),
                  ),
                ],
              ),
            ),
            Expanded(
              child: items.isEmpty
                  ? const EmptyState(message: 'Nothing here yet.')
                  : GridView.builder(
                      padding: const EdgeInsets.fromLTRB(20, 16, 20, 20),
                      gridDelegate:
                          const SliverGridDelegateWithFixedCrossAxisCount(
                            crossAxisCount: 3,
                            crossAxisSpacing: 10,
                            mainAxisSpacing: 10,
                            childAspectRatio: 2 / 3,
                          ),
                      itemCount: items.length,
                      itemBuilder: (context, i) {
                        final t = items[i];
                        return PosterCard(
                          title: t.name,
                          subtitle: '${t.year}',
                          gradientSeed: t.gradientSeed,
                          imageUrl: TmdbService.posterUrl(t.posterPath),
                          onTap: () => _openTitle(context, t),
                        );
                      },
                    ),
            ),
          ],
        ),
      ),
    );
  }
}
