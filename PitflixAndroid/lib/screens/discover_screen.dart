import 'package:flutter/material.dart';
import '../models/social_activity_item.dart';
import '../models/title_item.dart';
import '../services/app_settings.dart';
import '../services/social_service.dart';
import '../services/tmdb_service.dart';
import '../theme/app_theme.dart';
import '../utils/title_actions_sheet.dart';
import '../widgets/friend_avatar.dart';
import '../widgets/widgets.dart';
import 'search_screen.dart';
import 'title_detail_movie_screen.dart';
import 'title_detail_series_screen.dart';

class _DiscoverCategory {
  final String name;
  final int movieGenreId;
  final int? tvGenreId;

  const _DiscoverCategory(this.name, this.movieGenreId, [this.tvGenreId]);
}

/// TMDB genre ids — movie/TV taxonomies don't line up 1:1 (e.g. TV has no
/// standalone "Horror"), so a few categories are movie-only.
const _categories = [
  _DiscoverCategory('Action & Adventure', 28, 10759),
  _DiscoverCategory('Comedy', 35, 35),
  _DiscoverCategory('Drama', 18, 18),
  _DiscoverCategory('Sci-Fi & Fantasy', 878, 10765),
  _DiscoverCategory('Animation', 16, 16),
  _DiscoverCategory('Crime', 80, 80),
  _DiscoverCategory('Mystery', 9648, 9648),
  _DiscoverCategory('Documentary', 99, 99),
  _DiscoverCategory('Family', 10751, 10751),
  _DiscoverCategory('Horror', 27),
  _DiscoverCategory('Romance', 10749),
];

/// Real data: browse grid is replaced with TMDB category rows (movies +
/// shows mixed together per genre), each loading independently.
class DiscoverScreen extends StatefulWidget {
  const DiscoverScreen({super.key});

  @override
  State<DiscoverScreen> createState() => _DiscoverScreenState();
}

class _DiscoverScreenState extends State<DiscoverScreen> {
  final Map<String, List<TitleItem>?> _items = {
    for (final c in _categories) c.name: null,
  };
  final Map<String, String?> _errors = {
    for (final c in _categories) c.name: null,
  };

  List<SocialActivityItem>? _watchedByFriends;

  /// Genres picked in the first-run Onboarding wizard (see
  /// AppSettings.favoriteGenreIds) sorted first, everything else after in
  /// its original order — a one-time snapshot at load, not reactive to
  /// later changes, since this preference is only realistically set once.
  late final List<_DiscoverCategory> _orderedCategories = () {
    final favorites = AppSettings.favoriteGenreIds.value;
    if (favorites.isEmpty) return _categories;
    final preferred = <_DiscoverCategory>[];
    final rest = <_DiscoverCategory>[];
    for (final c in _categories) {
      (favorites.contains(c.movieGenreId) ? preferred : rest).add(c);
    }
    return [...preferred, ...rest];
  }();

  @override
  void initState() {
    super.initState();
    for (final category in _categories) {
      _loadCategory(category);
    }
    _loadWatchedByFriends();
  }

  /// Real friends' recent "watched" activity, deduped so each title only
  /// shows once (attributed to whichever friend appears first). RLS already
  /// scopes the feed to self + friends, so this is filtered client-side just
  /// for the action type.
  Future<void> _loadWatchedByFriends() async {
    try {
      final feed = await SocialService.fetchActivityFeed();
      if (!mounted) return;
      final seen = <String>{};
      final deduped = <SocialActivityItem>[];
      for (final item in feed) {
        if (item.action != SocialActivityAction.watched) continue;
        final key = '${item.tmdbId}-${item.mediaType}';
        if (!seen.add(key)) continue;
        deduped.add(item);
      }
      setState(() => _watchedByFriends = deduped);
    } catch (_) {
      // Decorative section — skip silently if it fails to load.
    }
  }

  Future<void> _loadCategory(_DiscoverCategory category) async {
    setState(() => _errors[category.name] = null);
    try {
      final items = await TmdbService.discoverByGenre(
        movieGenreId: category.movieGenreId,
        tvGenreId: category.tvGenreId,
      );
      if (!mounted) return;
      setState(() => _items[category.name] = items);
    } catch (e) {
      if (!mounted) return;
      setState(() => _errors[category.name] = e.toString());
    }
  }

  void _openTitle(TitleItem title) {
    Navigator.of(context).push(
      MaterialPageRoute(
        builder: (_) => title.isShow
            ? TitleDetailSeriesScreen(title: title)
            : TitleDetailMovieScreen(title: title),
      ),
    );
  }

  TitleItem _activityTitleItem(SocialActivityItem item) {
    final kind = TmdbService.kindFromMediaType(item.mediaType);
    return TitleItem(
      id: 'tmdb-${item.tmdbId}',
      name: item.title ?? 'Untitled',
      kind: kind,
      year: 0,
      network: kind == TitleKind.movie ? 'Theaters' : 'TV',
      rating: 0,
      genres: const [],
      overview: '',
      gradientSeed: item.tmdbId % 6,
      posterPath: item.posterPath,
      tmdbId: item.tmdbId,
      isSummaryOnly: true,
    );
  }

  void _openActivityTitle(SocialActivityItem item) =>
      _openTitle(_activityTitleItem(item));

  @override
  Widget build(BuildContext context) {
    return Scaffold(
      backgroundColor: AppColors.bgBase,
      body: SafeArea(
        child: Column(
          children: [
            Padding(
              padding: const EdgeInsets.fromLTRB(20, 14, 20, 0),
              child: Align(
                alignment: Alignment.centerLeft,
                child: Text(
                  'Discover',
                  style: AppTextStyles.bebas(fontSize: 26, letterSpacing: 0.14),
                ),
              ),
            ),
            Padding(
              padding: const EdgeInsets.fromLTRB(20, 14, 20, 0),
              child: GestureDetector(
                onTap: () => Navigator.of(
                  context,
                ).push(MaterialPageRoute(builder: (_) => const SearchScreen())),
                child: Container(
                  height: 46,
                  padding: const EdgeInsets.symmetric(horizontal: 14),
                  decoration: BoxDecoration(
                    color: AppColors.bgCard,
                    borderRadius: BorderRadius.circular(12),
                    border: Border.all(
                      color: AppColors.borderInput,
                      width: 1.5,
                    ),
                  ),
                  child: Row(
                    children: [
                      const Icon(
                        Icons.search,
                        size: 18,
                        color: AppColors.textMuted,
                      ),
                      const SizedBox(width: 10),
                      Text(
                        'Search movies & shows',
                        style: AppTextStyles.dmSans(
                          fontSize: 15,
                          color: AppColors.textMuted,
                        ),
                      ),
                    ],
                  ),
                ),
              ),
            ),
            const SizedBox(height: 8),
            Expanded(
              child: ListView(
                padding: const EdgeInsets.only(top: 10, bottom: 24),
                children: [
                  if (_watchedByFriends != null &&
                      _watchedByFriends!.isNotEmpty) ...[
                    SectionHeader(title: 'Watched by Friends'),
                    SizedBox(
                      height: 162,
                      child: _buildWatchedByFriendsRow(_watchedByFriends!),
                    ),
                    const SizedBox(height: AppSpacing.sectionGap),
                  ],
                  for (final category in _orderedCategories) ...[
                    SectionHeader(title: category.name),
                    SizedBox(height: 162, child: _buildCategoryRow(category)),
                    const SizedBox(height: AppSpacing.sectionGap),
                  ],
                ],
              ),
            ),
          ],
        ),
      ),
    );
  }

  Widget _buildWatchedByFriendsRow(List<SocialActivityItem> entries) {
    return ListView.separated(
      scrollDirection: Axis.horizontal,
      padding: const EdgeInsets.symmetric(horizontal: AppSpacing.screenPadding),
      itemCount: entries.length,
      separatorBuilder: (_, _) => const SizedBox(width: AppSpacing.posterGap),
      itemBuilder: (context, i) {
        final item = entries[i];
        return SizedBox(
          width: 110,
          height: 162,
          child: Stack(
            children: [
              PosterCard(
                width: 110,
                height: 162,
                title: item.title ?? 'Untitled',
                subtitle: 'Watched by ${item.profile.name}',
                gradientSeed: item.tmdbId % 6,
                imageUrl: TmdbService.posterUrl(item.posterPath),
                tmdbId: item.tmdbId,
                kind: TmdbService.kindFromMediaType(item.mediaType),
                onTap: () => _openActivityTitle(item),
                onLongPress: () => showTitleActionsSheet(
                  context,
                  _activityTitleItem(item),
                  (_) {},
                ),
              ),
              Positioned(
                top: 6,
                right: 6,
                child: FriendAvatar(profile: item.profile, size: 26),
              ),
            ],
          ),
        );
      },
    );
  }

  Widget _buildCategoryRow(_DiscoverCategory category) {
    final error = _errors[category.name];
    if (error != null) {
      return Padding(
        padding: const EdgeInsets.symmetric(
          horizontal: AppSpacing.screenPadding,
        ),
        child: Row(
          children: [
            Expanded(
              child: Text(
                "Couldn't load: $error",
                maxLines: 2,
                overflow: TextOverflow.ellipsis,
                style: AppTextStyles.dmSans(
                  fontSize: 12,
                  color: AppColors.textMuted,
                ),
              ),
            ),
            GestureDetector(
              onTap: () => _loadCategory(category),
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

    final items = _items[category.name];
    if (items == null) {
      return const PosterRowSkeleton();
    }

    if (items.isEmpty) {
      return Padding(
        padding: const EdgeInsets.symmetric(
          horizontal: AppSpacing.screenPadding,
        ),
        child: Text(
          'Nothing here yet.',
          style: AppTextStyles.dmSans(fontSize: 12, color: AppColors.textMuted),
        ),
      );
    }

    return ListView.separated(
      scrollDirection: Axis.horizontal,
      padding: const EdgeInsets.symmetric(horizontal: AppSpacing.screenPadding),
      itemCount: items.length,
      separatorBuilder: (_, _) => const SizedBox(width: AppSpacing.posterGap),
      itemBuilder: (context, i) {
        final t = items[i];
        return PosterCard(
          width: 110,
          height: 162,
          title: t.name,
          subtitle: t.year > 0 ? '${t.year}' : null,
          gradientSeed: t.gradientSeed,
          imageUrl: TmdbService.posterUrl(t.posterPath),
          tmdbId: t.tmdbId,
          kind: t.kind,
          onTap: () => _openTitle(t),
          onLongPress: () => showTitleActionsSheet(context, t, (_) {}),
        );
      },
    );
  }
}
