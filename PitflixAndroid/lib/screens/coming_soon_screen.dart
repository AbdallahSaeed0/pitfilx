import 'package:flutter/material.dart';
import '../models/coming_soon_item.dart';
import '../models/title_item.dart';
import '../services/local_backend_service.dart';
import '../theme/app_theme.dart';
import '../widgets/widgets.dart';
import 'title_detail_movie_screen.dart';
import 'title_detail_series_screen.dart';

/// Full "Coming Soon" page — automatic countdown of upcoming movie releases
/// and new/returning TV seasons from the local backend's
/// `/api/home/coming-soon` discovery endpoint.
class ComingSoonScreen extends StatefulWidget {
  const ComingSoonScreen({super.key});

  @override
  State<ComingSoonScreen> createState() => _ComingSoonScreenState();
}

class _ComingSoonScreenState extends State<ComingSoonScreen> {
  List<ComingSoonItem>? _items;
  String? _error;

  @override
  void initState() {
    super.initState();
    _load();
  }

  Future<void> _load() async {
    setState(() => _error = null);
    try {
      final items = await LocalBackendService.fetchComingSoon();
      if (!mounted) return;
      setState(() => _items = items);
    } catch (e) {
      if (!mounted) return;
      setState(() => _error = e.toString());
    }
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

    if (_items!.isEmpty) {
      return Center(
        child: Text(
          'Nothing coming up right now.',
          style: AppTextStyles.dmSans(fontSize: 13, color: AppColors.textMuted),
        ),
      );
    }

    return ListView.separated(
      padding: const EdgeInsets.fromLTRB(20, 16, 20, 20),
      itemCount: _items!.length,
      separatorBuilder: (_, _) => const SizedBox(height: 12),
      itemBuilder: (context, i) =>
          _ComingSoonRow(item: _items![i], onTap: () => _openTitle(_items![i])),
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
                    ? Image.network(
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
