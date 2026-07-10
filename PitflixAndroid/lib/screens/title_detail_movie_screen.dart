import 'package:flutter/material.dart';
import '../config/app_config.dart';
import '../data/mock_data.dart';
import '../models/cast_member.dart';
import '../models/title_item.dart';
import '../services/local_backend_service.dart';
import '../services/tmdb_service.dart';
import '../theme/app_theme.dart';
import '../services/session_stats_store.dart';
import '../utils/favorites.dart';
import '../utils/reactions.dart';
import '../utils/title_actions_sheet.dart';
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
  TitleItem? _enriched;
  Map<String, dynamic>? _ratings;
  int? _favoritesListId;
  bool? _isFavorite;
  String _review = '';
  String? _reaction;

  @override
  void initState() {
    super.initState();
    if (widget.title.needsDetailEnrichment) {
      TmdbService.fetchDetails(widget.title.tmdbId!, TitleKind.movie).then((
        full,
      ) {
        if (mounted && full != null) setState(() => _enriched = full);
      });
    }
    if (AppConfig.useLocalBackend && widget.title.tmdbId != null) {
      LocalBackendService.fetchRatings(widget.title.tmdbId!, 'movie').then((
        data,
      ) {
        if (mounted && data != null) setState(() => _ratings = data);
      });
      _loadFavorite();
    }
  }

  Future<void> _loadFavorite() async {
    try {
      final listId = await findFavoritesListId();
      if (listId == null || !mounted) return;
      final isFav = await LocalBackendService.isInList(
        listId,
        widget.title.tmdbId!,
        'Movie',
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
        await LocalBackendService.addToList(
          listId,
          tmdbId: tmdbId,
          mediaType: 'Movie',
          title: t.name,
          posterRemoteUrl: TmdbService.posterUrl(t.posterPath),
        );
      } else {
        await LocalBackendService.removeFromList(listId, tmdbId, 'Movie');
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
    SessionStatsStore.logRating(result.$1, null);
    SessionStatsStore.logReaction(result.$4);
    setState(() {
      _rating = result.$1;
      _review = result.$2;
      _watchLater = result.$3;
      _reaction = result.$4;
      _watched = true;
    });
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
                    if (_ratings != null) ...[
                      RatingsRow(ratings: _ratings!),
                      const SizedBox(height: 16),
                    ],
                    SizedBox(
                      width: double.infinity,
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
                          'WATCH',
                          style: AppTextStyles.bebas(
                            fontSize: 20,
                            letterSpacing: 0.12,
                            color: AppColors.textPrimary,
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
                    TitleAboutSection(
                      overview: t.overview,
                      cast: t.cast.isNotEmpty
                          ? t.cast
                          : t.castActorIds
                                .map(MockData.actorById)
                                .map(CastMember.fromMockActor)
                                .toList(),
                      genres: t.genres,
                      onCastTap: (member) => _openActor(context, member),
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

void _openActor(BuildContext context, CastMember member) {
  Navigator.of(context).push(
    MaterialPageRoute(
      builder: (_) => member.tmdbPersonId != null
          ? ActorScreen.real(castMember: member)
          : ActorScreen.mock(actor: MockData.actorById(member.mockActorId!)),
    ),
  );
}
