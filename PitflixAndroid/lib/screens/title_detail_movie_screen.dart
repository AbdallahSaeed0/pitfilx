import 'package:flutter/material.dart';
import '../data/mock_data.dart';
import '../models/cast_member.dart';
import '../models/social_activity_item.dart';
import '../models/title_item.dart';
import '../services/ratings_service.dart';
import '../services/social_service.dart';
import '../services/tmdb_service.dart';
import '../services/user_library_service.dart';
import '../theme/app_theme.dart';
import '../services/session_stats_store.dart';
import '../utils/favorites.dart';
import '../utils/reactions.dart';
import '../utils/title_actions_sheet.dart';
import '../widgets/friend_avatar.dart';
import '../widgets/widgets.dart';
import 'actor_screen.dart';

class TitleDetailMovieScreen extends StatefulWidget {
  final TitleItem title;

  const TitleDetailMovieScreen({super.key, required this.title});

  @override
  State<TitleDetailMovieScreen> createState() => _TitleDetailMovieScreenState();
}

class _TitleDetailMovieScreenState extends State<TitleDetailMovieScreen> {
  late bool _watched = widget.title.watched;
  late int _rating = widget.title.userRating;
  late bool _watchLater = widget.title.watchLater;
  late int _rewatchCount = widget.title.rewatchCount;
  TitleItem? _enriched;
  Map<String, dynamic>? _ratings;

  /// Friends (from `activity_events`) who've watched/rated this specific
  /// movie — null while loading, empty once loaded with nobody found. Only
  /// ratings/"watched" are shown; written reviews aren't persisted anywhere
  /// in the backend today (see `_review` above — session-local only), so
  /// there's nothing to surface for those yet.
  List<SocialActivityItem>? _friendActivity;

  /// True while the full TMDB detail lookup (cast/overview/genres) is in
  /// flight — drives the loading skeleton below so a first open reads as
  /// "loading" rather than a blank About section.
  late bool _enriching = widget.title.needsDetailEnrichment;

  String? _favoritesListId;
  bool? _isFavorite;
  String _review = '';
  String? _reaction;

  // Per-account custom poster/backdrop (see UserLibraryService.setCustomPoster
  // / setCustomBackdrop) — fetched independently of TMDB enrichment and
  // re-applied on top of `_enriched` whichever finishes last, so a picked
  // custom poster never gets clobbered by the enrichment response overwriting
  // `_enriched` wholesale.
  String? _customPosterPath;
  String? _customBackdropPath;

  @override
  void initState() {
    super.initState();
    if (widget.title.needsDetailEnrichment) {
      TmdbService.fetchDetails(widget.title.tmdbId!, TitleKind.movie).then((
        full,
      ) {
        if (!mounted) return;
        setState(() {
          if (full != null) _enriched = _applyCustomArtwork(full);
          _enriching = false;
        });
      });
    }
    if (widget.title.tmdbId != null) {
      RatingsService.fetch(
        widget.title.tmdbId!,
        TitleKind.movie,
        widget.title.rating,
      ).then((data) {
        if (mounted) setState(() => _ratings = data);
      });
    }
    if (widget.title.tmdbId != null) {
      _loadFavorite();
      _loadCustomArtwork();
      _loadWatchedStatus();
      _loadFriendActivity();
    }
  }

  Future<void> _loadFriendActivity() async {
    try {
      final items = await SocialService.fetchActivityForTitle(
        widget.title.tmdbId!,
        'movie',
      );
      if (mounted) setState(() => _friendActivity = items);
    } catch (_) {
      if (mounted) setState(() => _friendActivity = const []);
    }
  }

  /// A [TitleItem] built from a Currently-Watching/Trending/Search/Discover
  /// result never carries this account's real watch history (see
  /// _titleFromWatchRecord — always constructed with `watched: false`), so
  /// `widget.title.watched` alone can't tell a never-seen movie from one
  /// already logged complete. Checking the real `watch_records` row is what
  /// actually drives the WATCH → REWATCH button switch below.
  Future<void> _loadWatchedStatus() async {
    try {
      final record = await UserLibraryService.fetchWatchRecord(
        widget.title.tmdbId!,
        'movie',
      );
      if (!mounted || record == null) return;
      setState(() {
        _watched = true;
        final rating = (record['rating'] as num?)?.toInt();
        if (rating != null && rating > 0) _rating = rating;
        final rewatchCount = (record['rewatch_count'] as num?)?.toInt();
        if (rewatchCount != null) _rewatchCount = rewatchCount;
      });
    } catch (_) {
      // Best-effort — button just falls back to "WATCH" if this fails.
    }
  }

  Future<void> _loadCustomArtwork() async {
    try {
      final row = await UserLibraryService.fetchCustomArtwork(
        widget.title.tmdbId!,
        'movie',
      );
      if (!mounted || row == null) return;
      _customPosterPath = row['custom_poster_path'] as String?;
      _customBackdropPath = row['custom_backdrop_path'] as String?;
      setState(
        () => _enriched = _applyCustomArtwork(_enriched ?? widget.title),
      );
    } catch (_) {
      // Custom artwork is decorative — falls back to the TMDB default.
    }
  }

  TitleItem _applyCustomArtwork(TitleItem t) => t.copyWith(
    posterPath: _customPosterPath,
    backdropPath: _customBackdropPath,
  );

  Future<void> _loadFavorite() async {
    try {
      final listId = await findFavoritesListId();
      if (listId == null || !mounted) return;
      final isFav = await UserLibraryService.isInList(
        listId,
        widget.title.tmdbId!,
        'movie',
      );
      if (!mounted) return;
      setState(() {
        _favoritesListId = listId;
        _isFavorite = isFav;
      });
    } catch (_) {
      // Decorative — heart button just stays hidden if this fails.
    }
  }

  Future<void> _toggleFavorite() async {
    final listId = _favoritesListId;
    final tmdbId = widget.title.tmdbId;
    if (listId == null || tmdbId == null || _isFavorite == null) return;
    final newValue = !_isFavorite!;
    setState(() => _isFavorite = newValue);
    try {
      if (newValue) {
        final t = _enriched ?? widget.title;
        await UserLibraryService.addToList(
          listId,
          tmdbId: tmdbId,
          mediaType: 'movie',
          title: t.name,
          posterPath: t.posterPath,
        );
        SocialService.logActivity(
          action: SocialActivityAction.addedToFavorites,
          tmdbId: tmdbId,
          mediaType: 'movie',
          title: t.name,
          posterPath: t.posterPath,
        );
      } else {
        await UserLibraryService.removeFromList(listId, tmdbId, 'movie');
      }
    } catch (e) {
      if (!mounted) return;
      setState(() => _isFavorite = !newValue);
      ScaffoldMessenger.of(
        context,
      ).showSnackBar(SnackBar(content: Text("Couldn't update favorite: $e")));
    }
  }

  Future<void> _openReviewSheet() async {
    final t = _enriched ?? widget.title;
    final result = await showReviewSheet(
      context,
      titleName: t.name,
      initialRating: _rating,
      initialReview: _review,
      initialWatchLater: _watchLater,
      initialReaction: _reaction,
    );
    if (result == null) return;
    // Captured before logWatched fires — mirrors desktop's "already
    // completed → completing again" rewatch rule (LibraryRepository.
    // UpdateMovieWatchStatusAsync), computed client-side here so the badge
    // updates without a round-trip re-fetch.
    final wasWatched = _watched;
    SessionStatsStore.logRating(result.$1, null, isShow: false);
    SessionStatsStore.logReaction(result.$4, isShow: false);
    if (t.tmdbId != null) {
      SocialService.logActivity(
        action: result.$1 > 0
            ? SocialActivityAction.rated
            : SocialActivityAction.watched,
        tmdbId: t.tmdbId!,
        mediaType: 'movie',
        title: t.name,
        posterPath: t.posterPath,
        rating: result.$1 > 0 ? result.$1 : null,
      );
      UserLibraryService.logWatched(
        tmdbId: t.tmdbId!,
        mediaType: 'movie',
        title: t.name,
        posterPath: t.posterPath,
        genres: t.genres,
        releaseYear: t.year > 0 ? t.year : null,
        rating: result.$1 > 0 ? result.$1 : null,
        estimatedMinutes: _runtimeMinutes(t.runtimeLabel),
      );
    }
    setState(() {
      _rating = result.$1;
      _review = result.$2;
      _watchLater = result.$3;
      _reaction = result.$4;
      _watched = true;
      if (wasWatched) _rewatchCount++;
    });
  }

  /// Long-pressing REWATCH shows how many times this has been watched, and lets the count be
  /// corrected. [StatefulBuilder] so the +/- buttons update the number inside the open sheet;
  /// [_adjustRewatchCount] separately calls setState on the screen behind it.
  void _openRewatchCountSheet() {
    showModalBottomSheet<void>(
      context: context,
      backgroundColor: AppColors.bgCard,
      shape: const RoundedRectangleBorder(
        borderRadius: BorderRadius.vertical(top: Radius.circular(18)),
      ),
      builder: (sheetContext) => SafeArea(
        child: StatefulBuilder(
          builder: (sheetContext, setSheetState) {
            Future<void> adjust(int delta) async {
              await _adjustRewatchCount(delta);
              setSheetState(() {});
            }

            return Padding(
              padding: const EdgeInsets.fromLTRB(24, 20, 24, 24),
              child: Column(
                mainAxisSize: MainAxisSize.min,
                children: [
                  Text(
                    'REWATCHED',
                    style: AppTextStyles.sectionLabel(),
                  ),
                  const SizedBox(height: 14),
                  Row(
                    mainAxisAlignment: MainAxisAlignment.center,
                    children: [
                      _RewatchStepperButton(
                        icon: Icons.remove_rounded,
                        onTap: _rewatchCount > 0 ? () => adjust(-1) : null,
                      ),
                      const SizedBox(width: 22),
                      Row(
                        crossAxisAlignment: CrossAxisAlignment.center,
                        children: [
                          const Icon(
                            Icons.replay_rounded,
                            size: 20,
                            color: AppColors.textSecondary,
                          ),
                          const SizedBox(width: 8),
                          Text(
                            '×$_rewatchCount',
                            style: AppTextStyles.bebas(
                              fontSize: 32,
                              color: AppColors.textPrimary,
                            ),
                          ),
                        ],
                      ),
                      const SizedBox(width: 22),
                      _RewatchStepperButton(
                        icon: Icons.add_rounded,
                        onTap: () => adjust(1),
                      ),
                    ],
                  ),
                  const SizedBox(height: 10),
                  Text(
                    _rewatchCount == 0
                        ? "You've watched this once."
                        : 'Watched ${_rewatchCount + 1} times in total.',
                    style: AppTextStyles.dmSans(
                      fontSize: 12,
                      color: AppColors.textMuted,
                    ),
                  ),
                ],
              ),
            );
          },
        ),
      ),
    );
  }

  Future<void> _adjustRewatchCount(int delta) async {
    final t = _enriched ?? widget.title;
    if (t.tmdbId == null) return;
    final next = (_rewatchCount + delta).clamp(0, 1 << 30);
    setState(() => _rewatchCount = next);
    await UserLibraryService.setTitleRewatchCount(t.tmdbId!, 'movie', next);
  }

  @override
  Widget build(BuildContext context) {
    final t = _enriched ?? widget.title;
    return Scaffold(
      backgroundColor: AppColors.bgBase,
      body: SafeArea(
        bottom: false,
        child: Column(
          children: [
            TitleHeroHeader(
              title: t.name,
              metaLine: '${t.year} · ${t.runtimeLabel} · ${t.network}',
              rating: t.rating,
              gradientSeed: t.gradientSeed,
              imageUrl: TmdbService.backdropUrl(t.backdropPath),
              posterUrl: TmdbService.posterUrl(t.posterPath),
              height: 220,
              isFavorite: _isFavorite,
              onFavoriteToggled: _toggleFavorite,
              onMorePressed: () => showTitleActionsSheet(
                context,
                t,
                (updated) => setState(() => _enriched = updated),
              ),
            ),
            Expanded(
              child: SingleChildScrollView(
                padding: const EdgeInsets.fromLTRB(20, 16, 20, 24),
                child: Column(
                  crossAxisAlignment: CrossAxisAlignment.start,
                  children: [
                    // These two sections each arrive from their own async
                    // fetch; revealing them via [_RevealSection] animates the
                    // layout open instead of hard-popping them in and shoving
                    // the WATCH button down, which is what made a first open
                    // feel jumpy.
                    _RevealSection(
                      visible: _ratings != null,
                      child: _ratings == null
                          ? const SizedBox.shrink()
                          : Column(
                              crossAxisAlignment: CrossAxisAlignment.start,
                              children: [
                                RatingsRow(ratings: _ratings!),
                                const SizedBox(height: 16),
                              ],
                            ),
                    ),
                    _RevealSection(
                      visible:
                          _friendActivity != null &&
                          _friendActivity!.isNotEmpty,
                      child:
                          (_friendActivity == null || _friendActivity!.isEmpty)
                          ? const SizedBox.shrink()
                          : Column(
                              crossAxisAlignment: CrossAxisAlignment.start,
                              children: [
                                _FriendActivitySection(items: _friendActivity!),
                                const SizedBox(height: 16),
                              ],
                            ),
                    ),
                    if (t.isUnreleased)
                      Container(
                        width: double.infinity,
                        padding: const EdgeInsets.symmetric(vertical: 14),
                        decoration: BoxDecoration(
                          color: AppColors.bgCard,
                          borderRadius: BorderRadius.circular(12),
                        ),
                        alignment: Alignment.center,
                        child: Text(
                          'COMING SOON',
                          style: AppTextStyles.bebas(
                            fontSize: 20,
                            letterSpacing: 0.12,
                            color: AppColors.textSecondary,
                          ),
                        ),
                      )
                    else
                      SizedBox(
                        width: double.infinity,
                        // The rewatch count used to sit in a permanent row under this button. It's
                        // now behind a long-press: it's a number you occasionally want to check or
                        // correct, not something worth a line of chrome on every visit.
                        child: GestureDetector(
                          onLongPress: _watched ? _openRewatchCountSheet : null,
                          child: ElevatedButton(
                            onPressed: _openReviewSheet,
                            style: ElevatedButton.styleFrom(
                              backgroundColor: AppColors.buttonPurple,
                              padding: const EdgeInsets.symmetric(vertical: 14),
                              shape: RoundedRectangleBorder(
                                borderRadius: BorderRadius.circular(12),
                              ),
                              elevation: 0,
                            ),
                            child: Text(
                              _watched ? 'REWATCH' : 'WATCH',
                              style: AppTextStyles.bebas(
                                fontSize: 20,
                                letterSpacing: 0.12,
                                color: AppColors.textPrimary,
                              ),
                            ),
                          ),
                        ),
                      ),
                    if (_watched && (_rating > 0 || _reaction != null)) ...[
                      const SizedBox(height: 14),
                      Row(
                        children: [
                          if (_rating > 0) ...[
                            const Icon(
                              Icons.star_rounded,
                              size: 15,
                              color: AppColors.star,
                            ),
                            const SizedBox(width: 4),
                            Text(
                              '$_rating',
                              style: AppTextStyles.dmSans(
                                fontSize: 12,
                                color: AppColors.star,
                              ),
                            ),
                            const SizedBox(width: 14),
                          ],
                          if (_reaction != null)
                            Text(
                              '${_reactionEmoji(_reaction!) ?? ''} $_reaction',
                              style: AppTextStyles.dmSans(
                                fontSize: 12,
                                color: AppColors.textSecondary,
                              ),
                            ),
                        ],
                      ),
                    ],
                    if (_review.isNotEmpty) ...[
                      const SizedBox(height: 16),
                      Text('YOUR REVIEW', style: AppTextStyles.sectionLabel()),
                      const SizedBox(height: 8),
                      Container(
                        width: double.infinity,
                        padding: const EdgeInsets.all(14),
                        decoration: BoxDecoration(
                          color: AppColors.bgCard,
                          borderRadius: BorderRadius.circular(
                            AppSpacing.cardRadiusMin,
                          ),
                        ),
                        child: Text(
                          _review,
                          style: AppTextStyles.dmSans(
                            fontSize: 13,
                            height: 1.5,
                            color: Colors.white.withValues(alpha: 0.75),
                          ),
                        ),
                      ),
                    ],
                    const SizedBox(height: AppSpacing.sectionGap),
                    if (_enriching) ...[
                      Text(
                        'Loading details…',
                        style: AppTextStyles.dmSans(
                          fontSize: 12,
                          color: AppColors.textMuted,
                        ),
                      ),
                      const SizedBox(height: 12),
                      const TitleAboutSkeleton(),
                    ] else
                      TitleAboutSection(
                        overview: t.overview,
                        cast: t.cast.isNotEmpty
                            ? t.cast
                            : t.castActorIds
                                  .map(MockData.actorById)
                                  .map(CastMember.fromMockActor)
                                  .toList(),
                        crew: t.crew,
                        genres: t.genres,
                        onCastTap: (member) => _openActor(context, member),
                        onCrewTap: (member) => _openActor(context, member),
                      ),
                  ],
                ),
              ),
            ),
            const PushedScreenBottomNav(active: MainTab.discover),
          ],
        ),
      ),
    );
  }

  String? _reactionEmoji(String label) {
    for (final (emoji, l) in kReactions) {
      if (l == label) return emoji;
    }
    return null;
  }
}

/// Smoothly reveals a section that arrives asynchronously (ratings, friend
/// activity) rather than hard-popping it into the layout and shoving
/// everything below it down. Height animates from zero and the content fades
/// in together; while [visible] is false it occupies no vertical space.
/// Tiny circular +/- button for manually correcting the rewatch count —
/// mirrors the desktop RewatchBadge control's inline stepper.
class _RewatchStepperButton extends StatelessWidget {
  final IconData icon;
  final VoidCallback? onTap;

  const _RewatchStepperButton({required this.icon, required this.onTap});

  @override
  Widget build(BuildContext context) {
    return InkWell(
      onTap: onTap,
      borderRadius: BorderRadius.circular(11),
      child: Container(
        width: 22,
        height: 22,
        alignment: Alignment.center,
        decoration: BoxDecoration(
          shape: BoxShape.circle,
          border: Border.all(color: AppColors.bgCard),
        ),
        child: Icon(
          icon,
          size: 14,
          color: onTap == null
              ? AppColors.textSecondary.withValues(alpha: 0.35)
              : AppColors.textSecondary,
        ),
      ),
    );
  }
}

class _RevealSection extends StatelessWidget {
  final bool visible;
  final Widget child;

  const _RevealSection({required this.visible, required this.child});

  @override
  Widget build(BuildContext context) {
    return AnimatedSize(
      duration: const Duration(milliseconds: 240),
      curve: Curves.easeOutCubic,
      alignment: Alignment.topCenter,
      child: AnimatedOpacity(
        duration: const Duration(milliseconds: 240),
        opacity: visible ? 1 : 0,
        child: visible
            ? child
            : const SizedBox(width: double.infinity, height: 0),
      ),
    );
  }
}

/// Which friends (+ maybe you, from another device/session) have
/// watched/rated this movie — one row per person, star rating shown when
/// they rated it, a plain "Watched" tag otherwise.
class _FriendActivitySection extends StatelessWidget {
  final List<SocialActivityItem> items;

  const _FriendActivitySection({required this.items});

  @override
  Widget build(BuildContext context) {
    return Column(
      crossAxisAlignment: CrossAxisAlignment.start,
      children: [
        Text('FRIENDS', style: AppTextStyles.sectionLabel()),
        const SizedBox(height: 8),
        Container(
          decoration: BoxDecoration(
            color: AppColors.bgCard,
            borderRadius: BorderRadius.circular(AppSpacing.cardRadiusMin),
          ),
          child: Column(
            children: [
              for (var i = 0; i < items.length; i++) ...[
                if (i > 0) const Divider(height: 1, color: AppColors.border),
                Padding(
                  padding: const EdgeInsets.symmetric(
                    horizontal: 14,
                    vertical: 10,
                  ),
                  child: Row(
                    children: [
                      FriendAvatar(profile: items[i].profile, size: 32),
                      const SizedBox(width: 10),
                      Expanded(
                        child: Text(
                          items[i].profile.name,
                          maxLines: 1,
                          overflow: TextOverflow.ellipsis,
                          style: AppTextStyles.dmSans(
                            fontSize: 13,
                            fontWeight: FontWeight.w600,
                          ),
                        ),
                      ),
                      if (items[i].rating != null && items[i].rating! > 0)
                        Row(
                          mainAxisSize: MainAxisSize.min,
                          children: [
                            const Icon(
                              Icons.star_rounded,
                              size: 15,
                              color: AppColors.star,
                            ),
                            const SizedBox(width: 3),
                            Text(
                              '${items[i].rating}',
                              style: AppTextStyles.dmSans(
                                fontSize: 12,
                                fontWeight: FontWeight.w600,
                                color: AppColors.star,
                              ),
                            ),
                          ],
                        )
                      else
                        Text(
                          'Watched',
                          style: AppTextStyles.dmSans(
                            fontSize: 11,
                            color: AppColors.textMuted,
                          ),
                        ),
                    ],
                  ),
                ),
              ],
            ],
          ),
        ),
      ],
    );
  }
}

/// Parses "2h 46m" (see [TitleItem.runtimeLabel]) into total minutes, for
/// [UserLibraryService.logWatched]'s estimated watch-time.
int _runtimeMinutes(String? label) {
  if (label == null) return 0;
  final match = RegExp(r'(?:(\d+)h)?\s*(?:(\d+)m)?').firstMatch(label);
  if (match == null) return 0;
  final hours = int.tryParse(match.group(1) ?? '') ?? 0;
  final minutes = int.tryParse(match.group(2) ?? '') ?? 0;
  return hours * 60 + minutes;
}

void _openActor(BuildContext context, CastMember member) {
  Navigator.of(context).push(
    MaterialPageRoute(
      builder: (_) => member.tmdbPersonId != null
          ? ActorScreen.real(castMember: member)
          : ActorScreen.mock(actor: MockData.actorById(member.mockActorId!)),
    ),
  );
}
