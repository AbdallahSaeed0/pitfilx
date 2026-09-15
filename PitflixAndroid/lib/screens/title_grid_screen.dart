import 'package:flutter/material.dart';
import '../models/title_item.dart';
import '../services/tmdb_service.dart';
import '../theme/app_theme.dart';
import '../utils/title_actions_sheet.dart';
import '../widgets/widgets.dart';
import 'title_detail_movie_screen.dart';
import 'title_detail_series_screen.dart';

/// Read-only poster grid for "See all" from a Home section (Trending,
/// Currently Watching) — takes the items already loaded by the caller
/// rather than re-fetching, since those sections are cheap in-memory lists
/// by the time the user taps through. Own copy of [items] (rather than
/// StatelessWidget) so dropping a title here removes it from this grid
/// immediately too, not just Home's row underneath.
class TitleGridScreen extends StatefulWidget {
  final String title;
  final List<TitleItem> items;

  const TitleGridScreen({super.key, required this.title, required this.items});

  @override
  State<TitleGridScreen> createState() => _TitleGridScreenState();
}

class _TitleGridScreenState extends State<TitleGridScreen> {
  late List<TitleItem> _items = widget.items;

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
    final title = widget.title;
    final items = _items;
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
                          // episodeSub (e.g. "Next: S5E5") beats a raw year
                          // for progress-tracking sections like Currently
                          // Watching/Next Episodes — those items are
                          // summary-only with year left at 0, so falling
                          // back to "${t.year}" would just show "0".
                          subtitle: t.episodeSub ?? (t.year > 0 ? '${t.year}' : null),
                          progress: t.progress,
                          cornerBadge: t.posterBadge,
                          gradientSeed: t.gradientSeed,
                          imageUrl: TmdbService.posterUrl(t.posterPath),
                          tmdbId: t.tmdbId,
                          kind: t.kind,
                          onTap: () => _openTitle(context, t),
                          onLongPress: () => showTitleActionsSheet(
                            context,
                            t,
                            (_) {},
                            onDropped: () => setState(
                              () => _items = _items
                                  .where((x) => x.tmdbId != t.tmdbId)
                                  .toList(),
                            ),
                          ),
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
