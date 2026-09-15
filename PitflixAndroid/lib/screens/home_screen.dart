import 'dart:async';
import 'package:flutter/material.dart';
import '../models/coming_soon_item.dart';
import '../models/rate_prompt_item.dart';
import '../models/title_item.dart';
import '../services/app_settings.dart';
import '../services/profile_photo_store.dart';
import '../services/rate_prompt_store.dart';
import '../services/social_service.dart';
import '../services/tmdb_service.dart';
import '../services/user_library_service.dart';
import '../theme/app_theme.dart';
import '../utils/title_actions_sheet.dart';
import '../utils/watch_later.dart';
import '../widgets/widgets.dart';
import 'coming_soon_screen.dart';
import 'lists_screen.dart';
import 'notifications_screen.dart';
import 'search_screen.dart';
import 'title_detail_movie_screen.dart';
import 'title_detail_series_screen.dart';
import 'title_grid_screen.dart';
import '../widgets/pitflix_network_image.dart';

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
  List<TitleItem>? _nextEpisodes;
  List<ComingSoonItem>? _comingSoon;
  String? _trendingError;
  String? _watchLaterError;
  String? _currentlyWatchingError;
  String? _nextEpisodesError;
  String? _comingSoonError;

  /// tmdbIds dropped during this Home instance's lifetime — filtered out of
  /// every Currently Watching/Next Episodes render regardless of source.
  /// Needed because a drop's local removal (see title_actions_sheet's
  /// onDropped) can otherwise get clobbered by an *already in-flight* reload
  /// that started before the drop and still carries the old, undropped
  /// server snapshot — without this, the item would flash back for a few
  /// seconds until the next reload catches up.
  final Set<int> _recentlyDroppedIds = {};

  List<TitleItem> _excludeDropped(List<TitleItem> items) => items
      .where((t) => t.tmdbId == null || !_recentlyDroppedIds.contains(t.tmdbId))
      .toList();

  void _onTitleDropped(TitleItem t) {
    if (t.tmdbId != null) _recentlyDroppedIds.add(t.tmdbId!);
    setState(() {
      _currentlyWatching = _currentlyWatching == null
          ? null
          : _excludeDropped(_currentlyWatching!);
      _nextEpisodes = _nextEpisodes == null
          ? null
          : _excludeDropped(_nextEpisodes!);
    });
  }

  @override
  void initState() {
    super.initState();
    _loadTrending();
    _loadWatchLater();
    _loadCurrentlyWatching();
    _loadNextEpisodes();
    _loadComingSoon();
    UserLibraryService.libraryVersion.addListener(_onLibraryChanged);
    if (ProfilePhotoStore.avatarUrl.value == null) _loadAvatar();
  }

  /// Only fetches if nothing's loaded it yet (e.g. Home is the first screen
  /// shown this session) — once loaded, [ProfilePhotoStore.avatarUrl] stays
  /// current via Profile/Edit Profile's own writes, no need to re-fetch here.
  Future<void> _loadAvatar() async {
    try {
      final profile = await SocialService.myProfile();
      if (mounted) ProfilePhotoStore.avatarUrl.value = profile?.avatarUrl;
    } catch (_) {
      // Decorative — avatar just stays a placeholder if this fails.
    }
  }

  @override
  void dispose() {
    UserLibraryService.libraryVersion.removeListener(_onLibraryChanged);
    _libraryChangeDebounce?.cancel();
    super.dispose();
  }

  Timer? _libraryChangeDebounce;

  /// Debounced — a single user action can bump [UserLibraryService
  /// .libraryVersion] more than once (e.g. Drop's first-ever use both
  /// creates the "Dropped" list and adds to it, two separate bumps fired
  /// back to back). Without this, each bump kicked off its own full reload
  /// (paged Supabase fetch + per-show TMDB calls) concurrently with the
  /// last, doubling the network/CPU work and making the app visibly janky
  /// right after an action like Drop — collapsing rapid-fire bumps into one
  /// reload fixes that without changing what ends up loaded.
  void _onLibraryChanged() {
    _libraryChangeDebounce?.cancel();
    _libraryChangeDebounce = Timer(const Duration(milliseconds: 400), () {
      _loadWatchLater(forceRefresh: true);
      _loadCurrentlyWatching();
      _loadNextEpisodes();
    });
  }

  Future<void> _loadNextEpisodes() async {
    setState(() => _nextEpisodesError = null);
    try {
      final items = await UserLibraryService.fetchNextEpisodes();
      if (!mounted) return;
      final healed = await UserLibraryService.applyCustomArtwork(items);
      if (!mounted) return;
      setState(() => _nextEpisodes = _excludeDropped(healed));
    } catch (e) {
      if (!mounted) return;
      setState(() => _nextEpisodesError = e.toString());
    }
  }

  Future<void> _loadComingSoon() async {
    setState(() => _comingSoonError = null);
    try {
      final items = await TmdbService.fetchComingSoon();
      if (!mounted) return;
      final dismissed = AppSettings.dismissedComingSoonIds.value;
      setState(
        () => _comingSoon = items
            .where((i) => !dismissed.contains('${i.tmdbId}-${i.mediaType}'))
            .toList(),
      );
    } catch (e) {
      if (!mounted) return;
      setState(() => _comingSoonError = e.toString());
    }
  }

  Future<void> _loadCurrentlyWatching() async {
    setState(() => _currentlyWatchingError = null);

    // Instant stale paint from last session's snapshot while the real fetch
    // (below) runs — only on this screen's first load, and only if the live
    // fetch hasn't already beaten it to painting something. Deliberately
    // skips applyCustomArtwork here (unlike the live paints below) — that's
    // a Supabase network call, and paying for it before showing anything
    // would defeat the entire point of painting instantly from disk.
    if (_currentlyWatching == null) {
      final cachedRows = await UserLibraryService.cachedCurrentlyWatching();
      if (cachedRows != null && mounted && _currentlyWatching == null) {
        final cachedItems = [
          for (final row in cachedRows) _currentlyWatchingItem(row, null),
        ];
        setState(() => _currentlyWatching = _excludeDropped(cachedItems));
      }
    }

    try {
      final rows = await UserLibraryService.fetchCurrentlyWatching();
      if (!mounted) return;

      // Posters render immediately with no progress bar yet, instead of the
      // whole row staying blank until every show's total episode count
      // comes back — that's a separate TMDB detail call *per show*
      // (fetchEpisodeCount, only used for the watched/total progress bar),
      // and was why this section in particular took so much longer to show
      // anything than Home's other rows.
      final initialItems = [
        for (final row in rows) _currentlyWatchingItem(row, null),
      ];
      final healedInitial = await UserLibraryService.applyCustomArtwork(
        initialItems,
      );
      if (!mounted) return;
      setState(() => _currentlyWatching = _excludeDropped(healedInitial));

      // Total episode count per show, so the row can upgrade to showing
      // watched/total progress instead of just a "N episodes watched" count
      // with no sense of how close to finished that is. Fills in on top of
      // the posters already on screen rather than blocking them.
      final episodeCounts = await Future.wait(
        rows.map(
          (r) => TmdbService.fetchEpisodeCount((r['tmdb_id'] as num).toInt()),
        ),
      );
      if (!mounted) return;

      final items = [
        for (var i = 0; i < rows.length; i++)
          _currentlyWatchingItem(rows[i], episodeCounts[i]),
      ];
      final healed = await UserLibraryService.applyCustomArtwork(items);
      if (!mounted) return;
      setState(() => _currentlyWatching = _excludeDropped(healed));
    } catch (e) {
      if (!mounted) return;
      setState(() => _currentlyWatchingError = e.toString());
    }
  }

  TitleItem _currentlyWatchingItem(
    Map<String, dynamic> row,
    int? totalEpisodes,
  ) {
    final tmdbId = (row['tmdb_id'] as num).toInt();
    final watchedCount = (row['watched_episode_count'] as num?)?.toInt() ?? 0;
    final nextSeason = (row['next_season'] as num?)?.toInt();
    final nextEpisode = (row['next_episode'] as num?)?.toInt();
    // Mirrors desktop's Up Next card: a "SxxExx" corner badge for the actual
    // next episode, plus a "watched / total eps" subtitle for progress —
    // desktop shows both, not one string standing in for the other.
    final badge = (nextSeason != null && nextEpisode != null)
        ? 'S${nextSeason.toString().padLeft(2, '0')}E${nextEpisode.toString().padLeft(2, '0')}'
        : null;
    return TitleItem(
      id: 'currently-watching-$tmdbId',
      name: row['title'] as String? ?? 'Untitled',
      kind: TitleKind.show,
      year: 0,
      network: 'TV',
      rating: 0,
      genres: const [],
      overview: '',
      gradientSeed: tmdbId % 6,
      posterPath: row['poster_path'] as String?,
      tmdbId: tmdbId,
      isSummaryOnly: true,
      // totalEpisodes is null until fetchEpisodeCount's second wave resolves
      // (see _loadCurrentlyWatching's progressive load) or if that TMDB call
      // failed — show just the watched count rather than a "N / ?" that
      // reads like broken data.
      episodeSub: totalEpisodes == null
          ? '$watchedCount eps watched'
          : '$watchedCount / $totalEpisodes eps',
      posterBadge: badge,
      progress: (totalEpisodes != null && totalEpisodes > 0)
          ? (watchedCount / totalEpisodes).clamp(0.0, 1.0)
          : null,
    );
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

  void _openTitleGrid(String title, List<TitleItem>? items) {
    Navigator.of(context).push(
      MaterialPageRoute(
        builder: (_) => TitleGridScreen(title: title, items: items ?? const []),
      ),
    );
  }

  void _openComingSoon({required bool showsTab}) {
    Navigator.of(context).push(
      MaterialPageRoute(
        builder: (_) => ComingSoonScreen(initialShowsTab: showsTab),
      ),
    );
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
        releaseDate: item.releaseDate,
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
                        onTap: () => Navigator.of(context).push(
                          MaterialPageRoute(
                            builder: (_) => const NotificationsScreen(),
                          ),
                        ),
                        child: ValueListenableBuilder<List<RatePromptItem>>(
                          valueListenable: RatePromptStore.items,
                          builder: (context, items, _) => Stack(
                            clipBehavior: Clip.none,
                            children: [
                              const Icon(
                                Icons.notifications_none,
                                color: AppColors.textMuted,
                                size: 22,
                              ),
                              if (items.isNotEmpty)
                                Positioned(
                                  right: -3,
                                  top: -3,
                                  child: Container(
                                    padding: const EdgeInsets.symmetric(
                                      horizontal: 4,
                                      vertical: 1,
                                    ),
                                    constraints: const BoxConstraints(
                                      minWidth: 14,
                                    ),
                                    decoration: const BoxDecoration(
                                      color: AppColors.accent,
                                      shape: BoxShape.circle,
                                    ),
                                    child: Text(
                                      '${items.length}',
                                      textAlign: TextAlign.center,
                                      style: AppTextStyles.dmSans(
                                        fontSize: 9,
                                        fontWeight: FontWeight.w700,
                                        color: AppColors.bgBase,
                                      ),
                                    ),
                                  ),
                                ),
                            ],
                          ),
                        ),
                      ),
                      const SizedBox(width: 16),
                      GestureDetector(
                        onTap: widget.onAvatarTap,
                        child: ValueListenableBuilder<String?>(
                          valueListenable: ProfilePhotoStore.avatarUrl,
                          builder: (context, avatarUrl, _) => Container(
                            width: 28,
                            height: 28,
                            clipBehavior: Clip.antiAlias,
                            decoration: const BoxDecoration(
                              color: AppColors.avatarBg,
                              shape: BoxShape.circle,
                            ),
                            child: avatarUrl != null
                                ? PitflixNetworkImage(
                                    avatarUrl,
                                    fit: BoxFit.cover,
                                    errorBuilder:
                                        (context, error, stackTrace) =>
                                            const SizedBox.shrink(),
                                  )
                                : null,
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
            ValueListenableBuilder<List<RatePromptItem>>(
              valueListenable: RatePromptStore.items,
              builder: (context, items, _) {
                if (items.isEmpty) return const SizedBox.shrink();
                return _RatePromptBanner(item: items.first);
              },
            ),
            Expanded(
              // Swipe left/right to switch the Shows/Movies tab — only wins
              // the gesture when the drag doesn't start over one of the
              // horizontal poster rows below (those rows' own ListViews
              // claim horizontal drags for their own scrolling first; this
              // only fires for drags over section headers/gaps/vertical
              // scroll area, same idea as a swipeable segmented tab bar).
              child: GestureDetector(
                behavior: HitTestBehavior.opaque,
                onHorizontalDragEnd: (details) {
                  final vx = details.primaryVelocity ?? 0;
                  if (vx > 300 && _tab != 1) {
                    setState(() => _tab = 1); // swiped right → Movies
                  } else if (vx < -300 && _tab != 0) {
                    setState(() => _tab = 0); // swiped left → Shows
                  }
                },
                child: RefreshIndicator(
                  color: AppColors.accent,
                  backgroundColor: AppColors.bgCard,
                  onRefresh: () => Future.wait([
                    _loadTrending(forceRefresh: true),
                    _loadWatchLater(forceRefresh: true),
                    _loadCurrentlyWatching(),
                    _loadNextEpisodes(),
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
                              onSeeAll: () => _openTitleGrid(
                                'Currently Watching',
                                _currentlyWatching,
                              ),
                              onDropped: _onTitleDropped,
                            ),
                            const SizedBox(height: AppSpacing.sectionGap),
                            _PosterRow(
                              title: 'Next Episodes',
                              items: _nextEpisodes,
                              errorText: _nextEpisodesError,
                              onRetry: _loadNextEpisodes,
                              showProgress: true,
                              onTap: _openTitle,
                              onSeeAll: () => _openTitleGrid(
                                'Next Episodes',
                                _nextEpisodes,
                              ),
                              onDropped: _onTitleDropped,
                            ),
                            const SizedBox(height: AppSpacing.sectionGap),
                            _ComingSoonPosterRow(
                              // Shows-only. Used to be combined movies+shows
                              // because a 30-day window made TV discovery too
                              // sparse on its own — now that the window is 90
                              // days with 2 pages fetched per side
                              // (TmdbService.fetchComingSoon), there's enough
                              // TV-only data to split back out per tab.
                              items: _comingSoon
                                  ?.where((c) => c.isShow)
                                  .toList(),
                              errorText: _comingSoonError,
                              onRetry: _loadComingSoon,
                              onSeeAll: () => _openComingSoon(showsTab: true),
                              onTap: _openComingSoonItem,
                            ),
                            const SizedBox(height: AppSpacing.sectionGap),
                            _PosterRow(
                              title: 'Trending',
                              items: _trendingShows,
                              errorText: _trendingError,
                              onRetry: _loadTrending,
                              onTap: _openTitle,
                              onSeeAll: () =>
                                  _openTitleGrid('Trending', _trendingShows),
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
                              onSeeAll: () => _openComingSoon(showsTab: false),
                              onTap: _openComingSoonItem,
                            ),
                            const SizedBox(height: AppSpacing.sectionGap),
                            _PosterRow(
                              title: 'Trending',
                              items: _trendingMovies,
                              errorText: _trendingError,
                              onRetry: _loadTrending,
                              onTap: _openTitle,
                              onSeeAll: () =>
                                  _openTitleGrid('Trending', _trendingMovies),
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
            ),
          ],
        ),
      ),
    );
  }
}

/// Countdown-style poster row for upcoming titles — mirrors [_PosterRow]'s
/// loading/error/empty states but shows a "days until release" badge instead
/// of an episode/progress subtitle.
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
      return InlineErrorRetry(
        message: "Couldn't load: $errorText",
        onRetry: onRetry,
      );
    }

    if (items == null) {
      return const PosterRowSkeleton();
    }

    if (items!.isEmpty) {
      return const EmptyState(
        message:
            'Nothing coming up in the next ${TmdbService.comingSoonWindowDays} days.',
        padding: EdgeInsets.symmetric(horizontal: AppSpacing.screenPadding),
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

  /// Called right after a title is successfully dropped from this row's long
  /// press menu, so the caller can remove it from the row immediately
  /// instead of waiting for Home's debounced background reload to catch up.
  final ValueChanged<TitleItem>? onDropped;

  const _PosterRow({
    required this.title,
    required this.items,
    required this.onTap,
    this.errorText,
    this.onRetry,
    this.showProgress = false,
    this.onSeeAll,
    this.onDropped,
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
      return InlineErrorRetry(
        message: "Couldn't load: $errorText",
        onRetry: onRetry,
      );
    }

    if (items == null) {
      return const PosterRowSkeleton();
    }

    if (items!.isEmpty) {
      return const EmptyState(
        message: 'Nothing here yet.',
        padding: EdgeInsets.symmetric(horizontal: AppSpacing.screenPadding),
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
          tmdbId: t.tmdbId,
          kind: t.kind,
          subtitle: showProgress ? t.episodeSub : null,
          progress: showProgress ? t.progress : null,
          cornerBadge: showProgress ? t.posterBadge : null,
          onTap: () => onTap(t),
          onLongPress: () => showTitleActionsSheet(
            context,
            t,
            (_) {},
            onDropped: onDropped == null ? null : () => onDropped!(t),
          ),
        );
      },
    );
  }
}

/// Dismissible "you just watched this, wanna rate it?" strip for the single
/// newest pending item — the rest live in NotificationsScreen (bell icon
/// above). Rating or dismissing removes it from RatePromptStore immediately,
/// which lets the next-newest item (if any) take its place here.
class _RatePromptBanner extends StatelessWidget {
  final RatePromptItem item;

  const _RatePromptBanner({required this.item});

  Future<void> _rate(int rating) async {
    switch (item.type) {
      case RatePromptType.movie:
        await UserLibraryService.setTitleRating(item.tmdbId, 'movie', rating);
      case RatePromptType.series:
        await UserLibraryService.setTitleRating(item.tmdbId, 'series', rating);
      case RatePromptType.episode:
        await UserLibraryService.setEpisodeRating(
          item.tmdbId,
          item.season!,
          item.episodeNumber!,
          rating,
        );
    }
    RatePromptStore.remove(item.key);
  }

  void _dismiss() {
    AppSettings.dismissRatePrompt(item.key);
    RatePromptStore.remove(item.key);
  }

  @override
  Widget build(BuildContext context) {
    return Container(
      margin: const EdgeInsets.fromLTRB(
        AppSpacing.screenPadding,
        12,
        AppSpacing.screenPadding,
        0,
      ),
      padding: const EdgeInsets.symmetric(horizontal: 14, vertical: 10),
      decoration: BoxDecoration(
        color: AppColors.bgCard,
        borderRadius: BorderRadius.circular(AppSpacing.cardRadiusMax),
        border: Border.all(color: AppColors.accent.withValues(alpha: 0.3)),
      ),
      child: Row(
        children: [
          Expanded(
            child: Column(
              crossAxisAlignment: CrossAxisAlignment.start,
              mainAxisSize: MainAxisSize.min,
              children: [
                Text(
                  'You just watched "${item.displayLabel}" — wanna rate it?',
                  style: AppTextStyles.dmSans(fontSize: 12),
                ),
                const SizedBox(height: 6),
                StarRating(rating: 0, max: 5, size: 18, onChanged: _rate),
              ],
            ),
          ),
          IconButton(
            onPressed: _dismiss,
            icon: const Icon(Icons.close, size: 16, color: AppColors.textMuted),
          ),
        ],
      ),
    );
  }
}
