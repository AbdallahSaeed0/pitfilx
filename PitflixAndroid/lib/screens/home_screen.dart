import 'package:flutter/material.dart';
import '../config/app_config.dart';
import '../models/coming_soon_item.dart';
import '../models/title_item.dart';
import '../services/local_backend_service.dart';
import '../services/tmdb_service.dart';
import '../theme/app_theme.dart';
import '../utils/watch_later.dart';
import '../widgets/widgets.dart';
import 'coming_soon_screen.dart';
import 'lists_screen.dart';
import 'search_screen.dart';
import 'title_detail_movie_screen.dart';
import 'title_detail_series_screen.dart';

class HomeScreen extends StatefulWidget {
  final VoidCallback? onAvatarTap;

  const HomeScreen({super.key, this.onAvatarTap});

  @override
  State<HomeScreen> createState() => _HomeScreenState();
}

class _HomeScreenState extends State<HomeScreen> {
  int _tab = 0; // 0 = Shows, 1 = Movies

  // null = loading, empty list = loaded-but-empty; errors tracked separately.
  List<TitleItem>? _trendingShows;
  List<TitleItem>? _trendingMovies;
  List<TitleItem>? _watchLaterShows;
  List<TitleItem>? _watchLaterMovies;
  List<TitleItem>? _currentlyWatching;
  List<ComingSoonItem>? _comingSoon;
  String? _trendingError;
  String? _watchLaterError;
  String? _currentlyWatchingError;
  String? _comingSoonError;

  @override
  void initState() {
    super.initState();
    _loadTrending();
    _loadWatchLater();
    _loadCurrentlyWatching();
    _loadComingSoon();
  }

  Future<void> _loadComingSoon() async {
    if (!AppConfig.useLocalBackend) {
      setState(() => _comingSoon = const []);
      return;
    }
    setState(() => _comingSoonError = null);
    try {
      final items = await LocalBackendService.fetchComingSoon();
      if (!mounted) return;
      setState(() => _comingSoon = items);
    } catch (e) {
      if (!mounted) return;
      setState(() => _comingSoonError = e.toString());
    }
  }

  Future<void> _loadCurrentlyWatching() async {
    if (!AppConfig.useLocalBackend) {
      setState(() => _currentlyWatching = const []);
      return;
    }
    setState(() => _currentlyWatchingError = null);
    try {
      final rows = await LocalBackendService.fetchWatchingCurrently();
      if (!mounted) return;
      setState(() {
        _currentlyWatching = rows.map((r) {
          final tmdbId = (r['showTmdbId'] as num?)?.toInt() ?? 0;
          return TitleItem(
            id: 'currently-watching-${r['libraryShowId']}',
            name: r['showTitle'] as String? ?? 'Untitled',
            kind: TitleKind.show,
            year: 0,
            network: 'TV',
            rating: 0,
            genres: const [],
            overview: '',
            gradientSeed: tmdbId % 6,
            posterPath: r['posterUrl'] as String?,
            tmdbId: tmdbId,
            isSummaryOnly: true,
            episodeSub: r['nextLabel'] as String?,
            progress: (r['progressFraction'] as num?)?.toDouble(),
            libraryId: (r['libraryShowId'] as num?)?.toInt(),
          );
        }).toList();
      });
    } catch (e) {
      if (!mounted) return;
      setState(() => _currentlyWatchingError = e.toString());
    }
  }

  Future<void> _loadTrending({bool forceRefresh = false}) async {
    setState(() => _trendingError = null);
    try {
      final results = await Future.wait([
        TmdbService.fetchTrending(TitleKind.show, forceRefresh: forceRefresh),
        TmdbService.fetchTrending(TitleKind.movie, forceRefresh: forceRefresh),
      ]);
      if (!mounted) return;
      setState(() {
        _trendingShows = results[0];
        _trendingMovies = results[1];
      });
    } catch (e) {
      if (!mounted) return;
      setState(() => _trendingError = e.toString());
    }
  }

  Future<void> _loadWatchLater({bool forceRefresh = false}) async {
    setState(() => _watchLaterError = null);
    try {
      final items = await fetchWatchLaterItems(forceRefresh: forceRefresh);
      if (!mounted) return;
      setState(() {
        _watchLaterShows = items.where((t) => t.isShow).toList();
        _watchLaterMovies = items.where((t) => !t.isShow).toList();
      });
    } catch (e) {
      if (!mounted) return;
      setState(() => _watchLaterError = e.toString());
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

  void _openLists() {
    Navigator.of(
      context,
    ).push(MaterialPageRoute(builder: (_) => const ListsScreen()));
  }

  void _openComingSoon() {
    Navigator.of(
      context,
    ).push(MaterialPageRoute(builder: (_) => const ComingSoonScreen()));
  }

  void _openComingSoonItem(ComingSoonItem item) {
    final kind = item.isShow ? TitleKind.show : TitleKind.movie;
    _openTitle(
      TitleItem(
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
      ),
    );
  }

  @override
  Widget build(BuildContext context) {
    final isShows = _tab == 0;
    return Scaffold(
      backgroundColor: AppColors.bgBase,
      body: SafeArea(
        bottom: false,
        child: Column(
          children: [
            Padding(
              padding: const EdgeInsets.fromLTRB(20, 14, 20, 0),
              child: Row(
                mainAxisAlignment: MainAxisAlignment.spaceBetween,
                children: [
                  const AnimatedWordmark(fontSize: 26, loop: true),
                  Row(
                    children: [
                      GestureDetector(
                        onTap: () => Navigator.of(context).push(
                          MaterialPageRoute(
                            builder: (_) => const SearchScreen(),
                          ),
                        ),
                        child: const Icon(
                          Icons.search,
                          color: AppColors.textMuted,
                          size: 22,
                        ),
                      ),
                      const SizedBox(width: 16),
                      GestureDetector(
                        onTap: widget.onAvatarTap,
                        child: Container(
                          width: 28,
                          height: 28,
                          decoration: const BoxDecoration(
                            color: AppColors.avatarBg,
                            shape: BoxShape.circle,
                          ),
                        ),
                      ),
                    ],
                  ),
                ],
              ),
            ),
            SegmentedTabBar(
              tabs: const ['Shows', 'Movies'],
              activeIndex: _tab,
              onChanged: (i) => setState(() => _tab = i),
            ),
            Expanded(
              child: RefreshIndicator(
                color: AppColors.accent,
                backgroundColor: AppColors.bgCard,
                onRefresh: () => Future.wait([
                  _loadTrending(forceRefresh: true),
                  _loadWatchLater(forceRefresh: true),
                  _loadCurrentlyWatching(),
                  _loadComingSoon(),
                ]),
                child: ListView(
                  padding: const EdgeInsets.only(top: 18, bottom: 24),
                  children: isShows
                      ? [
                          _PosterRow(
                            title: 'Currently Watching',
                            items: _currentlyWatching,
                            errorText: _currentlyWatchingError,
                            onRetry: _loadCurrentlyWatching,
                            showProgress: true,
                            onTap: _openTitle,
                          ),
                          const SizedBox(height: AppSpacing.sectionGap),
                          _ComingSoonPosterRow(
                            items: _comingSoon?.where((c) => c.isShow).toList(),
                            errorText: _comingSoonError,
                            onRetry: _loadComingSoon,
                            onSeeAll: _openComingSoon,
                            onTap: _openComingSoonItem,
                          ),
                          const SizedBox(height: AppSpacing.sectionGap),
                          _PosterRow(
                            title: 'Trending',
                            items: _trendingShows,
                            errorText: _trendingError,
                            onRetry: _loadTrending,
                            onTap: _openTitle,
                          ),
                          const SizedBox(height: AppSpacing.sectionGap),
                          _PosterRow(
                            title: 'Watch Later',
                            items: _watchLaterShows,
                            errorText: _watchLaterError,
                            onRetry: _loadWatchLater,
                            onTap: _openTitle,
                            onSeeAll: _openLists,
                          ),
                        ]
                      : [
                          _ComingSoonPosterRow(
                            items: _comingSoon
                                ?.where((c) => !c.isShow)
                                .toList(),
                            errorText: _comingSoonError,
                            onRetry: _loadComingSoon,
                            onSeeAll: _openComingSoon,
                            onTap: _openComingSoonItem,
                          ),
                          const SizedBox(height: AppSpacing.sectionGap),
                          _PosterRow(
                            title: 'Trending',
                            items: _trendingMovies,
                            errorText: _trendingError,
                            onRetry: _loadTrending,
                            onTap: _openTitle,
                          ),
                          const SizedBox(height: AppSpacing.sectionGap),
                          _PosterRow(
                            title: 'Watch Later',
                            items: _watchLaterMovies,
                            errorText: _watchLaterError,
                            onRetry: _loadWatchLater,
                            onTap: _openTitle,
                            onSeeAll: _openLists,
                          ),
                        ],
                ),
              ),
            ),
          ],
        ),
      ),
    );
  }
}

/// Countdown-style poster row for pinned upcoming titles — mirrors
/// [_PosterRow]'s loading/error/empty states but shows a "days until
/// release" badge instead of an episode/progress subtitle.
class _ComingSoonPosterRow extends StatelessWidget {
  final List<ComingSoonItem>? items; // null = loading
  final String? errorText;
  final VoidCallback? onRetry;
  final VoidCallback onSeeAll;
  final ValueChanged<ComingSoonItem> onTap;

  const _ComingSoonPosterRow({
    required this.items,
    required this.onSeeAll,
    required this.onTap,
    this.errorText,
    this.onRetry,
  });

  @override
  Widget build(BuildContext context) {
    return Column(
      crossAxisAlignment: CrossAxisAlignment.start,
      children: [
        SectionHeader(title: 'Coming Soon', onSeeAll: onSeeAll),
        SizedBox(height: 162, child: _buildContent()),
      ],
    );
  }

  Widget _buildContent() {
    if (errorText != null) {
      return Padding(
        padding: const EdgeInsets.symmetric(
          horizontal: AppSpacing.screenPadding,
        ),
        child: Row(
          children: [
            Expanded(
              child: Text(
                "Couldn't load: $errorText",
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

    if (items == null) {
      return const PosterRowSkeleton();
    }

    if (items!.isEmpty) {
      return Padding(
        padding: const EdgeInsets.symmetric(
          horizontal: AppSpacing.screenPadding,
        ),
        child: Text(
          'Nothing pinned yet.',
          style: AppTextStyles.dmSans(fontSize: 12, color: AppColors.textMuted),
        ),
      );
    }

    return ListView.separated(
      scrollDirection: Axis.horizontal,
      padding: const EdgeInsets.symmetric(horizontal: AppSpacing.screenPadding),
      itemCount: items!.length,
      separatorBuilder: (_, _) => const SizedBox(width: AppSpacing.posterGap),
      itemBuilder: (context, i) {
        final item = items![i];
        return PosterCard(
          width: 110,
          height: 162,
          title: item.title,
          gradientSeed: item.tmdbId % 6,
          imageUrl: item.posterUrl,
          subtitle: item.countdownLabel,
          onTap: () => onTap(item),
        );
      },
    );
  }
}

class _PosterRow extends StatelessWidget {
  final String title;
  final List<TitleItem>? items; // null = loading
  final String? errorText;
  final VoidCallback? onRetry;
  final bool showProgress;
  final ValueChanged<TitleItem> onTap;
  final VoidCallback? onSeeAll;

  const _PosterRow({
    required this.title,
    required this.items,
    required this.onTap,
    this.errorText,
    this.onRetry,
    this.showProgress = false,
    this.onSeeAll,
  });

  @override
  Widget build(BuildContext context) {
    return Column(
      crossAxisAlignment: CrossAxisAlignment.start,
      children: [
        SectionHeader(title: title, onSeeAll: onSeeAll ?? () {}),
        SizedBox(height: 162, child: _buildContent()),
      ],
    );
  }

  Widget _buildContent() {
    if (errorText != null) {
      return Padding(
        padding: const EdgeInsets.symmetric(
          horizontal: AppSpacing.screenPadding,
        ),
        child: Row(
          children: [
            Expanded(
              child: Text(
                "Couldn't load: $errorText",
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

    if (items == null) {
      return const PosterRowSkeleton();
    }

    if (items!.isEmpty) {
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
      itemCount: items!.length,
      separatorBuilder: (_, _) => const SizedBox(width: AppSpacing.posterGap),
      itemBuilder: (context, i) {
        final t = items![i];
        return PosterCard(
          width: 110,
          height: 162,
          title: t.name,
          gradientSeed: t.gradientSeed,
          imageUrl: TmdbService.posterUrl(t.posterPath),
          subtitle: showProgress ? t.episodeSub : null,
          progress: showProgress ? t.progress : null,
          onTap: () => onTap(t),
        );
      },
    );
  }
}
