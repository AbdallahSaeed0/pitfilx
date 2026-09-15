import 'package:flutter/material.dart';
import '../models/coming_soon_item.dart';
import '../models/title_item.dart';
import '../services/app_settings.dart';
import '../services/tmdb_service.dart';
import '../theme/app_theme.dart';
import '../widgets/widgets.dart';
import 'title_detail_movie_screen.dart';
import 'title_detail_series_screen.dart';
import '../widgets/pitflix_network_image.dart';

/// Full "Coming Soon" page — automatic countdown of upcoming movie releases
/// and new/returning TV within the next few months, straight from TMDB (see
/// TmdbService.fetchComingSoon). Tabbed Movies/Shows, same split as Home's
/// two Coming Soon sections — [initialShowsTab] seeds which tab is active so
/// opening this from the Shows section's "See All" doesn't land on Movies.
class ComingSoonScreen extends StatefulWidget {
  final bool initialShowsTab;

  const ComingSoonScreen({super.key, this.initialShowsTab = true});

  @override
  State<ComingSoonScreen> createState() => _ComingSoonScreenState();
}

class _ComingSoonScreenState extends State<ComingSoonScreen> {
  List<ComingSoonItem>? _items;
  String? _error;
  late int _tab = widget.initialShowsTab ? 0 : 1; // 0 Shows, 1 Movies

  @override
  void initState() {
    super.initState();
    _load();
  }

  Future<void> _load() async {
    setState(() => _error = null);
    try {
      final items = await TmdbService.fetchComingSoon();
      if (!mounted) return;
      final dismissed = AppSettings.dismissedComingSoonIds.value;
      setState(
        () => _items = items
            .where((i) => !dismissed.contains('${i.tmdbId}-${i.mediaType}'))
            .toList(),
      );
    } catch (e) {
      if (!mounted) return;
      setState(() => _error = e.toString());
    }
  }

  void _dismiss(ComingSoonItem item) {
    setState(() => _items?.remove(item));
    AppSettings.dismissComingSoonItem(item.tmdbId, item.mediaType);
  }

  void _openTitle(ComingSoonItem item) {
    final kind = item.isShow ? TitleKind.show : TitleKind.movie;
    final title = TitleItem(
      id: 'coming-soon-${item.tmdbId}',
      name: item.title,
      kind: kind,
      year: item.releaseDate?.year ?? 0,
      network: kind == TitleKind.movie ? 'Theaters' : 'TV',
      rating: 0,
      genres: const [],
      overview: item.overview ?? '',
      gradientSeed: item.tmdbId % 6,
      posterPath: item.posterUrl,
      tmdbId: item.tmdbId,
      isSummaryOnly: true,
      releaseDate: item.releaseDate,
    );
    Navigator.of(context).push(
      MaterialPageRoute(
        builder: (_) => kind == TitleKind.show
            ? TitleDetailSeriesScreen(title: title)
            : TitleDetailMovieScreen(title: title),
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
                  Text(
                    'COMING SOON',
                    style: AppTextStyles.bebas(
                      fontSize: 22,
                      letterSpacing: 0.1,
                      color: AppColors.logoAccent,
                    ),
                  ),
                ],
              ),
            ),
            SegmentedTabBar(
              tabs: const ['Shows', 'Movies'],
              activeIndex: _tab,
              onChanged: (i) => setState(() => _tab = i),
            ),
            Expanded(child: _buildBody()),
          ],
        ),
      ),
    );
  }

  Widget _buildBody() {
    if (_error != null) {
      return Center(
        child: Padding(
          padding: const EdgeInsets.symmetric(horizontal: 32),
          child: Column(
            mainAxisSize: MainAxisSize.min,
            children: [
              Text(
                "Couldn't load coming soon.\n$_error",
                textAlign: TextAlign.center,
                style: AppTextStyles.dmSans(
                  fontSize: 13,
                  color: AppColors.textMuted,
                ),
              ),
              const SizedBox(height: 12),
              GestureDetector(
                onTap: _load,
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
          ),
        ),
      );
    }

    if (_items == null) {
      return const ListRowsSkeleton(rowHeight: 96);
    }

    final showsOnly = _tab == 0;
    final items = _items!.where((i) => i.isShow == showsOnly).toList();

    if (items.isEmpty) {
      return Center(
        child: Text(
          'Nothing coming up right now.',
          style: AppTextStyles.dmSans(fontSize: 13, color: AppColors.textMuted),
        ),
      );
    }

    return ListView.separated(
      padding: const EdgeInsets.fromLTRB(20, 16, 20, 20),
      itemCount: items.length,
      separatorBuilder: (_, _) => const SizedBox(height: 12),
      itemBuilder: (context, i) {
        final item = items[i];
        return Dismissible(
          key: ValueKey('${item.tmdbId}-${item.mediaType}'),
          direction: DismissDirection.horizontal,
          background: _DismissBackground(alignment: Alignment.centerLeft),
          secondaryBackground: _DismissBackground(
            alignment: Alignment.centerRight,
          ),
          onDismissed: (_) => _dismiss(item),
          child: _ComingSoonRow(item: item, onTap: () => _openTitle(item)),
        );
      },
    );
  }
}

class _DismissBackground extends StatelessWidget {
  final Alignment alignment;

  const _DismissBackground({required this.alignment});

  @override
  Widget build(BuildContext context) {
    return Container(
      decoration: BoxDecoration(
        color: AppColors.destructive.withValues(alpha: 0.85),
        borderRadius: BorderRadius.circular(AppSpacing.cardRadiusMax),
      ),
      alignment: alignment,
      padding: const EdgeInsets.symmetric(horizontal: 14),
      child: const Icon(
        Icons.delete_outline,
        color: AppColors.textPrimary,
        size: 20,
      ),
    );
  }
}

class _ComingSoonRow extends StatelessWidget {
  final ComingSoonItem item;
  final VoidCallback onTap;

  const _ComingSoonRow({required this.item, required this.onTap});

  /// Days until release — negative once released, used to decide urgency
  /// accent color (soon = warmer, far off = brand purple).
  int? get _daysAway {
    final date = item.releaseDate;
    if (date == null) return null;
    final now = DateTime.now();
    final today = DateTime(now.year, now.month, now.day);
    final target = DateTime(date.year, date.month, date.day);
    return target.difference(today).inDays;
  }

  Color get _urgencyColor {
    final days = _daysAway;
    if (days == null) return AppColors.buttonPurple;
    if (days <= 3) return AppColors.destructive;
    if (days <= 10) return AppColors.star;
    return AppColors.buttonPurple;
  }

  String? get _releaseDateLabel {
    final date = item.releaseDate;
    if (date == null) return null;
    const months = [
      'Jan',
      'Feb',
      'Mar',
      'Apr',
      'May',
      'Jun',
      'Jul',
      'Aug',
      'Sep',
      'Oct',
      'Nov',
      'Dec',
    ];
    return '${months[date.month - 1]} ${date.day}, ${date.year}';
  }

  @override
  Widget build(BuildContext context) {
    final accent = _urgencyColor;
    return GestureDetector(
      onTap: onTap,
      child: Container(
        decoration: BoxDecoration(
          color: AppColors.bgCard,
          borderRadius: BorderRadius.circular(AppSpacing.cardRadiusMax),
          border: Border(left: BorderSide(color: accent, width: 3)),
        ),
        padding: const EdgeInsets.fromLTRB(11, 12, 12, 12),
        child: Row(
          crossAxisAlignment: CrossAxisAlignment.start,
          children: [
            ClipRRect(
              borderRadius: BorderRadius.circular(8),
              child: SizedBox(
                width: 68,
                height: 100,
                child: item.posterUrl != null
                    ? PitflixNetworkImage(
                        item.posterUrl!,
                        fit: BoxFit.cover,
                        errorBuilder: (context, error, stackTrace) =>
                            DecoratedBox(
                              decoration: BoxDecoration(
                                gradient: PosterGradients.of(item.tmdbId % 6),
                              ),
                            ),
                      )
                    : DecoratedBox(
                        decoration: BoxDecoration(
                          gradient: PosterGradients.of(item.tmdbId % 6),
                        ),
                      ),
              ),
            ),
            const SizedBox(width: 14),
            Expanded(
              child: Column(
                crossAxisAlignment: CrossAxisAlignment.start,
                children: [
                  Container(
                    padding: const EdgeInsets.symmetric(
                      horizontal: 10,
                      vertical: 4,
                    ),
                    decoration: BoxDecoration(
                      color: accent,
                      borderRadius: BorderRadius.circular(20),
                    ),
                    child: Text(
                      item.countdownLabel.toUpperCase(),
                      style: AppTextStyles.dmSans(
                        fontSize: 10,
                        fontWeight: FontWeight.w700,
                        color: accent == AppColors.star
                            ? AppColors.bgBase
                            : AppColors.textPrimary,
                        letterSpacing: 0.06,
                      ),
                    ),
                  ),
                  const SizedBox(height: 8),
                  Text(
                    item.title,
                    maxLines: 1,
                    overflow: TextOverflow.ellipsis,
                    style: AppTextStyles.dmSans(
                      fontSize: 15,
                      fontWeight: FontWeight.w700,
                    ),
                  ),
                  const SizedBox(height: 3),
                  Text(
                    item.seasonLabel ?? (item.isShow ? 'Series' : 'Movie'),
                    style: AppTextStyles.dmSans(
                      fontSize: 11,
                      color: AppColors.textMuted,
                    ),
                  ),
                  if (_releaseDateLabel != null) ...[
                    const SizedBox(height: 3),
                    Text(
                      _releaseDateLabel!,
                      style: AppTextStyles.dmSans(
                        fontSize: 11,
                        color: Colors.white.withValues(alpha: 0.4),
                      ),
                    ),
                  ],
                  if (item.overview != null && item.overview!.isNotEmpty) ...[
                    const SizedBox(height: 6),
                    Text(
                      item.overview!,
                      maxLines: 2,
                      overflow: TextOverflow.ellipsis,
                      style: AppTextStyles.dmSans(
                        fontSize: 11,
                        height: 1.4,
                        color: Colors.white.withValues(alpha: 0.5),
                      ),
                    ),
                  ],
                ],
              ),
            ),
            const SizedBox(width: 4),
            const Icon(Icons.chevron_right, size: 18, color: Color(0x40FFFFFF)),
          ],
        ),
      ),
    );
  }
}
